// Offline checks of the installers. The full installs (downloads, npm ci, the smoke) run in
// .github/workflows/install-smoke.yml; these tests guard what can break without a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpSmoke, PROTOCOL } from "./mcp-smoke.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const SH = join(HERE, "install.sh");
const PS1 = join(HERE, "install.ps1");
const read = (f: string) => readFileSync(f, "utf8");
const noSh = process.platform === "win32" ? "install.sh is for macOS and Linux; CI runs it there" : false;

/** Run install.sh with a scratch HOME, so no test touches a real profile. */
function sh(args: string[], home: string) {
  return spawnSync("sh", [SH, ...args], { encoding: "utf8", env: { ...process.env, HOME: home, SHELL: "/bin/sh" }, timeout: 30_000 });
}

test("the installers are plain ASCII, so Windows PowerShell 5.1 and every shell read them the same", () => {
  for (const f of ["install.sh", "install.ps1", "smoke.sh", "smoke.ps1", "install-functions.test.ps1"]) {
    const bad = [...read(join(HERE, f))].findIndex((c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && c !== "\n" && c !== "\r" && c !== "\t"));
    assert.equal(bad, -1, `${f} has a non-ASCII character at offset ${bad}`);
  }
});

test("both installers want the Node major that package.json requires and the same repository", () => {
  const engines = (JSON.parse(read(join(ROOT, "package.json"))) as { engines: { node: string } }).engines.node;
  const major = /^>=(\d+)$/.exec(engines)?.[1];
  assert.ok(major, `engines.node is ${engines}`);
  assert.match(read(SH), new RegExp(`^NODE_MAJOR=${major}$`, "m"));
  assert.match(read(PS1), new RegExp(`\\$NodeMajor = ${major}$`, "m"));
  for (const f of [SH, PS1]) {
    assert.match(read(f), /NeuralDEEPnet\/Open3DJ/);
    assert.match(read(f), /SHASUMS256\.txt/);
    assert.match(read(f), /--omit=dev/);
    assert.match(read(f), /--ignore-scripts/);
  }
});

test("install.ps1 never calls exit, so irm | iex cannot close the user's PowerShell window", () => {
  const code = read(PS1).replace(/<#[\s\S]*?#>/g, "").split("\n").filter((l) => !l.trim().startsWith("#"));
  // The generated open3dj.ps1 shim may exit; it is written as single-quoted text.
  const exits = code.filter((l) => /(^|[;{]\s*)exit\b/.test(l.trim()) && !/^'.*'[,)]?$/.test(l.trim()));
  assert.deepEqual(exits, []);
  // It never asks for the machine scope.
  assert.doesNotMatch(read(PS1), /'Machine'\)\s*$|SetEnvironmentVariable\([^)]*'Machine'/m);
});

