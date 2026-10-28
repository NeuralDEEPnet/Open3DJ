import { initKernel } from "@open3dj/kernel";
import * as B from "brepjs";
const kernel = await initKernel();
B.registerKernel("occt-wasm", B.OcctWasmAdapter.fromKernel(kernel.raw));
const faceOf = (d: any) => { const sk: any = d.clone().sketchOnPlane("XY"); const f = sk.face(); return f.wrapped.id; };
// sagitta: from (0,0) to (10,0) sagitta 2, then close back via lines down
const d1 = B.draw([0, 0]).sagittaArcTo([10, 0], 2).lineTo([10, -5]).lineTo([0, -5]).close();
const f1 = faceOf(d1); console.error("sagitta+ bbox", kernel.bbox(f1 as any), kernel.area(f1 as any));
const holed = B.drawRectangle(20, 10).cut(B.drawCircle(2));
const fh = faceOf(holed); console.error("holed area", kernel.area(fh as any), 200 - Math.PI * 4);
const two = B.drawRectangle(20, 10).fuse(B.drawCircle(2).translate(30, 0));
try { const ft = faceOf(two); console.error("two", kernel.shapeType(ft as any), kernel.area(ft as any)); } catch (e) { console.error("two err", (e as Error).message); }
const sk2: any = two.clone().sketchOnPlane("XY"); console.error("two faces", sk2.faces?.().wrapped?.id, kernel.shapeType(sk2.faces().wrapped.id), kernel.area(sk2.faces().wrapped.id));
// wrap a kernel wire into brepjs
const w = kernel.polygon([[0,0,0],[10,0,0],[10,10,0],[0,10,0]]);
const bw: any = B.castShape({ __occtWasm: true, type: "wire", id: w, delete() {}, HashCode(u: number) { return (w as number) % u; }, IsNull() { return false; } } as any);
console.error("cast", bw.constructor?.name);
const tw: any = B.twistExtrude(bw, 90, [0,0,0], [0,0,10], { profile: "linear", endFactor: 0.5 });
console.error("twist from kernel wire", tw.ok, tw.ok && kernel.volume(tw.value.wrapped.id), 1000*(1+0.5+0.25)/3);
const ce: any = B.complexExtrude(bw, [0,0,0], [0,0,10], { profile: "linear", endFactor: 0.5 });
console.error("complex", ce.ok, ce.ok && kernel.volume(ce.value.wrapped.id));
const off: any = B.offsetWire2D(bw, -1, "arc"); console.error("offset", off.ok, off.ok && off.value.wrapped.id, off.ok && kernel.area(kernel.face(off.value.wrapped.id)));
const off2 = kernel.raw.offsetWire2D(w, -1); console.error("raw offset", kernel.area(kernel.face(off2 as any)));
const pts = B.drawPolysides(30, 6); console.error("ngon bbox", pts.boundingBox.bounds);
