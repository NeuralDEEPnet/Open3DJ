import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initKernel } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import { validate } from "@open3dj/schemas";
import { AssemblyError, DEFAULT_FIT_OPTIONS, PACKAGE_STATUS, buildAssembly, computeFits, exportArtifacts, report, resolveTargets } from "./index.ts";
import { enclosure } from "./fixtures.ts";

let kernel: Kernel;
before(async () => {
  kernel = await initKernel();
});

const close = (actual: number, expected: number, tol = 1e-6) => assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test("exports the assembly entry points", () => {
  for (const f of [buildAssembly, computeFits, report, exportArtifacts]) assert.equal(typeof f, "function");
  assert.equal(DEFAULT_FIT_OPTIONS.watchDistance, 0.5);
  assert.equal(PACKAGE_STATUS, "ready");
});

describe("buildAssembly", () => {
  test("a single part becomes a root assembly with one occurrence", () => {
    const asm = buildAssembly(kernel, { parts: [{ name: "bracket", shape: kernel.box(10, 10, 10) }], mates: [], params: {}, warnings: [] });
    const root = asm.file.definitions[asm.file.root]!;
    assert.equal(root.kind, "assembly");
    assert.equal(root.occurrences?.length, 1);
    assert.equal(root.occurrences?.[0]?.name, "bracket");
    assert.deepEqual(root.occurrences?.[0]?.transform, { t: [0, 0, 0], q: [0, 0, 0, 1] });
    assert.equal(asm.instances.length, 1);
    assert.deepEqual(validate("assembly", asm.file).errors, []);
  });

  test("identical clones share one definition", () => {
    const screw = kernel.cylinder(1.5, 10);
    const asm = buildAssembly(kernel, {
      parts: [
        { name: "screw", shape: kernel.translate(screw, [0, 0, 0]) },
        { name: "screw", shape: kernel.translate(screw, [10, 0, 0]) },
      ],
      mates: [], params: {}, warnings: [],
    });
    assert.equal(asm.instances.length, 2);
    assert.equal(asm.shapes.size, 1);
    assert.equal(asm.file.definitions.screw?.shared_by, "inferred");
    assert.deepEqual(asm.instances.map((i) => i.path), ["screw#1", "screw#2"]);
    assert.deepEqual(asm.instances[1]!.world.t, [10, 0, 0]);
  });

  test("the enclosure has 3 definitions for 6 occurrences, shared by clone provenance", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    assert.deepEqual(validate("assembly", asm.file).errors, []);
    assert.equal(asm.file.root, "enclosure");
    assert.deepEqual(Object.keys(asm.file.definitions), ["enclosure", "base", "lid", "screw"]);
    assert.equal(asm.file.definitions.screw?.shared_by, "measured");
    assert.deepEqual(asm.instances.map((i) => i.path), ["base", "lid", "screw#1", "screw#2", "screw#3", "screw#4"]);
    // The screw definition sits at its own origin; each occurrence carries the placement.
    const def = kernel.bbox(asm.shapes.get("screw")!);
    close(def.min[2], 0);
    assert.deepEqual(asm.instances[3]!.world, { t: [74, 6, 20], q: [0, 0, 0, 1] });
    assert.equal(asm.warnings.length, 0);
    // Occurrence ids are stable for the same script and names.
    const again = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    assert.deepEqual(again.instances.map((i) => i.id), asm.instances.map((i) => i.id));
  });

  test("clones without provenance are shared by geometry, labelled inferred", () => {
    const asm = buildAssembly(kernel, enclosure(kernel, { clones: "geometry" }));
    assert.equal(asm.shapes.size, 3);
    assert.equal(asm.file.definitions.screw?.shared_by, "inferred");
    // Without provenance the definition frame is the first screw's world frame.
    assert.deepEqual(asm.instances[2]!.world.t, [0, 0, 0]);
    const placed = kernel.bbox(kernel.place(asm.shapes.get("screw")!, asm.instances[3]!.world));
    close(placed.min[0], 74 - 2.75);
    close(placed.min[2], 20);
  });

  test("a rotated clone with provenance shares the definition and keeps its rotation", () => {
    const screw = kernel.fuse(kernel.cylinder(1.5, 12), kernel.translate(kernel.cylinder(2.75, 2), [0, 0, 12]));
    const t1 = { t: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] };
    const t2 = { t: [20, 5, 3] as [number, number, number], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as [number, number, number, number] };
    const asm = buildAssembly(kernel, {
      parts: [
        { name: "screw", shape: kernel.place(screw, t1), cloneOf: "s", cloneTransform: t1 },
        { name: "screw", shape: kernel.place(screw, t2), cloneOf: "s", cloneTransform: t2 },
      ],
      mates: [], params: {}, warnings: [],
    });
    assert.equal(asm.shapes.size, 1);
    assert.equal(asm.file.definitions.screw?.shared_by, "measured");
    const placed = kernel.bbox(kernel.place(asm.shapes.get("screw")!, asm.instances[1]!.world));
    const expected = kernel.bbox(kernel.place(screw, t2));
    for (let i = 0; i < 3; i++) close(placed.max[i]!, expected.max[i]!, 1e-9);
  });

  test("a rotated look-alike without provenance stays separate and says why", () => {
    const peg = kernel.box(2, 4, 10);
    const asm = buildAssembly(kernel, {
      parts: [
        { name: "peg", shape: peg },
        { name: "peg", shape: kernel.translate(kernel.rotate(peg, 90, { origin: [0, 0, 0], dir: [1, 0, 0] }), [20, 0, 0]) },
      ],
      mates: [], params: {}, warnings: [],
    });
    assert.equal(asm.shapes.size, 2);
    assert.deepEqual([...asm.shapes.keys()], ["peg", "peg_2"]);
    assert.match(asm.warnings.join("\n"), /rotated.*clone\(\)/);
  });

  test("groups become sub-assemblies with their own paths", () => {
    const asm = buildAssembly(kernel, {
      parts: [
        { name: "board", shape: kernel.box(20, 20, 1), group: ["pcb_assy"] },
        { name: "standoff", shape: kernel.translate(kernel.cylinder(1, 5), [2, 2, -5]), group: ["pcb_assy"] },
        { name: "standoff", shape: kernel.translate(kernel.cylinder(1, 5), [18, 2, -5]), group: ["pcb_assy"] },
        { name: "case", shape: kernel.translate(kernel.box(30, 30, 2), [-5, -5, -8]) },
      ],
      mates: [], params: {}, warnings: [],
    });
    assert.deepEqual(validate("assembly", asm.file).errors, []);
    assert.deepEqual(asm.instances.map((i) => i.path), ["pcb_assy/board", "pcb_assy/standoff#1", "pcb_assy/standoff#2", "case"]);
    assert.equal(asm.file.definitions.pcb_assy?.kind, "assembly");
    assert.equal(asm.file.definitions.pcb_assy?.occurrences?.length, 3);
    assert.deepEqual(resolveTargets(asm, ["pcb_assy"]).length, 3);
    assert.deepEqual(resolveTargets(asm, ["root/case"]).map((i) => i.path), ["case"]);
  });

  test("previous occurrence ids are kept", () => {
    const first = buildAssembly(kernel, enclosure(kernel));
    const edited = structuredClone(first.file);
    edited.definitions.root!.occurrences![1]!.id = "0193ab00-0000-7000-8000-000000000001";
    const next = buildAssembly(kernel, enclosure(kernel), { previous: edited });
    assert.equal(next.instances[1]!.id, "0193ab00-0000-7000-8000-000000000001");
    assert.equal(next.instances[0]!.id, first.instances[0]!.id);
  });

  test("empty returns and bad shapes are refused with an AssemblyError", () => {
    assert.throws(() => buildAssembly(kernel, { parts: [], mates: [], params: {}, warnings: [] }), (e: unknown) => e instanceof AssemblyError && e.code === "EMPTY_ASSEMBLY");
    assert.throws(() => buildAssembly(kernel, { parts: [{ name: "x", shape: 999999 as never }], mates: [], params: {}, warnings: [] }), (e: unknown) => e instanceof AssemblyError && e.code === "BAD_PART");
  });

  test("unknown targets name the known paths", () => {
    const asm = buildAssembly(kernel, enclosure(kernel));
    assert.deepEqual(resolveTargets(asm, ["lid#1"]).map((i) => i.path), ["lid"]);
    assert.equal(resolveTargets(asm, ["screw"]).length, 4);
    assert.throws(() => resolveTargets(asm, ["nope"]), (e: unknown) => e instanceof AssemblyError && e.code === "UNKNOWN_TARGET" && /screw#1/.test(e.hint ?? ""));
  });
});
