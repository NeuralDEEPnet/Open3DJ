// sweep and the 3D curves it follows: spline3d, helix, polyline3d (#78). Each answer is
// analytic: Weyl's tube formula (a section kept across its centreline holds A x L), Pappus,
// and a prism cut on a slant (A x the length at the centroid, so a mitre keeps A x L).
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const PI = Math.PI;
const ok = (r: { ok: boolean; error?: { code: string; message: string } }) => assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);

test("a coil spring: a circle swept along a helix holds pi r^2 L", async () => {
  const h = await harness();
  const r = await h.run("const coil = helix(10, 5, 20); console.log(coil.length()); return sweep(circle2d(1), coil);");
  ok(r);
  const L = 4 * Math.hypot(20 * PI, 5);
  assert.ok(near(r.logs[0] as number, L, 1e-6), `helix length ${r.logs[0]}, exact ${L}`);
  const m = r.parts[0]!.m;
  assert.ok(m.valid);
  assert.ok(near(m.volume, PI * L, 1e-6), `volume ${m.volume}, exact ${PI * L}`);
});

test("sweep puts the profile across the path start: sketch +Z along the path, +Y towards up", async () => {
  const h = await harness();
  const r = await h.run([
    "const flat = sweep(rect(10, 2), polyline3d([[0, 0, 0], [50, 0, 0]]));",
    "const upright = sweep(rect(10, 2), polyline3d([[0, 0, 0], [0, 0, 50]]));",
    "return [flat, upright];",
  ].join("\n"));
  ok(r);
  const [flat, upright] = r.parts.map((p) => p.m);
  // Along +X with up +Z: the sketch's y (2) points up, its x (10) along +Y.
  assert.ok(vecNear(flat!.bbox.min, [0, -5, -1], 1e-6) && vecNear(flat!.bbox.max, [50, 5, 1], 1e-6), JSON.stringify(flat!.bbox));
  // Along +Z the profile stays as drawn, as in extrude.
  assert.ok(vecNear(upright!.bbox.min, [-5, -1, 0], 1e-6) && vecNear(upright!.bbox.max, [5, 1, 50], 1e-6), JSON.stringify(upright!.bbox));
  assert.ok(near(flat!.volume, 1000, 1e-12) && near(upright!.volume, 1000, 1e-12));
});

test("a profile with a hole sweeps into a tube, and a mitred corner keeps A x L", async () => {
  const h = await harness();
  const r = await h.run([
    "const ring = circle2d(10).subtract(circle2d(8));",
    "return [sweep(ring, polyline3d([[0, 0, 0], [0, 0, 100]])), sweep(ring, polyline3d([[0, 0, 0], [0, 0, 30], [40, 0, 30]]))];",
  ].join("\n"));
  ok(r);
  const [straight, bent] = r.parts.map((p) => p.m);
  assert.ok(near(straight!.volume, 36 * PI * 100, 1e-9), `straight tube ${straight!.volume}`);
  assert.ok(bent!.valid);
  // Each leg is a prism cut on a slant through the centreline, so the volume is A x L.
  assert.ok(near(bent!.volume, 36 * PI * 70, 1e-9), `bent tube ${bent!.volume}, A x L = ${36 * PI * 70}`);
});

test("round corners turn the profile about the corner", async () => {
  const h = await harness();
  const r = await h.run("return sweep(rect(4, 4), polyline3d([[0, 0, 0], [0, 0, 30], [40, 0, 30]]), { corners: 'round' });");
  ok(r);
  // The outer 2 x 2 corner of the mitre becomes a quarter disc of radius 2, through the 4 mm depth.
  assert.ok(near(r.parts[0]!.m.volume, 16 * 70 - 4 * (4 - PI), 1e-9), String(r.parts[0]!.m.volume));
});

test("a closed spline3d path sweeps into a ring", async () => {
  const h = await harness();
  const r = await h.run([
    "const pts = Array.from({ length: 24 }, (_, i) => { const a = 2 * Math.PI * i / 24; return [30 * Math.cos(a), 30 * Math.sin(a), 0]; });",
    "return sweep(circle2d(2), spline3d(pts, { closed: true }));",
  ].join("\n"));
  ok(r);
  const m = r.parts[0]!.m;
  assert.ok(m.valid);
  // Pappus for a torus, with the spline standing in for the circle of radius 30.
  assert.ok(near(m.volume, 2 * PI * 30 * PI * 4, 1e-4), `ring ${m.volume}, torus ${2 * PI * 30 * PI * 4}`);
});

