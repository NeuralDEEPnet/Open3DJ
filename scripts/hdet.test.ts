// Tests for scripts/hdet.ts and hdet-lib.ts: the instrumented script logs exact measure bits
// without changing the geometry, STEP normalisation strips only what varies, samples compare
// field by field, and a 2-run H-det on the bracket finds its measures bit-identical.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "@open3dj/compute";
import { CASES, compareSamples, instrument, normaliseStep, normaliseStepIds, sampleOf } from "./hdet-lib.ts";
import type { Sample } from "./hdet-lib.ts";
import { ROOT } from "./lib.ts";

const pool = createPool({ size: 1, log: () => {} });
after(() => pool.close());

test("every corpus case exists", () => {
  for (const [name, path] of Object.entries(CASES)) assert.ok(readFileSync(join(ROOT, path), "utf8").includes("return"), name);
});

test("instrument logs the exact volume and area bits and leaves the geometry alone", async () => {
  const source = "return [{ name: \"A\", shape: box(10, 20, 30) }, { name: \"B\", shape: cylinder(10, 5).translateX(20) }];";
  const job = { kind: "export" as const, rev: "r_0001", detail: "detailed" as const, export: { formats: ["step" as const], baseName: "t" } };
  const plain = await pool.run({ ...job, script: source });
  const r = await pool.run({ ...job, script: instrument(source) });
  assert.ok(plain.ok && r.ok);
  if (!plain.ok || !r.ok) return;
  assert.deepEqual(r.report.parts, plain.report.parts);
  const s = sampleOf(r);
  const bits = JSON.parse(s.bits) as Array<[string, string, string]>;
  assert.deepEqual(bits.map((b) => b[0]), ["A", "B"]);
  const f64 = (hex: string) => Buffer.from(hex, "hex").readDoubleBE(0);
  assert.equal(f64(bits[0]![1]), 6000);
  assert.equal(f64(bits[0]![2]), 2 * (200 + 600 + 300));
  assert.ok(Math.abs(f64(bits[1]![1]) - Math.PI * 250) < 1e-9);
  assert.match(s.step, /^[0-9a-f]{64}$/);
});

test("STEP normalisation strips the timestamp, and the usage ids only in normaliseStepIds", () => {
  const text = "FILE_NAME('Open CASCADE Shape Model','2026-10-28T18:40:13',('Author'),(\r\n#9 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('3','bracket','',#5,#27,$);\r\n";
  const n = normaliseStep(text);
  assert.ok(n.includes("'TIMESTAMP'") && !n.includes("2026-10-28") && !n.includes("\r"));
  assert.ok(n.includes("NEXT_ASSEMBLY_USAGE_OCCURRENCE('3'"));
  assert.ok(normaliseStepIds(text).includes("NEXT_ASSEMBLY_USAGE_OCCURRENCE('ID','bracket'"));
});

// Regression (review round 2 of increment 2): a blanked usage id going from '9' to '10' moved
// where OCCT wraps the line, so the offset case showed 2 warm STEP variants that differ only in
// line breaks, and the build log blamed the STYLED_ITEM order.
test("normaliseStepIds ignores where OCCT wraps an entity line, but not what is inside strings", () => {
  const a = "#5451 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('9','octagon_cup','',#5,#3440,$);\n#2 = PRODUCT('a b','',$);\n";
  const b = "#5451 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('10','octagon_cup','',#5,#3440,$\n  );\n#2 = PRODUCT('a b','',$);\n";
  assert.equal(normaliseStepIds(a), normaliseStepIds(b));
  assert.notEqual(normaliseStepIds(a), normaliseStepIds(a.replace("'a b'", "'ab'")), "spaces inside a string still count");
  assert.notEqual(normaliseStepIds(a), normaliseStepIds(a.replace("#3440", "#3441")));
});

test("compareSamples counts distinct values per field", () => {
  const s = (step: string, bits = "b"): Sample => ({ bits, bbox: "x", counts: "c", step, step_ids: "i", worker: 1 });
  const same = compareSamples("a", [s("1"), s("1")], [s("1"), s("1")]);
  assert.ok(same.identical && same.geometry_identical);
  const warmStep = compareSamples("a", [s("1"), s("1")], [s("1"), s("2")]);
  assert.deepEqual(warmStep.fields.step, { fresh: 1, warm: 2, identical: false });
  assert.ok(warmStep.geometry_identical && !warmStep.identical);
  const freshVsWarm = compareSamples("a", [s("1", "x")], [s("1", "y")]);
  assert.deepEqual(freshVsWarm.fields.bits, { fresh: 1, warm: 1, identical: false });
  assert.ok(!freshVsWarm.geometry_identical);
});

test("hdet.ts end to end: two fresh processes and two warm reuses of the bracket agree on every measure bit", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "hdet.ts"), "--runs", "2", "--cases", "bracket", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  assert.ok(r.status === 0 || r.status === 1, `exit ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout) as { warm_worker_recycled: boolean; results: Array<{ geometry_identical: boolean; fields: Record<string, { fresh: number }> }> };
  assert.equal(out.warm_worker_recycled, false);
  assert.equal(out.results[0]!.geometry_identical, true);
  assert.equal(out.results[0]!.fields.step!.fresh, 1, "STEP is byte-identical across fresh processes");
});
