// draft (Phase D of the surfacing plan, #78): every wall that runs along the pull direction turns
// by the draft angle about the neutral plane, so a moulded part releases. The answers are
// analytic: drafted walls of a box make a frustum, h/3 (A1 + A2 + sqrt(A1 A2)), and a drafted
// cylinder makes a cone frustum, pi h/3 (r1^2 + r1 r2 + r2^2), with r2 = r1 - h tan(angle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const PI = Math.PI;
const t3 = Math.tan((3 * PI) / 180);
const ok = (r: { ok: boolean; error?: { code: string; message: string } }) => assert.equal(r.ok, true, `${r.error?.code} ${r.error?.message}`);
/** The square frustum of a side-s box h tall, its walls drafted by 3 degrees towards the pull. */
const frustum = (s: number, h: number, inset = h * t3) => (h / 3) * (s * s + (s - 2 * inset) ** 2 + s * (s - 2 * inset));

test("a drafted box is a frustum, and a drafted cylinder a cone frustum, about the base", async () => {
  const h = await harness();
  const r = await h.run("return [box(40, 40, 10).draft(3), draft(cylinder(10, 10), 3)];");
  ok(r);
  const [block, round] = r.parts.map((p) => p.m);
  assert.ok(block!.valid && round!.valid);
  assert.ok(near(block!.volume, frustum(40, 10), 1e-9), `box ${block!.volume}, frustum ${frustum(40, 10)}`);
  // The base keeps its size (the neutral plane is Z = 0 by default); the top shrinks.
  assert.ok(vecNear(block!.bbox.min, [-20, -20, 0], 1e-6) && vecNear(block!.bbox.max, [20, 20, 10], 1e-6), JSON.stringify(block!.bbox));
  const r2 = 10 - 10 * t3;
  assert.ok(near(round!.volume, (PI * 10 / 3) * (100 + 10 * r2 + r2 * r2), 1e-9), `cylinder ${round!.volume}`);
});

test("holes open out towards the pull, and the neutral plane keeps its size wherever it is", async () => {
  const h = await harness();
  const r = await h.run([
    "const holed = box(40, 40, 10).subtract(cylinder(10, 5)).draft(3);",
    "const fromTop = box(40, 40, 10).draft(3, { neutral: [0, 0, 10] });",
    "const sideways = box(40, 40, 10).draft(3, { pull: [1, 0, 0], neutral: [20, 0, 0] });",
    "const down = box(40, 40, 10).draft(-3);",
    "return [holed, fromTop, sideways, down];",
  ].join("\n"));
  ok(r);
  const [holed, fromTop, sideways, down] = r.parts.map((p) => p.m);
  // The hole is a cone frustum from r = 5 at the base to 5 + 10 tan(3) at the top, cut from the box frustum.
  const top = 5 + 10 * t3;
  const hole = (PI * 10 / 3) * (25 + 5 * top + top * top);
  assert.ok(near(holed!.volume, frustum(40, 10) - hole, 1e-9), `holed ${holed!.volume}, expected ${frustum(40, 10) - hole}`);
  // About the top, the top keeps 40 x 40 and the base grows by 10 tan(3) a side.
  assert.ok(near(fromTop!.volume, frustum(40, 10, -10 * t3), 1e-9), `about the top ${fromTop!.volume}`);
  assert.ok(Math.abs(fromTop!.bbox.max[0] - (20 + 10 * t3)) < 1e-6, JSON.stringify(fromTop!.bbox));
  // Pulled along +X about X = 20: the four walls along X lean in towards +X, so the 40 x 10
  // section at X = 20 keeps its size and, d mm back along the pull, each wall stands d tan(3)
  // further out: the volume is the integral of (40 + 2 d t)(10 + 2 d t) for d from 0 to 40.
  const expected = 16000 + 80000 * t3 + (256000 / 3) * t3 * t3;
  assert.ok(near(sideways!.volume, expected, 1e-9), `sideways ${sideways!.volume}, expected ${expected}`);
  assert.ok(Math.abs(sideways!.bbox.min[1] + 20 + 40 * t3) < 1e-6 && Math.abs(sideways!.bbox.max[0] - 20) < 1e-6, JSON.stringify(sideways!.bbox));
  // A negative angle leans the walls the other way: the top grows.
  assert.ok(near(down!.volume, frustum(40, 10, -10 * t3), 1e-9), `negative ${down!.volume}`);
});

test("rounded corners draft into cones: a rounded rectangle and filleted vertical edges keep the exact volume", async () => {
  const h = await harness();
  const r = await h.run("return [roundedRect(40, 30, 5).extrude(10).draft(3), fillet(box(40, 30, 10), 2, { parallel: [0, 0, 1] }).draft(3), fillet(box(40, 30, 10).draft(3), 2, { atZ: 10 })];");
  ok(r);
  const [rounded, filleted, after] = r.parts.map((p) => p.m);
  // d mm up the walls stand d tan(3) in, so the section is a w x l rectangle less 2 d t a side,
  // with corner radius r - d t: area (w - 2dt)(l - 2dt) - (4 - pi)(r - dt)^2, integrated over h.
  const v = (w: number, l: number, rc: number, hh = 10) =>
    w * l * hh - (w + l) * t3 * hh * hh + (4 * t3 * t3 * hh ** 3) / 3 - (4 - PI) * (rc * rc * hh - rc * t3 * hh * hh + (t3 * t3 * hh ** 3) / 3);
  assert.ok(near(rounded!.volume, v(40, 30, 5), 1e-9), `rounded rectangle ${rounded!.volume}, expected ${v(40, 30, 5)}`);
  assert.ok(near(filleted!.volume, v(40, 30, 2), 1e-9), `filleted corners ${filleted!.volume}, expected ${v(40, 30, 2)}`);
  // Draft first, then round the top edges: the order that works (see the refusal below). The
  // rounds take a little from the drafted block (under 0.86 r^2 a millimetre of edge, 140 mm of it).
  assert.ok(after!.valid, "valid");
  assert.ok(after!.volume < v(40, 30, 0) && after!.volume > v(40, 30, 0) - (4 - PI) * 140, `rounded after draft ${after!.volume}`);
});

test("draft refuses what it cannot do, with a fix", async () => {
  const h = await harness();
  const cases: Array<[string, RegExp]> = [
    ["box(10, 10, 10).draft(0)", /angle must be between -45 and 45 degrees and not 0/],
    ["box(10, 10, 10).draft(50)", /angle must be between -45 and 45/],
    ["box(10, 10, 10).draft(3, { pull: [0, 0, 0] })", /pull must not be the zero vector/],
    ["box(10, 10, 10).draft(3, { parting: 0 })", /unknown option "parting"/],
    ["sphere(10).draft(3)", /no wall runs along the pull/],
    ["draft(circle2d(5), 3)", /must be a 3D shape, got a 2D sketch/],
    // A freeform wall: OCCT drafts planes, cylinders and cones only.
    ["spline2d([[15, 0], [0, 12], [-15, 0], [0, -12]], { closed: true }).extrude(10).draft(3)", /could not draft an? \w+ wall/],
    // A wall that meets a fillet already made: draft first, then fillet.
    ["fillet(box(40, 30, 10), 2, { atZ: 10 }).draft(3)", /could not draft a plane wall/],
  ];
  for (const [call, message] of cases) {
    const r = await h.run(`return ${call};`);
    assert.equal(r.ok, false, `${call} should fail`);
    assert.match(r.error!.message, message, `${call}: ${r.error!.code} ${r.error!.message}`);
    assert.ok(r.error!.hint, `${call} has a hint`);
  }
});
