// Regression tests for 2D sketch booleans (review round 2, issue 1). brepjs 20.11.1 Drawing
// booleans dropped the tool or returned overlapping faces when a profile had curved edges, so
// the DSL now runs them in the kernel. Each expected value is worked out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlappingSolids } from "./collect.ts";
import { runScript } from "@open3dj/sandbox";
import { harness, near } from "./testing.ts";

const PI = Math.PI;
/** Area of a rounded rectangle w x h with corner radius r. */
const rr = (w: number, h: number, r: number) => w * h - (4 - PI) * r * r;
/** Area of the lens where two circles of radius r with centres d apart overlap. */
const lens = (r: number, d: number) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);

const cases: Array<[string, string, number]> = [
  ["rounded rect minus rounded rect", "roundedRect(20, 20, 2).subtract(roundedRect(10, 10, 1))", rr(20, 20, 2) - rr(10, 10, 1)],
  ["rounded rect minus circle", "roundedRect(20, 20, 2).subtract(circle2d(3))", rr(20, 20, 2) - 9 * PI],
  ["rounded rect intersect rect", "roundedRect(20, 20, 2).intersect(rect(10, 30))", 200],
  // The rect spans x 10..20 and touches the rounded rect along x = 10.
  ["rounded rect add touching rect", "roundedRect(20, 20, 2).add(rect(10, 10).translate(15, 0))", rr(20, 20, 2) + 100],
  ["rounded rect add overlapping rect", "roundedRect(20, 20, 2).add(rect(10, 10).translate(10, 0))", rr(20, 20, 2) + 50],
  ["circle minus rounded rect", "circle2d(10).subtract(roundedRect(6, 6, 1))", 100 * PI - rr(6, 6, 1)],
  ["slot minus circle", "slot(20, 6).subtract(circle2d(1))", 14 * 6 + 9 * PI - PI],
  ["rect add circle", "rect(20, 20).add(circle2d(5).translate(8, 0))", 400 + segmentBeyond(5, 2)],
  ["rect intersect circle", "rect(20, 20).intersect(circle2d(5).translate(8, 0))", 25 * PI - segmentBeyond(5, 2)],
  // A 10 x 10 square whose right side is a semicircle of radius 5 bulging outward.
  ["path with an arc minus rect", "path().moveTo(0, 0).lineTo(10, 0).arcTo(10, 10, -5).lineTo(0, 10).close().subtract(rect(2, 2).translate(5, 5))", 100 + 12.5 * PI - 4],
  ["two circles add", "circle2d(5).add(circle2d(5).translate(8, 0))", 50 * PI - lens(5, 8)],
  ["two circles intersect", "circle2d(5).intersect(circle2d(5).translate(8, 0))", lens(5, 8)],
  ["two subtracts in a row", "rect(20, 20).subtract(circle2d(3)).subtract(rect(2, 2).translate(6, 6))", 400 - 9 * PI - 4],
  ["union2d of crossed slots", "union2d(slot(20, 4), slot(20, 4).rotate(90))", 2 * (16 * 4 + 4 * PI) - 16],
  ["difference2d with two tools", "difference2d(roundedRect(40, 20, 2), roundedRect(6, 6, 1).translate(-10, 0), roundedRect(6, 6, 1).translate(10, 0))", rr(40, 20, 2) - 2 * rr(6, 6, 1)],
  // Corner fillets drawn by brepjs carry a 1e-7 edge tolerance, which once hid the result face.
  ["filleted rect minus filleted rect", "rect(20, 20).filletCorners(2).subtract(rect(10, 10).filletCorners(1))", rr(20, 20, 2) - rr(10, 10, 1)],
  ["ellipse minus circle", "ellipse(10, 6).subtract(circle2d(2))", 60 * PI - 4 * PI],
];

/** Area of the part of a circle of radius r that lies more than d from its centre on one side. */
function segmentBeyond(r: number, d: number): number {
  return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
}

