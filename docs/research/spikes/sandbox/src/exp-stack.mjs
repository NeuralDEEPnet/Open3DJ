// Which QuickJS maxStackSize makes deep recursion fail cleanly (InternalError) instead of
// overflowing the host's native stack (RangeError escaping evalCode)?
// usage: node [--stack-size=N] exp-stack.mjs <deps> [variant]   (also run inside a Worker via exp-stack-worker)
import { loadQuickJS } from "./lib/bridge.mjs";
import { depsPath } from "./lib/util.mjs";
import { isMainThread, workerData } from "node:worker_threads";
const deps = isMainThread ? depsPath() : workerData.deps;
const which = isMainThread ? (process.argv[3] || "quickjs") : workerData.variant;
const { mod } = await loadQuickJS(deps, which);
const scripts = {
  recursion: "function f(n){return f(n+1)+1} f(0)",
  json: "JSON.parse('['.repeat(1e6))",
  catchRetry: "function f(){ try { return f() } catch(e) { return f() } } f()",
};
const out = {};
for (const kb of [32, 64, 128, 192, 256, 384, 512, 1024]) {
  for (const [name, src] of Object.entries(scripts)) {
    const rt = mod.newRuntime(); rt.setMaxStackSize(kb * 1024); rt.setMemoryLimit(64 << 20);
    const dl = Date.now() + 3000; rt.setInterruptHandler(() => Date.now() > dl);
    const ctx = rt.newContext();
    let res;
    try { const r = ctx.evalCode(src); if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); res = `guest ${e.name}: ${e.message}`; } else { r.value.dispose(); res = "ok"; } }
    catch (e) { res = `HOST ${e.constructor.name}: ${e.message}`; }
    let disp = "dispose ok";
    try { ctx.dispose(); rt.dispose(); } catch (e) { disp = "DISPOSE ABORT"; }
    out[`${kb}KB ${name}`] = `${res} | ${disp}`;
  }
}
// also: what does a trivial depth probe reach at 256KB?
const rt = mod.newRuntime(); rt.setMaxStackSize(256 * 1024); const ctx = rt.newContext();
const r = ctx.evalCode("let d=0; function g(){ d++; g(); } try { g() } catch (e) {} d");
out.depth_at_256KB = r.error ? "error" : ctx.dump(r.value); if (r.value) r.value.dispose(); else r.error.dispose(); ctx.dispose(); rt.dispose();
const line = JSON.stringify({ where: isMainThread ? `main thread, execArgv=${process.execArgv.join(" ") || "-"}` : `worker stackSizeMb=${workerData.stackSizeMb}`, variant: which, out }, null, 1);
if (isMainThread) console.log(line); else (await import("node:worker_threads")).parentPort.postMessage(line);
