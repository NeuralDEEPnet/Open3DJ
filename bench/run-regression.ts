// The o3dj-bench regression split: deterministic replays of every regression task's reference
// solution (it must pass every assertion) and seeded mutant (it must fail one), with no LLM in
// the loop. It must stay at 100% (PLAN.md section 4.3).
//
//   node bench/run-regression.ts               every regression task on the real compute pool
//   node bench/run-regression.ts --repeat 3    also replay each reference 3 times and require
//                                              identical measures every time
//   node bench/run-regression.ts --cli         fresh CLI processes instead of the pool
//   node bench/run-regression.ts --json        machine-readable results on stdout
//
// Tasks run in id order and the table lists them in id order, so two runs print the same
// table apart from the timings. Exit 0 when every task passes.
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { createPool } from "@open3dj/compute";
import { cliRunner, lintTask, loadTasks, poolRunner } from "./lib.ts";
import type { LintResult, Outcome, RunResult } from "./lib.ts";

const args = process.argv.slice(2);
const useCli = args.includes("--cli");
const json = args.includes("--json");
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt >= 0 ? Math.max(1, Number(args[repeatAt + 1]) || 1) : 1;

const tasks = loadTasks().filter((t) => t.task.split === "regression");
if (tasks.length === 0) {
  process.stderr.write("no regression tasks in bench/tasks\n");
  process.exit(1);
}

/** The measured facts that must not change between replays (timings excluded). */
function fingerprint(o: Outcome): string {
  const r = o.report;
  return JSON.stringify({
    status: r.status,
    assembly: r.assembly,
    parts: r.parts.map((p) => [p.def, p.occurrences, p.valid, p.volume_mm3, p.area_mm2, p.bbox, p.counts]),
    fits: r.fits.map((f) => [f.a, f.b, f.kind, f.volume_mm3, f.distance_mm]),
    occurrences: o.occurrences,
  });
}

const size = Math.max(1, Math.min(4, availableParallelism() - 1));
const pool = useCli ? undefined : createPool({ size, log: () => {} });
const run = pool ? poolRunner(pool) : cliRunner;
const start = performance.now();
let results: LintResult[];
const drift: string[] = [];
try {
  results = await Promise.all(tasks.map((t) => lintTask(t, run)));
  if (repeat > 1) {
    const replay = () => Promise.all(tasks.map((t) => run(join(t.dir, t.task.reference), t.task.params)));
    const print = (r: RunResult) => (r.ok ? fingerprint(r.outcome) : `error ${r.error.code}`);
    const first = (await replay()).map(print);
    for (let k = 2; k <= repeat; k++) {
      (await replay()).map(print).forEach((p, i) => {
        if (p !== first[i]) drift.push(`${tasks[i]!.task.id}: replay ${k} differs from replay 1`);
      });
    }
  }
} finally {
  await pool?.close();
}
const wall = Math.round(performance.now() - start);

const failed = results.filter((r) => r.problems.length > 0);
if (json) process.stdout.write(`${JSON.stringify({ tasks: results.length, failed: failed.map((r) => r.id), drift, wall_ms: wall, results }, null, 2)}\n`);
else {
  const rows = results.map((r) => {
    const passed = r.reference ? r.reference.results.filter((x) => x.pass).length : 0;
    const total = r.reference?.results.length ?? 0;
    const caught = r.mutant ? r.mutant.results.filter((x) => !x.pass).map((x) => x.id).join(", ") : "did not run";
    return `| ${r.id} | ${r.problems.length === 0 ? "pass" : "FAIL"} | ${passed}/${total} | ${caught} | ${r.reference?.ms ?? "-"} | ${r.mutant?.ms ?? "-"} |`;
  });
  process.stdout.write([
    "| Task | Result | Reference assertions | Mutant caught by | Reference (ms) | Mutant (ms) |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}
for (const r of failed) process.stderr.write(`FAIL ${r.id}\n  ${r.problems.join("\n  ")}\n`);
for (const d of drift) process.stderr.write(`DRIFT ${d}\n`);
const pct = Math.round(((results.length - failed.length) / results.length) * 1000) / 10;
process.stderr.write(`regression split: ${results.length - failed.length} of ${results.length} tasks pass (${pct}%)${repeat > 1 ? `, ${repeat} replays${drift.length ? `, ${drift.length} drifted` : ", identical"}` : ""}, ${(wall / 1000).toFixed(1)} s\n`);
process.exit(failed.length === 0 && drift.length === 0 ? 0 : 1);