for (const [name, expr, want] of cases) {
  test(`sketch boolean: ${name}`, async () => {
    const h = await harness();
    const r = await h.run(`const s = ${expr};\nconsole.log(s.area());\nreturn s.extrude(1);`);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.ok(near(r.logs[0] as number, want, 1e-3), `area ${String(r.logs[0])}, want ${want}`);
    const m = r.parts[0]!.m;
    assert.equal(m.counts.solids, 1, `solids ${m.counts.solids}`);
    assert.ok(near(m.volume, want, 1e-3), `volume ${m.volume}, want ${want}`);
    assert.equal(m.valid, true);
  });
}

test("sketch boolean: a hole stays a hole (the face has two wires)", async () => {
  const h = await harness();
  const r = await h.run("return roundedRect(20, 20, 2).subtract(roundedRect(10, 10, 1)).extrude(1);");
  assert.equal(r.ok, true, JSON.stringify(r.error));
  // 8 outer side faces, 8 inner side faces, top and bottom.
  assert.equal(r.parts[0]!.m.counts.faces, 18);
});

test("sketch boolean: an intersection of disjoint profiles is an empty-result error", async () => {
  const h = await harness();
  const r = await h.run("return circle2d(5).intersect(circle2d(5).translate(20, 0)).extrude(1);");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "DSL_EMPTY_RESULT");
  assert.equal(r.error!.line, 1);
});

test("sketch boolean results can still be transformed, offset and shelled", async () => {
  const h = await harness();
  const r = await h.run([
    "const ring = circle2d(10).subtract(circle2d(5));",
    "const a = ring.translate(30, 0).extrude(2);",
    "const b = rect(20, 20).subtract(rect(10, 10)).rotate(45).extrude(1);",
    "const c = rect(4, 4).add(rect(4, 4).translate(2, 2)).offset(1).extrude(1);",
    "const d = rect(20, 10).add(circle2d(5).translate(10, 0)).extrude(10).shell(1);",
    "return [a, b, c, d];",
  ].join("\n"));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(near(r.parts[0]!.m.volume, 2 * 75 * PI, 1e-3));
  assert.ok(near(r.parts[1]!.m.volume, 300, 1e-3));
  // The union has area 28 and perimeter 24, with 6 convex and 2 concave corners. Offsetting by 1
  // adds 24 x 1, a quarter circle at each convex corner, and loses a 1 x 1 square at each concave one.
  assert.ok(near(r.parts[2]!.m.volume, 28 + 24 + 1.5 * PI - 2, 1e-3), String(r.parts[2]!.m.volume));
  // Shell keeps the outer skin: the hollow is the profile inset by 1, from z = 1 up through the open top.
  const outer = 200 + 12.5 * PI;
  const inner = 19 * 8 + 8 * PI;
  assert.ok(near(r.parts[3]!.m.volume, outer * 10 - inner * 9, 1e-3), String(r.parts[3]!.m.volume));
});

test("overlappingSolids finds solids of one part that share volume", async () => {
  const h = await harness();
  const k = h.kernel;
  const mark = k.checkpoint();
  try {
    const a = k.box(10, 10, 10);
    const overlapping = k.compound([a, k.translate(k.box(10, 10, 10), [5, 0, 0])]);
    const touching = k.compound([a, k.translate(k.box(10, 10, 10), [10, 0, 0])]);
    const apart = k.compound([a, k.translate(k.box(10, 10, 10), [20, 0, 0])]);
    const hit = overlappingSolids(k, overlapping);
    assert.ok(hit, "overlap not found");
    assert.deepEqual([hit.a, hit.b], [1, 2]);
    assert.ok(near(hit.volume, 500, 1e-6), String(hit.volume));
    assert.equal(overlappingSolids(k, touching), undefined);
    assert.equal(overlappingSolids(k, apart), undefined);
    assert.equal(overlappingSolids(k, a), undefined);
  } finally {
    k.releaseSince(mark);
  }
});

// S1 polish: filletCorners and chamferCorners used to refuse kernel profiles (the result of a
// sketch boolean or offset) with DSL_UNSUPPORTED. They now work on the kernel face: the
// profile is extruded 1 mm, the vertical edges at its corners are filleted or chamfered, and
// the top face comes back. Smooth joins (a line running into a tangent arc) are not corners.
const filletLoss = (r: number) => (4 - PI) * r * r / 4; // one 90 degree corner
const chamferLoss = (s: number) => (s * s) / 2;

