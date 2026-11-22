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
  assert.deepEqual(run.tolerances, { gap_mm: 1e-3, angle_deg: 0.1, curvature_per_mm: 1e-5, relative: 0.01, flat_per_mm: 1e-5 });
  // Faces: the cube is six flats, listed nowhere; the block's one curved face is its fillet.
  assert.equal(run.grid, 8);
  assert.deepEqual([cube!.faces, cube!.face_counts], [[], { flat: 6, convex: 0, concave: 0, saddle: 0, mixed: 0, inflected: 0 }]);
  assert.deepEqual(block!.face_counts, { flat: 6, convex: 1, concave: 0, saddle: 0, mixed: 0, inflected: 0 });
  const [round] = block!.faces;
  assert.deepEqual([round!.kind, round!.surface, round!.min_radius_mm, round!.k_min_per_mm, round!.k_max_per_mm, round!.inflection], ["convex", "cylinder", 2, [0, 0], [0.5, 0.5], false]);
  assert.match(round!.face, /^face:\d+$/);
  assert.deepEqual([block!.tightest, cube!.tightest], [{ face: round!.face, min_radius_mm: 2 }, undefined]);
  assert.ok(run.notes.some((n) => /not a Class-A sign-off/.test(n)), run.notes.join("\n"));
  const v = validate("tool-inspect-output", { status: "ok", continuity: run, compute: { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" } });
  assert.ok(v.valid, JSON.stringify(v.errors));
  // defs narrows the run; limit caps the list but not the counts.
  assert.deepEqual(continuityRun(k, asm, { defs: ["cube"] }).parts.map((p) => p.def), ["cube"]);
  const capped = continuityRun(k, asm, { defs: ["cube"], limit: 5 }).parts[0]!;
  assert.equal(capped.edges.length, 5);
  assert.equal(capped.omitted, 7);
  assert.equal(capped.counts.G0, 12);
  const one = continuityRun(k, asm, { defs: ["block"], limit: 1 }).parts[0]!;
  assert.deepEqual([one.faces.length, one.faces_omitted, one.face_counts.convex], [1, undefined, 1]);
  // The cap shortens the list, never the tightest radius: here an S-panel's inflecting skins fill
  // the list first, and the 1 mm ball beside it is still the tightest bend.
  const panel = k.thicken(k.surfaceGrid([0, 50].map((y) => [0, 10, -10, 0].map((z, i): Vec3 => [(100 * i) / 3, y, z]))), 2);
  const pair = buildAssembly(k, { parts: [{ name: "pair", shape: k.fuse(panel, k.translate(k.sphere(1), [50, 25, 40])) }], mates: [], params: {}, warnings: [] });
  const short = continuityRun(k, pair, { limit: 1 }).parts[0]!;
  assert.deepEqual([short.faces.length, short.faces[0]!.inflection, short.faces_omitted, short.tightest?.min_radius_mm], [1, true, 2, 1]);
});
