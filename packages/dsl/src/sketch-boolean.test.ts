// Regression tests for 2D sketch booleans (review round 2, issue 1). brepjs 20.11.1 Drawing
// booleans dropped the tool or returned overlapping faces when a profile had curved edges, so
// the DSL now runs them in the kernel. Each expected value is worked out by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlappingSolids } from "./collect.ts";
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

test("corner fillets after a sketch boolean say what to do instead", async () => {
  const h = await harness();
  const r = await h.run("return rect(20, 20).subtract(circle2d(3)).filletCorners(1).extrude(1);");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "DSL_UNSUPPORTED");
  assert.match(r.error!.hint ?? "", /before the boolean/);
});
