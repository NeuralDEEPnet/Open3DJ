// @sebastianwessel/quickjs host-call (env function) overhead, and the timeout-during-marshalling crash.
// usage: node wessel-calls.mjs <deps> measure|crash
import { depsPath, now, stats, r3, median } from "./lib/util.mjs";
const deps = depsPath();
const { loadQuickJs } = await import(`file://${deps}/node_modules/@sebastianwessel/quickjs/dist/esm/index.js`);
const variant = (await import(`file://${deps}/node_modules/@jitl/quickjs-ng-wasmfile-release-sync/dist/index.mjs`)).default;
const { runSandboxed } = await loadQuickJs(variant);
const run = (code, opts) => runSandboxed(async ({ evalCode }) => evalCode(code), opts);
if (process.argv[3] === "crash") {
  process.on("exit", (c) => process.stderr.write(`host process exiting with code ${c}\n`));
  const r = await run("for (let i=0;i<10000;i++) env.noop(); export default 1", { executionTimeout: +(process.argv[4] || 2000), env: { noop: () => {} } });
  console.log("returned normally:", JSON.stringify(r).slice(0, 200));
} else {
  const N = 1000; const base = [], calls = [];
  for (let i = 0; i < 9; i++) {
    let t = now(); await run("for (let i=0;i<1000;i++) {} export default 1", { executionTimeout: 60000, env: { noop: () => {} } }); base.push(now() - t);
    t = now(); const r = await run(`for (let i=0;i<${N};i++) env.noop(); export default 1`, { executionTimeout: 60000, env: { noop: () => {} } }); calls.push(now() - t);
    if (!r.ok) console.error(r);
  }
  console.log(JSON.stringify({ calls: N, run_without_calls_ms: stats(base), run_with_calls_ms: stats(calls), per_call_us: r3(((median(calls) - median(base)) / N) * 1000) }));
}
