// The job composition (sandbox + dsl + assembly + render), run inline on a fresh kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@open3dj/schemas";
import { INLINE_COMPUTE, redactPaths, toScriptError } from "./job.ts";
import { runJobInline } from "./index.ts";
import type { JobRequest } from "./types.ts";

const PLATE = `const t = Param.number("Thickness", 4, { min: 2, max: 10 });
return box(40, 20, t);`;

const TWO_PARTS = `const base = box(30, 30, 5);
const pin = cylinder(20, 3).translate(0, 0, 5);
return [{ name: "Base", shape: base }, { name: "Pin", shape: pin }];`;

const job = (over: Partial<JobRequest>): JobRequest => ({ kind: "run", script: PLATE, rev: "r_test", ...over });

test("run: script and params give a schema-valid report and assembly", async () => {
  const r = await runJobInline(job({ params: { Thickness: 5 } }));
  assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.error));
  if (!r.ok) return;
  assert.ok(validate("geometry-report", r.report).valid, JSON.stringify(validate("geometry-report", r.report).errors));
  assert.ok(validate("assembly", r.assembly).valid);
  assert.equal(r.report.status, "ok");
  assert.equal(r.report.rev, "r_test");
  assert.deepEqual(r.report.compute, INLINE_COMPUTE);
  assert.deepEqual(r.compute, INLINE_COMPUTE);
  assert.ok(Math.abs(r.report.parts[0]!.volume_mm3 - 40 * 20 * 5) < 1e-6);
  assert.deepEqual(r.params, { Thickness: 5 });
  assert.equal(r.stats.liveShapes, 0, "every handle of the job is released");
  assert.ok(r.stats.memoryBytes > 0);
});

