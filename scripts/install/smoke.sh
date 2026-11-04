#!/bin/sh
# Checks an installed open3dj the way a person uses it: open3dj from PATH runs doctor, runs two
# examples, exports STEP and 3MF, renders PNGs and serves one MCP session over stdio. The
# install smoke workflow runs it in a fresh login shell after install.sh; you can run it too.
#
#   sh scripts/install/smoke.sh <out-dir> [<prefix>]
#
# <prefix> is the install folder (default ~/.local/share/open3dj). Results go to <out-dir>:
# doctor.json, bracket.png, enclosure.png, exports/, mcp-smoke.json.
set -eu

[ $# -ge 1 ] || { echo "usage: sh smoke.sh <out-dir> [<prefix>]" >&2; exit 3; }
out="$1"
prefix="${2:-$HOME/.local/share/open3dj}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
mkdir -p "$out/work"
out="$(cd "$out" && pwd)"

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'smoke: FAILED: %s\n' "$*" >&2; exit 1; }

step "open3dj on PATH"
command -v open3dj || fail "open3dj is not on PATH in this shell"
open3dj --version

step "doctor --json"
open3dj doctor --json >"$out/doctor.json"
grep -q '"cpu.wasm"' "$out/doctor.json" || fail "doctor --json lists no cpu.wasm backend"

cp "$repo/examples/bracket/bracket.o3j.js" "$repo/examples/enclosure/enclosure.o3j.js" "$out/work/"
cd "$out/work"

step "run"
open3dj run bracket.o3j.js
open3dj run enclosure.o3j.js

step "export"
open3dj export bracket.o3j --format step --out "$out/exports"
open3dj export enclosure.o3j --format step --out "$out/exports"
open3dj export enclosure.o3j --format 3mf --out "$out/exports"
for f in bracket.step enclosure.step; do
  [ "$(head -c 13 "$out/exports/$f")" = "ISO-10303-21;" ] || fail "$f is not a STEP file"
done
[ "$(head -c 2 "$out/exports/enclosure.3mf")" = "PK" ] || fail "enclosure.3mf is not a zip (3MF) file"

step "render"
open3dj render bracket.o3j --out "$out/bracket.png"
open3dj render enclosure.o3j --out "$out/enclosure.png"
for f in bracket.png enclosure.png; do
  [ "$(head -c 4 "$out/$f" | tail -c 3)" = "PNG" ] || fail "$f is not a PNG"
done

step "MCP over stdio"
node="$(sed -n 's/^ *"node": "\(.*\)",*$/\1/p' "$prefix/install.json" | head -n 1)"
[ -x "$node" ] || fail "no node in $prefix/install.json"
"$node" "$here/mcp-smoke.ts" --install "$prefix/install.json" | tee "$out/mcp-smoke.json"

printf '\nsmoke: all checks passed\n'
