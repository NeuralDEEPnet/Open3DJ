// Assembly spike 3: exact B-rep vs mesh-based clash checks for N instances of one definition.
// Usage: node asm3_meshpath.mjs <occt_deps_dir> <mesh_deps_dir> <grid>
import { performance } from "node:perf_hooks";
const [DEPS, MDEPS, GARG] = process.argv.slice(2);
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const Module = (await import(`file://${MDEPS}/node_modules/manifold-3d/manifold.js`)).default;
const THREE = await import(`file://${MDEPS}/node_modules/three/build/three.module.js`);
const { MeshBVH } = await import(`file://${MDEPS}/node_modules/three-mesh-bvh/src/index.js`);
const k = await OcctKernel.init();
const wasm = await Module(); wasm.setup();
const { Manifold, Mesh } = wasm;
const ms = (t) => +(performance.now() - t).toFixed(1);
const G = Number(GARG || 12), pitch = 10, N = G * G;
const holes = [];
for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) holes.push([5 + i * pitch, 5 + j * pitch]);
const plate = k.cutAll(k.makeBox(G * pitch, G * pitch, 4), holes.map(([x, y]) => k.translate(k.makeCylinder(1.7, 10), x, y, -2)));
const screw = k.fuse(k.makeCylinder(1.5, 12), k.translate(k.makeCylinder(2.75, 2), 0, 0, 12));
const BAD = new Set([7, Math.floor(N / 2)]);
const zOf = (idx) => (BAD.has(idx) ? -9 : -8); // -8 seats the head on the top face; -9 sinks it 1 mm
const mats = holes.map(([x, y], idx) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, zOf(idx)]);
const res = { instances: N + 1, bad_instances: [...BAD] };

// 1. Exact B-rep (OCCT common) on AABB candidates only
let t = performance.now();
const pb = k.getBoundingBox(plate);
const exact = [];
for (let idx = 0; idx < N; idx++) {
  const s = k.located(screw, mats[idx]);
  const v = k.getVolume(k.common(s, plate));
  if (v > 1e-6) exact.push({ idx, mm3: +v.toFixed(2) });
}
res.exact_brep = { ms: ms(t), per_pair_ms: +(ms(t) / N).toFixed(2), clashes: exact };

// Tessellate each DEFINITION once (cache key = definition), weld vertices
function toManifold(shape, tol) {
  const m = k.tessellate(shape, { linearDeflection: tol });
  const mesh = new Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices });
  mesh.merge();
  return new Manifold(mesh);
}
t = performance.now();
const mPlate = toManifold(plate, 0.02);
const mScrew = toManifold(screw, 0.02);
res.tessellate_and_weld_ms = ms(t);

// 2. Manifold (mesh boolean) per instance, on the CPU in WASM
t = performance.now();
const mf = [];
for (let idx = 0; idx < N; idx++) {
  const [a, , , x, , , , y, , , , z] = mats[idx];
  const inst = mScrew.translate([x, y, z]);
  const v = inst.intersect(mPlate).volume();
  if (v > 1e-3) mf.push({ idx, mm3: +v.toFixed(2) });
}
res.manifold_mesh = { ms: ms(t), per_pair_ms: +(ms(t) / N).toFixed(3), clashes: mf };
// Clearance query via minGap on a good instance (shaft-to-hole radial gap is 0.2 mm)
t = performance.now();
const gap = mScrew.translate([5, 5, -8]).minGap(mPlate, 1.0);
res.manifold_minGap = { mm: +gap.toFixed(4), ms: ms(t), note: "0 = touching: the head rests on the plate" };

// 3. three-mesh-bvh triangle intersection test per instance (CPU, JS). Boolean only, no volume.
function toGeom(shape, tol) {
  const m = k.tessellate(shape, { linearDeflection: tol });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}
const gPlate = toGeom(plate, 0.02), gScrew = toGeom(screw, 0.02);
t = performance.now();
const bvh = new MeshBVH(gPlate);
res.bvh_build_ms = ms(t);
t = performance.now();
const hits = [];
const M = new THREE.Matrix4();
for (let idx = 0; idx < N; idx++) {
  const [, , , x, , , , y, , , , z] = mats[idx];
  M.makeTranslation(x, y, z);
  if (bvh.intersectsGeometry(gScrew, M)) hits.push(idx);
}
res.bvh_surface_intersect = { ms: ms(t), per_pair_ms: +(ms(t) / N).toFixed(3), hits_count: hits.length, note: "touching faces count as hits; surface test only" };
console.log(JSON.stringify(res, null, 1));