test("filletCorners and chamferCorners work after a sketch boolean and after offset", async () => {
  const h = await harness();
  const cases: Array<[string, number]> = [
    // A square with a round hole: the hole has no corners, the four outer corners are rounded.
    ["rect(20, 20).subtract(circle2d(3)).filletCorners(1)", 400 - 9 * PI - 4 * filletLoss(1)],
    ["rect(20, 20).subtract(circle2d(3)).chamferCorners(2)", 400 - 9 * PI - 4 * chamferLoss(2)],
    // An L made by a boolean: five convex corners lose area, the concave one gains it.
    ["rect(20, 20).subtract(rect(10, 10).translate(5, 5)).filletCorners(1)", 300 - 5 * filletLoss(1) + filletLoss(1)],
    // A square hole in a square: its four corners are concave from the material's side.
    ["rect(30, 30).subtract(rect(10, 10)).filletCorners(2)", 800 - 4 * filletLoss(2) + 4 * filletLoss(2)],
    // offset keeps sharp corners with the "arc" join only outside; inside it is a smaller square.
    ["rect(20, 20).offset(-2).filletCorners(1)", 256 - 4 * filletLoss(1)],
    // A slot unioned with a rect: the arcs join the slot's sides smoothly, only true corners round.
    ["slot(30, 10).add(rect(10, 20)).filletCorners(1)", 20 * 10 + 25 * PI + 10 * 5 * 2 - 0],
  ];
  for (const [code, want] of cases) {
    const r = await h.run(`const p = ${code};\nreturn p.extrude(1);`);
    assert.equal(r.ok, true, `${code}: ${r.error?.code} ${r.error?.message}`);
    const got = r.parts[0]!.m.volume;
    if (!code.startsWith("slot")) assert.ok(near(got, want, 1e-6), `${code}: area ${got}, hand value ${want}`);
    assert.equal(r.parts[0]!.m.valid, true, code);
  }
});

test("a corner radius too large for the kernel profile fails with the fillet hint", async () => {
  const h = await harness();
  const r = await h.run("return rect(20, 20).subtract(circle2d(3)).filletCorners(15).extrude(1);");
  assert.equal(r.ok, false);
  assert.match(r.error!.code, /^KERNEL_FILLET_FAILED$|^DSL_BAD_ARGUMENT$/);
  assert.match(r.error!.hint ?? r.error!.message, /smaller radius|radius/);
});

// Regression (review round 1): the area guard assumed both sides of every corner were
// straight, so the kernel's correct fillet at a corner between a line and an arc (a D profile,
// a lens) was refused with DSL_UNSUPPORTED. Hand values come from Green's theorem over the
// corner piece: the straight side, the fillet arc and the profile's arc.
type P2 = [number, number];
const seg2 = (p: P2, q: P2) => (p[0] * q[1] - p[1] * q[0]) / 2;
const arc2 = (c: P2, r: number, a: number, b: number) => (r * r * (b - a) + r * (c[0] * (Math.sin(b) - Math.sin(a)) - c[1] * (Math.cos(b) - Math.cos(a)))) / 2;
const ang2 = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** Area a fillet of radius r removes at one corner of a disk of radius R cut by the line y = h. */
function dCornerLoss(R: number, h: number, r: number): number {
  const C: P2 = [Math.sqrt((R - r) ** 2 - (h - r) ** 2), h - r];
  const V: P2 = [Math.sqrt(R * R - h * h), h];
  const T1: P2 = [C[0], h];
  const T2: P2 = [(C[0] * R) / (R - r), (C[1] * R) / (R - r)];
  return Math.abs(seg2(V, T1) + arc2(C, r, ang2(C, T1), ang2(C, T2)) + arc2([0, 0], R, ang2([0, 0], T2), ang2([0, 0], V)));
}
/** Area a fillet of radius r removes at one tip of the lens of two radius-R circles d apart. */
function lensCornerLoss(R: number, d: number, r: number): number {
  const O1: P2 = [0, 0];
  const O2: P2 = [d, 0];
  const C: P2 = [d / 2, Math.sqrt((R - r) ** 2 - (d / 2) ** 2)];
  const V: P2 = [d / 2, Math.sqrt(R * R - (d / 2) ** 2)];
  const T1: P2 = [(C[0] * R) / (R - r), (C[1] * R) / (R - r)];
  const T2: P2 = [d + ((C[0] - d) * R) / (R - r), (C[1] * R) / (R - r)];
  return Math.abs(arc2(O1, R, ang2(O1, V), ang2(O1, T1)) + arc2(C, r, ang2(C, T1), ang2(C, T2)) + arc2(O2, R, ang2(O2, T2), ang2(O2, V)));
}

