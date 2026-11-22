// Lofts through placed sections (#78): sketch.place() puts a profile on any plane, so a body can
// be lofted through station sections along X, as transport design does, and a loft can end in a
// point. The answers are analytic: cylinder, cone and box volumes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const PI = Math.PI;
const ok = (r: { ok: boolean; error?: { code: string; message: string } }) => assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);

test("a loft through two placed circles is a cylinder, and one ending in a point is a cone", async () => {
  const h = await harness();
  const r = await h.run([
    "const a = circle2d(5).place();",
    "const b = circle2d(5).place({ origin: [0, 0, 20] });",
    "const tips = { start: [0, 0, -30], end: [0, 0, 30] };",
    "return [loft([a, b]), loft([a], { end: [0, 0, 30] }), loft([a], { ...tips, ruled: true }), loft([a], tips)];",
  ].join("\n"));
  ok(r);
  const [cylinder, cone, cones, spindle] = r.parts.map((p) => p.m.volume);
  assert.ok(near(cylinder!, PI * 25 * 20, 1e-9), `cylinder ${cylinder}`);
  assert.ok(near(cone!, (PI * 25 * 30) / 3, 1e-9), `cone ${cone}`);
  assert.ok(near(cones!, (2 * PI * 25 * 30) / 3, 1e-9), `ruled: two cones ${cones}`);
  // Smooth through point, circle, point: the radius follows the parabola 5 (1 - z^2 / 900), so
  // the volume is pi 25 x 60 x 8/15.
  assert.ok(near(spindle!, PI * 25 * 60 * (8 / 15), 1e-8), `smooth: a parabolic spindle ${spindle}`);
});

test("station sections along X: place puts sketch x across (+Y) and sketch y up (+Z)", async () => {
  const h = await harness();
  const r = await h.run("return loft([0, 50, 100].map((x) => rect(20, 10).place({ origin: [x, 0, 0], normal: [1, 0, 0] })));");
  ok(r);
  const m = r.parts[0]!.m;
  assert.ok(near(m.volume, 20 * 10 * 100, 1e-9), String(m.volume));
  assert.ok(vecNear(m.bbox.min, [0, -10, -5], 1e-6) && vecNear(m.bbox.max, [100, 10, 5], 1e-6), JSON.stringify(m.bbox));
});

test("a nose: a circle, an ellipse and a point along X make one smooth valid solid", async () => {
  const h = await harness();
  const r = await h.run([
    "const tail = circle2d(10).place({ normal: [1, 0, 0] });",
    "const mid = ellipse(12, 8).place({ origin: [40, 0, 0], normal: [1, 0, 0] });",
    "return loft([tail, mid], { end: [70, 0, 2] });",
  ].join("\n"));
  ok(r);
  const m = r.parts[0]!.m;
  assert.ok(m.valid && m.counts.solids === 1);
  assert.ok(Math.abs(m.bbox.min[0]) < 1e-6 && Math.abs(m.bbox.max[0] - 70) < 1e-6, JSON.stringify(m.bbox));
  // Symmetric across Y = 0, as its sections are, and at least as wide as the ellipse (12 mm);
  // a smooth loft bulges a little past it on the way to the point (13.47 mm here).
  assert.ok(Math.abs(m.bbox.min[1] + m.bbox.max[1]) < 1e-6, JSON.stringify(m.bbox));
  assert.ok(m.bbox.max[1] >= 12 - 1e-6 && m.bbox.max[1] < 14, JSON.stringify(m.bbox));
});

test("ruled lofts go straight between sections; closed 3D curves are sections too", async () => {
  const h = await harness();
  const ring = (z: number, r: number) => `spline3d(Array.from({ length: 32 }, (_, i) => { const a = 2 * Math.PI * i / 32; return [${r} * Math.cos(a), ${r} * Math.sin(a), ${z}]; }), { closed: true })`;
  const r = await h.run([
    "const ruled = loft([rect(10, 10).place(), circle2d(6).place({ origin: [0, 0, 20] })], { ruled: true });",
    `const rings = loft([${ring(0, 10)}, ${ring(30, 10)}]);`,
    "return [ruled, rings];",
  ].join("\n"));
  ok(r);
  const [ruled, rings] = r.parts.map((p) => p.m);
  assert.ok(ruled!.valid && ruled!.volume > 0);
  // Two equal spline rings through 32 points on a circle: a cylinder within 1e-5. (With 16
  // points OCCT's loft comes out 1.4e-4 under the rings' own area: coarse sections cost accuracy.)
  assert.ok(near(rings!.volume, PI * 100 * 30, 1e-5), String(rings!.volume));
});

test("the height form of loft is unchanged", async () => {
  const h = await harness();
  const r = await h.run("return loft([rect(20, 20), rect(10, 10)], [0, 10]);");
  ok(r);
  // A square frustum: h/3 (A1 + A2 + sqrt(A1 A2)).
  assert.ok(near(r.parts[0]!.m.volume, (10 / 3) * (400 + 100 + 200), 1e-6), String(r.parts[0]!.m.volume));
});

test("loft and place refuse what they cannot use, with a fix", async () => {
  const h = await harness();
  const cases: Array<[string, RegExp]> = [
    ["loft([circle2d(5)], { end: [0, 0, 10] })", /needs their heights, or placed sections/],
    ["loft([circle2d(5).place(), circle2d(5).place({ origin: [0, 0, 9] })], [0, 9])", /placed sections carry their own position/],
    ["loft([circle2d(5).place()])", /at least 2 sections, or a section and a start or end point/],
    ["loft([circle2d(5).place()], { tip: [0, 0, 9] })", /unknown option "tip"/],
    ["circle2d(5).place({ normal: [0, 0, 0] })", /normal must not be the zero vector/],
    ["circle2d(5).place({ centre: [0, 0, 9] })", /unknown option "centre"/],
    ["loft([polyline3d([[0, 0, 0], [9, 0, 0]]), circle2d(5).place({ origin: [0, 0, 9] })])", /closed/],
  ];
  for (const [call, message] of cases) {
    const r = await h.run(`return ${call};`);
    assert.equal(r.ok, false, `${call} should fail`);
    assert.match(r.error!.message, message, `${call}: ${r.error!.code} ${r.error!.message}`);
    assert.ok(r.error!.hint, `${call} has a hint`);
  }
});
