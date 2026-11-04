import { loadKernel } from "./lib.mjs";
const [DEPS] = process.argv.slice(2);
const { k, idx } = await loadKernel(DEPS);
const info = (n, s) => console.log(n, k.getShapeType(s), "solids", k.subShapeCount(s,"solid"), "shells", k.subShapeCount(s,"shell"), "faces", k.subShapeCount(s,"face"), "vol", k.getVolume(s).toFixed(2), "valid", k.isValid(s));
const W=70,D=50,H=30;
const topOf = (s) => k.getSubShapes(s,"face").find(f => { const bb = k.getBoundingBox(f); return Math.abs(bb.zmin-H)<1e-6 && Math.abs(bb.zmax-H)<1e-6; });
const box0 = k.makeBox(W, D, H);
info("plain shell untranslated", k.shell(box0, [topOf(box0)], 2, 1e-3));
const box = k.translate(box0, -W/2, -D/2, 0);
info("plain shell translated", k.shell(box, [topOf(box)], 2, 1e-3));
const r0 = k.fillet(box0, k.getSubShapes(box0,"edge"), 3);
info("filleted untranslated shell", k.shell(r0, [topOf(r0)], 2, 1e-3));
try { info("filleted shell Intersection", k.shell(r0, [topOf(r0)], 2, 1e-3, idx.JoinType.Intersection)); } catch(e){console.log("err", e.message)}
// fillet only vertical + bottom edges, keep top sharp
const ed = k.getSubShapes(box0,"edge").filter(e => { const bb=k.getBoundingBox(e); return !(Math.abs(bb.zmin-H)<1e-6 && Math.abs(bb.zmax-H)<1e-6); });
console.log("non-top edges", ed.length);
const r1 = k.fillet(box0, ed, 3); info("r1", r1);
info("r1 shell", k.shell(r1, [topOf(r1)], 2, 1e-3));
const r1t = k.translate(r1, -W/2, -D/2, 0); info("r1 translated shell", k.shell(r1t, [topOf(r1t)], 2, 1e-3));
