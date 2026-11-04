import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const t0 = performance.now();
const DEPS = process.argv[2];
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);

function mem() {
  const out = {};
  for (const line of readFileSync("/proc/self/status", "utf8").split("\n")) {
    if (line.startsWith("VmHWM") || line.startsWith("VmRSS")) {
      const [k, v] = line.split(":");
      out[k] = parseInt(v) / 1024;
    }
  }
  return out;
}
const memBaseline = mem();
const tInit0 = performance.now();
const k = await OcctKernel.init();
const initMs = performance.now() - tInit0;
const memAfterInit = mem();

const box = (x, y, z) => k.makeBox(x, y, z);
const cyl = (r, h) => k.makeCylinder(r, h);
const tr = (s, dx, dy, dz) => k.translate(s, dx, dy, dz);

function wFuseSmall() { return k.fuse(box(10, 10, 10), tr(cyl(3, 20), 5, 5, -5)); }
function wCutGrid() {
  const plate = box(200, 200, 10);
  const holes = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) holes.push(tr(cyl(3, 20), 10 + 20 * i, 10 + 20 * j, -5));
  return k.cutAll(plate, holes);
}
function filletAll(s, r) { return k.fillet(s, k.getSubShapes(s, "edge"), r); }
function wFilletBox() { return filletAll(box(20, 20, 20), 2.0); }
function bracket() {
  const plate = box(100, 60, 8);
  const up = tr(box(100, 8, 50), 0, 0, 8);
  const b = k.fuse(plate, up);
  const holes = [];
  for (const x of [15, 85]) for (const y of [25, 45]) holes.push(tr(cyl(3, 30), x, y, -5));
  return k.cutAll(b, holes);
}
function wBracketFillet() { return filletAll(bracket(), 1.0); }
function wFuseMany() {
  const boxes = [];
  for (let i = 0; i < 40; i++) boxes.push(tr(box(10, 10, 10), 7 * i, 3 * (i % 4), 0));
  return k.fuseAll(boxes);
}
function wMeshStep() {
  const s = wCutGrid();
  k.tessellate(s, { linearDeflection: 0.1, angularDeflection: 0.5 });
  k.exportStep(s);
  return s;
}

const WORK = [
  ["fuse_box_cyl", wFuseSmall],
  ["cut_grid_100_holes", wCutGrid],
  ["fillet_box_12_edges", wFilletBox],
  ["bracket_fillet_all_edges", wBracketFillet],
  ["fuse_40_boxes", wFuseMany],
  ["cut_grid_mesh_step", wMeshStep],
];
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const res = {
  runtime: `occt-wasm 5.8.1 (Node ${process.version})`,
  module_import_ms: +(tInit0 - t0).toFixed(1),
  init_ms: +initMs.toFixed(1),
  mem_baseline_MB: memBaseline,
  mem_after_init_MB: memAfterInit,
  work: {},
};
for (const [name, fn] of WORK) {
  let s;
  try {
    const mark = k.arenaMark ? k.arenaMark() : null;
    s = fn(); s = fn();
  } catch (e) {
    res.work[name] = { error: String(e && e.message || e).slice(0, 200) };
    continue;
  }
  const ts = [];
  for (let i = 0; i < 7; i++) { const t = performance.now(); s = fn(); ts.push(performance.now() - t); }
  res.work[name] = { median_ms: +median(ts).toFixed(2), volume: +k.getVolume(s).toFixed(3) };
}
res.mem_after_suite_MB = mem();
// growth check: 1000 small fuses, releasing handles each time
k.releaseAll();
const before = mem().VmRSS;
const tg = performance.now();
for (let i = 0; i < 1000; i++) { wFuseSmall(); k.releaseAll(); }
res.fuse_x1000_s = +((performance.now() - tg) / 1000).toFixed(2);
res.rss_growth_1000_fuses_MB = +(mem().VmRSS - before).toFixed(1);
res.mem_final_MB = mem();
console.log(JSON.stringify(res, null, 1));
