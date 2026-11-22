// The seeded continuity corpus (corpora/continuity/cases.json, #78): every case runs through the
// real job runner with inspect continuity's job options, and its class counts must match the
// answers taken from the geometry. An edge in a higher class than expected is a false pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJobRunner } from "@open3dj/compute/job";
import { initKernel } from "@open3dj/kernel";

interface Case {
  id: string;
  script: string;
  expect: { G2: number; G1: number; G0: number; gap: number };
  min_angle_deg?: number;
  why: string;
}

const corpus = JSON.parse(readFileSync(new URL("../corpora/continuity/cases.json", import.meta.url), "utf8")) as { cases: Case[] };
const ORDER = ["gap", "G0", "G1", "G2"] as const;

test("the seeded continuity corpus reads exactly its geometric answers, with no false pass", async () => {
  const kernel = await initKernel({ sink: () => {} });
  const runner = createJobRunner(kernel);
  const problems: string[] = [];
  let n = 0;
  for (const c of corpus.cases) {
    const { result } = await runner.run({ kind: "run", script: c.script, rev: `r_${++n}`, continuity: {}, fits: false }, { workerId: 0, jobs: n });
    if (!result.ok) {
      problems.push(`${c.id}: ${result.error.code} ${result.error.message}`);
      continue;
    }
    const part = result.continuity?.parts[0];
    if (!part) {
      problems.push(`${c.id}: no continuity table`);
      continue;
    }
    // More edges in a higher class than the answer allows is a false pass, worse than a miss.
    let above = 0;
    let expectedAbove = 0;
    for (let i = ORDER.length - 1; i > 0; i--) {
      above += part.counts[ORDER[i]!];
      expectedAbove += c.expect[ORDER[i]!];
      if (above > expectedAbove) problems.push(`${c.id}: FALSE PASS, ${above} edges at ${ORDER[i]} or better, the geometry allows ${expectedAbove}`);
    }
    if (JSON.stringify(part.counts) !== JSON.stringify(c.expect)) problems.push(`${c.id}: counts ${JSON.stringify(part.counts)}, expected ${JSON.stringify(c.expect)} (${c.why})`);
    if (c.min_angle_deg !== undefined) {
      const least = Math.min(...part.edges.map((e) => e.angle_deg));
      if (Math.abs(least - c.min_angle_deg) > 1e-6) problems.push(`${c.id}: the shallowest crease is ${least} degrees, expected ${c.min_angle_deg}`);
    }
  }
  assert.deepEqual(problems, []);
});
