// Why does a push loop under setMemoryLimit(64 MiB) not hit OOM quickly, and how far does the wasm heap grow?
import { loadQuickJS } from "./lib/bridge.mjs";
import { depsPath, now, r2 } from "./lib/util.mjs";
const { mod } = await loadQuickJS(depsPath(), process.argv[3] || "quickjs");
const mem = () => Math.round(mod.getWasmMemory().buffer.byteLength / 1048576);
const scripts = {
  "push new Array(1e4).fill(1.5)": "globalThis.n=0; const a=[]; while(true){ a.push(new Array(1e4).fill(1.5)); n++; }",
  "push Array.from({length:1e4})": "globalThis.n=0; const a=[]; while(true){ a.push(Array.from({length:1e4}, (_, i) => i)); n++; }",
  "push 1e4-element literal-ish arrays via loop": "globalThis.n=0; const a=[]; while(true){ const b=[]; for(let i=0;i<1e4;i++) b.push(i); a.push(b); n++; }",
  "push strings 100kB": "globalThis.n=0; const a=[]; while(true){ a.push('y'.repeat(1e5) + n); n++; }",
  "push objects": "globalThis.n=0; const a=[]; while(true){ a.push({x:n, y:[n,n], z:'k'+n}); n++; }",
};
for (const limitMiB of (process.argv[4] ? process.argv[4].split(",").map(Number) : [64, 256])) for (const [name, src] of Object.entries(scripts)) {
  const before = mem();
  const rt = mod.newRuntime(); rt.setMemoryLimit(limitMiB << 20);
  const dl = Date.now() + 8000; rt.setInterruptHandler(() => Date.now() > dl);
  const ctx = rt.newContext();
  const t = now(); const r = ctx.evalCode(src); const ms = r2(now() - t);
  let res; if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); res = `${e.name}: ${e.message}`; } else { r.value.dispose(); res = "ok"; }
  const nH = ctx.getProp(ctx.global, "n"); const n = ctx.getNumber(nH); nH.dispose();
  const usage = rt.dumpMemoryUsage().split("\n").find((l) => /memory used/.test(l)) || "";
  let disp = "ok"; try { ctx.dispose(); rt.dispose(); } catch (e) { disp = "ABORT"; }
  console.log(JSON.stringify({ limitMiB, name, result: res, ms, iterations: n, qjs_reported: usage.trim().replace(/\s+/g, " "), wasm_heap_MiB_before: before, wasm_heap_MiB_after: mem(), dispose: disp }));
}
