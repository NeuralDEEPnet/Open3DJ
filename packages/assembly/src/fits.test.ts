import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initKernel } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import { validate } from "@open3dj/schemas";
import type { ComputeBlock } from "@open3dj/schemas";
import { buildAssembly, computeFits, report } from "./index.ts";
import { CLASH_VOLUME, SCREW_Z_CLEAR, enclosure } from "./fixtures.ts";

let kernel: Kernel;
before(async () => {
  kernel = await initKernel();
});

const compute: ComputeBlock = { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" };

describe("computeFits", () => {
  test("finds the deliberate 1 mm screw-head clash with the lid", () => {
    const asm = buildAssembly(kernel, enclosure(kernel));
    const fits = computeFits(kernel, asm);
    const clashes = fits.filter((f) => f.kind === "clash");
    assert.deepEqual(clashes.map((f) => [f.a, f.b]), [["lid", "screw#1"], ["lid", "screw#2"], ["lid", "screw#3"], ["lid", "screw#4"]]);
    for (const c of clashes) {
      assert.ok(Math.abs(c.volume_mm3! - CLASH_VOLUME) < 1e-3, `clash volume ${c.volume_mm3}`);
      assert.equal(c.confidence, "measured");
    }
    // The lid rests on the base rim: contact, not clash.
    assert.deepEqual(fits.filter((f) => f.kind === "contact").map((f) => [f.a, f.b]), [["base", "lid"]]);
  });

  test("reports clearance once the screws are raised", () => {
    const asm = buildAssembly(kernel, enclosure(kernel, { screwZ: SCREW_Z_CLEAR }));
    const fits = computeFits(kernel, asm);
    assert.equal(fits.filter((f) => f.kind === "clash").length, 0);
    const clear = fits.filter((f) => f.kind === "clearance");
    assert.equal(clear.length, 4);
    for (const c of clear) assert.ok(Math.abs(c.distance_mm! - 0.2) < 1e-6, `distance ${c.distance_mm}`);
  });

  test("mated pairs are exempt from contact, never from clash", () => {
    const asm = buildAssembly(kernel, enclosure(kernel, { mates: true }));
    assert.deepEqual(asm.file.mates, [{ id: "m1", type: "fastened", a: "lid.rim", b: "base.rim", flip: true, owner: "script" }]);
    const fits = computeFits(kernel, asm);
    assert.equal(fits.filter((f) => f.kind === "contact").length, 0);
    assert.equal(fits.filter((f) => f.kind === "clash").length, 4);
  });

  // Regression (S1 polish): one line per pair hid the lip of a box lid. The lid rests on the
  // rim (a mated contact, exempt) and its lip clears the inner wall by 0.25 mm, but the
  // report said nothing about the lip because the pair's minimum distance was 0.
  test("a mated lid reports its lip clearance in addition to the exempt seat contact", () => {
    const base = kernel.cut(kernel.box(70, 50, 30), kernel.translate(kernel.box(66, 46, 30), [2, 2, 2]));
    const ring = kernel.cut(kernel.translate(kernel.box(65.5, 45.5, 4), [2.25, 2.25, 26]), kernel.translate(kernel.box(62.3, 42.3, 6), [3.85, 3.85, 25]));
    const lid = kernel.fuse(kernel.translate(kernel.box(70, 50, 3), [0, 0, 30]), ring);
    const parts = [{ name: "base", shape: base }, { name: "lid", shape: lid }];
    const mated = buildAssembly(kernel, { parts, mates: [{ a: "lid.rim", b: "base.rim", flip: true }], params: {}, warnings: [] });
    const fits = computeFits(kernel, mated);
    assert.deepEqual(fits.map((f) => [f.a, f.b, f.kind]), [["base", "lid", "clearance"]], JSON.stringify(fits));
    assert.ok(Math.abs(fits[0]!.distance_mm! - 0.25) < 1e-6, JSON.stringify(fits));
    assert.equal(fits[0]!.extra, true, "a further gap of a pair whose closest relation (the mated contact) is not listed");
    // Without the mate the seat contact is listed too, and the lip clearance after it.
    const loose = buildAssembly(kernel, { parts, mates: [], params: {}, warnings: [] });
    assert.deepEqual(computeFits(kernel, loose).map((f) => [f.kind, f.distance_mm === undefined ? undefined : Number(f.distance_mm.toFixed(6))]), [["contact", 0], ["clearance", 0.25]]);
  });

  test("distinct gaps of one pair are separate lines; equal gaps are one", () => {
    // A pin in a hole: 0.1 mm radial clearance and a 0.3 mm gap under its head.
    const block = kernel.cut(kernel.box(20, 20, 10), kernel.translate(kernel.cylinder(3.1, 12), [10, 10, -1]));
    const pin = kernel.fuse(kernel.translate(kernel.cylinder(3, 10), [10, 10, 0]), kernel.translate(kernel.cylinder(5, 2), [10, 10, 10.3]));
    const asm = buildAssembly(kernel, { parts: [{ name: "block", shape: block }, { name: "pin", shape: pin }], mates: [], params: {}, warnings: [] });
    const fits = computeFits(kernel, asm);
    assert.deepEqual(fits.map((f) => [f.kind, Number(f.distance_mm!.toFixed(6)), f.extra ?? false]), [["clearance", 0.1, false], ["clearance", 0.3, true]], JSON.stringify(fits));
    // The concise report keeps both, and its budget still holds.
    const r = report(kernel, asm, { rev: "r_0001", compute, fits });
    assert.equal(r.fits.length, 2);
  });

  // Regression (review round 1): two parallel planes facing the same way, with one part's
  // material between them, were reported as a further gap. A 0.2 mm sheet held 0.1 mm above
  // a plate has one air gap (0.1); the plate top to the sheet top (0.3) is not a gap.
  test("parallel faces count as a gap only when they face each other across empty space", () => {
    const plate = kernel.box(20, 20, 2);
    const sheet = kernel.translate(kernel.box(10, 10, 0.2), [5, 5, 2.1]);
    const asm = buildAssembly(kernel, { parts: [{ name: "plate", shape: plate }, { name: "sheet", shape: sheet }], mates: [], params: {}, warnings: [] });
    const fits = computeFits(kernel, asm);
    assert.deepEqual(fits.map((f) => [f.kind, Number(f.distance_mm!.toFixed(6)), f.extra ?? false]), [["clearance", 0.1, false]], JSON.stringify(fits));
  });

  test("a gap measured through a part's own fin and slot is not a gap", () => {
    // Regression (review round 2 of increment 2): A is a U channel, a 0.1 mm fin at x 0..0.1, a
    // slot from 0.1 to 0.3 and a wall from 0.3 to 1; B's face is at x = -0.1. The 0.4 mm from
    // B to A's wall crosses A's fin, so only the 0.1 mm gap to the fin is real.
    const floor = kernel.translate(kernel.box(1, 10, 1), [0, -5, 0]);
    const fin = kernel.translate(kernel.box(0.1, 10, 5), [0, -5, 0]);
    const wall = kernel.translate(kernel.box(0.7, 10, 5), [0.3, -5, 0]);
    const a = kernel.fuseAll([floor, fin, wall]);
    const b = kernel.translate(kernel.box(2.9, 10, 5), [-3, -5, 0]);
    const asm = buildAssembly(kernel, { parts: [{ name: "A", shape: a }, { name: "B", shape: b }], mates: [], params: {}, warnings: [] });
    const fits = computeFits(kernel, asm);
    assert.deepEqual(fits.map((f) => [f.kind, Number(f.distance_mm!.toFixed(6)), f.extra ?? false]), [["clearance", 0.1, false]], JSON.stringify(fits));
  });

  test("round faces count as a gap only between a convex and a concave face", () => {
    // A pin (r 3) in a thin sleeve (bore r 3.1, outside r 3.4): the gap is 0.1. The sleeve's
    // outside is 0.4 mm from the pin, but behind the sleeve wall, so it is not a gap.
    const sleeve = kernel.cut(kernel.cylinder(3.4, 10), kernel.translate(kernel.cylinder(3.1, 12), [0, 0, -1]));
    const pin = kernel.translate(kernel.cylinder(3, 14), [0, 0, -2]);
    const asm = buildAssembly(kernel, { parts: [{ name: "sleeve", shape: sleeve }, { name: "pin", shape: pin }], mates: [], params: {}, warnings: [] });
    const fits = computeFits(kernel, asm);
    assert.deepEqual(fits.map((f) => [f.kind, Number(f.distance_mm!.toFixed(6)), f.extra ?? false]), [["clearance", 0.1, false]], JSON.stringify(fits));
  });

  test("a part nested inside another is a clash, not a clearance", () => {
    const asm = buildAssembly(kernel, {
      parts: [{ name: "block", shape: kernel.box(10, 10, 10) }, { name: "pin", shape: kernel.translate(kernel.box(2, 2, 2), [4, 4, 4]) }],
      mates: [], params: {}, warnings: [],
    });
    const [fit] = computeFits(kernel, asm);
    assert.equal(fit?.kind, "clash");
    assert.ok(Math.abs(fit!.volume_mm3! - 8) < 1e-6);
  });

  test("far pairs are dropped and no handles leak", () => {
    const asm = buildAssembly(kernel, {
      parts: [{ name: "a", shape: kernel.box(1, 1, 1) }, { name: "b", shape: kernel.translate(kernel.box(1, 1, 1), [5, 0, 0]) }],
      mates: [], params: {}, warnings: [],
    });
    const before = kernel.stats().liveShapes;
    assert.deepEqual(computeFits(kernel, asm), []);
    assert.equal(kernel.stats().liveShapes, before);
  });
});

describe("report", () => {
  test("a clash gives a schema-valid warning report with a render hint", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const rep = report(kernel, asm, { rev: "r_1", compute });
    assert.deepEqual(validate("geometry-report", rep).errors, []);
    assert.equal(rep.status, "warning");
    assert.deepEqual(rep.assembly.occurrences, 6);
    assert.deepEqual(rep.assembly.definitions, 3);
    assert.deepEqual(rep.assembly.bbox, { min: [0, 0, 0], max: [80, 60, 34] });
    assert.ok(rep.next?.some((n) => n === "render view=multiview targets=[lid,screw#1,screw#2,screw#3,screw#4]"), JSON.stringify(rep.next));
    const screw = rep.parts.find((p) => p.def === "screw")!;
    assert.equal(screw.occurrences, 4);
    const volume = Math.PI * 1.5 ** 2 * 12 + Math.PI * 2.75 ** 2 * 2;
    assert.ok(Math.abs(screw.volume_mm3 - volume) < 1e-3);
    assert.match(rep.warnings!.join("\n"), /1\.24 g\/cm3 \(PLA\)/);
    // Concise means short (the 300-token budget is measured in packages/mcp/src/report-budget.test.ts):
    // no area, centre of mass or counts for one-solid parts, and the four identical screw clashes on one line.
    for (const p of rep.parts) assert.deepEqual([p.area_mm2, p.center_of_mass, p.counts], [undefined, undefined, undefined], p.def);
    assert.deepEqual(rep.fits.filter((f) => f.kind === "clash").map((f) => [f.a, f.b, f.n]), [["lid", "screw#1..4", 4]]);
  });

  test("a clean assembly is ok; detailed keeps more digits", () => {
    const asm = buildAssembly(kernel, enclosure(kernel, { screwZ: SCREW_Z_CLEAR, mates: true }));
    const rep = report(kernel, asm, { rev: "r_2", compute, detail: "detailed" });
    assert.deepEqual(validate("geometry-report", rep).errors, []);
    assert.equal(rep.status, "ok");
    assert.equal(rep.fits.length, 4);
    assert.deepEqual(rep.next?.slice(0, 2), ["render view=multiview", "export format=step"]);
    const screw = rep.parts.find((p) => p.def === "screw")!;
    assert.ok(Math.abs(screw.mass_g! - screw.volume_mm3 * 0.00124) < 1e-6, "detailed parts carry mass, area, centre of mass and counts");
    assert.ok(screw.area_mm2! > 0 && screw.center_of_mass && screw.counts?.faces);
  });

  test("a single part reports one definition and one occurrence", () => {
    const asm = buildAssembly(kernel, { parts: [{ name: "part", shape: kernel.box(10, 20, 30) }], mates: [], params: {}, warnings: [] });
    const rep = report(kernel, asm, { rev: "r_3", compute });
    assert.deepEqual(validate("geometry-report", rep).errors, []);
    assert.equal(rep.parts[0]?.volume_mm3, 6000);
    assert.equal(rep.assembly.mass_g, 7.44);
  });
});
