// Regression (H-det, ops/build-log.md 2026-10-28): STEP bytes from a warm worker differed from
// export to export. The usage ids came from a counter that lives as long as the kernel, and in
// multi-colour assemblies run between other jobs the STYLED_ITEM and COLOUR_RGB entities came
// out in another order. The fix (ARCHITECTURE.md section 8): a STEP export runs on a fresh
// kernel instance, so a warm runner gives the same bytes as a fresh process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { initKernel } from "@open3dj/kernel";
import { createJobRunner, needsFreshKernel } from "./job.ts";
import { runJobInline } from "./index.ts";
import type { JobRequest, JobResult } from "./types.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const ENCLOSURE = read("examples/enclosure/enclosure.o3j.js");
const SHELL = read("corpora/hdet/shell.o3j.js");
const BRACKET = read("examples/bracket/bracket.o3j.js");

const exportStep: JobRequest = { kind: "export", script: ENCLOSURE, rev: "r_0001", export: { formats: ["step"], baseName: "enclosure" } };

/** The STEP text of a result with the FILE_NAME time stamp blanked. */
function stepOf(r: JobResult): string {
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  const step = r.artifacts?.find((a) => a.format === "step");
  assert.ok(step, "the job returned a STEP file");
  return Buffer.from(step.bytes).toString("latin1").replace(/(FILE_NAME\('(?:[^']|'')*',)'[^']*'/, "$1'TIMESTAMP'");
}

/** The first line where a and b differ, with its number, or undefined when they are equal. */
function firstDifference(a: string, b: string): string | undefined {
  if (a === b) return undefined;
  const x = a.split("\n");
  const y = b.split("\n");
  const i = x.findIndex((line, j) => line !== y[j]);
  const at = i < 0 ? x.length : i;
  return `line ${at + 1}: ${JSON.stringify(x[at] ?? "<end>")} instead of ${JSON.stringify(y[at] ?? "<end>")}`;
}

test("STEP of the enclosure is byte-identical across 5 exports on one warm runner, between other jobs", async () => {
  const kernel = await initKernel();
  const runner = createJobRunner(kernel);
  let jobs = 0;
  const run = async (job: JobRequest) => (await runner.run(job, { workerId: 1, jobs: ++jobs })).result;
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) {
    steps.push(stepOf(await run(exportStep)));
    // Other jobs on the same kernel between exports: a shell part, and an export of another
    // example without STEP (which stays on the warm kernel).
    assert.ok((await run({ kind: "run", script: SHELL, rev: "r_0001" })).ok);
    assert.ok((await run({ kind: "export", script: BRACKET, rev: "r_0001", export: { formats: ["stl"], baseName: "bracket" } })).ok);
  }
  for (let i = 1; i < steps.length; i++) assert.equal(firstDifference(steps[i]!, steps[0]!), undefined, `export ${i + 1} differs from export 1`);
  // A fresh kernel in this process (runJobInline loads its own) writes the same bytes. H-det
  // (scripts/hdet.ts) compares real fresh processes.
  assert.equal(firstDifference(stepOf(await runJobInline(exportStep)), steps[0]!), undefined, "a fresh kernel differs from the warm runner");
  assert.equal(kernel.stats().liveShapes, 0, "the warm kernel holds no handles after the jobs");
});

test("needsFreshKernel: exports with STEP, and jobs that ask; the flag wins", () => {
  const base = { script: "", rev: "r_0001" } as const;
  assert.equal(needsFreshKernel({ ...base, kind: "export", export: { formats: ["stl", "step"] } }), true);
  assert.equal(needsFreshKernel({ ...base, kind: "export", export: { formats: ["stl", "3mf"] } }), false);
  assert.equal(needsFreshKernel({ ...base, kind: "run" }), false);
  assert.equal(needsFreshKernel({ ...base, kind: "run", freshKernel: true }), true);
  assert.equal(needsFreshKernel({ ...base, kind: "export", export: { formats: ["step"] }, freshKernel: false }), false);
});