test("install.sh parses, prints help and rejects bad options", { skip: noSh }, () => {
  const home = mkdtempSync(join(tmpdir(), "o3j-install-"));
  try {
    for (const f of ["install.sh", "smoke.sh"]) assert.equal(spawnSync("sh", ["-n", join(HERE, f)]).status, 0, `${f} has a syntax error`);
    const help = sh(["--help"], home);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--source <dir>/);
    assert.match(help.stdout, /--uninstall/);
    assert.equal(sh(["--bogus"], home).status, 2);
    // A ref may not inject a command, nor walk the download URL out of the repository with "..".
    for (const bad of ["main;rm -rf ~", "../../../octocat/Hello-World/tar.gz/master", "a//b", ".x", "x/", "x.lock"]) {
      const ref = sh(["--ref", bad, "--uninstall", "--yes", "--prefix", join(home, "none")], home);
      assert.equal(ref.status, 1, bad);
      assert.match(ref.stderr, /is not a branch, tag or commit name/, bad);
    }
    assert.equal(sh(["--ref", "v1.2.3", "--uninstall", "--yes", "--prefix", join(home, "none")], home).status, 0);
    const http = spawnSync("sh", [SH, "--uninstall", "--yes"], { encoding: "utf8", env: { ...process.env, HOME: home, OPEN3DJ_NODE_DIST: "http://nodejs.org/dist" } });
    assert.match(http.stderr, /must be an https:\/\/ address/);
    assert.match(sh(["--prefix"], home).stderr, /--prefix needs a value/);
    assert.match(sh(["--prefix", home, "--yes"], home).stderr, /not \/ or your home folder/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install.sh never installs into or uninstalls a folder it did not make", { skip: noSh }, () => {
  const home = mkdtempSync(join(tmpdir(), "o3j-install-"));
  try {
    const precious = join(home, "precious");
    mkdirSync(precious);
    writeFileSync(join(precious, "keep.txt"), "keep");
    const un = sh(["--uninstall", "--prefix", precious, "--yes"], home);
    assert.equal(un.status, 1);
    assert.match(un.stderr, /no \.open3dj-install marker/);
    const inst = sh(["--prefix", precious, "--source", ROOT, "--yes"], home);
    assert.equal(inst.status, 1);
    assert.match(inst.stderr, /was not made by this installer/);
    assert.ok(existsSync(join(precious, "keep.txt")));
    // An uninstall with nothing installed succeeds and leaves a profile without its lines.
    writeFileSync(join(home, ".profile"), "export A=1\nexport PATH=\"/x:$PATH\" # added by the Open3DJ installer\n");
    const clean = sh(["--uninstall", "--yes"], home);
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(read(join(home, ".profile")), "export A=1\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** A stand-in Open3DJ folder with no dependencies, so npm ci needs no network. */
function fakeSource(root: string) {
  mkdirSync(join(root, "packages", "open3dj", "src"), { recursive: true });
  mkdirSync(join(root, "scripts", "install"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake-open3dj", version: "0.0.0", private: true }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "fake-open3dj", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fake-open3dj", version: "0.0.0" } } }));
  writeFileSync(join(root, "packages", "open3dj", "src", "cli.ts"), 'console.log(process.argv[2] === "--version" ? "0.0.0-test" : "fake " + process.argv.slice(2).join(" "));\n');
  cpSync(SH, join(root, "scripts", "install", "install.sh"));
}

test("install.sh writes the PATH lines to the right profiles when HOME has spaces, moves them with --bin-dir, and uninstalls it all", { skip: noSh, timeout: 120_000 }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "o3j-install-"));
  try {
    const home = join(tmp, "home", "Jane Doe Zo\u00eb");
    const run = join(tmp, "run");
    const src = join(tmp, "src");
    mkdirSync(home, { recursive: true });
    mkdirSync(run);
    fakeSource(src);
    writeFileSync(join(home, ".bashrc"), "# mine\n");
    const prefix = join(home, "o3j");
    const env = {
      ...process.env,
      HOME: home,
      SHELL: "/bin/bash",
      PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ""),
      npm_config_offline: "true",
      npm_config_cache: join(tmp, "npm-cache"),
    };
    const install = (...extra: string[]) => spawnSync("sh", [SH, "--source", src, "--prefix", prefix, "--yes", ...extra], { cwd: run, encoding: "utf8", env, timeout: 60_000 });
    const marked = (f: string) => existsSync(f) ? read(f).split("\n").filter((l) => l.includes("# added by the Open3DJ installer")) : [];

    const first = install();
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const bin = join(home, ".local", "bin");
    for (const f of [".profile", ".bashrc"]) assert.deepEqual(marked(join(home, f)), [`export PATH="${bin}:$PATH" # added by the Open3DJ installer`], f);
    assert.match(read(join(home, ".bashrc")), /^# mine\n/);
    assert.deepEqual(readdirSync(run), [], "nothing is written next to where the installer ran");
    // The Claude Desktop entry it prints is valid JSON.
    const desktop = first.stdout.split("\n").find((l) => l.trimStart().startsWith('"open3dj": '));
    assert.ok(desktop, first.stdout);
    const entry = (JSON.parse(`{${desktop}}`) as { open3dj: { command: string; args: string[] } }).open3dj;
    assert.deepEqual(entry.args.slice(1), ["mcp", "--root", join(home, "open3dj-designs")]);

    // Another --bin-dir: the old command goes and each profile line is replaced, not kept.
    const bin2 = join(home, "bin 2");
    const second = install("--bin-dir", bin2);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.ok(!existsSync(join(bin, "open3dj")), "the command in the old --bin-dir is left behind");
    assert.ok(existsSync(join(bin2, "open3dj")));
    for (const f of [".profile", ".bashrc"]) assert.deepEqual(marked(join(home, f)), [`export PATH="${bin2}:$PATH" # added by the Open3DJ installer`], f);
    const shim = spawnSync(join(bin2, "open3dj"), ["--version"], { encoding: "utf8", env });
    assert.equal(shim.stdout.trim(), "0.0.0-test");

    // Uninstall from the app folder, without --bin-dir: install.json names the command.
    const un = spawnSync("sh", [join(prefix, "app", "scripts", "install", "install.sh"), "--uninstall", "--yes", "--prefix", prefix], { cwd: run, encoding: "utf8", env });
    assert.equal(un.status, 0, un.stderr);
    assert.ok(!existsSync(prefix));
    assert.ok(!existsSync(join(bin2, "open3dj")));
    for (const f of [".profile", ".bashrc"]) assert.deepEqual(marked(join(home, f)), [], f);
    assert.equal(read(join(home, ".bashrc")), "# mine\n");
    assert.deepEqual(readdirSync(run), []);

    // An install folder inside --source is refused before anything is written.
    const inside = spawnSync("sh", [SH, "--source", src, "--prefix", join(src, "inst"), "--yes"], { cwd: run, encoding: "utf8", env });
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /is inside --source/);
    assert.ok(!existsSync(join(src, "inst")));

    // The same through a symbolic link, as macOS has for its temp folder (/var -> /private/var):
    // the prefix does not exist yet, so only its parent can be resolved.
    const link = join(tmp, "linked");
    symlinkSync(tmp, link);
    const viaLink = join(link, relative(tmp, src));
    const linked = spawnSync("sh", [SH, "--source", viaLink, "--prefix", join(viaLink, "inst-linked"), "--yes"], { cwd: run, encoding: "utf8", env });
    assert.equal(linked.status, 1, linked.stdout + linked.stderr);
    assert.match(linked.stderr, /is inside --source/);
    assert.ok(!existsSync(join(src, "inst-linked")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** The PowerShells on this machine: Windows PowerShell 5.1 and PowerShell 7 where present. */
function powershells(): string[] {
  const names = process.platform === "win32" ? ["powershell.exe", "pwsh.exe"] : ["pwsh"];
  return names.filter((n) => spawnSync(n, ["-NoProfile", "-Command", "exit 0"], { timeout: 60_000 }).status === 0);
}
const shells = powershells();

for (const ps of shells.length ? shells : ["PowerShell"]) {
  test(`install.ps1 helpers in ${ps}: deletes never follow links or meet cmd.exe, the marker goes last, open3dj.cmd is ASCII`, { skip: shells.length ? false : "no PowerShell on this machine", timeout: 120_000 }, () => {
    const base = mkdtempSync(join(tmpdir(), "o3j-ps-"));
    try {
      // "a&b" without a space is what cmd.exe split into two commands; the rest are characters
      // a Windows user name may hold, and a name no single code page can write.
      const odd = ["a&b^c%OS%(1)", "Zo\u00eb \u0141 & R&D ^%PATH%!"];
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "install-functions.test.ps1")], {
        encoding: "utf8",
        timeout: 110_000,
        env: { ...process.env, O3J_PS1: PS1, O3J_BASE: base, O3J_ODD: odd.join("|"), O3J_NODE: process.execPath },
      });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const out = JSON.parse(r.stdout.trim().split("\n").pop()!) as {
        functions: string[];
        trees: { name: string; linked: boolean; removed: boolean; siblingKept: boolean }[];
        linkTargetKept: boolean;
        busy?: { renameFailed: boolean; threw: boolean; markerKept: boolean; removedAfterClose: boolean };
        refsOk: string[];
        refsBad: string[];
        inside: boolean[];
        shim: { private: string; nvm: string; percent: string; ascii: boolean; refused: string; asciiPreamble: number };
        run?: { output: string; exitCode: number };
        retry: { free: boolean; busyFails?: boolean; renamesAfterClose?: boolean };
      };
      assert.equal(out.functions.length, 10, out.functions.join(", "));
      assert.equal(out.retry.free, true, "Rename-WithRetry did not rename a free folder");
      if (process.platform === "win32") assert.deepEqual([out.retry.busyFails, out.retry.renamesAfterClose], [true, true], "Rename-WithRetry on a busy folder");
      assert.deepEqual(out.trees.map((t) => t.name), odd);
      for (const t of out.trees) assert.deepEqual([t.linked, t.removed, t.siblingKept], [true, true, true], t.name);
      assert.ok(out.linkTargetKept, "Remove-Tree followed a link and deleted its target");
      if (process.platform === "win32") {
        assert.deepEqual(out.busy, { renameFailed: true, threw: true, markerKept: true, removedAfterClose: true });
        assert.deepEqual(out.run, { output: '["hello"]', exitCode: 0 });
      }
      assert.equal(out.refsOk.length, 5);
      assert.equal(out.refsBad.length, 13);
      assert.deepEqual(out.inside, [true, true, false, false]);
      assert.match(out.shim.private, /^"%~dp0\.\.\\node\\node\.exe" "%~dp0\.\.\\app\\packages\\open3dj\\src\\cli\.ts" %\*\r$/m);
      assert.match(out.shim.nvm, /^"%APPDATA%\\nvm\\v24\.22\.1\\node\.exe" /m);
      assert.match(out.shim.percent, /^"C:\\tools\\50%%\\node\.exe" /m);
      assert.ok(out.shim.ascii);
      assert.equal(out.shim.asciiPreamble, 0, "open3dj.cmd would start with a byte order mark");
      assert.match(out.shim.refused, /cannot hold/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}

test("mcp-smoke speaks raw JSON-RPC to this checkout's server", { timeout: 120_000 }, async () => {
  const r = await mcpSmoke({ command: process.execPath, args: [join(ROOT, "packages", "open3dj", "src", "cli.ts")] });
  assert.equal(r.protocolVersion, PROTOCOL);
  assert.equal(r.serverName, "open3dj");
  assert.deepEqual(r.tools, ["docs", "export", "inspect", "render", "run"]);
  assert.equal(r.run.status, "ok");
  assert.equal(r.run.rev, "r_0001");
  assert.ok(r.run.volume_mm3 > 0);
});
