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
