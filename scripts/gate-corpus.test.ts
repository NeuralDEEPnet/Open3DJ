// The seeded gate corpus in npm test (PLAN.md S3 exit: zero false passes on the seeded gate
// corpus). Every case in corpora/gates runs on the real compute pool through the gate job of
// inspect fields=[gates], and each gate must give its expected verdict: no seeded defect may
// pass, no control may fail, every value must sit in its range, and the known miss must still
// be the only one. Also unit tests for the manifest check and the judge.
// node scripts/gate-corpus.ts runs the same corpus by hand and prints the table.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createPool } from "@open3dj/compute";
import type { PartGateRun } from "@open3dj/schemas";
import { checkCorpus, countOf, judgeCase, loadCorpus, problemsOf, runOnPool, table } from "./gate-corpus-lib.ts";
import type { CaseRun, GateCase } from "./gate-corpus-lib.ts";

const corpus = loadCorpus();

test("corpora/gates/cases.json is well formed and covers every script", () => {
  assert.deepEqual(checkCorpus(corpus), []);
  const kinds = (k: string) => corpus.cases.filter((c) => c.kind === k).length;
  assert.ok(kinds("defect") >= 25 && kinds("control") >= 10, `${kinds("defect")} defects, ${kinds("control")} controls`);
  assert.equal(kinds("known-miss"), 1, "the documented leaning-tip miss, and nothing else");
});

test("the manifest check catches mistakes in a case", () => {
  const good = corpus.cases.find((c) => c.id === "wall-tray-0.6")!;
  const bad = (patch: (c: GateCase) => void) => {
    const c = structuredClone(good);
    patch(c);
    return checkCorpus({ profile: corpus.profile, cases: [...corpus.cases.filter((x) => x.id !== good.id), c] });
  };
  assert.ok(bad((c) => delete (c.expect as Record<string, unknown>).bed).some((p) => p.includes("exactly")), "a gate without a verdict");
  assert.ok(bad((c) => { c.kind = "control"; }).some((p) => p.includes("control must expect every gate to pass")), "a control that expects a fail");
  assert.ok(bad((c) => { (c.expect as Record<string, unknown>).min_wall = { verdict: "fail", value: [0.7, 0.5] }; }).some((p) => p.includes("min <= max")), "an empty range");
  assert.ok(bad((c) => { c.id = "no-such-case"; }).some((p) => p.includes("missing")), "a case without a script");
  assert.ok(bad((c) => { c.build = [0, 0, 0]; }).some((p) => p.includes("build")), "a zero build direction");
  assert.ok(bad((c) => { (c as unknown as Record<string, unknown>).bulid = [0, 0, 1]; }).some((p) => p.includes("unknown field bulid")), "a misspelt field");
  assert.ok(bad((c) => { (c.expect as Record<string, unknown>).min_wall = { verdict: "fail", marginl: true }; }).some((p) => p.includes("unknown field marginl")), "a misspelt flag");
});

// A part's gate result, as the gate job returns it: only the fields the judge reads.
const part = (pass: string[], fail: PartGateRun["fail"], min?: number): CaseRun => ({ ok: true, ms: 1, part: { def: "part", pass, fail, wall: { rays: 100, spacing_mm: 0.5, ...(min === undefined ? {} : { min_mm: min }) } } as PartGateRun });
const all = ["watertight", "min_wall", "overhang", "bed"];
const thinCase: GateCase = { id: "t", kind: "defect", seeds: "a thin test wall", expect: { watertight: "pass", min_wall: { verdict: "fail", value: [0.55, 0.65] }, overhang: "pass", bed: "pass" } };

