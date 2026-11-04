#!/bin/sh
# Open3DJ installer for macOS and Linux (x64 and arm64). POSIX sh.
#
#   curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.sh -o install-open3dj.sh
#   sh install-open3dj.sh            # read it first, then run it
#
# What it does, all inside your home folder and without sudo:
#   1. Uses the node on your PATH if it is version 24 or newer. Otherwise it downloads the
#      official Node 24 build from nodejs.org, checks its SHA-256 against SHASUMS256.txt and
#      keeps it private to the install folder. It never touches a system Node.
#   2. Downloads the Open3DJ source for --ref from GitHub (or copies --source), and runs
#      npm ci --omit=dev --ignore-scripts in it.
#   3. Writes the open3dj command to <prefix>/bin and <bin-dir>, and adds <bin-dir> to your
#      shell profile when it is not on your PATH yet (unless --no-path).
#   4. Runs open3dj doctor and prints the next steps.
# Rerunning it upgrades in place. --uninstall removes everything it added; your designs are
# never touched.

set -eu

REPO="${OPEN3DJ_REPO:-NeuralDEEPnet/Open3DJ}"
NODE_MAJOR=24
NODE_DIST="${OPEN3DJ_NODE_DIST:-https://nodejs.org/dist}"
MARKER="# added by the Open3DJ installer"
SHIM_TAG="# Open3DJ command, written by the Open3DJ installer."
REPORT_URL="https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml"

ref="main"
source_dir=""
prefix="$HOME/.local/share/open3dj"
bin_dir="$HOME/.local/bin"
bin_dir_set=0
no_path=0
yes=0
uninstall=0
private_node=0

usage() {
  cat <<EOF
Open3DJ installer for macOS and Linux.

Usage: sh install.sh [options]

  --ref <ref>        Git branch, tag or commit to install (default: main)
  --source <dir>     Install from a local Open3DJ folder instead of downloading
  --prefix <dir>     Install folder (default: ~/.local/share/open3dj)
  --bin-dir <dir>    Folder for the open3dj command (default: ~/.local/bin)
  --no-path          Do not add the command folder to your shell profile
  --private-node     Download a private Node $NODE_MAJOR even if a suitable node is on PATH
  --yes, -y          Do not ask questions
  --uninstall        Remove Open3DJ from --prefix and --bin-dir
  --help, -h         Show this help

Rerun the installer to upgrade. Nothing needs sudo.
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() {
  printf 'open3dj installer: error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value. Run with --help for the options."
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) need_value "$@"; ref="$2"; shift 2 ;;
    --ref=*) ref="${1#*=}"; shift ;;
    --source) need_value "$@"; source_dir="$2"; shift 2 ;;
    --source=*) source_dir="${1#*=}"; shift ;;
    --prefix) need_value "$@"; prefix="$2"; shift 2 ;;
    --prefix=*) prefix="${1#*=}"; shift ;;
    --bin-dir) need_value "$@"; bin_dir="$2"; bin_dir_set=1; shift 2 ;;
    --bin-dir=*) bin_dir="${1#*=}"; bin_dir_set=1; shift ;;
    --no-path) no_path=1; shift ;;
    --private-node) private_node=1; shift ;;
    --yes | -y) yes=1; shift ;;
    --uninstall) uninstall=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) printf 'open3dj installer: unknown option "%s". Run with --help for the options.\n' "$1" >&2; exit 2 ;;
  esac
done

# A git ref the way git check-ref-format allows it, within a safe character set. No "..", so a
# ref can never walk the download URL out of the repository.
case "$ref" in
  *[!A-Za-z0-9._/-]* | -* | /* | .* | */ | *. | *..* | *//* | */.* | *.lock | *.lock/* | "")
    die "--ref \"$ref\" is not a branch, tag or commit name" ;;
esac
case "$NODE_DIST" in
  https://*) ;;
  *) die "OPEN3DJ_NODE_DIST must be an https:// address, not $NODE_DIST" ;;