test("run: a two-part script becomes a two-occurrence assembly with fits", async () => {
  const r = await runJobInline(job({ script: TWO_PARTS }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.report.assembly.occurrences, 2);
  assert.deepEqual(r.report.fits.map((f) => [f.a, f.b, f.kind]), [["base", "pin", "contact"]]);
});

test("render: multiview PNG and SVG come back as bytes", async () => {
  const r = await runJobInline(job({ kind: "render", render: { view: "multiview", width: 400, height: 300 } }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.images!.map((i) => [i.format, i.width, i.height]), [["png", 400, 300], ["svg", 400, 300]]);
  assert.deepEqual([...r.images![0]!.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.match(new TextDecoder().decode(r.images![1]!.bytes), /<svg/);
});

test("export: artifacts and evidence, and files written under the project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "o3j-compute-"));
  try {
    const r = await runJobInline(job({ kind: "export", export: { formats: ["step", "stl"], baseName: "plate", dir: "out/r_test", root } }));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    if (!r.ok) return;
    assert.deepEqual(r.artifacts!.map((a) => a.name).sort(), ["plate.evidence.json", "plate.step", "plate.stl"]);
    assert.deepEqual(r.files!.map((f) => f.path).sort(), ["out/r_test/plate.evidence.json", "out/r_test/plate.step", "out/r_test/plate.stl"]);
    const step = await readFile(join(root, "out/r_test/plate.step"), "utf8");
    assert.match(step, /^ISO-10303-21;/);
    const evidence = JSON.parse(await readFile(join(root, "out/r_test/plate.evidence.json"), "utf8")) as { rev?: string };
    assert.equal(evidence.rev, "r_test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export: a dir outside the project is refused by the path policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "o3j-compute-"));
  try {
    const r = await runJobInline(job({ kind: "export", export: { formats: ["step"], dir: "../escape", root } }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.code, "PATH_REFUSED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failures are ScriptErrors with the user's line, and handles are released", async () => {
  const syntax = await runJobInline(job({ script: "const a = ;\nreturn box(1,1,1);" }));
  assert.equal(syntax.ok, false);
  if (!syntax.ok) assert.equal(syntax.error.code, "SCRIPT_SYNTAX");

  const fillet = await runJobInline(job({ script: "const b = box(10, 10, 10);\nreturn fillet(b, 8);" }));
  assert.equal(fillet.ok, false);
  if (!fillet.ok) {
    assert.equal(fillet.error.code, "KERNEL_FILLET_FAILED");
    assert.equal(fillet.error.line, 2);
    assert.ok(fillet.error.hint);
    assert.equal(fillet.stats.liveShapes, 0);
  }

  const badReturn = await runJobInline(job({ script: "return 42;" }));
  assert.equal(badReturn.ok, false);
  if (!badReturn.ok) assert.match(badReturn.error.code, /^DSL_/);

  const noFormats = await runJobInline(job({ kind: "export" }));
  assert.equal(noFormats.ok, false);
  if (!noFormats.ok) assert.equal(noFormats.error.code, "BAD_JOB");

  const target = await runJobInline(job({ kind: "render", render: { view: "multiview", targets: ["nope"] } }));
  assert.equal(target.ok, false);
  if (!target.ok) {
    assert.equal(target.error.code, "UNKNOWN_TARGET");
    assert.ok(target.error.hint);
  }
});

test("unexpected errors become INTERNAL_ERROR without file paths and retire the kernel", () => {
  const { error, fault } = toScriptError(new Error("ENOENT: no such file, open '/home/someone/secret/project/x.step'"));
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(error.message, /someone/);
  assert.ok(fault);
  assert.equal(redactPaths("at file:///a/b/c.ts:1:2"), "at <path>:1:2");
});

// Regression (review round 1): a cut that removes the whole part came back as BAD_PART with
// kernel wording, no line and no hint.
test("run: a part with nothing left is DSL_EMPTY_RESULT with the line and a hint", async () => {
  for (const script of [
    "const a = cylinder(10, 5);\nreturn a.subtract(cylinder(12, 5).translate(0, 0, -1));",
    "const plate = box(60, 40, 6);\nconst cut = box(100, 100, 100);\nreturn plate.subtract(cut);",
  ]) {
    const r = await runJobInline(job({ script }));
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.equal(r.error.code, "DSL_EMPTY_RESULT", JSON.stringify(r.error));
    assert.equal(r.error.line, script.split("\n").length, JSON.stringify(r.error));
    assert.match(r.error.hint ?? "", /cutter size and position/);
    assert.doesNotMatch(r.error.message, /getBoundingBox/);
  }
});

// Regression (review round 1): exports tessellated at an absolute 0.1 mm, so a 200 km sphere
// (inside the DSL's size limit) made meshes that never finished. The deflection now grows
// with the part, and the evidence sidecar records the value used.
test("export: mesh deflection scales with part size, so very large parts still export", async () => {
  const t = performance.now();
  const r = await runJobInline(job({ kind: "export", script: "return sphere(1e5);", export: { formats: ["stl", "gltf"] } }));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  if (!r.ok) return;
  assert.ok(performance.now() - t < 15_000, `export took ${Math.round(performance.now() - t)} ms`);
  const evidence = JSON.parse(new TextDecoder().decode(r.artifacts!.find((a) => a.format === "evidence")!.bytes)) as { tessellation: { linear_deflection_mm: number } };
  assert.ok(evidence.tessellation.linear_deflection_mm > 1, JSON.stringify(evidence.tessellation));
  // Small parts keep the 0.1 mm default.
  const small = await runJobInline(job({ kind: "export", export: { formats: ["stl"] } }));
  assert.ok(small.ok);
  if (!small.ok) return;
  const ev = JSON.parse(new TextDecoder().decode(small.artifacts!.find((a) => a.format === "evidence")!.bytes)) as { tessellation: { linear_deflection_mm: number } };
  assert.equal(ev.tessellation.linear_deflection_mm, 0.1);
});

// Regression (review round 1): SCRIPT_RUNTIME errors had no hint, and QuickJS's TypeError
// does not name the missing method, so a guessed CadQuery or OpenSCAD name gave nothing to act on.
test("run: a wrong method or function name gets a hint with the nearest DSL entry", async () => {
  const cases: Array<[string, RegExp]> = [
    ["const a = box(10, 10, 10);\nreturn a.union(box(5, 5, 20));", /"\.union\(\)".*\badd\b/],
    ["return cube(10);", /"cube".*\bbox\b/],
    ["return box(10, 10, 10).filet(1);", /"\.filet\(\)".*\bfillet\b/],
  ];
  for (const [script, hint] of cases) {
    const r = await runJobInline(job({ script }));
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.equal(r.error.code, "SCRIPT_RUNTIME", JSON.stringify(r.error));
    assert.match(r.error.hint ?? "", hint, JSON.stringify(r.error));
    assert.match(r.error.hint ?? "", /docs/);
  }
});

// Regression (review round 1): a chamfer failure came back with elements: [].
test("run: a failed chamfer names the edges it tried", async () => {
  const r = await runJobInline(job({ script: "return chamfer(box(10, 10, 10), 6);" }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error.code, /^KERNEL_(CHAMFER_FAILED|INVALID_RESULT)$/);
  assert.ok((r.error.elements ?? []).length > 0, JSON.stringify(r.error));
  assert.match(r.error.elements![0]!, /^edge:\d+$/);
});
