// Determinism probe: build a fixed corpus and fingerprint every result.
// usage: node determinism.mjs <deps> <out.json> <repeats> <perturb:none|keep|junk> [cases]
//   repeats: builds of the whole corpus inside this one process
//   perturb: none = releaseAll between repeats; keep = never release (heap evolves);
//            junk = releaseAll, then allocate a varying number of junk shapes kept alive
import { writeFileSync } from "node:fs";
import { loadKernel, buildPart, sha, f64hex, bboxHex, normStep, heapMiB, now } from "./lib.mjs";

const [DEPS, OUT, REPEATS = "1", PERTURB = "none", CASES] = process.argv.slice(2);
const { k, mod, idx } = await loadKernel(DEPS);

function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function blobs(n, seed) {
  const r = lcg(seed); const out = [];
  for (let i = 0; i < n; i++) {
    const x = r() * 40, y = r() * 40, z = r() * 40;
    const s = i % 3 === 0 ? k.makeSphere(4 + r() * 4)
      : i % 3 === 1 ? k.rotate(k.makeCylinder(2 + r() * 3, 10 + r() * 15), { point: { x: 0, y: 0, z: 0 }, direction: { x: r(), y: r(), z: 1 } }, r() * 3)
        : k.makeBox(5 + r() * 8, 5 + r() * 8, 5 + r() * 8);
    out.push(k.translate(s, x, y, z));
  }
  return out;
}
function seqFuse(shapes) { let acc = shapes[0]; for (let i = 1; i < shapes.length; i++) acc = k.fuse(acc, shapes[i]); return acc; }
function shuffled(a, seed) { const r = lcg(seed); const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function bracket() {
  const b = k.fuse(k.makeBox(100, 60, 8), k.translate(k.makeBox(100, 8, 50), 0, 0, 8));
  const holes = []; for (const x of [15, 85]) for (const y of [25, 45]) holes.push(k.translate(k.makeCylinder(3, 30), x, y, -5));
  return solidOf(k.cutAll(b, holes));
}
function solidOf(s) { if (k.isSolid(s)) return s; const so = k.getSubShapes(s, "solid"); if (so.length !== 1) throw new Error(`${so.length} solids`); return so[0]; }

const CORPUS = {
  part: () => buildPart(k, { w: 70 }),
  seqFuse40: () => seqFuse(blobs(40, 12345)),
  seqFuse40_reversed: () => seqFuse(blobs(40, 12345).reverse()),
  fuseAll40: () => k.fuseAll(blobs(40, 12345)),
  fuseAll40_shuffled: () => k.fuseAll(shuffled(blobs(40, 12345), 99)),
  bracketFilletAll: () => { const s = bracket(); return k.fillet(s, k.getSubShapes(s, "edge"), 1.0); },
  offsetPart: () => k.offset(buildPart(k, { w: 70 }), 0.8, 1e-3),
  shellAllFilleted: () => { // the invalid-shell case (BRepOffset) — determinism of a bad result
    const b = k.makeBox(70, 50, 30); const r = k.fillet(b, k.getSubShapes(b, "edge"), 3);
    const top = k.getSubShapes(r, "face").find((f) => { const bb = k.getBoundingBox(f); return Math.abs(bb.zmin - 30) < 1e-6 && Math.abs(bb.zmax - 30) < 1e-6; });
    return k.shell(r, [top], 2, 1e-3);
  },
};
const caseNames = CASES ? CASES.split(",") : Object.keys(CORPUS);

function fingerprint(s) {
  const fp = {};
  fp.type = k.getShapeType(s);
  fp.valid = k.isValid(s);
  const vol = k.getVolume(s), area = k.getSurfaceArea(s);
  fp.volume = vol; fp.volume_bits = f64hex(vol); fp.area_bits = f64hex(area);
  fp.bbox_bits = sha(bboxHex(k.getBoundingBox(s)));
  fp.counts = ["solid", "shell", "face", "edge", "vertex"].map((t) => k.subShapeCount(s, t)).join("/");
  const fh = k.subShapeHashes(s, "face", 2147483647), eh = k.subShapeHashes(s, "edge", 2147483647);
  fp.faceHashes_ordered = sha(fh.join(",")); fp.faceHashes_sorted = sha([...fh].sort((a, b) => a - b).join(","));
  fp.edgeHashes_ordered = sha(eh.join(",")); fp.edgeHashes_sorted = sha([...eh].sort((a, b) => a - b).join(","));
  fp.faceHash_first3 = fh.slice(0, 3).join(",");
  // canonical geometric fingerprint: sorted per-face (area, centroid) rounded to 1e-6
  const faces = k.getSubShapes(s, "face");
  const rows = faces.map((f) => { const a = k.getSurfaceArea(f); const c = k.getSurfaceCenterOfMass(f); return [a, c.x, c.y, c.z].map((v) => (Math.round(v * 1e6) / 1e6).toFixed(6)).join(";"); });
  fp.faceGeom_sorted = sha(rows.sort().join("|"));
  fp.faceGeom_ordered = sha(faces.map((f, i) => rows[i]).join("|"));
  const step = k.exportStep(s);
  fp.step_bytes = step.length; fp.step_raw = sha(step); fp.step_norm = sha(normStep(step));
  const m = k.tessellate(s, { linearDeflection: 0.1, angularDeflection: 0.5 });
  fp.tris = m.triangleCount;
  fp.mesh_pos = sha(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
  fp.mesh_nrm = sha(Buffer.from(m.normals.buffer, m.normals.byteOffset, m.normals.byteLength));
  fp.mesh_idx = sha(Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
  const stl = k.exportStl(s, 0.1);
  fp.stl = sha(Buffer.from(stl.buffer, stl.byteOffset, stl.byteLength));
  return fp;
}

const runs = [];
const junkR = lcg(7);
for (let r = 0; r < +REPEATS; r++) {
  const rep = { rep: r, heap_mib_before: heapMiB(mod), cases: {} };
  for (const name of caseNames) {
    const t = now();
    try { const s = CORPUS[name](); rep.cases[name] = { ...fingerprint(s), ms: +(now() - t).toFixed(1) }; }
    catch (e) { rep.cases[name] = { error: String(e?.message ?? e).slice(0, 200) }; }
  }
  runs.push(rep);
  if (PERTURB === "none" || PERTURB === "junk") k.releaseAll();
  if (PERTURB === "junk") { const n = 1 + Math.floor(junkR() * 300); for (let j = 0; j < n; j++) k.makeSphere(1 + junkR()); }
  process.stderr.write(`rep ${r} done heap ${heapMiB(mod)}\n`);
}
writeFileSync(OUT, JSON.stringify({ pid: process.pid, perturb: PERTURB, repeats: +REPEATS, runs }, null, 1));