esac

# Make a path absolute without requiring it to exist.
absolute() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd)" "$1" ;;
  esac
}
prefix="$(absolute "${prefix%/}")"
bin_dir="$(absolute "${bin_dir%/}")"
[ "$prefix" != "/" ] && [ "$prefix" != "$HOME" ] || die "--prefix must be a folder of its own, not / or your home folder"

# Ask a yes/no question; the default is yes. With --yes, or with no terminal to ask on, the
# answer is the default.
confirm() {
  [ "$yes" = 1 ] && return 0
  if [ -t 0 ]; then
    printf '%s [Y/n] ' "$1"
    read -r answer || answer=""
  elif (exec </dev/tty) 2>/dev/null; then
    printf '%s [Y/n] ' "$1"
    read -r answer </dev/tty || answer=""
  else
    return 0
  fi
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

have() { command -v "$1" >/dev/null 2>&1; }

# HTTPS only, also after a redirect. BusyBox wget has no --https-only; the URLs are https anyway.
wget_https() {
  if wget --help 2>&1 | grep -q -- --https-only; then wget --https-only "$@"; else wget "$@"; fi
}

# download <url> <file>
download() {
  if have curl; then
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 -o "$2" "$1" || die "could not download $1"
  elif have wget; then
    wget_https -q -O "$2" "$1" || die "could not download $1"
  else
    die "neither curl nor wget is installed; install one of them and run this again"
  fi
}

# fetch <url> [header]: print a small text file, or nothing on failure.
fetch() {
  if have curl; then
    if [ $# -ge 2 ]; then curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 20 -H "$2" "$1" 2>/dev/null || true
    else curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 20 "$1" 2>/dev/null || true; fi
  elif have wget; then
    if [ $# -ge 2 ]; then wget_https -q -O - --header="$2" "$1" 2>/dev/null || true
    else wget_https -q -O - "$1" 2>/dev/null || true; fi
  fi
}

sha256() {
  if have sha256sum; then sha256sum "$1" | cut -d ' ' -f 1
  elif have shasum; then shasum -a 256 "$1" | cut -d ' ' -f 1
  elif have openssl; then openssl dgst -sha256 "$1" | sed 's/^.*= *//'
  else die "no SHA-256 tool found (sha256sum, shasum or openssl)"
  fi
}

# Shell profiles that get the PATH line: ~/.profile for sh, and the rc file of your shell. One
# per line: callers read them with "while IFS= read -r", because a home folder may hold spaces.
profiles() {
  printf '%s\n' "$HOME/.profile"
  case "${SHELL:-}" in
    */zsh) printf '%s\n' "$HOME/.zshrc" ;;
    */bash)
      printf '%s\n' "$HOME/.bashrc"
      [ -f "$HOME/.bash_profile" ] && printf '%s\n' "$HOME/.bash_profile"
      ;;
    */fish) printf '%s\n' "$HOME/.config/fish/conf.d/open3dj.fish" ;;
  esac
  return 0
}

remove_marked_lines() {
  [ -f "$1" ] || return 0
  grep -qF "$MARKER" "$1" || return 0
  tmp_profile="$(mktemp)"
  grep -vF "$MARKER" "$1" >"$tmp_profile" || true
  cat "$tmp_profile" >"$1"
  rm -f "$tmp_profile"
  say "removed the PATH line from $1"
}

# The PATH line for profile file $1 and command folder $2.
profile_line() {
  case "$1" in
    *.fish) printf 'set -gx PATH "%s" $PATH %s\n' "$2" "$MARKER" ;;
    *) printf 'export PATH="%s:$PATH" %s\n' "$2" "$MARKER" ;;
  esac
}

# The command an earlier install recorded in <prefix>/install.json, if any. install.json is
# written by JSON.stringify with two-space indents; a path with an escape in it is skipped.
recorded_shim() {
  [ -f "$prefix/install.json" ] || return 0
  sed -n 's/^  "shim": "\(.*\)",\{0,1\}$/\1/p' "$prefix/install.json" | grep -v '\\' | head -n 1
}

