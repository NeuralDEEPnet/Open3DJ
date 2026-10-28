// Per-entry conformance checks of the facade against analytic values.
import { writeFileSync } from "node:fs";
import { createRuntime } from "./dsl.mjs";
const DEPS = process.argv[2], OUT = process.argv[3];
const rt = await createRuntime(DEPS);
const A = rt.api;
const PI = Math.PI;
const rows = [];
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const vecNear = (a, b, tol = 1e-4) => a.every((x, i) => Math.abs(x - b[i]) < tol);
function check(entry, f) {
  try {
    const { ok, got, want, note } = f();
    rows.push({ entry, ok, got, want, note: note ?? "" });
  } catch (e) { rows.push({ entry, ok: false, got: `THROW ${e.message}`, want: "", note: "" }); }
}
const r6 = (x) => +x.toFixed(4);

check("box(w,d,h) centred XY, base Z=0", () => { const s = A.box(20, 10, 30), b = s.bounds(); return { ok: vecNear(b.min, [-10, -5, 0]) && vecNear(b.max, [10, 5, 30]) && near(s.volume(), 6000), got: `${JSON.stringify(b.min)}..${JSON.stringify(b.max)} V=${r6(s.volume())}`, want: "[-10,-5,0]..[10,5,30] V=6000" }; });
check("cylinder(h,r)", () => { const s = A.cylinder(10, 5), b = s.bounds(); return { ok: near(s.volume(), PI * 250) && vecNear(b.min, [-5, -5, 0]), got: r6(s.volume()), want: r6(PI * 250) }; });
check("cylinder(h,r,rTop) cone", () => { const s = A.cylinder(80, 25, 35); const w = (PI * 80 / 3) * (625 + 875 + 1225); return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("cylinder(h,r,0) sharp cone", () => { const s = A.cylinder(10, 5, 0); const w = PI * 25 * 10 / 3; return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("sphere(r) centred origin", () => { const s = A.sphere(10), b = s.bounds(); const w = 4 / 3 * PI * 1000; return { ok: near(s.volume(), w, 1e-5) && vecNear(b.min, [-10, -10, -10], 1e-3), got: r6(s.volume()), want: r6(w) }; });
check("torus(R,r) XY plane", () => { const s = A.torus(20, 3), b = s.bounds(); const w = 2 * PI * PI * 20 * 9; return { ok: near(s.volume(), w, 1e-5) && Math.abs(b.size[2] - 6) < 1e-3, got: `${r6(s.volume())} zsize=${r6(b.size[2])}`, want: `${r6(w)} zsize=6` }; });
check("rect(w,h).extrude(h)", () => { const s = A.rect(20, 10).extrude(5), b = s.bounds(); return { ok: near(s.volume(), 1000) && vecNear(b.min, [-10, -5, 0]), got: r6(s.volume()), want: 1000 }; });
check("roundedRect(w,h,r).extrude", () => { const s = A.roundedRect(20, 10, 2).extrude(5); const w = (200 - (4 - PI) * 4) * 5; return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("circle2d(r).extrude", () => { const s = A.circle2d(5).extrude(2); return { ok: near(s.volume(), PI * 50), got: r6(s.volume()), want: r6(PI * 50) }; });
check("ellipse(rx,ry).extrude", () => { const s = A.ellipse(6, 3).extrude(2); const rel = Math.abs(s.volume() - PI * 36) / (PI * 36); return { ok: rel < 1e-4, got: r6(s.volume()), want: r6(PI * 36), note: `rel err ${rel.toExponential(2)} (ellipse drawn as approximated curve)` }; });
check("ngon(n,r).extrude", () => { const s = A.ngon(6, 30).extrude(1); const w = 6 * 0.5 * 900 * Math.sin(PI / 3); return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("ngon.offset(-2) (inradius-2)", () => { const s = A.ngon(6, 30).offset(-2).extrude(1); const ri = 30 * Math.cos(PI / 6) - 2; const w = 2 * Math.sqrt(3) * ri * ri; const b = s.bounds(); return { ok: near(s.volume(), w, 1e-4), got: `${r6(s.volume())} bbox x ${r6(b.min[0])}..${r6(b.max[0])} y ${r6(b.min[1])}..${r6(b.max[1])}`, want: `${r6(w)} x ±${r6(ri)} y ±${r6(ri / Math.cos(PI / 6))}`, valid: s.geometryInfo().valid, note: "via OCCT offsetWire2D; brepjs Drawing.offset gave invalid solid" }; });
check("star(n,R,r).extrude", () => { const s = A.star(5, 10, 4).extrude(1); const w = 5 * 2 * 0.5 * 10 * 4 * Math.sin(PI / 5); return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("slot(len,w).extrude", () => { const s = A.slot(30, 10).extrude(1); const w = 20 * 10 + PI * 25; return { ok: near(s.volume(), w, 1e-4), got: r6(s.volume()), want: r6(w) }; });
check("polygon(pts).extrude", () => { const s = A.polygon([[0, 0], [10, 0], [10, 5], [0, 5]]).extrude(2); return { ok: near(s.volume(), 100), got: r6(s.volume()), want: 100 }; });
check("polygon with duplicate point", () => { const s = A.polygon([[0, 0], [10, 0], [10, 0], [10, 5], [0, 5]]).extrude(2); return { ok: near(s.volume(), 100), got: r6(s.volume()), want: 100 }; });
check("rect.revolve() (X=radius, Y=height)", () => { const s = A.rect(4, 2).translate(10, 5).revolve(); const b = s.bounds(); const w = PI * (144 - 64) * 2; return { ok: near(s.volume(), w) && vecNear([b.min[2], b.max[2]], [4, 6]), got: `${r6(s.volume())} z ${r6(b.min[2])}..${r6(b.max[2])}`, want: `${r6(w)} z 4..6` }; });
check("rect.revolve(90)", () => { const s = A.rect(4, 2).translate(10, 5).revolve(90); const w = PI * (144 - 64) * 2 / 4; return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("extrude(h,{twist,scaleTop})", () => { const s = A.ngon(6, 30).extrude(120, { twist: 120, scaleTop: 0.7 }); const Ar = 6 * 0.5 * 900 * Math.sin(PI / 3); const w = Ar * 120 * (1 + 0.7 + 0.49) / 3; return { ok: near(s.volume(), w, 1e-5) && s.geometryInfo().valid, got: r6(s.volume()), want: r6(w) }; });
check("extrude(h,{scaleTop}) only", () => { const s = A.rect(10, 10).extrude(10, { scaleTop: 0.5 }); const w = 100 * 10 * (1 + 0.5 + 0.25) / 3; return { ok: near(s.volume(), w, 1e-5), got: r6(s.volume()), want: r6(w) }; });
check("loftTo(other,h)", () => { const s = A.rect(10, 10).loftTo(A.rect(5, 5), 10); const w = 10 / 3 * (100 + 25 + 50); return { ok: near(s.volume(), w, 1e-5), got: r6(s.volume()), want: r6(w) }; });
check("add (fuseAll, variadic)", () => { const s = A.box(10, 10, 10).add(A.box(10, 10, 10).translate(5, 0, 0), A.box(10, 10, 10).translate(10, 0, 0)); return { ok: near(s.volume(), 2000) && s.geometryInfo().solids === 1, got: r6(s.volume()), want: 2000 }; });
check("subtract (cutAll, variadic+arrays)", () => { const s = A.box(20, 20, 10).subtract([A.cylinder(12, 2).translate(5, 5, -1)], A.cylinder(12, 2).translate(-5, -5, -1)); const w = 4000 - 2 * PI * 4 * 10; return { ok: near(s.volume(), w), got: r6(s.volume()), want: r6(w) }; });
check("intersect", () => { const s = A.box(10, 10, 10).intersect(A.box(10, 10, 10).translate(5, 0, 0)); return { ok: near(s.volume(), 500), got: r6(s.volume()), want: 500 }; });
check("union/difference/intersection", () => { const u = A.union(A.box(10, 10, 10), A.box(10, 10, 10).translate(0, 0, 10)), d = A.difference(u, A.box(10, 10, 10)), i = A.intersection(u, A.box(10, 10, 10)); return { ok: near(u.volume(), 2000) && near(d.volume(), 1000) && near(i.volume(), 1000), got: `${r6(u.volume())}/${r6(d.volume())}/${r6(i.volume())}`, want: "2000/1000/1000" }; });
check("translate", () => { const b = A.box(2, 2, 2).translate(1, 2, 3).bounds(); return { ok: vecNear(b.min, [0, 1, 3]), got: JSON.stringify(b.min), want: "[0,1,3]" }; });
check("rotate(axis,deg,pivot)", () => { const b = A.box(2, 2, 2).translate(10, 0, 0).rotate([0, 0, 1], 90, [0, 0, 0]).bounds(); return { ok: vecNear(b.center, [0, 10, 1]), got: JSON.stringify(b.center.map(r6)), want: "[0,10,1]" }; });
check("rotate(axis,deg,{pivot})", () => { const b = A.box(2, 2, 2).rotate([0, 0, 1], 180, { pivot: [5, 0, 0] }).bounds(); return { ok: vecNear(b.center, [10, 0, 1]), got: JSON.stringify(b.center.map(r6)), want: "[10,0,1]" }; });
check("mirror([0,1,0]) through origin", () => { const b = A.box(2, 2, 2).translate(0, 10, 0).mirror([0, 1, 0]).bounds(); return { ok: vecNear(b.center, [0, -10, 1]), got: JSON.stringify(b.center.map(r6)), want: "[0,-10,1]" }; });
check("fillet atZ (top 4 edges)", () => { const s = A.fillet(A.box(20, 20, 30), 2, { atZ: 30 }); const w = 12000 - (4 - PI) * 20 * 4 + 0; return { ok: s.geometryInfo().valid && s.volume() < 12000 && s.volume() > 12000 - 4 * (4 - PI) * 20, got: r6(s.volume()), want: `<12000, >${r6(12000 - 4 * (4 - PI) * 20)}`, note: "corner blends make exact value non-trivial" }; });
check("chamfer atZ+minLength (box: all top)", () => { const s = A.chamfer(A.box(20, 20, 30), 1, { atZ: 30, minLength: 10 }); return { ok: s.geometryInfo().valid && s.volume() < 12000, got: r6(s.volume()), want: "<12000" }; });
check("fillet parallel [0,0,1] (4 vertical)", () => { const e = rt.selectEdges(A.box(20, 20, 30), { parallel: [0, 0, 1] }); return { ok: e.length === 4, got: e.length, want: 4 }; });
check("edgeQuery perpendicular [0,0,1] on box", () => { const e = rt.selectEdges(A.box(20, 20, 30), { perpendicular: [0, 0, 1] }); return { ok: e.length === 8, got: e.length, want: 8 }; });
check("edgeQuery atZ on cylinder top", () => { const e = rt.selectEdges(A.cylinder(8, 45), { atZ: 8 }); return { ok: e.length === 1, got: e.length, want: 1 }; });
check("shell(t) open top", () => { const s = A.box(20, 20, 10).shell(2); const w = 4000 - 16 * 16 * 8; return { ok: near(s.volume(), w, 1e-5), got: r6(s.volume()), want: w }; });
check("shell(t,{openTop:false}) closed hollow", () => { const s = A.box(20, 20, 10).shell(2, { openTop: false }); const w = 4000 - 16 * 16 * 6; return { ok: near(s.volume(), w, 1e-5), got: r6(s.volume()), want: w }; });
check("linearPattern(shape,n,dx,dy)", () => { const s = A.linearPattern(A.box(1, 1, 1), 4, 3, 0); return { ok: near(s.volume(), 4) && s.geometryInfo().solids === 4, got: `${r6(s.volume())} solids=${s.geometryInfo().solids}`, want: "4 solids=4" }; });
check("circularPattern(shape,n)", () => { const s = A.circularPattern(A.cylinder(1, 1).translate(10, 0, 0), 6); return { ok: near(s.volume(), 6 * PI), got: r6(s.volume()), want: r6(6 * PI) }; });
check("circularPattern partial angle", () => { const s = A.circularPattern(A.box(1, 1, 1).translate(10, 0, 0), 3, { angle: 90 }); const b = s.bounds(); return { ok: s.geometryInfo().solids === 3 && Math.abs(b.max[1] - 10.5) < 1e-6, got: `solids=${s.geometryInfo().solids} ymax=${r6(b.max[1])}`, want: "solids=3 ymax=10.5" }; });
check("mirrorCopy", () => { const s = A.mirrorCopy(A.box(2, 2, 2).translate(5, 0, 0), [1, 0, 0]); return { ok: near(s.volume(), 16) && s.geometryInfo().solids === 2, got: r6(s.volume()), want: 16 }; });
check("cutPlane('XY',z,'negative')", () => { const s = A.sphere(10).cutPlane("XY", 0, "negative"); return { ok: near(s.volume(), 2 / 3 * PI * 1000, 1e-5), got: r6(s.volume()), want: r6(2 / 3 * PI * 1000) }; });
check("pointAlong([1,0,0])", () => { const b = A.cylinder(10, 1).pointAlong([1, 0, 0]).bounds(); return { ok: Math.abs(b.size[0] - 10) < 1e-6, got: JSON.stringify(b.size.map(r6)), want: "[10,2,2]" }; });
check("moveTo(x,y,z)", () => { const b = A.box(2, 2, 2).moveTo(5, 5, 5).bounds(); return { ok: vecNear(b.min, [5, 5, 5]), got: JSON.stringify(b.min.map(r6)), want: "[5,5,5]" }; });
check("withReferences survive translate+fillet", () => { const s = A.box(10, 10, 10).withReferences({ p: [0, 0, 10] }).translate(1, 2, 3); const f = A.fillet(s, 1, { atZ: 13 }); return { ok: vecNear(f.referencePoint("p"), [1, 2, 13]), got: JSON.stringify(f.referencePoint("p")), want: "[1,2,13]" }; });
check("attachTo(parent,'top','bottom')", () => { const p = A.box(10, 10, 10), c = A.box(4, 4, 4).attachTo(p, "top", "bottom"); return { ok: vecNear(c.bounds().min, [-2, -2, 10]), got: JSON.stringify(c.bounds().min.map(r6)), want: "[-2,-2,10]" }; });
check("connector matchTo (anti-aligned seat)", () => { const plate = A.box(10, 10, 2).withConnectors({ s: { kind: "female", origin: [0, 0, 2], axis: [0, 0, 1], up: [1, 0, 0] } }); const post = A.cylinder(10, 1).withConnectors({ p: { kind: "male", origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] } }).matchTo(plate, "p", "s"); const b = post.bounds(); return { ok: vecNear([b.min[2], b.max[2]], [2, 12]), got: `${r6(b.min[2])}..${r6(b.max[2])}`, want: "2..12" }; });
check("geometryInfo()", () => { const g = A.box(1, 1, 1).geometryInfo(); return { ok: g.solids === 1 && g.faces === 6 && g.edges === 12 && g.valid, got: JSON.stringify(g), want: "solids 1 faces 6 edges 12 valid" }; });

const pass = rows.filter((r) => r.ok).length;
console.log(`conformance ${pass}/${rows.length}`);
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.entry} | got ${r.got} | want ${r.want}${r.note ? " | " + r.note : ""}`);
writeFileSync(`${OUT}/conformance.json`, JSON.stringify({ pass, total: rows.length, rows }, null, 1));
