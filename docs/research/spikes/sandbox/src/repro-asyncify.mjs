// Minimal repro: asyncify variant of quickjs-emscripten 0.32.0, runtime dispose.
import { loadQuickJS } from "./lib/bridge.mjs";
import { depsPath } from "./lib/util.mjs";
Error.stackTraceLimit = 60;
const { mod } = await loadQuickJS(depsPath(), process.argv[3] || "asyncify");
const steps = [];
try {
  for (let i = 0; i < 3; i++) {
    const rt = mod.newRuntime(); steps.push(`rt${i}`);
    const ctx = rt.newContext(); steps.push(`ctx${i}`);
    const r = ctx.evalCode("1+1"); steps.push(`eval${i}=` + ctx.dump(r.value)); r.value.dispose();
    ctx.dispose(); steps.push(`ctxdisp${i}`);
    rt.dispose(); steps.push(`rtdisp${i}`);
  }
  console.log("OK", steps.join(","));
} catch (e) { console.log("FAILED after", steps.join(","), "::", e.message, "\n", e.stack.split("\n").filter(l => /src\//.test(l)).join("\n")); }
// Variant: context created directly from module (module.newContext())
try { const ctx = mod.newContext(); const r = ctx.evalCode("2+2"); console.log("module.newContext eval", ctx.dump(r.value)); r.value.dispose(); ctx.dispose(); console.log("module.newContext dispose OK"); } catch (e) { console.log("module.newContext FAILED:", e.message); }
// Variant: with a host function (newFunction) -> HostRef
for (const order of ["ctx-then-rt", "rt-only"]) {
  try {
    const rt = mod.newRuntime(); const ctx = rt.newContext();
    const fn = ctx.newFunction("f", () => {}); ctx.setProp(ctx.global, "f", fn); fn.dispose();
    const r = ctx.evalCode("for (let i=0;i<10;i++) f(); 7"); console.log(order, "eval", ctx.dump(r.value)); r.value.dispose();
    if (order === "ctx-then-rt") ctx.dispose();
    rt.dispose(); console.log(order, "dispose OK");
  } catch (e) { console.log(order, "FAILED:", e.message); }
}
// After an Aborted() assertion, is the shared wasm module still usable?
try { const rt = mod.newRuntime(); const ctx = rt.newContext(); const r = ctx.evalCode("40+2"); console.log("after-abort eval:", ctx.dump(r.value)); r.value.dispose(); ctx.dispose(); rt.dispose(); console.log("after-abort OK"); }
catch (e) { console.log("after-abort FAILED:", e.constructor.name, e.message.slice(0, 200)); }
