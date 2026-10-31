// Realistic CAD script: direct occt-wasm calls vs the same ops through the QuickJS bridge.
// usage: node cadbench.mjs <deps> [variant] [iterations]
import { readFileSync } from "node:fs";
import { loadQuickJS, loadKernel, runScript } from "./lib/bridge.mjs";
import { now, median, stats, r3, depsPath, pkgVersion } from "./lib/util.mjs";
const deps = depsPath();
const which = process.argv[3] || "quickjs";
const ITER = +(process.argv[4] || 21);
const t0 = now(); const kernel = await loadKernel(deps); const kernelInit = now() - t0;
const t1 = now(); const qjs = await loadQuickJS(deps, which); const qjsInit = now() - t1;
const src = (f) => readFileSync(new URL(`./scripts/${f}`, import.meta.url), "utf8");

function directEnclosure(k) {
  const cp = k.checkpoint(); const s = now();
  const w = 80, d = 60, h = 32;
  const b = k.translate(k.makeBox(w, d, h), -w / 2, -d / 2, 0);
  let body = k.fillet(b, k.getSubShapes(b, "edge"), 3);
  const holes = [[-32, -22], [32, -22], [-32, 22], [32, 22]].map(([x, y]) => k.translate(k.makeCylinder(1.7, 40), x, y, -4));
  body = k.cutAll(body, holes);
  const part = k.fuse(body, k.translate(k.makeCylinder(10, 10), 0, 0, h));
  const v = k.getVolume(part); const ok = k.isValid(part);
  const t = now() - s; k.releaseSince(cp); return { t, v, ok };
}
function directPlate(k) {
  const cp = k.checkpoint(); const s = now();
  const plate = k.translate(k.makeBox(120, 120, 6), -60, -60, 0);
  const holes = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) holes.push(k.translate(k.makeCylinder(2, 10), -54 + i * 12, -54 + j * 12, -2));
  const part = k.cutAll(plate, holes);
  const v = k.getVolume(part); const ok = k.isValid(part);
  const t = now() - s; k.releaseSince(cp); return { t, v, ok };
}
const cases = [
  { name: "enclosure (box, fillet 12 edges, 4 holes cutAll, boss)", direct: directEnclosure, code: src("enclosure.js") },
  { name: "plate with 100 holes (cutAll, ~200 host calls)", direct: directPlate, code: src("plate100.js") },
];
const results = [];
for (const c of cases) {
  const firstDirect = c.direct(kernel).t;
  const firstBridge = runScript({ qjs, kernel, code: c.code }).timings.total_ms;
  for (let i = 0; i < 2; i++) { c.direct(kernel); runScript({ qjs, kernel, code: c.code }); }
  const D = [], B = [], Bs = [], Be = [], Bh = [], Bt = [], Bnf = [];
  let vd, vb, ops;
  for (let i = 0; i < ITER; i++) {
    const d = c.direct(kernel); D.push(d.t); vd = d.v;
    const b = runScript({ qjs, kernel, code: c.code });
    if (!b.ok) throw new Error(JSON.stringify(b.error));
    B.push(b.timings.total_ms); Bs.push(b.timings.setup_ms); Be.push(b.timings.exec_ms); Bh.push(b.timings.host_ms); Bt.push(b.timings.teardown_ms);
    vb = b.parts[0].volume; ops = b.stats.kernelOps;
    Bnf.push(runScript({ qjs, kernel, code: c.code, limits: { freezeIntrinsics: false } }).timings.total_ms);
  }
  const guestOverhead = Be.map((e, i) => e - Bh[i]);
  results.push({ case: c.name, kernel_ops: ops, volume_direct: r3(vd), volume_bridge: r3(vb), identical_volume: vd === vb,
    first_run_ms: { direct: r3(firstDirect), bridge: r3(firstBridge) },
    direct_ms: stats(D), bridge_total_ms: stats(B), bridge_setup_ms: stats(Bs), bridge_exec_ms: stats(Be), bridge_kernel_ms: stats(Bh),
    bridge_guest_and_marshalling_ms: stats(guestOverhead), bridge_teardown_ms: stats(Bt), bridge_total_no_freeze_ms: stats(Bnf),
    overhead_ms_median: r3(median(B) - median(D)), overhead_pct_median: r3(((median(B) - median(D)) / median(D)) * 100) });
}
console.log(JSON.stringify({ node: process.version, variant: which, quickjs_emscripten: pkgVersion(deps, "quickjs-emscripten-core"), occt_wasm: pkgVersion(deps, "occt-wasm"),
  kernel_init_ms: r3(kernelInit), quickjs_init_ms: r3(qjsInit), iterations: ITER, results, rss_mb: Math.round(process.memoryUsage().rss / 1e6) }, null, 1));
