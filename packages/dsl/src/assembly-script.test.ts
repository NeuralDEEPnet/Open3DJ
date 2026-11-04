// Multi-part scripts in the 3dj style: named descriptors, colours, connectors and matchTo.
// The scripts are written for these tests; they exercise the same entries as the public 3dj
// multi-part starters without copying them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const PI = Math.PI;

const BASE_AND_PIN = `// A square base with a bore, and a pin with a collar that sits in the bore.
const side = Param.number("Base side", 60, { min: 30, max: 120, unit: "mm" });
const thick = Param.number("Base thickness", 6, { min: 3, max: 15, unit: "mm" });
const pinLen = Param.number("Pin length", 40, { min: 15, max: 90, unit: "mm" });
const pinR = Param.number("Pin radius", 8, { min: 4, max: 20, unit: "mm" });
const gap = Param.number("Radial gap", 0.25, { min: 0.1, max: 0.6, unit: "mm" });

const bore = cylinder(thick + 2, pinR + gap).translate(0, 0, -1);
const socket = connector.female("press", { origin: [0, 0, thick], axis: [0, 0, 1], up: [1, 0, 0] });
const base = roundedRect(side, side, 5).extrude(thick).subtract(bore).withConnectors({ socket });

const collar = cylinder(3, pinR + 4).translate(0, 0, pinLen - 3);
const foot = connector.male("press", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] });
const pin = cylinder(pinLen, pinR).add(collar).withConnectors({ foot });
const seated = pin.matchTo(base, "foot", "socket");

return [
  { name: "Base", shape: base, color: "#5b6b7a" },
  { name: "Pin", shape: seated, color: "#00d4ff" },
];
`;

test("two-part script: named parts, colours, connectors and a matchTo mate", async () => {
  const h = await harness();
  const r = await h.run(BASE_AND_PIN);
  assert.equal(r.ok, true, r.error?.message);
  const [base, pin] = r.parts;
  assert.deepEqual(r.parts.map((p) => p.name), ["Base", "Pin"]);
  assert.ok(vecNear(base!.color!, [0x5b / 255, 0x6b / 255, 0x7a / 255], 1e-4));
  assert.ok(near(base!.m.volume, (3600 - (4 - PI) * 25) * 6 - PI * 8.25 ** 2 * 6));
  assert.ok(near(pin!.m.volume, PI * 64 * 40 + PI * (144 - 64) * 3));
  // The pin was seated on the base's top face: it now spans z = 6 .. 46.
  assert.ok(Math.abs(pin!.m.bbox.min[2] - 6) < 1e-6 && Math.abs(pin!.m.bbox.max[2] - 46) < 1e-6);
  assert.deepEqual(base!.connectors, [{ name: "socket", origin: [0, 0, 6], z: [0, 0, 1], x: [1, 0, 0], gender: "female", type: "press", anchor: "literal" }]);
  const male = pin!.connectors![0]!;
  assert.equal(male.name, "foot");
  assert.ok(vecNear(male.origin, [0, 0, 6]) && vecNear(male.z, [0, 0, -1]) && vecNear(male.x!, [1, 0, 0]));
  const matchLine = BASE_AND_PIN.split("\n").findIndex((l) => l.includes(".matchTo(")) + 1;
  assert.deepEqual(r.out!.mates, [{ a: "Pin.foot", b: "Base.socket", flip: true, line: matchLine }]);
  assert.equal(pin!.line, matchLine);
  assert.deepEqual(r.out!.params, { "Base side": 60, "Base thickness": 6, "Pin length": 40, "Pin radius": 8, "Radial gap": 0.25 });
  assert.deepEqual(r.out!.warnings, []);
});

test("two-part script with caller params moves the seat with the base thickness", async () => {
  const h = await harness();
  const r = await h.run(BASE_AND_PIN, { "Base thickness": 10 });
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(Math.abs(r.parts[1]!.m.bbox.min[2] - 10) < 1e-6);
});

