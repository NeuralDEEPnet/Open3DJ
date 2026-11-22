// Surfaces (#78): surface() through a grid of points, fill() inside a closed curve, sew() into a
// closed solid, thicken() into a panel. Answers are analytic: a 3 x 3 grid with its centre raised
// by h is the biquadratic graph h x 4u(1-u) x 4v(1-v), whose volume over a square of side s is
// h s^2 4/9; flat and planar pieces have exact areas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near } from "./testing.ts";

const PI = Math.PI;
const ok = (r: { ok: boolean; error?: { code: string; message: string } }) => assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
/** A 3 x 3 grid over 100 x 100 with its centre at height h, as script source. */
const grid = (h: number) => `[0, 1, 2].map((i) => [0, 1, 2].map((j) => [i * 50, j * 50, i === 1 && j === 1 ? ${h} : 0]))`;

test("a pillow: two surfaces sewn edge to edge close the biquadratic volume, and a mirror makes the other half", async () => {
  const h = await harness();
  const r = await h.run([
    `const top = surface(${grid(20)});`,
    `const flat = surface(${grid(0)});`,
    "console.log(flat.area());",
    "return [sew(top, flat), sew(top, top.mirror([0, 0, 1]))];",
  ].join("\n"));
  ok(r);
  assert.ok(near(r.logs[0] as number, 10000, 1e-12), String(r.logs[0]));
  const [half, whole] = r.parts.map((p) => p.m);
  assert.ok(near(half!.volume, 20 * 10000 * (4 / 9), 1e-9), `half ${half!.volume}`);
  assert.ok(near(whole!.volume, 2 * 20 * 10000 * (4 / 9), 1e-9), `mirrored pair ${whole!.volume}`);
  assert.ok(Math.abs(whole!.bbox.max[2] - 20) < 1e-5 && Math.abs(whole!.bbox.min[2] + 20) < 1e-5, JSON.stringify(whole!.bbox));
});

test("thicken grows a panel along the surface normal, or against it", async () => {
  const h = await harness();
  const r = await h.run(`const s = surface(${grid(0)}); return [s.thicken(2), thicken(s, -2)];`);
  ok(r);
  const [up, down] = r.parts.map((p) => p.m);
  assert.ok(near(up!.volume, 20000, 1e-12) && near(down!.volume, 20000, 1e-12));
  assert.ok(Math.abs(up!.bbox.max[2] - 2) < 1e-6 && Math.abs(down!.bbox.min[2] + 2) < 1e-6, `${JSON.stringify(up!.bbox)} ${JSON.stringify(down!.bbox)}`);
});

test("fill spans a closed curve; six filled squares sew into a cube the right way out", async () => {
  const h = await harness();
  const r = await h.run([
    "const disc = fill(circle2d(10).place());",
    "console.log(disc.area());",
    "const sq = (o, n) => fill(rect(10, 10).place({ origin: o, normal: n }));",
    "const cube = sew(sq([5, 5, 0], [0, 0, 1]), sq([5, 5, 10], [0, 0, 1]), sq([5, 0, 5], [0, 1, 0]), sq([5, 10, 5], [0, 1, 0]), sq([0, 5, 5], [1, 0, 0]), sq([10, 5, 5], [1, 0, 0]));",
    "return [cube, disc.thicken(3)];",
  ].join("\n"));
  ok(r);
  assert.ok(near(r.logs[0] as number, PI * 100, 1e-12), String(r.logs[0]));
  const [cube, plate] = r.parts.map((p) => p.m);
  assert.ok(near(cube!.volume, 1000, 1e-12), `cube ${cube!.volume}`);
  assert.ok(near(plate!.volume, PI * 300, 1e-12), `plate ${plate!.volume}`);
});

test("surfaces refuse what they cannot make, with a fix", async () => {
  const h = await harness();
  const cases: Array<[string, RegExp]> = [
    ["sew(...[[5, 5, 0], [5, 5, 10], [5, 0, 5], [5, 10, 5], [0, 5, 5]].map((o, i) => fill(rect(10, 10).place({ origin: o, normal: [[0, 0, 1], [0, 0, 1], [0, 1, 0], [0, 1, 0], [1, 0, 0]][i] }))))", /4 open edges.*do not close a volume/],
    ["surface([[[0, 0, 0], [1, 0, 0]], [[0, 1, 0]]])", /every row the same length/],
    ["sew(box(1, 1, 1))", /sew surface must be a surface, got a 3D shape/],
    [`surface(${grid(0)}).thicken(0)`, /must not be 0/],
    ["fill(polyline3d([[0, 0, 0], [5, 0, 0]]))", /not closed/],
  ];
  for (const [call, message] of cases) {
    const r = await h.run(`return ${call};`);
    assert.equal(r.ok, false, `${call} should fail`);
    assert.match(r.error!.message, message, `${call}: ${r.error!.code} ${r.error!.message}`);
    assert.ok(r.error!.hint, `${call} has a hint`);
  }
  const returned = await h.run(`return surface(${grid(0)});`);
  assert.equal(returned.ok, false);
  assert.match(returned.error!.message, /is a surface/);
  assert.match(returned.error!.hint ?? "", /thicken/);
});
