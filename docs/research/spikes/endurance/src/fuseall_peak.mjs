// Peak memory of a 200-part fuseAll in a fresh process (one case per process so VmHWM is clean).
// usage: node fuseall_peak.mjs <deps> <case:boxes|parts|cyls> [n]
import { loadKernel, buildPart, heapMiB, procMem, now } from "./lib.mjs";
const [DEPS, CASE = "boxes", NS = "200"] = process.argv.slice(2);
const n = +NS;
const { k, mod } = await loadKernel(DEPS);
const before = { heap_mib: heapMiB(mod), ...procMem() };
let shapes = [];
const t0 = now();
if (CASE === "boxes") { // the spike-occt-wasm case: a row of overlapping unit boxes
  for (let i = 0; i < n; i++) shapes.push(k.translate(k.makeBox(1, 1, 1), i * 0.9, 0, 0));
} else if (CASE === "cyls") { // 200 cylinders on a 20x10 grid, each overlapping its neighbours, on a base plate
  shapes.push(k.makeBox(210, 110, 2));
  for (let i = 0; i < n - 1; i++) shapes.push(k.translate(k.makeCylinder(6, 10 + (i % 7)), 10 + (i % 20) * 10, 10 + Math.floor(i / 20) * 10, 1));
} else if (CASE === "parts") { // 200 copies of the realistic enclosure, overlapping in a 20x10 grid at 0.9x pitch
  const proto = buildPart(k, { w: 70 });
  for (let i = 0; i < n; i++) shapes.push(k.translate(proto, (i % 20) * 63, Math.floor(i / 20) * 45, 0));
}
const tBuild = now() - t0;
const mid = { heap_mib: heapMiB(mod), ...procMem() };
const t1 = now();
let r, err = null;
try { r = k.fuseAll(shapes); } catch (e) { err = String(e?.message ?? e).slice(0, 300); }
const tFuse = now() - t1;
const after = { heap_mib: heapMiB(mod), ...procMem() };
const res = { case: CASE, n, build_inputs_ms: +tBuild.toFixed(1), fuseAll_ms: +tFuse.toFixed(1), err, before, mid, after };
if (!err) {
  res.valid = k.isValid(r); res.volume = k.getVolume(r);
  res.counts = ["solid", "face", "edge"].map((t) => k.subShapeCount(r, t)).join("/");
  const t2 = now(); const m = k.tessellate(r, { linearDeflection: 0.1, angularDeflection: 0.5 }); res.tess_ms = +(now() - t2).toFixed(1); res.tris = m.triangleCount;
  res.after_tess = { heap_mib: heapMiB(mod), ...procMem() };
}
k.releaseAll();
res.after_releaseAll = { heap_mib: heapMiB(mod), ...procMem() };
process.stdout.write(JSON.stringify(res) + "\n");