test("matchTo with a rotation: a male frame on the side is turned to sit on the top", async () => {
  const h = await harness();
  const r = await h.run([
    "const base = box(20, 20, 10).withConnectors({ top: connector.female('seat', { origin: [0, 0, 10], axis: [0, 0, 1], up: [1, 0, 0] }) });",
    "const peg = cylinder(8, 2).withConnectors({ end: connector.male('seat', { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) }).rotate([0, 1, 0], 90);",
    "const seated = peg.matchTo(base, 'end', 'top');",
    "return { base, seated };",
  ].join("\n"));
  assert.equal(r.ok, true, r.error?.message);
  const peg = r.parts[1]!;
  assert.ok(vecNear(peg.m.bbox.min, [-2, -2, 10]) && vecNear(peg.m.bbox.max, [2, 2, 18]), JSON.stringify(peg.m.bbox));
  assert.deepEqual(r.out!.mates.map((m) => [m.a, m.b]), [["seated.end", "base.top"]]);
});

test("enclosure: lib pockets and countersunk cutters, a lid seated with connectors", async () => {
  const h = await harness();
  const r = await h.run(`const W = 80, D = 60, H = 32, wall = 2.4, lidT = 8, lipT = 2, play = 0.25, r = 4, bossR = 5;
const size = Param.choice("Fastener", "M3", ["M3", "M4"]);
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * (W / 2 - wall - bossR), sy * (D / 2 - wall - bossR)]);

const hollow = roundedRect(W - 2 * wall, D - 2 * wall, r - wall).extrude(H).translate(0, 0, wall);
const bosses = corners.map(([x, y]) => cylinder(H - wall, bossR).translate(x, y, wall));
const inserts = corners.map(([x, y]) => lib.heatSetPocket(size).translate(x, y, H));
const box1 = roundedRect(W, D, r).extrude(H).subtract(hollow).add(bosses).subtract(inserts)
  .withConnectors({ rim: connector.female("seat", { origin: [0, 0, H], axis: [0, 0, 1], up: [1, 0, 0] }) });

const plate = roundedRect(W, D, r).extrude(lidT).translateZ(lipT);
const lip = roundedRect(W - 2 * (wall + play), D - 2 * (wall + play), r - wall).extrude(lipT);
const holes = corners.map(([x, y]) => lib.screwCutter(size, { head: "countersunk", length: lidT + 2 }).translate(x, y, lipT + lidT));
const lid = union(plate, lip).subtract(holes)
  .withConnectors({ underside: connector.male("seat", { origin: [0, 0, lipT], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(box1, "underside", "rim");

return { Body: box1.color("#5b6b7a"), Lid: lid.color("#00d4ff") };`);
  assert.equal(r.ok, true, r.error?.message);
  const [body, lid] = r.parts;
  assert.deepEqual(r.parts.map((p) => p.name), ["Body", "Lid"]);
  for (const p of r.parts) {
    assert.ok(p.m.valid, p.name);
    assert.equal(p.m.counts.solids, 1, p.name);
  }
  assert.ok(Math.abs(body!.m.bbox.max[2] - 32) < 1e-6);
  // The lip drops into the opening: the lid spans z = 30 .. 40.
  assert.ok(Math.abs(lid!.m.bbox.min[2] - 30) < 1e-6 && Math.abs(lid!.m.bbox.max[2] - 40) < 1e-6, JSON.stringify(lid!.m.bbox));
  assert.deepEqual(r.out!.mates.map((m) => [m.a, m.b]), [["Lid.underside", "Body.rim"]]);
});