# Remove a command file, but only one this installer wrote.
remove_shim() {
  if [ -n "$1" ] && [ -f "$1" ] && grep -qF "$SHIM_TAG" "$1"; then rm -f "$1" && say "removed $1"; fi
  return 0
}

# ---- uninstall -------------------------------------------------------------------------

if [ "$uninstall" = 1 ]; then
  if [ -d "$prefix" ] && [ ! -f "$prefix/.open3dj-install" ]; then
    die "$prefix has no .open3dj-install marker, so it was not made by this installer. Nothing was removed."
  fi
  say "This removes $prefix, $bin_dir/open3dj and the PATH lines this installer added."
  say "Your designs and projects are not touched."
  confirm "Uninstall Open3DJ?" || { say "Nothing was removed."; exit 0; }
  old_shim="$(recorded_shim)"
  remove_shim "$bin_dir/open3dj"
  remove_shim "$prefix/bin/open3dj"
  remove_shim "$old_shim"
  while IFS= read -r f; do remove_marked_lines "$f"; done <<EOF
$(profiles)
$HOME/.bashrc
$HOME/.bash_profile
$HOME/.zshrc
EOF
  rm -f "$HOME/.config/fish/conf.d/open3dj.fish"
  if [ -d "$prefix" ]; then
    # The marker goes last, so an uninstall that stops part way can be run again.
    find "$prefix" -mindepth 1 -maxdepth 1 ! -name .open3dj-install -exec rm -rf {} + 2>/dev/null || true
    if [ -n "$(find "$prefix" -mindepth 1 -maxdepth 1 ! -name .open3dj-install)" ]; then
      die "could not remove everything in $prefix. Close programs that use Open3DJ and run this again."
    fi
    rm -f "$prefix/.open3dj-install"
    rmdir "$prefix" || die "could not remove $prefix"
    say "removed $prefix"
  fi
  say "Open3DJ is uninstalled. Open a new terminal to refresh your PATH."
  exit 0
fi

# ---- platform ----------------------------------------------------------------------------

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW* | MSYS* | CYGWIN*) die "this is Windows: use scripts/install/install.ps1 in PowerShell instead" ;;
  *) die "$(uname -s) is not supported yet; Open3DJ runs on Linux, macOS and Windows" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) arch="$(uname -m)" ;;
esac
# A shell under Rosetta reports x86_64 on Apple silicon; the native build is faster.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
musl=0
if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); }; then musl=1; fi

say "Open3DJ installer: $os-$arch, prefix $prefix"

if [ -n "$source_dir" ]; then
  source_dir="$(cd "$source_dir" 2>/dev/null && pwd -P)" || die "--source folder not found"
  [ -f "$source_dir/package.json" ] && [ -f "$source_dir/packages/open3dj/src/cli.ts" ] \
    || die "$source_dir is not an Open3DJ folder (no packages/open3dj/src/cli.ts)"
  # The copy would take in the old install (and the private Node) if the prefix were inside.
  # Resolve the deepest folder that exists and keep the rest, so a prefix that is not made
  # yet still compares as a real path (on macOS the temp folder /var is a link to /private/var).
  real_prefix="$prefix"; rest=""
  while [ ! -d "$real_prefix" ] && [ "$real_prefix" != "$(dirname "$real_prefix")" ]; do
    rest="/$(basename "$real_prefix")$rest"; real_prefix="$(dirname "$real_prefix")"
  done
  real_prefix="$(cd "$real_prefix" && pwd -P)$rest"
  case "$real_prefix/" in
    "$source_dir/"*) die "the install folder $prefix is inside --source $source_dir. Choose a --prefix outside it." ;;
  esac
fi

if [ -d "$prefix" ] && [ ! -f "$prefix/.open3dj-install" ] && [ -n "$(ls -A "$prefix" 2>/dev/null)" ]; then
  die "$prefix exists and was not made by this installer. Choose another --prefix or empty it."
