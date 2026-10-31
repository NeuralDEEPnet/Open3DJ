// lib.*: fastener data and the volumes of the cutters and schematic hardware, against
// analytic values from the same table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FASTENERS } from "./lib.ts";
import { harness, near } from "./testing.ts";

const PI = Math.PI;
const hexArea = (s: number) => (Math.sqrt(3) / 2) * s * s;

test("lib.fastener returns the table entry, including the 3dj fields", async () => {
  const h = await harness();
  const r = await h.run("console.log(lib.fastener('M3'));\nreturn box(1, 1, 1);");
  assert.equal(r.ok, true, r.error?.message);
  const m3 = r.logs[0] as Record<string, unknown>;
  assert.deepEqual(m3["nut"], { s: 5.5, m: 2.4 });
  assert.deepEqual(m3["socketHead"], { dk: 5.5, k: 3, s: 2.5, t: 1.3 });
  assert.deepEqual(m3["countersunk"], { dk: 6.72, k: 1.86 });
  assert.deepEqual(m3["clearance"], { close: 3.2, medium: 3.4, coarse: 3.6 });
  assert.deepEqual(Object.keys(FASTENERS), ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"]);
});

test("every size has consistent dimensions", () => {
  for (const [size, f] of Object.entries(FASTENERS)) {
    assert.ok(f.clearance.close > f.d && f.clearance.medium >= f.clearance.close && f.clearance.coarse >= f.clearance.medium, size);
    assert.ok(f.socketHead.dk > f.clearance.coarse && f.socketHead.t < f.socketHead.k, size);
    assert.ok(f.washer.d1 > f.d && f.washer.d2 > f.washer.d1, size);
    assert.ok(f.nut.s > f.d && f.countersunk.dk > f.d, size);
  }
});

const VOLUMES: [string, string, number, (string | number)[]?][] = [
  ["bolt M3 x 10", "lib.bolt('M3', 10)", PI * 2.75 ** 2 * 3 - hexArea(2.5) * 1.3 + PI * 1.5 ** 2 * 10, [-10, 3]],
  ["nut M3", "lib.nut('M3')", hexArea(5.5) * 2.4 - PI * 1.5 ** 2 * 2.4, [-1.2, 1.2]],
  ["washer M3", "lib.washer('M3')", (PI / 4) * (7 ** 2 - 3.2 ** 2) * 0.5, [-0.25, 0.25]],
  ["washer M8", "lib.washer('M8')", (PI / 4) * (16 ** 2 - 8.4 ** 2) * 1.6],
  ["clearanceHole M3", "lib.clearanceHole('M3', { length: 10 })", PI * 1.7 ** 2 * 11, [-10, 1]],
  ["clearanceHole M3 close", "lib.clearanceHole('M3', { length: 10, fit: 'close' })", PI * 1.6 ** 2 * 11],
  ["heatSetPocket M3", "lib.heatSetPocket('M3')", PI * 2 ** 2 * 6.2, [-5.7, 0.5]],
  ["hexNutPocket M3", "lib.hexNutPocket('M3')", hexArea(5.9) * 2.9, [-2.4, 0.5]],
  ["screwCutter M3 socket", "lib.screwCutter('M3', { length: 8 })", PI * 1.7 ** 2 * 5 + PI * 3.25 ** 2 * 4, [-8, 1]],
  ["screwCutter M3 none", "lib.screwCutter('M3', { length: 8, head: 'none' })", PI * 1.7 ** 2 * 9],
];

for (const [label, code, want, z] of VOLUMES) {
  test(`lib volume: ${label}`, async () => {
    const h = await harness();
    const r = await h.run(`return ${code};`);
    assert.equal(r.ok, true, r.error?.message);
    const m = r.parts[0]!.m;
    assert.ok(m.valid);
    assert.equal(m.counts.solids, 1);
    assert.ok(near(m.volume, want, 1e-6), `${m.volume} != ${want}`);
    if (z) assert.ok(Math.abs(m.bbox.min[2] - (z[0] as number)) < 1e-6 && Math.abs(m.bbox.max[2] - (z[1] as number)) < 1e-6, JSON.stringify(m.bbox));
  });
}

test("lib volume: countersunk screw cutter (90 degree head)", async () => {
  const h = await harness();
  const r = await h.run("return lib.screwCutter('M3', { head: 'countersunk', length: 8 });");
  assert.equal(r.ok, true, r.error?.message);
  const rs = 1.7;
  const R = 3.36;
  const depth = R - rs;
  const want = PI * rs * rs * (8 - depth) + (PI * depth * (rs * rs + rs * R + R * R)) / 3 + PI * R * R;
  assert.ok(near(r.parts[0]!.m.volume, want), `${r.parts[0]!.m.volume} != ${want}`);
});

test("lib hardware carries seat connectors", async () => {
  const h = await harness();
  const r = await h.run("return [lib.bolt('M4', 12).name('bolt'), lib.nut('M4').name('nut'), lib.washer('M4').name('washer')];");
  assert.equal(r.ok, true, r.error?.message);
  assert.deepEqual(r.parts.map((p) => p.connectors?.map((c) => c.name)), [["head_seat", "tip"], ["seat"], ["seat"]]);
  assert.deepEqual(r.parts[1]!.connectors![0]!.origin, [0, 0, -1.6]);
});

test("unknown sizes and options are refused", async () => {
  const h = await harness();
  for (const code of ["lib.bolt('M7', 10)", "lib.screwCutter('M3', { head: 'pan' })", "lib.clearanceHole('M3', { fit: 'loose' })", "lib.bolt('M3', -1)"]) {
    const r = await h.run(`return ${code};`);
    assert.equal(r.error?.code, "DSL_BAD_ARGUMENT", code);
  }
});
