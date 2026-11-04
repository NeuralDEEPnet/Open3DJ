// Minimal memory-limit repro: no interrupt handler, no prelude, fresh module per variant.
import { loadQuickJS } from "./lib/bridge.mjs";
import { depsPath } from "./lib/util.mjs";
const deps = depsPath();
for (const v of ["quickjs", "ng"]) {
  const { mod } = await loadQuickJS(deps, v);
  for (const [label, src] of [
    ["1 alloc of 32 MiB", "new Uint8Array(32*1024*1024).length"],
    ["40 x 1 MiB Uint8Array", "const a=[]; for (let i=0;i<40;i++) a.push(new Uint8Array(1024*1024)); a.length"],
    ["40 x Array(1e4).fill (160kB each)", "const a=[]; for (let i=0;i<40;i++) a.push(new Array(1e4).fill(1.5)); a.length"],
    ["400 x Array(1e4).fill", "const a=[]; for (let i=0;i<400;i++) a.push(new Array(1e4).fill(1.5)); a.length"],
    ["1 Array of 4e6 via push", "const a=[]; for (let i=0;i<4e6;i++) a.push(i); a.length"],
    ["string 'x'.repeat(2**25)", "'x'.repeat(2**25).length"],
  ]) {
    const rt = mod.newRuntime(); rt.setMemoryLimit(16 * 1024 * 1024);
    const ctx = rt.newContext();
    const r = ctx.evalCode(src);
    let res; if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); res = "ERR " + (e && e.message); } else { res = "ok " + ctx.dump(r.value); r.value.dispose(); }
    const used = (rt.dumpMemoryUsage().split("\n").find((l) => /memory used/.test(l)) || "").trim().replace(/\s+/g, " ");
    try { ctx.dispose(); rt.dispose(); } catch (e) { res += " DISPOSE-ABORT"; }
    console.log(v.padEnd(8), "limit 16MiB |", label.padEnd(36), "|", res.padEnd(22), "|", used);
  }
}