test("a job on a fresh kernel reports the worker's own kernel and leaves it registered for the next job", async () => {
  const kernel = await initKernel();
  const runner = createJobRunner(kernel);
  const step = await runner.run({ kind: "export", script: "return box(10, 10, 10);", rev: "r_0001", export: { formats: ["step"] } }, { workerId: 3, jobs: 1 });
  assert.ok(step.result.ok, step.result.ok ? "" : JSON.stringify(step.result.error));
  assert.equal(step.recycle, undefined);
  assert.equal(step.result.stats.workerId, 3);
  assert.equal(step.result.stats.liveShapes, kernel.stats().liveShapes);
  // A failing script on the fresh kernel is a result, and the warm kernel still runs the next job.
  const bad = await runner.run({ kind: "export", script: "return box(10, 10, 10).fillet(99);", rev: "r_0001", export: { formats: ["step"] } }, { workerId: 3, jobs: 2 });
  assert.equal(bad.result.ok, false);
  const next = await runner.run({ kind: "run", script: "return box(10, 10, 10);", rev: "r_0001" }, { workerId: 3, jobs: 3 });
  assert.ok(next.result.ok, next.result.ok ? "" : JSON.stringify(next.result.error));
  assert.equal(next.result.report.parts[0]!.volume_mm3, 1000);
  assert.equal(kernel.stats().liveShapes, 0);
});

test("with the revision time as time stamp, two exports of one revision are the same file, byte for byte", async () => {
  const kernel = await initKernel();
  const runner = createJobRunner(kernel);
  const job: JobRequest = { kind: "export", script: SHELL, rev: "r_0001", export: { formats: ["step"], baseName: "tray", timestamp: "2026-10-28T09:15:30.123Z" } };
  const a = (await runner.run(job, { workerId: 1, jobs: 1 })).result;
  assert.ok((await runner.run({ kind: "run", script: BRACKET, rev: "r_0002" }, { workerId: 1, jobs: 2 })).result.ok);
  const b = (await runner.run(job, { workerId: 1, jobs: 3 })).result;
  const bytes = (r: JobResult) => (r.ok ? Buffer.from(r.artifacts!.find((x) => x.format === "step")!.bytes) : Buffer.alloc(0));
  assert.match(bytes(a).toString("latin1"), /FILE_NAME\('tray\.step','2026-10-28T09:15:30',/);
  assert.ok(bytes(a).length > 0 && bytes(a).equals(bytes(b)), "the second export differs from the first");
});

// Regression (verifier soak, 2026-10-28): fresh kernels leaked on a long-lived worker, about
// 7.7 MB per enclosure STEP export. brepjs 20.11.1 never frees a shape handle (its
// FinalizationRegistry entry closes over the handle) and each handle keeps the adapter that
// made it, so every fresh kernel a 2D sketch touched stayed alive with its WebAssembly memory.
test("fresh kernels are freed after STEP exports that draw 2D sketches", async () => {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  const kernel = await initKernel();
  const freed: WeakRef<object>[] = [];
  const fresh = kernel.fresh.bind(kernel);
  kernel.fresh = async () => {
    const k = await fresh();
    freed.push(new WeakRef(k.raw));
    return k;
  };
  const runner = createJobRunner(kernel);
  // The bracket draws its profile with polygon(), which goes through brepjs.
  const job: JobRequest = { kind: "export", script: BRACKET, rev: "r_0001", export: { formats: ["step"], baseName: "bracket" } };
  for (let i = 1; i <= 4; i++) {
    const { result } = await runner.run(job, { workerId: 1, jobs: i });
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.error));
  }
  assert.equal(freed.length, 4, "each STEP export ran on its own fresh kernel");
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
  assert.equal(freed.filter((r) => r.deref() !== undefined).length, 0, "fresh kernels still reachable after their jobs");
  // The warm kernel still runs sketches after the fresh ones are gone.
  const { result } = await runner.run({ kind: "run", script: BRACKET, rev: "r_0001" }, { workerId: 1, jobs: 5 });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.error));
});