fi
mkdir -p "$prefix" || die "cannot create $prefix"
printf '%s\n' "Open3DJ install folder, made by scripts/install/install.sh. Remove it with: sh install.sh --uninstall" >"$prefix/.open3dj-install"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/open3dj-install.XXXXXX")" || die "cannot create a temporary folder"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

# ---- Node --------------------------------------------------------------------------------

node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

install_private_node() {
  [ "$musl" = 0 ] || die "nodejs.org has no official Node build for musl (Alpine). Install Node $NODE_MAJOR with your package manager (apk add nodejs-current npm) and run this again."
  dist="$NODE_DIST/latest-v$NODE_MAJOR.x"
  download "$dist/SHASUMS256.txt" "$tmp/SHASUMS256.txt"
  line="$(grep -E "^[0-9a-f]{64}  node-v$NODE_MAJOR\.[0-9]+\.[0-9]+-$os-$arch\.tar\.gz\$" "$tmp/SHASUMS256.txt" | head -n 1 || true)"
  [ -n "$line" ] || die "nodejs.org has no Node $NODE_MAJOR build for $os-$arch. Install Node $NODE_MAJOR or newer yourself and run this again."
  want="${line%% *}"
  file="${line##* }"
  version="${file#node-}"
  version="${version%%-*}"
  if [ -x "$prefix/node/bin/node" ] && [ "$("$prefix/node/bin/node" --version 2>/dev/null)" = "$version" ]; then
    say "private Node $version is up to date"
    return 0
  fi
  say "downloading Node $version for $os-$arch from nodejs.org"
  download "$dist/$file" "$tmp/$file"
  got="$(sha256 "$tmp/$file")"
  [ "$got" = "$want" ] || die "SHA-256 mismatch for $file: expected $want, got $got. Nothing was installed."
  say "SHA-256 matches SHASUMS256.txt ($want)"
  mkdir "$tmp/node"
  tar -xzf "$tmp/$file" -C "$tmp/node" || die "could not extract $file"
  rm -rf "$prefix/node.new"
  mv "$tmp/node/node-$version-$os-$arch" "$prefix/node.new" || die "unexpected layout in $file"
  rm -rf "$prefix/node"
  mv "$prefix/node.new" "$prefix/node"
  say "Node $version is in $prefix/node (private to Open3DJ)"
}

step "Node"
node=""
if [ "$private_node" = 0 ] && have node && [ "$(node_major node)" -ge "$NODE_MAJOR" ] 2>/dev/null; then
  node="$(node -p 'process.execPath')"
  say "using $node ($(node --version))"
else
  if [ "$private_node" = 1 ]; then
    say "--private-node: Open3DJ gets its own Node $NODE_MAJOR"
  elif have node; then
    say "the node on your PATH is $(node --version 2>/dev/null || echo unknown); Open3DJ needs $NODE_MAJOR or newer"
  else
    say "no node on your PATH; Open3DJ needs Node $NODE_MAJOR or newer"
  fi
  confirm "Download Node $NODE_MAJOR from nodejs.org into $prefix/node (private to Open3DJ)?" \
    || die "Open3DJ needs Node $NODE_MAJOR. Install it (https://nodejs.org) and run this again."
  install_private_node
  node="$prefix/node/bin/node"
fi
node_dir="$(dirname "$node")"
npm_cli="$node_dir/../lib/node_modules/npm/bin/npm-cli.js"

# ---- source ------------------------------------------------------------------------------

step "Open3DJ source"
mkdir "$tmp/src"
commit=""
if [ -n "$source_dir" ]; then
  say "copying $source_dir (without node_modules, .git and project folders that runs made)"
  (cd "$source_dir" && tar -cf - --exclude=node_modules --exclude=.git --exclude='*.o3j' --exclude=.o3j-cache .) | (cd "$tmp/src" && tar -xf -) \
    || die "could not copy $source_dir"
  if have git; then commit="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true)"; fi
  src="$tmp/src"
  kind=local