test("bolted stack: plates with clearance holes, and a bolt, washer and nut placed from lib.fastener data", async () => {
  const h = await harness();
  const r = await h.run(`const size = Param.choice("Size", "M5", ["M4", "M5", "M6"]);
const f = lib.fastener(size);
const t = 4, stack = 2 * t;
const plate = (z) => box(30, 30, t).subtract(lib.clearanceHole(size, { length: t + 1 }).translateZ(t)).translateZ(z);
const lower = plate(0);
const upper = plate(t).rotateZ(45);
const washer = lib.washer(size).translateZ(stack + f.washer.h / 2);
const bolt = lib.bolt(size, stack + f.washer.h + f.nut.m + 3).translateZ(stack + f.washer.h);
const nut = lib.nut(size).translateZ(-f.nut.m / 2);
return [
  { name: "Lower plate", shape: lower },
  { name: "Upper plate", shape: upper },
  { name: "Washer", shape: washer },
  { name: "Bolt", shape: bolt },
  { name: "Nut", shape: nut },
];`);
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.parts.length, 5);
  for (const p of r.parts) assert.ok(p.m.valid && p.m.counts.solids === 1, p.name);
  // M5: washer 1 mm, nut 4.7 mm, socket head 5 mm. The bolt hangs from z = 9 down to 9 - 16.7.
  const bolt = r.parts[3]!.m;
  assert.ok(Math.abs(bolt.bbox.min[2] - (9 - 16.7)) < 1e-6 && Math.abs(bolt.bbox.max[2] - (9 + 5)) < 1e-6, JSON.stringify(bolt.bbox));
  // The plates' clearance holes are ISO 273 medium (5.5 mm).
  const lower = r.parts[0]!.m;
  assert.ok(near(lower.volume, 30 * 30 * 4 - PI * 2.75 ** 2 * 4));
});

// Regression (review round 1): when the moved up vector was exactly opposite the target up,
// align() turned the part 180 degrees about a fallback axis that was not the connector axis,
// which flipped the male axis back onto the female axis. Connectors along Z hid the bug.
const SEATS: Array<{ name: string; code: string; min: number[]; max: number[] }> = [
  {
    name: "connectors along X with default ups",
    code: [
      "const pin = cylinder(10, 1).pointAlong([1, 0, 0]).withConnectors({ tip: connector.male('seat', { origin: [10, 0, 0], axis: [1, 0, 0] }) });",
      "const wall = box(4, 20, 20).translate(22, 0, -10).withConnectors({ face: connector.female('seat', { origin: [20, 0, 0], axis: [-1, 0, 0] }) });",
      "return { wall, pin: pin.matchTo(wall, 'tip', 'face') };",
    ].join("\n"),
    min: [10, -1, -1],
    max: [20, 1, 1],
  },
  {
    name: "connectors along X with opposite explicit ups",
    code: [
      "const peg = cylinder(10, 1).pointAlong([1, 0, 0]).withConnectors({ tip: connector.male('seat', { origin: [10, 0, 0], axis: [1, 0, 0], up: [0, 1, 0] }) });",
      "const wall = box(4, 20, 20).translate(22, 0, -10).withConnectors({ face: connector.female('seat', { origin: [20, 0, 1], axis: [-1, 0, 0], up: [0, -1, 0] }) });",
      "return { wall, peg: peg.matchTo(wall, 'tip', 'face') };",
    ].join("\n"),
    min: [10, -1, 0],
    max: [20, 1, 2],
  },
  {
    name: "connectors along Y with opposite explicit ups",
    code: [
      "const peg = cylinder(10, 1).pointAlong([0, 1, 0]).withConnectors({ tip: connector.male('seat', { origin: [0, 10, 0], axis: [0, 1, 0], up: [1, 0, 0] }) });",
      "const wall = box(20, 4, 20).translate(0, 22, -10).withConnectors({ face: connector.female('seat', { origin: [0, 20, 0], axis: [0, -1, 0], up: [-1, 0, 0] }) });",
      "return { wall, peg: peg.matchTo(wall, 'tip', 'face') };",
    ].join("\n"),
    min: [-1, 10, -1],
    max: [1, 20, 1],
  },
];

for (const c of SEATS) {
  test(`matchTo seats the male axis against the female axis: ${c.name}`, async () => {
    const h = await harness();
    const r = await h.run(c.code);
    assert.equal(r.ok, true, r.error?.message);
    const [wall, moved] = r.parts;
    assert.ok(vecNear(moved!.m.bbox.min, c.min) && vecNear(moved!.m.bbox.max, c.max), JSON.stringify(moved!.m.bbox));
    const male = moved!.connectors![0]!;
    const female = wall!.connectors![0]!;
    assert.ok(vecNear(male.z, female.z.map((x) => -x)), `male axis ${JSON.stringify(male.z)} vs female ${JSON.stringify(female.z)}`);
    assert.ok(vecNear(male.x!, female.x!), `male up ${JSON.stringify(male.x)} vs female ${JSON.stringify(female.x)}`);
  });
}
