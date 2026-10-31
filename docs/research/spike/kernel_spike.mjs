import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
const DEPS = process.argv[2];
const t0 = performance.now();
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const rss = () => Math.round(process.memoryUsage().rss / 1e6);
const timings = {};
const time = (k, f) => { const s = performance.now(); const r = f(); timings[k] = +(performance.now() - s).toFixed(2); return r; };
const kernel = await OcctKernel.init();
timings.init_ms = +(performance.now() - t0).toFixed(0);
// A project box: rounded body, shelled, four bolt holes, a fused boss
const box = time("box", () => kernel.makeBox(80, 60, 32));
const edges = kernel.getSubShapes(box, "edge");
const body = time("fillet_12_edges", () => kernel.fillet(box, edges, 3.0));
const cyls = [];
for (const [x, y] of [[8, 8], [72, 8], [8, 52], [72, 52]]) cyls.push(kernel.translate(kernel.makeCylinder(1.7, 40), x, y, -4));
let part = body;
time("cut_4_holes", () => { for (const c of cyls) part = kernel.cut(part, c); });
const boss = kernel.translate(kernel.makeCylinder(10, 10), 40, 30, 32);
part = time("fuse_boss", () => kernel.fuse(part, boss));
const vol = time("volume", () => kernel.getVolume(part));
const bb = time("bbox", () => kernel.getBoundingBox(part));
const mesh = time("tessellate", () => kernel.tessellate(part));
const step = time("export_step", () => kernel.exportStep(part));
const back = time("import_step", () => kernel.importStep(step));
const vol2 = kernel.getVolume(back);
// stress: 200 sequential fuses of small boxes
let acc = kernel.makeBox(1, 1, 1);
time("fuse_200_boxes", () => { for (let i = 1; i < 200; i++) acc = kernel.fuse(acc, kernel.translate(kernel.makeBox(1, 1, 1), i * 0.9, 0, 0)); });
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(kernel)).filter(m => m !== "constructor");
console.log(JSON.stringify({
  node: process.version, occt_wasm: JSON.parse(readFileSync(`${DEPS}/node_modules/occt-wasm/package.json`)).version,
  timings, volume_mm3: +vol.toFixed(3), volume_after_step_roundtrip: +vol2.toFixed(3), bbox: bb,
  triangles: mesh.indices.length / 3, step_bytes: step.length, rss_mb: rss(), kernel_methods: methods.length,
  has: Object.fromEntries(["checkValidity", "isValid", "draftAngle", "makeDraft", "shell", "offset", "loft", "sweep", "exportStl", "exportGltf", "hlr", "section", "getMassProperties", "thicken"].map(m => [m, methods.some(x => x.toLowerCase().includes(m.toLowerCase()))])),
}, null, 1));