else
  # Pin the ref to a commit first, so install.json and doctor --report name what was installed.
  commit="$(fetch "https://api.github.com/repos/$REPO/commits/$ref" "Accept: application/vnd.github.sha" | head -c 40)"
  case "$commit" in *[!0-9a-f]* | "") commit="" ;; esac
  say "downloading $REPO at $ref${commit:+ (commit $commit)}"
  download "https://codeload.github.com/$REPO/tar.gz/${commit:-$ref}" "$tmp/source.tar.gz"
  tar -xzf "$tmp/source.tar.gz" -C "$tmp/src" || die "could not extract the source archive"
  src="$(find "$tmp/src" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -f "$src/packages/open3dj/src/cli.ts" ] || die "the archive for $ref does not hold Open3DJ"
  kind=github
fi

# ---- app and dependencies ------------------------------------------------------------------

step "Dependencies"
app="$prefix/app"
rm -rf "$prefix/app.old" "$prefix/app.new"
mv "$src" "$prefix/app.new" 2>/dev/null || { mkdir "$prefix/app.new" && cp -R "$src/." "$prefix/app.new/"; } \
  || die "could not place the source in $prefix"
if [ -d "$app" ]; then mv "$app" "$prefix/app.old"; fi
mv "$prefix/app.new" "$app"
restore() {
  rm -rf "$app"
  if [ -d "$prefix/app.old" ]; then mv "$prefix/app.old" "$app" && say "the previous install is unchanged"; fi
}
# Only runtime dependencies, and no install scripts (none of them needs one).
if [ -f "$npm_cli" ]; then
  npm_run() { (cd "$app" && PATH="$node_dir:$PATH" "$node" "$npm_cli" "$@"); }
elif have npm; then
  npm_run() { (cd "$app" && PATH="$node_dir:$PATH" npm "$@"); }
else
  restore
  die "npm was not found next to $node. Rerun with --private-node to use a private Node $NODE_MAJOR."
fi
if ! npm_run ci --omit=dev --ignore-scripts --no-audit --no-fund --update-notifier=false --loglevel=error; then
  restore
  say "Behind a company proxy, npm needs HTTPS_PROXY (export HTTPS_PROXY=http://proxy.example:8080); it does not read the system proxy settings. If the proxy inspects HTTPS (UNABLE_TO_GET_ISSUER_CERT_LOCALLY), also export NODE_EXTRA_CA_CERTS=<the proxy's CA file>, or NODE_OPTIONS=--use-system-ca. Then run this again." >&2
  die "npm ci failed (see above)"
fi
cli="$app/packages/open3dj/src/cli.ts"
if ! version="$("$node" "$cli" --version)"; then
  restore
  die "open3dj does not start; see the error above"
fi
rm -rf "$prefix/app.old"
say "open3dj $version in $app"

# ---- command ---------------------------------------------------------------------------

step "Command"
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
write_shim() {
  cat >"$1" <<EOF
#!/bin/sh
$SHIM_TAG
# Rerun the installer to update it; see $app/scripts/install/install.sh.
node=$(quote "$node")
cli=$(quote "$cli")
if [ ! -x "\$node" ]; then
  echo "open3dj: Node was not found at \$node. Rerun the Open3DJ installer." >&2
  exit 127
fi
exec "\$node" "\$cli" "\$@"
EOF
  chmod 755 "$1"
}
mkdir -p "$prefix/bin" "$bin_dir" || die "cannot create $bin_dir"
# A command an earlier install wrote to another --bin-dir would outlive this install's app.
old_shim="$(recorded_shim)"
if [ "$old_shim" != "$prefix/bin/open3dj" ] && [ "$old_shim" != "$bin_dir/open3dj" ]; then remove_shim "$old_shim"; fi
write_shim "$prefix/bin/open3dj"
shim="$prefix/bin/open3dj"
if [ "$bin_dir" != "$prefix/bin" ]; then
  if [ -e "$bin_dir/open3dj" ] && ! grep -qF "$SHIM_TAG" "$bin_dir/open3dj" 2>/dev/null; then
    die "$bin_dir/open3dj exists and was not written by this installer. Move it, or pass --bin-dir."
  fi
  write_shim "$bin_dir/open3dj"
  shim="$bin_dir/open3dj"
