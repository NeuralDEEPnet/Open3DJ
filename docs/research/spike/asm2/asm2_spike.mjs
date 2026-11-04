// Assembly spike 2: fit classification, broad-phase scaling, Euler order, brepjs mate solver behaviour.
// Usage: node asm2_spike.mjs <deps_dir>
import { performance } from "node:perf_hooks";
const [DEPS] = process.argv.slice(2);
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init();
const ms = (t) => +(performance.now() - t).toFixed(2);
const out = {};

// A. Fit classification: clearance, contact, clash
const plate = k.cut(k.makeBox(20, 20, 6), k.translate(k.makeCylinder(4.15, 10), 10, 10, -2));
const pinOk = k.translate(k.makeCylinder(4.0, 12), 10, 10, -3);
const pinTight = k.translate(k.makeCylinder(4.3, 12), 10, 10, -3);
const sitter = k.translate(k.makeBox(5, 5, 5), 0, 0, 6); // rests on the plate's top face
function classify(a, b) {
  const t0 = performance.now();
  const d = k.distanceBetween(a, b);
  const t1 = ms(t0);
  const t2s = performance.now();
  const v = k.getVolume(k.common(a, b));
  const t2 = ms(t2s);
  const kind = v > 1e-6 ? "clash" : d <= 1e-6 ? "contact" : "clearance";
  return { distance_mm: +d.toFixed(4), overlap_mm3: +v.toFixed(4), kind, distance_ms: t1, common_ms: t2 };
}
out.fit = { pin_0p15_clearance: classify(pinOk, plate), pin_oversize: classify(pinTight, plate), box_resting_on_plate: classify(sitter, plate) };

// B. Broad-phase scaling: N screws in a grid plate with holes, one wrongly placed
const screw = k.fuse(k.makeCylinder(1.5, 12), k.translate(k.makeCylinder(2.75, 2), 0, 0, 12));
const G = 12, pitch = 10, N = G * G;
const holes = [];
for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) holes.push([5 + i * pitch, 5 + j * pitch]);
const t0 = performance.now();
const grid = k.cutAll(k.makeBox(G * pitch, G * pitch, 4), holes.map(([x, y]) => k.translate(k.makeCylinder(1.7, 10), x, y, -2)));
const plateMs = ms(t0);
const placed = holes.map(([x, y], idx) => {
  const dz = idx === 7 ? -11 : -8; // instance 7 sits 3 mm too low: head into plate
  return k.located(screw, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 4 + dz]);
});
const parts = [grid, ...placed];
const tb = performance.now();
const boxes = parts.map((p) => k.getBoundingBox(p));
const bbMs = ms(tb);
const overlap = (a, b, tol) => a.xmin <= b.xmax + tol && b.xmin <= a.xmax + tol && a.ymin <= b.ymax + tol && b.ymin <= a.ymax + tol && a.zmin <= b.zmax + tol && b.zmin <= a.zmax + tol;
const tp = performance.now();
const cand = [];
for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(boxes[i], boxes[j], 0.5)) cand.push([i, j]);
const pairMs = ms(tp);
const te = performance.now();
const clashes = [];
for (const [i, j] of cand) {
  const v = k.getVolume(k.common(parts[i], parts[j]));
  if (v > 1e-6) clashes.push({ i, j, overlap_mm3: +v.toFixed(3) });
}
const exactMs = ms(te);
out.broadphase = { instances: parts.length, all_pairs: (parts.length * (parts.length - 1)) / 2, aabb_candidates: cand.length, plate_build_ms: plateMs, bbox_ms: bbMs, pair_filter_ms: pairMs, exact_common_ms: exactMs, clashes };

// C. Euler order of XCAF addChild location
const doc = k.createXCAFDocument();
const root = doc.addShape(k.makeBox(1, 1, 1), { name: "root" });
const c = doc.addChild(root, k.makeBox(1, 1, 1), { name: "c", location: { rx: Math.PI / 2, rz: Math.PI / 2 } });
const L = doc.getLocation(c).map((v) => +v.toFixed(3));
const Rx = [[1, 0, 0], [0, 0, -1], [0, 1, 0]], Rz = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, kk) => s + v * B[kk][j], 0)));
const flat = (M) => M.flat().map((v) => +v.toFixed(3));
const loc3 = [L[0], L[1], L[2], L[4], L[5], L[6], L[8], L[9], L[10]];
out.euler = { location_3x4: L, matches_RzRx: JSON.stringify(flat(mul(Rz, Rx))) === JSON.stringify(loc3), matches_RxRz: JSON.stringify(flat(mul(Rx, Rz))) === JSON.stringify(loc3) };
doc.close();

// D. brepjs analytic mate solver: conflicting mates
const bj = await import(`file://${DEPS}/node_modules/brepjs/dist/brepjs.js`);
await bj.init();
let asm = bj.createAssemblyNode("root");
asm = bj.addChild(asm, bj.createAssemblyNode("A"));
asm = bj.addChild(asm, bj.createAssemblyNode("B"));
asm = bj.addChild(asm, bj.createAssemblyNode("C"));
asm = bj.addMate(asm, { type: "fixed", entity: { node: "A" } });
asm = bj.addMate(asm, { type: "coincident", entityA: { node: "A", point: [10, 0, 0] }, entityB: { node: "B", point: [0, 0, 0] } });
asm = bj.addMate(asm, { type: "coincident", entityA: { node: "A", point: [0, 0, 10] }, entityB: { node: "C", point: [0, 0, 0] } });
// Conflicting second mate on B: B origin must also coincide with C origin, which is 14 mm away
asm = bj.addMate(asm, { type: "coincident", entityA: { node: "C", point: [0, 0, 0] }, entityB: { node: "B", point: [0, 0, 0] } });
const r = bj.solveAssembly(asm);
out.brepjs_conflict = r.ok ? { ok: true, converged: r.value.converged, dof: r.value.dof, B: r.value.transforms.get("B")?.position, C: r.value.transforms.get("C")?.position } : { ok: false, error: String(r.error?.message ?? r.error) };
// Open-chain DOF counter on a closed four-bar loop
let fb = bj.createAssemblyNode("fourbar");
for (const n of ["ground", "crank", "coupler", "rocker"]) fb = bj.addChild(fb, bj.createAssemblyNode(n));
const ax = (x, y) => ({ origin: [x, y, 0], direction: [0, 0, 1] });
fb = bj.addJoint(fb, bj.revoluteJoint("ground", "crank", ax(0, 0)));
fb = bj.addJoint(fb, bj.revoluteJoint("crank", "coupler", ax(20, 0)));
fb = bj.addJoint(fb, bj.revoluteJoint("coupler", "rocker", ax(60, 30)));
fb = bj.addJoint(fb, bj.revoluteJoint("rocker", "ground", ax(80, 0)));
out.brepjs_fourbar = { mechanismDOF_reported: bj.mechanismDOF(fb), true_mobility_grubler: 1 };
console.log(JSON.stringify(out, null, 1));
