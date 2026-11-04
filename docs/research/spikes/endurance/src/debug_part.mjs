import { loadKernel } from "./lib.mjs";
const [DEPS] = process.argv.slice(2);
const { k } = await loadKernel(DEPS);
const info = (n, s) => console.log(n, k.getShapeType(s), "solids", k.subShapeCount(s,"solid"), "shells", k.subShapeCount(s,"shell"), "faces", k.subShapeCount(s,"face"), "vol", k.getVolume(s).toFixed(2), "valid", k.isValid(s));
const W=70,D=50,H=30;
const box = k.translate(k.makeBox(W, D, H), -W/2, -D/2, 0); info("box", box);
const rounded = k.fillet(box, k.getSubShapes(box,"edge"), 3); info("rounded", rounded);
const faces = k.getSubShapes(rounded,"face");
const top = faces.find(f => { const bb = k.getBoundingBox(f); return Math.abs(bb.zmin-H)<1e-6 && Math.abs(bb.zmax-H)<1e-6; });
console.log("top found", !!top);
for (const tol of [1e-6, 1e-3]) { try { const sh = k.shell(rounded, [top], 2, tol); info("shell tol "+tol, sh); } catch(e) { console.log("shell err", tol, e.message); } }
for (const t of [-2]) { try { const sh = k.shell(rounded, [top], t, 1e-3); info("shell thick "+t, sh); } catch(e) { console.log("shell err", t, e.message); } }
