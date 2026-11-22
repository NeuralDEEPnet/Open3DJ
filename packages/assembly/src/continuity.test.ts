// inspect fields=[continuity] at the assembly level (#78): one table per placed definition, in its
// own frame, with element addresses, counts, a report order that puts problems first, and a cap.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { initKernel } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import { validate } from "@open3dj/schemas";
import type { Vec3 } from "@open3dj/schemas";
import { buildAssembly, continuityRun } from "./index.ts";

let k: Kernel;
before(async () => {
  k = await initKernel();
});

test("continuityRun gives each definition its table once, with addresses, counts and problems first", () => {
  const box = k.box(10, 10, 10);
  const rounded = k.fillet(box, [k.subShapes(box, "edge")[0]!], 2);
  const at = (x: number) => ({ t: [x, 0, 0] as Vec3, q: [0, 0, 0, 1] as [number, number, number, number] });
  const asm = buildAssembly(k, {
    parts: [
      { name: "block", shape: rounded },
      ...[30, 50].map((x) => ({ name: "cube", shape: k.place(box, at(x)), cloneOf: "cube", cloneTransform: at(x) })),
    ],
    mates: [], params: {}, warnings: [],
  });
  const run = continuityRun(k, asm);
  assert.deepEqual(run.parts.map((p) => p.def), ["block", "cube"]);
  const [block, cube] = run.parts;
  assert.deepEqual(cube!.counts, { G2: 0, G1: 0, G0: 12, gap: 0 });
  assert.equal(block!.counts.G1, 2);
  // G1 edges (a curvature step where the faces are tangent) come first, then G0 edges.
  assert.deepEqual(block!.edges.slice(0, 2).map((e) => e.class), ["G1", "G1"]);
  assert.match(block!.edges[0]!.edge, /^edge:\d+$/);
  assert.ok(block!.edges[0]!.faces.every((f) => /^face:\d+$/.test(f)));
  assert.ok(Math.abs(block!.edges[0]!.curvature_jump_per_mm! - 0.5) < 1e-6);
  assert.equal(block!.edges.at(-1)!.curvature_jump_per_mm, undefined, "no curvature on G0 edges");
  assert.deepEqual(run.tolerances, { gap_mm: 1e-3, angle_deg: 0.1, curvature_per_mm: 1e-5, relative: 0.01 });
  assert.ok(run.notes.some((n) => /not a Class-A sign-off/.test(n)), run.notes.join("\n"));
  const v = validate("tool-inspect-output", { status: "ok", continuity: run, compute: { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" } });
  assert.ok(v.valid, JSON.stringify(v.errors));
  // defs narrows the run; limit caps the list but not the counts.
  assert.deepEqual(continuityRun(k, asm, { defs: ["cube"] }).parts.map((p) => p.def), ["cube"]);
  const capped = continuityRun(k, asm, { defs: ["cube"], limit: 5 }).parts[0]!;
  assert.equal(capped.edges.length, 5);
  assert.equal(capped.omitted, 7);
  assert.equal(capped.counts.G0, 12);
});