test("filletCorners and chamferCorners work at corners between a line or an arc and an arc", async () => {
  const h = await harness();
  const D = "circle2d(10).subtract(rect(30, 20).translate(0, 15))";
  const dArea = 100 * PI - segmentBeyond(10, 5);
  const lensArea = lens(10, 12);
  const cases: Array<[string, number]> = [
    [`${D}.filletCorners(1)`, dArea - 2 * dCornerLoss(10, 5, 1)],
    [`${D}.filletCorners(0.3)`, dArea - 2 * dCornerLoss(10, 5, 0.3)],
    ["circle2d(10).intersect(circle2d(10).translate(12, 0)).filletCorners(1)", lensArea - 2 * lensCornerLoss(10, 12, 1)],
  ];
  for (const [code, want] of cases) {
    const r = await h.run(`return ${code}.extrude(1);`);
    assert.equal(r.ok, true, `${code}: ${r.error?.code} ${r.error?.message}`);
    assert.ok(near(r.parts[0]!.m.volume, want, 1e-7), `${code}: area ${r.parts[0]!.m.volume}, hand value ${want}`);
    assert.equal(r.parts[0]!.m.valid, true, code);
  }
  // A chamfer of 1 at the D's two corners removes a sliver: less area than the profile, and
  // no more than the fillet-free triangle each corner can lose (half of 1 x 1 x sin 60, doubled, plus slack).
  const r = await h.run(`return ${D}.chamferCorners(1).extrude(1);`);
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  const lost = dArea - r.parts[0]!.m.volume;
  assert.ok(lost > 0 && lost < 2, `chamfer removed ${lost}`);
  assert.equal(r.parts[0]!.m.valid, true);
});

// Regression (ops/build-log.md, H-det run): ellipse(18, 10).offset(3) made edges on offset
// curves, which the STEP writer cannot express (NUL REF in SURFACE_OF_LINEAR_EXTRUSION), so
// the STEP file re-imported as 0 solids while the model was valid. offset() now rebuilds such
// edges as B-splines through the offset curve, within 1e-6 of the area.
test("an offset ellipse writes a STEP file that re-imports as the same solid", async () => {
  const h = await harness();
  const k = h.kernel;
  const mark = k.checkpoint();
  try {
    h.dsl.reset({});
    const raw = await runScript("return ellipse(18, 10).offset(3).extrude(10);", { hostApi: h.dsl.hostApi, params: {} });
    assert.ok(raw.ok, raw.ok ? "" : raw.error.message);
    if (!raw.ok) return;
    const shape = h.dsl.collect(raw.value).parts[0]!.shape;
    assert.ok(!k.edges(shape).some((e) => e.curve === "offset"), "no offset curves are left");
    // The offset of an ellipse by d has area pi*a*b + d*perimeter + pi*d^2.
    const perimeter = ellipsePerimeter(18, 10);
    const area = PI * 180 + 3 * perimeter + 9 * PI;
    assert.ok(near(k.volume(shape) / 10, area, 1e-6), `area ${k.volume(shape) / 10}, hand value ${area}`);
    const back = k.importStep(k.exportStep(shape));
    assert.equal(k.counts(back).solids, 1);
    assert.ok(near(k.volume(back), k.volume(shape), 1e-6));
  } finally {
    k.releaseSince(mark);
  }
});

/** Ellipse perimeter by Ramanujan's second formula (relative error about 1e-10 here). */
function ellipsePerimeter(a: number, b: number): number {
  const hh = ((a - b) / (a + b)) ** 2;
  return PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
}
