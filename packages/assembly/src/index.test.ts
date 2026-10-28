import { test } from "node:test";
import assert from "node:assert/strict";
import { NotImplementedError } from "@open3dj/schemas";
import { DEFAULT_FIT_OPTIONS, PACKAGE_STATUS, buildAssembly, computeFits, exportArtifacts, report } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "assembly is a stub" : false;

test("exports the assembly entry points", () => {
  for (const f of [buildAssembly, computeFits, report, exportArtifacts]) assert.equal(typeof f, "function");
  assert.equal(DEFAULT_FIT_OPTIONS.watchDistance, 0.5);
  if (PACKAGE_STATUS === "stub") assert.throws(() => buildAssembly({} as never, { parts: [], mates: [], params: {}, warnings: [] }), NotImplementedError);
});

test("a single part becomes a root assembly with one occurrence", { skip: stub }, async () => {
  const { initKernel } = await import("@open3dj/kernel");
  const kernel = await initKernel();
  const asm = buildAssembly(kernel, { parts: [{ name: "bracket", shape: kernel.box(10, 10, 10) }], mates: [], params: {}, warnings: [] });
  const root = asm.file.definitions[asm.file.root]!;
  assert.equal(root.kind, "assembly");
  assert.equal(root.occurrences?.length, 1);
  assert.equal(asm.instances.length, 1);
});

test("identical clones share one definition", { skip: stub }, async () => {
  const { initKernel } = await import("@open3dj/kernel");
  const kernel = await initKernel();
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
});