test("judge: a seeded defect that passes is a false pass, a control that fails a false failure", () => {
  const passed = judgeCase(thinCase, part(all, [], 3));
  assert.deepEqual(problemsOf([passed]).map((p) => [p.gate, p.outcome]), [["min_wall", "false_pass"]]);
  const caught = judgeCase(thinCase, part(["watertight", "overhang", "bed"], [{ gate: "min_wall", value: 0.6 }], 0.6));
  assert.deepEqual(problemsOf([caught]), []);
  // The right verdict with the wrong number, or marginal where it must fail outright.
  const off = judgeCase(thinCase, part(["watertight", "overhang", "bed"], [{ gate: "min_wall", value: 0.3 }], 0.3));
  assert.deepEqual(problemsOf([off]).map((p) => p.outcome), ["value"]);
  const marginal = judgeCase(thinCase, part(["watertight", "overhang", "bed"], [{ gate: "min_wall", value: 0.6, marginal: true }], 0.6));
  assert.deepEqual(problemsOf([marginal]).map((p) => p.outcome), ["marginal"]);
  const control: GateCase = { ...thinCase, kind: "control", expect: { watertight: "pass", min_wall: "pass", overhang: "pass", bed: "pass" } };
  const failed = judgeCase(control, part(["watertight", "min_wall", "bed"], [{ gate: "overhang", value: 50, note: "50 degrees" }], 5));
  assert.deepEqual(problemsOf([failed]).map((p) => [p.gate, p.outcome]), [["overhang", "false_fail"]]);
  assert.equal(countOf([passed, failed], "false_pass"), 1);
  assert.match(table([passed, failed]), /pass 3 \[FALSE_PASS\]/);
});

test("judge: a known miss is reported, not failed, until the gate catches it", () => {
  const miss: GateCase = { ...thinCase, kind: "known-miss", expect: { ...thinCase.expect, min_wall: { verdict: "fail", known_miss: "a documented limit of the rays" } } as GateCase["expect"] };
  const still = judgeCase(miss, part(all, [], 1.2));
  assert.deepEqual(problemsOf([still]), []);
  assert.equal(countOf([still], "known_miss"), 1);
  const caught = judgeCase(miss, part(["watertight", "overhang", "bed"], [{ gate: "min_wall", value: 0.5 }], 0.5));
  assert.deepEqual(problemsOf([caught]).map((p) => p.outcome), ["miss_caught"]);
});

test("judge: a part the run must refuse fails the corpus when it runs", () => {
  const refuse: GateCase = { id: "t", kind: "defect", seeds: "an invalid test solid", expect: { error: "KERNEL_INVALID_RESULT" } };
  assert.deepEqual(problemsOf([judgeCase(refuse, { ok: false, ms: 1, error: { code: "KERNEL_INVALID_RESULT", message: "" } })]), []);
  assert.deepEqual(problemsOf([judgeCase(refuse, part(all, [], 1))]).map((p) => p.outcome), ["false_pass"]);
  assert.deepEqual(problemsOf([judgeCase(refuse, { ok: false, ms: 1, error: { code: "SCRIPT_RUNTIME", message: "typo" } })]).map((p) => p.outcome), ["error"]);
});

// The corpus on the real pool, every case at once.
const pool = createPool({ size: 2, log: () => {} });
after(() => pool.close());
const started = performance.now();
const results = Promise.all(corpus.cases.map(async (c) => judgeCase(c, await runOnPool(pool, c, corpus.profile, { lane: "interactive" }))));

test("the seeded gate corpus: zero false passes, zero false failures, every value in range", async (t) => {
  const r = await results;
  t.diagnostic(`${r.length} cases in ${((performance.now() - started) / 1000).toFixed(1)} s on a pool of 2`);
  const problems = problemsOf(r);
  assert.deepEqual(problems, [], `\n${table(r)}\n\n${problems.map((p) => `${p.outcome} ${p.id} ${p.gate}: got ${p.got}; ${p.detail ?? ""}`).join("\n")}`);
  assert.equal(countOf(r, "false_pass"), 0);
  assert.equal(countOf(r, "false_fail"), 0);
  assert.deepEqual(r.filter((x) => x.findings.some((f) => f.outcome === "known_miss")).map((x) => x.id), ["known-miss-leaning-pocket-tip-0.7"]);
});
