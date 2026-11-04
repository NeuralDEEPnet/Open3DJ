// The seeded gate corpus by hand: runs every case in corpora/gates (or the ids given) and prints
// each gate's result against the expected one. Exits 1 on a false pass, a false failure, a value
// out of its range, a known miss that is now caught, or a run that fails where it should not.
//   node scripts/gate-corpus.ts                 every case on the compute pool
//   node scripts/gate-corpus.ts wall-tray-0.6   one case
//   node scripts/gate-corpus.ts --cli           through the real CLI, one fresh process per case
//   node scripts/gate-corpus.ts --json          the results as JSON
import { availableParallelism } from "node:os";
import { createPool } from "@open3dj/compute";
import { checkCorpus, countOf, judgeCase, loadCorpus, problemsOf, runOnCli, runOnPool, table } from "./gate-corpus-lib.ts";
import type { CaseResult } from "./gate-corpus-lib.ts";
import { ms } from "./lib.ts";

const args = process.argv.slice(2);
const cli = args.includes("--cli");
const json = args.includes("--json");
const ids = args.filter((a) => !a.startsWith("--"));

const corpus = loadCorpus();
const problems = checkCorpus(corpus);
if (problems.length > 0) {
  process.stderr.write(`corpora/gates/cases.json:\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
const unknown = ids.filter((id) => !corpus.cases.some((c) => c.id === id));
if (unknown.length > 0) {
  process.stderr.write(`no case ${unknown.join(", ")} in corpora/gates/cases.json\n`);
  process.exit(1);
}
const cases = ids.length > 0 ? corpus.cases.filter((c) => ids.includes(c.id)) : corpus.cases;

const start = process.hrtime.bigint();
let results: CaseResult[];
if (cli) {
  results = cases.map((c) => judgeCase(c, runOnCli(c)));
} else {
  // The job is inspect's gate job; the interactive lane lets every worker take cases (the batch
  // lane keeps one worker free for interactive jobs).
  const pool = createPool({ size: Math.max(2, Math.min(4, availableParallelism())), log: () => {} });
  try {
    results = await Promise.all(cases.map(async (c) => judgeCase(c, await runOnPool(pool, c, corpus.profile, { lane: "interactive" }))));
  } finally {
    await pool.close();
  }
}
const total = ms(start);
const bad = problemsOf(results);
const kinds = (k: string) => cases.filter((c) => c.kind === k).length;
const summary = {
  cases: cases.length, defects: kinds("defect"), controls: kinds("control"), known_miss_cases: kinds("known-miss"),
  false_passes: countOf(results, "false_pass"), false_failures: countOf(results, "false_fail"), known_misses: countOf(results, "known_miss"),
  other_problems: bad.length - countOf(results, "false_pass") - countOf(results, "false_fail"), ms: total, runner: cli ? "cli" : "pool",
};
if (json) process.stdout.write(JSON.stringify({ summary, results }, null, 2) + "\n");
else {
  process.stdout.write(table(results) + "\n\n");
  for (const p of bad) process.stdout.write(`${p.outcome.toUpperCase()} ${p.id} ${p.gate}: got ${p.got}; ${p.detail ?? ""}\n`);
  process.stdout.write(`${summary.cases} cases (${summary.defects} seeded defects, ${summary.controls} controls, ${summary.known_miss_cases} known miss): ${summary.false_passes} false passes, ${summary.false_failures} false failures, ${summary.known_misses} known misses, ${summary.other_problems} other problems, ${(total / 1000).toFixed(1)} s on the ${summary.runner}\n`);
}
process.exit(bad.length > 0 ? 1 : 0);
