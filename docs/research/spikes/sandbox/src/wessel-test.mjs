// @sebastianwessel/quickjs 3.1.0: what it exposes by default, per-run cost, host-call cost, limits.
import { depsPath, now, stats, r3, median, pkgVersion } from "./lib/util.mjs";
const deps = depsPath();
const { loadQuickJs } = await import(`file://${deps}/node_modules/@sebastianwessel/quickjs/dist/esm/index.js`);
const variant = (await import(`file://${deps}/node_modules/@jitl/quickjs-ng-wasmfile-release-sync/dist/index.mjs`)).default;
const t0 = now(); const { runSandboxed } = await loadQuickJs(variant); const loadMs = now() - t0;
const run = (code, opts = {}) => runSandboxed(async ({ evalCode }) => evalCode(code), { executionTimeout: 2000, ...opts });
const out = { version: pkgVersion(deps, "@sebastianwessel/quickjs"), load_ms: r3(loadMs) };
// per-run cost for a trivial script
const triv = []; for (let i = 0; i < 30; i++) { const t = now(); await run("export default 1+1"); triv.push(now() - t); }
out.trivial_run_ms = stats(triv);
// default globals / modules
out.default_globals = await run("export default JSON.stringify(Object.fromEntries(['process','require','fetch','setTimeout','console','env','Buffer','URL','Date','WebAssembly'].map(k => [k, typeof globalThis[k]])))");
for (const [k, code] of Object.entries({
  import_fs: "import fs from 'node:fs'; export default typeof fs.readFileSync",
  import_fs_read_host_file: "import fs from 'node:fs'; export default fs.readFileSync('/etc/hostname','utf8')",
  import_path: "import { join } from 'path'; export default join('a','b')",
  import_child_process: "import cp from 'node:child_process'; export default typeof cp.execSync",
  fetch_call: "export default await fetch('https://example.com').then(r => r.status)",
  infinite_loop: "while(true){}; export default 1",
  memory_push_loop_64MiB: "const a=[]; while(true) a.push(new Array(1e4).fill(1.5)); export default 1",
})) {
  if (process.argv[3] && !new RegExp(process.argv[3]).test(k)) continue;
  process.stderr.write(`CASE ${k}\n`);
  const t = now();
  try { const r = await run(code, { memoryLimit: 64 << 20 }); out[k] = { ...r, ms: r3(now() - t) }; } catch (e) { out[k] = { threw: String(e.message).slice(0, 200), ms: r3(now() - t) }; }
  if (out[k].error) out[k].error = { name: out[k].error.name, message: String(out[k].error.message).slice(0, 160) };
}
if (process.argv[3]) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
// host function call overhead through `env`
let calls = 0;
const callMs = [];
for (let i = 0; i < 7; i++) {
  const r = await run("const t=0; for (let i=0;i<10000;i++) env.noop(); export default 1", { env: { noop: () => { calls++; } } });
  const t = now(); await run("for (let i=0;i<10000;i++) env.noop(); export default 1", { env: { noop: () => { calls++; } } }); callMs.push(now() - t);
}
out.env_noop_10k_run_ms = stats(callMs);
out.env_noop_per_call_us_approx = r3(((median(callMs) - median(triv)) / 10000) * 1000);
console.log(JSON.stringify(out, null, 1));
