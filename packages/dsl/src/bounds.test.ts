// Bounding boxes of trimmed faces (stress test, handheld:0 and springs-pipes:3): the kernel's
// "precise" box bounds the whole underlying surface, so a solid cut by a plane kept the box of
// the uncut surface. Every answer here is exact: the cut puts the extreme on the cut edge. The
// kernel pads every box by the shape tolerance (1e-7 mm), hence 1e-6.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const ok = (r: { ok: boolean; error?: { code: string; message: string } }) => assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
const box = (m: { bbox: { min: number[]; max: number[] } }) => JSON.stringify(m.bbox);

test("a solid cut by a plane has the box of what is left, to the cut", async () => {
  const h = await harness();
  const r = await h.run([
    "const grid = (z) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => [i * 40, j * 40, i === 1 && j === 1 ? z : 0]));",
    "const pillow = sew(surface(grid(15)), surface(grid(0)));",
    "return [sphere(10).cutPlane('XZ', 5, 'negative'), pillow.cutPlane('XY', 5, 'negative'), sphere(10), cylinder(20, 5)];",
  ].join("\n"));
  ok(r);
  const [cutBall, cutPillow, ball, can] = r.parts.map((p) => p.m);
  assert.ok(vecNear(cutBall!.bbox.min, [-10, -10, -10], 1e-6) && vecNear(cutBall!.bbox.max, [10, 5, 10], 1e-6), box(cutBall!));
  assert.ok(vecNear(cutPillow!.bbox.min, [0, 0, 0], 1e-6) && vecNear(cutPillow!.bbox.max, [80, 80, 5], 1e-6), box(cutPillow!));
  // Uncut, the precise box stays exact.
  assert.ok(vecNear(ball!.bbox.min, [-10, -10, -10], 1e-6) && vecNear(ball!.bbox.max, [10, 10, 10], 1e-6), box(ball!));
  assert.ok(vecNear(can!.bbox.min, [-5, -5, 0], 1e-6) && vecNear(can!.bbox.max, [5, 5, 20], 1e-6), box(can!));
});

test("a coil ground flat at both ends is as tall as the grind, not the uncut coil", async () => {
  const h = await harness();
  const r = await h.run("return sweep(circle2d(1), helix(10, 5, 20)).cutPlane('XY', 2, 'positive').cutPlane('XY', 18, 'negative');");
  ok(r);
  const m = r.parts[0]!.m;
  assert.ok(near(m.bbox.min[2], 2, 1e-6) && near(m.bbox.max[2], 18, 1e-6), box(m));
});

test("bounds() in a script and shell's choice of the bottom face use the trimmed box", async () => {
  const h = await harness();
  const nose = "loft([circle2d(10).place({ normal: [1, 0, 0] }), ellipse(12, 8).place({ origin: [40, 0, 0], normal: [1, 0, 0] })], { end: [70, 0, 2] })";
  const r = await h.run([
    `console.log(${nose}.cutPlane('XY', -4, 'positive').bounds().min[2]);`,
    // Before, shell compared the flat cut with the uncut sphere's bottom (z = -10) and found
    // "no flat top or bottom face to open".
    "return sphere(10).cutPlane('XY', -4, 'positive').shell(1, { openTop: false, openBottom: true });",
  ].join("\n"));
  ok(r);
  assert.ok(near(r.logs[0] as number, -4, 1e-6), String(r.logs[0]));
  const m = r.parts[0]!.m;
  assert.ok(m.valid && near(m.bbox.min[2], -4, 1e-6), box(m));
  // A spherical cap 1 mm thick: the cap of radius 10 less the cap of radius 9, both cut at z = -4.
  const cap = (R: number) => (Math.PI / 3) * (R + 4) ** 2 * (3 * R - (R + 4));
  assert.ok(near(m.volume, cap(10) - cap(9), 1e-6), `${m.volume} vs ${cap(10) - cap(9)}`);
});