fi
say "wrote $shim"

"$node" -e '
const [file, node, cli, app, shim, ref, commit, source] = process.argv.slice(1);
const info = { installer: "install.sh", node, cli, app, shim, ref, source, installed: new Date().toISOString() };
if (commit) info.commit = commit;
require("node:fs").writeFileSync(file, JSON.stringify(info, null, 2) + "\n");
' "$prefix/install.json" "$node" "$cli" "$app" "$shim" "$ref" "$commit" "$kind"

on_path=0
case ":$PATH:" in *":$bin_dir:"*) on_path=1 ;; esac
if [ "$no_path" = 0 ]; then
  if [ "$on_path" = 0 ]; then
    case "$bin_dir" in *[\"\$\`\\]*) die "$bin_dir has characters that cannot go in a profile line; pass --no-path and add it yourself" ;; esac
  fi
  while IFS= read -r f; do
    if [ -f "$f" ] && grep -qF "$MARKER" "$f"; then
      if grep -qxF "$(profile_line "$f" "$bin_dir")" "$f"; then continue; fi
      # A line from an install with another --bin-dir is replaced, not kept.
      remove_marked_lines "$f"
    fi
    [ "$on_path" = 0 ] || continue
    mkdir -p "$(dirname "$f")"
    profile_line "$f" "$bin_dir" >>"$f"
    say "added $bin_dir to PATH in $f"
  done <<EOF
$(profiles)
EOF
fi

# ---- check -------------------------------------------------------------------------------

step "open3dj doctor"
"$shim" doctor || die "open3dj is installed, but open3dj doctor failed (see above)"

# JSON.stringify escapes any quote or backslash in the paths.
desktop="$("$node" -e 'const [command, cli, root] = process.argv.slice(1); console.log(JSON.stringify({ command, args: [cli, "mcp", "--root", root] }))' "$node" "$cli" "$HOME/open3dj-designs")"
uninstall_cmd="sh $(quote "$app/scripts/install/install.sh") --uninstall"
[ "$prefix" = "$HOME/.local/share/open3dj" ] || uninstall_cmd="$uninstall_cmd --prefix $(quote "$prefix")"
[ "$bin_dir_set" = 0 ] || uninstall_cmd="$uninstall_cmd --bin-dir $(quote "$bin_dir")"

cat <<EOF

Open3DJ $version is installed${commit:+ (commit $(printf '%s' "$commit" | cut -c 1-12))}.
EOF
if [ "$on_path" = 0 ]; then
  if [ "$no_path" = 0 ]; then
    say "Open a new terminal so that open3dj is on your PATH, or run: export PATH=\"$bin_dir:\$PATH\""
  else
    say "$bin_dir is not on your PATH. Run open3dj as $shim, or add the folder yourself."
  fi
fi
cat <<EOF

Try it:
  mkdir -p ~/open3dj-designs && cd ~/open3dj-designs
  cp $(quote "$app/examples/bracket/bracket.o3j.js") .
  open3dj run bracket.o3j.js
  open3dj view bracket.o3j.js          # opens the 3D viewer in your browser

Connect an agent (the server runs with this Node, so no PATH is needed):
  Claude Code:     claude mcp add open3dj -- $(quote "$node") $(quote "$cli") mcp
  Claude Desktop:  add this to claude_desktop_config.json, with your designs folder as --root:
    "open3dj": $desktop
  More clients:    $app/docs/GETTING-STARTED.md

Tell us how it went. Every report helps, and so does "it just worked":
  open3dj doctor --report     prints a hardware report to paste into
  $REPORT_URL

Upgrade: run this installer again.
Uninstall: $uninstall_cmd
EOF
