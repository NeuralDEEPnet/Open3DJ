// DSL conformance: the 47 checks of the DSL spike (spikes/dsl-brepjs/src/conformance.mjs),
// each run as a real script through the sandbox, against analytic values. Every part must
// also be a valid B-rep. Tolerances: 1e-6 relative unless the note says otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShapeMeasure } from "@open3dj/kernel";
import { center, harness, near, size, vecNear } from "./testing.ts";
import type { RunOutcome } from "./testing.ts";

const PI = Math.PI;

interface Check {
  entry: string;
  code: string;
  check: (m: ShapeMeasure[], r: RunOutcome) => void;
}

const vol = (m: ShapeMeasure, want: number, rel = 1e-6) => assert.ok(near(m.volume, want, rel), `volume ${m.volume} != ${want} (rel ${rel})`);
const at = (got: readonly number[], want: readonly number[], tol = 1e-4) => assert.ok(vecNear(got, want, tol), `${JSON.stringify(got)} != ${JSON.stringify(want)}`);

const CHECKS: Check[] = [
  { entry: "box(w,d,h) centred XY, base Z=0", code: "return box(20, 10, 30);", check: ([m]) => { at(m!.bbox.min, [-10, -5, 0]); at(m!.bbox.max, [10, 5, 30]); vol(m!, 6000); } },
  { entry: "cylinder(h,r)", code: "return cylinder(10, 5);", check: ([m]) => { vol(m!, PI * 250); at(m!.bbox.min, [-5, -5, 0]); } },
  { entry: "cylinder(h,r,rTop) cone", code: "return cylinder(80, 25, 35);", check: ([m]) => vol(m!, ((PI * 80) / 3) * (625 + 875 + 1225)) },
  { entry: "cylinder(h,r,0) sharp cone", code: "return cylinder(10, 5, 0);", check: ([m]) => vol(m!, (PI * 25 * 10) / 3) },
  { entry: "sphere(r) centred origin", code: "return sphere(10);", check: ([m]) => { vol(m!, (4 / 3) * PI * 1000, 1e-5); at(m!.bbox.min, [-10, -10, -10], 1e-3); } },
  { entry: "torus(R,r) XY plane", code: "return torus(20, 3);", check: ([m]) => { vol(m!, 2 * PI * PI * 20 * 9, 1e-5); assert.ok(Math.abs(size(m!)[2]! - 6) < 1e-3); } },
  { entry: "rect(w,h).extrude(h)", code: "return rect(20, 10).extrude(5);", check: ([m]) => { vol(m!, 1000); at(m!.bbox.min, [-10, -5, 0]); } },
  { entry: "roundedRect(w,h,r).extrude", code: "return roundedRect(20, 10, 2).extrude(5);", check: ([m]) => vol(m!, (200 - (4 - PI) * 4) * 5) },
  { entry: "circle2d(r).extrude", code: "return circle2d(5).extrude(2);", check: ([m]) => vol(m!, PI * 50) },
  // Exact since review round 1: the profile is a kernel ellipse edge, not two B-splines.
  { entry: "ellipse(rx,ry).extrude (exact curve)", code: "return ellipse(6, 3).extrude(2);", check: ([m]) => { vol(m!, PI * 36, 1e-9); at(size(m!), [12, 6, 2], 1e-6); } },
  { entry: "ngon(n,r).extrude", code: "return ngon(6, 30).extrude(1);", check: ([m]) => vol(m!, 6 * 0.5 * 900 * Math.sin(PI / 3)) },
  {
    entry: "ngon.offset(-2) (inradius - 2, via OCCT, 1e-4)",
    code: "return ngon(6, 30).offset(-2).extrude(1);",
    check: ([m]) => { const ri = 30 * Math.cos(PI / 6) - 2; vol(m!, 2 * Math.sqrt(3) * ri * ri, 1e-4); assert.ok(m!.valid); },
  },
  { entry: "star(n,R,r).extrude", code: "return star(5, 10, 4).extrude(1);", check: ([m]) => vol(m!, 5 * 2 * 0.5 * 10 * 4 * Math.sin(PI / 5)) },
  { entry: "slot(len,w).extrude (1e-4)", code: "return slot(30, 10).extrude(1);", check: ([m]) => vol(m!, 20 * 10 + PI * 25, 1e-4) },
  { entry: "polygon(pts).extrude", code: "return polygon([[0, 0], [10, 0], [10, 5], [0, 5]]).extrude(2);", check: ([m]) => vol(m!, 100) },
  { entry: "polygon with duplicate point", code: "return polygon([[0, 0], [10, 0], [10, 0], [10, 5], [0, 5]]).extrude(2);", check: ([m]) => vol(m!, 100) },
  {
    entry: "rect.revolve() (X = radius, Y = height)",
    code: "return rect(4, 2).translate(10, 5).revolve();",
    check: ([m]) => { vol(m!, PI * (144 - 64) * 2); at([m!.bbox.min[2], m!.bbox.max[2]], [4, 6]); },
  },
  { entry: "rect.revolve(90)", code: "return rect(4, 2).translate(10, 5).revolve(90);", check: ([m]) => vol(m!, (PI * (144 - 64) * 2) / 4) },
  {
    entry: "extrude(h, { twist, scaleTop }) (1e-5)",
    code: "return ngon(6, 30).extrude(120, { twist: 120, scaleTop: 0.7 });",
    check: ([m]) => { const a = 6 * 0.5 * 900 * Math.sin(PI / 3); vol(m!, (a * 120 * (1 + 0.7 + 0.49)) / 3, 1e-5); assert.ok(m!.valid); },
  },
  { entry: "extrude(h, { scaleTop }) only (1e-5)", code: "return rect(10, 10).extrude(10, { scaleTop: 0.5 });", check: ([m]) => vol(m!, (100 * 10 * (1 + 0.5 + 0.25)) / 3, 1e-5) },
  { entry: "loftTo(other, h) (1e-5)", code: "return rect(10, 10).loftTo(rect(5, 5), 10);", check: ([m]) => vol(m!, (10 / 3) * (100 + 25 + 50), 1e-5) },
  {
    entry: "add (fuseAll, variadic)",
    code: "return box(10, 10, 10).add(box(10, 10, 10).translate(5, 0, 0), box(10, 10, 10).translate(10, 0, 0));",
    check: ([m]) => { vol(m!, 2000); assert.equal(m!.counts.solids, 1); },
  },
  {
    entry: "subtract (cutAll, variadic + arrays)",
    code: "return box(20, 20, 10).subtract([cylinder(12, 2).translate(5, 5, -1)], cylinder(12, 2).translate(-5, -5, -1));",
    check: ([m]) => vol(m!, 4000 - 2 * PI * 4 * 10),
  },
  { entry: "intersect", code: "return box(10, 10, 10).intersect(box(10, 10, 10).translate(5, 0, 0));", check: ([m]) => vol(m!, 500) },
  {
    entry: "union/difference/intersection",
    code: "const u = union(box(10, 10, 10), box(10, 10, 10).translate(0, 0, 10));\nreturn [u, difference(u, box(10, 10, 10)), intersection(u, box(10, 10, 10))];",
    check: ([u, d, i]) => { vol(u!, 2000); vol(d!, 1000); vol(i!, 1000); },
  },
  { entry: "translate", code: "return box(2, 2, 2).translate(1, 2, 3);", check: ([m]) => at(m!.bbox.min, [0, 1, 3]) },
  { entry: "rotate(axis, deg, pivot)", code: "return box(2, 2, 2).translate(10, 0, 0).rotate([0, 0, 1], 90, [0, 0, 0]);", check: ([m]) => at(center(m!), [0, 10, 1]) },
  { entry: "rotate(axis, deg, { pivot })", code: "return box(2, 2, 2).rotate([0, 0, 1], 180, { pivot: [5, 0, 0] });", check: ([m]) => at(center(m!), [10, 0, 1]) },
  { entry: "mirror([0,1,0]) through origin", code: "return box(2, 2, 2).translate(0, 10, 0).mirror([0, 1, 0]);", check: ([m]) => at(center(m!), [0, -10, 1]) },
  {
    entry: "fillet atZ (top 4 edges)",
    code: "return fillet(box(20, 20, 30), 2, { atZ: 30 });",
    check: ([m]) => { assert.ok(m!.valid); assert.ok(m!.volume < 12000 && m!.volume > 12000 - 4 * (4 - PI) * 20, String(m!.volume)); },
  },
  {
    entry: "chamfer atZ + minLength (all top edges, mitred corners)",
    code: "return chamfer(box(20, 20, 30), 1, { atZ: 30, minLength: 10 });",
    // Four 0.5 x 1 x 1 triangular prisms along the 80 mm top perimeter, minus the four
    // corner overlaps of 1/3 mm^3 each.
    check: ([m]) => { assert.ok(m!.valid); vol(m!, 12000 - (40 - 4 / 3)); },
  },
  { entry: "edge query parallel [0,0,1] (4 vertical)", code: "console.log(box(20, 20, 30).edges({ parallel: [0, 0, 1] }).length); return box(1, 1, 1);", check: (_m, r) => assert.equal(r.logs[0], 4) },
  { entry: "edge query perpendicular [0,0,1] on box", code: "console.log(box(20, 20, 30).edges({ perpendicular: [0, 0, 1] }).length); return box(1, 1, 1);", check: (_m, r) => assert.equal(r.logs[0], 8) },
  { entry: "edge query atZ on cylinder top", code: "console.log(cylinder(8, 45).edges({ atZ: 8 }).length); return box(1, 1, 1);", check: (_m, r) => assert.equal(r.logs[0], 1) },
  { entry: "shell(t) open top", code: "return box(20, 20, 10).shell(2);", check: ([m]) => { vol(m!, 4000 - 16 * 16 * 8, 1e-5); assert.ok(m!.valid); } },
  { entry: "shell(t, { openTop: false }) closed hollow", code: "return box(20, 20, 10).shell(2, { openTop: false });", check: ([m]) => vol(m!, 4000 - 16 * 16 * 6, 1e-5) },
  {
    entry: "linearPattern(shape, n, dx, dy)",
    code: "return linearPattern(box(1, 1, 1), 4, 3, 0);",
    check: ([m]) => { vol(m!, 4); assert.equal(m!.counts.solids, 4); },
  },
  { entry: "circularPattern(shape, n)", code: "return circularPattern(cylinder(1, 1).translate(10, 0, 0), 6);", check: ([m]) => vol(m!, 6 * PI) },
  {
    entry: "circularPattern partial angle",
    code: "return circularPattern(box(1, 1, 1).translate(10, 0, 0), 3, { angle: 90 });",
    check: ([m]) => { assert.equal(m!.counts.solids, 3); assert.ok(Math.abs(m!.bbox.max[1] - 10.5) < 1e-6); },
  },
  {
    entry: "mirrorCopy",
    code: "return mirrorCopy(box(2, 2, 2).translate(5, 0, 0), [1, 0, 0]);",
    check: ([m]) => { vol(m!, 16); assert.equal(m!.counts.solids, 2); },
  },
  { entry: "cutPlane('XY', z, 'negative') (1e-5)", code: "return sphere(10).cutPlane('XY', 0, 'negative');", check: ([m]) => vol(m!, (2 / 3) * PI * 1000, 1e-5) },
  { entry: "pointAlong([1,0,0])", code: "return cylinder(10, 1).pointAlong([1, 0, 0]);", check: ([m]) => at(size(m!), [10, 2, 2], 1e-6) },
  { entry: "moveTo(x,y,z)", code: "return box(2, 2, 2).moveTo(5, 5, 5);", check: ([m]) => at(m!.bbox.min, [5, 5, 5]) },
  {
    entry: "withReferences survive translate + fillet",
    code: "const s = box(10, 10, 10).withReferences({ p: [0, 0, 10] }).translate(1, 2, 3);\nconst f = fillet(s, 1, { atZ: 13 });\nconsole.log(f.referencePoint('p'));\nreturn f;",
    check: (_m, r) => at(r.logs[0] as number[], [1, 2, 13]),
  },
  { entry: "attachTo(parent, 'top', 'bottom')", code: "const p = box(10, 10, 10);\nreturn box(4, 4, 4).attachTo(p, 'top', 'bottom');", check: ([m]) => at(m!.bbox.min, [-2, -2, 10]) },
  {
    entry: "connector matchTo (anti-aligned seat)",
    code: [
      "const plate = box(10, 10, 2).withConnectors({ s: connector.female('seat', { origin: [0, 0, 2], axis: [0, 0, 1], up: [1, 0, 0] }) });",
      "const post = cylinder(10, 1).withConnectors({ p: connector.male('seat', { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) }).matchTo(plate, 'p', 's');",
      "return post;",
    ].join("\n"),
    check: ([m]) => at([m!.bbox.min[2], m!.bbox.max[2]], [2, 12]),
  },
  {
    entry: "geometryInfo()",
    code: "console.log(box(1, 1, 1).geometryInfo()); return box(1, 1, 1);",
    check: (_m, r) => assert.deepEqual(r.logs[0], { solids: 1, shells: 1, faces: 6, edges: 12, vertices: 8, valid: true }),
  },
];

test("the conformance table has the spike's 47 checks", () => {
  assert.equal(CHECKS.length, 47);
});

for (const c of CHECKS) {
  test(`conformance: ${c.entry}`, async () => {
    const h = await harness();
    const r = await h.run(c.code);
    assert.equal(r.ok, true, r.error ? `${r.error.code}: ${r.error.message}` : "");
    for (const p of r.parts) assert.ok(p.m.valid, `part ${p.name} is not a valid B-rep`);
    c.check(r.parts.map((p) => p.m), r);
  });
}