test("a guide turns the profile: a square twisted a quarter turn keeps its volume", async () => {
  const h = await harness();
  const r = await h.run("return sweep(rect(4, 4), polyline3d([[0, 0, 0], [0, 0, 20]]), { orient: 'guide', guide: helix(5, 80, 20) });");
  ok(r);
  const m = r.parts[0]!.m;
  assert.ok(near(m.volume, 320, 1e-6), String(m.volume));
  // It twisted: half way up the square has turned 45 degrees, so its corners reach 2 sqrt 2.
  const d = 2 * Math.SQRT2;
  assert.ok(vecNear(m.bbox.min, [-d, -d, 0], 1e-4) && vecNear(m.bbox.max, [d, d, 20], 1e-4), JSON.stringify(m.bbox));
});

test("curves move and turn like shapes; every orientation gives the same tube on a helix", async () => {
  const h = await harness();
  const r = await h.run([
    "const coil = helix(10, 5, 20).rotate([0, 1, 0], 90).translate(0, 0, 50);",
    "return ['fixed', 'frenet', 'up'].map((orient) => sweep(circle2d(1), coil, { orient, up: [1, 0, 0] }));",
  ].join("\n"));
  ok(r);
  const L = 4 * Math.hypot(20 * PI, 5);
  for (const p of r.parts) {
    assert.ok(near(p.m.volume, PI * L, 1e-6), String(p.m.volume));
    // Turned onto +X and lifted: the coil runs from x = 0 to 20 around the line y = 0, z = 50.
    assert.ok(Math.abs(p.m.bbox.min[0] + 1) < 0.05 && Math.abs(p.m.bbox.max[0] - 21) < 0.05, JSON.stringify(p.m.bbox));
    assert.ok(Math.abs((p.m.bbox.min[2] + p.m.bbox.max[2]) / 2 - 50) < 0.5, JSON.stringify(p.m.bbox));
  }
});

test("sweep and the curve entries refuse bad input with a fix", async () => {
  const h = await harness();
  const cases: Array<[string, RegExp]> = [
    ["sweep(box(1, 1, 1), helix(10, 5, 20))", /sweep profile must be a 2D sketch, got a 3D shape/],
    ["sweep(circle2d(1), circle2d(5))", /sweep path must be a curve, got a 2D sketch/],
    ["sweep(circle2d(1), helix(10, 5, 20), { orient: 'guide' })", /guide/],
    ["sweep(circle2d(1), helix(10, 5, 20), { orient: 'sideways' })", /orient must be/],
    ["sweep(circle2d(1), helix(10, 5, 20), { twist: 90 })", /unknown option "twist"/],
    ["spline3d([[0, 0, 0]])", /at least 2 distinct points/],
    ["spline3d([[0, 0, 0], [5, 5, 0], [9, 0, 0]], { closed: true, tangents: [[1, 0, 0], [1, 0, 0]] })", /tangents.*open/],
    ["polyline3d([[0, 0, 0], [0, 0, 0]])", /at least 2 distinct points/],
    ["helix(10, 0, 20)", /pitch must be greater than 0/],
    ["union(box(1, 1, 1), helix(10, 5, 20))", /must be a 3D shape, got a curve/],
  ];
  for (const [call, message] of cases) {
    const r = await h.run(`return ${call};`);
    assert.equal(r.ok, false, `${call} should fail`);
    assert.equal(r.error!.code, "DSL_BAD_ARGUMENT", `${call}: ${r.error!.code} ${r.error!.message}`);
    assert.match(r.error!.message, message, call);
    assert.ok(r.error!.hint, `${call} has a hint`);
  }
  const curve = await h.run("return helix(10, 5, 20);");
  assert.equal(curve.ok, false);
  assert.match(curve.error!.message, /curve/);
  assert.match(curve.error!.hint ?? "", /sweep/);
});

// OCCT passes a sweep that overlaps itself as valid and counts the overlap twice in its volume.
test("a coil whose wire is thicker than its pitch is refused, not built with a doubled volume", async () => {
  const h = await harness();
  const r = await h.run("return sweep(circle2d(3), helix(10, 5, 20));");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "KERNEL_INVALID_RESULT");
  assert.match(r.error!.message, /comes back within 4\.9\d mm of itself/);
  assert.match(r.error!.hint ?? "", /tightest bend/);
  // The same coil with a wire that clears the pitch builds, with the tube volume.
  const fits = await h.run("return sweep(circle2d(2.4), helix(10, 5, 20));");
  ok(fits);
  assert.ok(near(fits.parts[0]!.m.volume, PI * 2.4 * 2.4 * 4 * Math.hypot(20 * PI, 5), 1e-6));
});
