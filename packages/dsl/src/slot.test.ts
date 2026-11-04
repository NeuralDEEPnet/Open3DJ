// Regression tests for slot() (review round 2, issue 3). slot() used a corner radius 1e-6 below
// half the width, which left 2e-6 mm sliver faces at each end: meshes with open edges, and
// fillet, chamfer and shell failures. The exact stadium has no straight end faces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near } from "./testing.ts";

const PI = Math.PI;

test("slot(20, 6) extruded has 8 faces and no sliver edges", async () => {
  const h = await harness();
  const r = await h.run("const s = slot(20, 6).extrude(5);\nconsole.log(s.edges({ maxLength: 1e-3 }).length);\nreturn s;");
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.parts[0]!.m.counts.faces, 8);
  assert.equal(r.logs[0], 0);
  assert.ok(near(r.parts[0]!.m.volume, 5 * (14 * 6 + 9 * PI), 1e-9));
});

test("fillet, chamfer and shell work on a slot extrusion", async () => {
  const h = await harness();
  const r = await h.run([
    "const f = fillet(slot(20, 6).extrude(5), 1, { atZ: 5 });",
    "const c = chamfer(slot(20, 6).extrude(5), 1, { atZ: 5 });",
    "const s = slot(40, 20).extrude(10).shell(2);",
    "return [f, c, s];",
  ].join("\n"));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  // Same as the matching roundedRect(l, w, w / 2) shapes.
  const want = await h.run("return [fillet(roundedRect(20, 6, 3).extrude(5), 1, { atZ: 5 }), chamfer(roundedRect(20, 6, 3).extrude(5), 1, { atZ: 5 })];");
  assert.ok(near(r.parts[0]!.m.volume, want.parts[0]!.m.volume, 1e-6), String(r.parts[0]!.m.volume));
  assert.ok(near(r.parts[1]!.m.volume, want.parts[1]!.m.volume, 1e-6), String(r.parts[1]!.m.volume));
  // Outer 20 x 20 + pi 10^2 by 10, minus the inset 20 x 16 + pi 8^2 from z = 2 up.
  assert.ok(near(r.parts[2]!.m.volume, (400 + 100 * PI) * 10 - (320 + 64 * PI) * 8, 1e-6), String(r.parts[2]!.m.volume));
});
