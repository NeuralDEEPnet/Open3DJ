// spline2d: a profile through points, the first free-form entry (#78). The answers are
// analytic: points on a circle or a half circle bound a known area, and a spline through
// enough of them must come within 0.05% of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near } from "./testing.ts";

const PI = Math.PI;
/** n points on a circle of radius r, as script source. from and to are in turns. */
const arc = (n: number, r: number, from = 0, to = 1, closedTurn = true) =>
  `Array.from({ length: ${n} }, (_, i) => { const a = 2 * Math.PI * (${from} + (${to} - ${from}) * i / ${closedTurn ? n : n - 1}); return [${r} * Math.cos(a), ${r} * Math.sin(a)]; })`;

test("a closed spline2d through 32 points on a circle is within 0.05% of its area, with no seam", async () => {
  const h = await harness();
  const r = await h.run([
    `const s = spline2d(${arc(32, 10)}, { closed: true });`,
    "console.log(s.area());",
    "return s.extrude(2);",
  ].join("\n"));
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  const area = r.logs[0] as number;
  assert.ok(near(area, PI * 100, 5e-4), `area ${area}, circle ${PI * 100}`);
  const m = r.parts[0]!.m;
  assert.ok(m.valid);
  // Both are integrated by OCCT over the B-spline, each to its own precision.
  assert.ok(near(m.volume, 2 * area, 1e-6), `volume ${m.volume}, twice the area ${2 * area}`);
  // Periodic: one smooth side face, so top, bottom and side make 3 faces.
  assert.equal(m.counts.faces, 3);
  assert.ok(m.bbox.max[0] >= 10 - 1e-9 && m.bbox.max[0] <= 10.01, `the curve passes through (10, 0): ${m.bbox.max[0]}`);
});

test("an open spline2d is closed by a straight line from the last point back to the first", async () => {
  const h = await harness();
  // 17 points on a half circle, closed by its diameter: a half disc.
  const r = await h.run(`const s = spline2d(${arc(17, 10, 0, 0.5, false)}); console.log(s.area()); return s.extrude(1);`);
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  assert.ok(near(r.logs[0] as number, (PI * 100) / 2, 5e-4), `area ${r.logs[0]}, half disc ${(PI * 100) / 2}`);
  const m = r.parts[0]!.m;
  assert.equal(m.counts.faces, 4, "top, bottom, the curved side and the flat side");
  // OCCT pads a bounding box by the shape tolerance, 1e-7 mm here.
  assert.ok(Math.abs(m.bbox.min[1]) < 1e-6, `the closing line lies on y = 0: ${m.bbox.min[1]}`);
});

test("tangents fix the end directions of an open spline2d", async () => {
  const h = await harness();
  // Two points, leaving straight up and arriving straight down: a D shape over the line.
  const r = await h.run("return spline2d([[0, 0], [20, 0]], { tangents: [[0, 1], [0, -1]] }).extrude(1);");
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  const m = r.parts[0]!.m;
  assert.ok(m.valid && m.volume > 0);
  assert.ok(Math.abs(m.bbox.min[0]) < 1e-6 && Math.abs(m.bbox.max[0] - 20) < 1e-6, `a vertical start and end keep the curve within x 0 to 20: ${JSON.stringify(m.bbox)}`);
  assert.ok(m.bbox.max[1] > 5, `the curve bulges up: ${m.bbox.max[1]}`);
});

test("point order, a repeated first point and duplicate points do not change a closed spline2d", async () => {
  const h = await harness();
  const pts = "[[0, 0], [20, 10], [40, 0], [20, -10]]";
  const r = await h.run([
    `const p = ${pts};`,
    "const a = spline2d(p, { closed: true });",
    "const b = spline2d([...p].reverse(), { closed: true });",
    "const c = spline2d([...p, p[0]], { closed: true });",
    "const d = spline2d([p[0], p[1], p[1], p[2], p[3]], { closed: true });",
    "return [a, b, c, d].map((s) => s.extrude(5));",
  ].join("\n"));
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  const [a, b, c, d] = r.parts.map((p) => p.m.volume);
  assert.ok(a! > 0);
  // Reversed order runs the same periodic curve the other way round.
  assert.ok(near(b!, a!, 1e-3), `clockwise ${b} against counter-clockwise ${a}`);
  assert.ok(near(c!, a!, 1e-12), `repeated first point ${c} against ${a}`);
  assert.ok(near(d!, a!, 1e-12), `duplicate point ${d} against ${a}`);
});

test("an open spline2d whose last point repeats the first closes with a corner, not a line", async () => {
  const h = await harness();
  const r = await h.run("return spline2d([[0, 0], [20, 10], [40, 0], [20, -10], [0, 0]]).extrude(5);");
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  assert.equal(r.parts[0]!.m.counts.faces, 3, "one side face from the single closed curve");
});

test("spline2d profiles work with offset, filletCorners, revolve and loft", async () => {
  const h = await harness();
  const r = await h.run([
    `const ring = spline2d(${arc(32, 10)}, { closed: true });`,
    `const half = spline2d(${arc(17, 10, 0, 0.5, false)});`,
    "console.log(ring.offset(1).area());",
    "console.log(half.area());",
    "console.log(half.filletCorners(1).area());",
    "return [ring.translate(30, 0).revolve(), loft([ring, circle2d(5)], [0, 20])];",
  ].join("\n"));
  assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
  assert.ok(near(r.logs[0] as number, PI * 121, 1e-3), `offset area ${r.logs[0]}, circle of radius 11 ${PI * 121}`);
  const [halfArea, rounded] = [r.logs[1] as number, r.logs[2] as number];
  assert.ok(rounded < halfArea && rounded > halfArea - 2, `rounding the two corners trims a little area: ${halfArea} to ${rounded}`);
  const [torus, frustum] = r.parts.map((p) => p.m);
  assert.ok(near(torus!.volume, 2 * PI * 30 * PI * 100, 1e-3), `torus ${torus!.volume}`);
  assert.ok(near(frustum!.volume, (PI * 20 / 3) * (100 + 25 + 50), 1e-3), `frustum ${frustum!.volume}`);
});

test("spline2d refuses bad input with DSL_BAD_ARGUMENT and a fix", async () => {
  const h = await harness();
  const cases: Array<[string, RegExp]> = [
    ["spline2d([[0, 0], [10, 0]])", /at least 3 distinct points/],
    ["spline2d([[0, 0], [10, 5], [20, 0]], { closed: true, tangents: [[1, 0], [1, 0]] })", /tangents.*open/],
    ["spline2d([[0, 0], [10, 5], [20, 0]], { tangents: [[1, 0]] })", /tangents must be \[\[x, y\], \[x, y\]\]/],
    ["spline2d([[0, 0], [10, 5], [20, 0]], { tangents: [[0, 0], [1, 0]] })", /not be zero/],
    ["spline2d([[0, 0], [10, 5], [20, 0]], { close: true })", /unknown option "close"/],
    ["spline2d([[0, 0], [10, 10], [10, 0], [0, 10]], { closed: true })", /crosses itself/],
    ["spline2d('0,0 1,1')", /list of \[x, y\] points/],
  ];
  for (const [call, message] of cases) {
    const r = await h.run(`return ${call}.extrude(1);`);
    assert.equal(r.ok, false, `${call} should fail`);
    assert.equal(r.error!.code, "DSL_BAD_ARGUMENT", `${call}: ${r.error!.code} ${r.error!.message}`);
    assert.match(r.error!.message, message, call);
    assert.ok(r.error!.hint, `${call} has a hint`);
  }
});
