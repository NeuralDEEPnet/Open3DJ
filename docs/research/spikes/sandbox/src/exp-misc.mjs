// (a) occt-wasm declared memory limits; (b) cost of the interrupt handler on CPU-bound guest code.
import { loadQuickJS } from "./lib/bridge.mjs";
import { depsPath, wasmMemoryLimits, now, stats } from "./lib/util.mjs";
const deps = depsPath();
const occt = wasmMemoryLimits(`${deps}/node_modules/occt-wasm/dist/occt-wasm.wasm`);
const { mod } = await loadQuickJS(deps);
const src = "let s = 0; for (let i = 0; i < 3e6; i++) { s += Math.sqrt(i) % 7; } s";
const timeIt = (handler) => { const xs = []; for (let r = 0; r < 9; r++) { const rt = mod.newRuntime(); if (handler) rt.setInterruptHandler(handler); const ctx = rt.newContext(); const t = now(); const res = ctx.evalCode(src); xs.push(now() - t); (res.value || res.error).dispose(); ctx.dispose(); rt.dispose(); } return stats(xs); };
const dl = Date.now() + 1e9;
console.log(JSON.stringify({ occt_wasm_memory: occt, cpu_loop_3e6_ms: { no_handler: timeIt(null), deadline_handler: timeIt(() => Date.now() > dl) } }, null, 1));
