// task-lint: checks every o3dj-bench task (or the ones whose id contains a filter).
//
//   node bench/lint.ts                  every task, on the real compute pool
//   node bench/lint.ts reg-flange       only tasks whose id contains "reg-flange"
//   node bench/lint.ts --cli            run each script through the real CLI in fresh processes
//   node bench/lint.ts --static         schema and layout checks only, no kernel
//   node bench/lint.ts --json           print the full results as JSON
//
// A task passes lint when task.json matches the C7 schema (bench-task.schema.json), its files
// are in place, the reference runs and passes every assertion, and the mutant runs and fails
// at least one assertion, including every id in mutant_fails. Exit 0 when every task passes.
import { availableParallelism } from "node:os";
import { createPool } from "@open3dj/compute";
import { cliRunner, lintTask, loadTasks, poolRunner } from "./lib.ts";
import type { LintResult } from "./lib.ts";

const args = process.argv.slice(2);
const useCli = args.includes("--cli");
const staticOnly = args.includes("--static");
const json = args.includes("--json");
const filters = args.filter((a) => !a.startsWith("--"));

const tasks = loadTasks().filter((t) => filters.length === 0 || filters.some((f) => t.task.id.includes(f)));
if (tasks.length === 0) {
  process.stderr.write(`no task matches ${filters.join(" ")}\n`);
  process.exit(1);
}

const results: LintResult[] = [];
if (staticOnly) {
  for (const t of tasks) results.push({ id: t.task.id, split: t.task.split, problems: t.problems });
} else {
  const size = Math.max(1, Math.min(4, availableParallelism() - 1));
  const pool = useCli ? undefined : createPool({ size, log: () => {} });
  const run = pool ? poolRunner(pool) : cliRunner;
  try {
    // Tasks run concurrently; the pool queues them across its workers. The CLI runner is
    // synchronous, so --cli runs one script at a time.
    results.push(...await Promise.all(tasks.map((t) => lintTask(t, run))));
  } finally {
    await pool?.close();
  }
}

if (json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
let bad = 0;
for (const r of results) {
  const ok = r.problems.length === 0;
  if (!ok) bad++;
  const timing = r.reference && r.mutant ? `  reference ${r.reference.ms} ms, mutant ${r.mutant.ms} ms` : "";
  const caught = r.mutant ? `  mutant fails ${r.mutant.results.filter((x) => !x.pass).map((x) => x.id).join(", ")}` : "";
  process.stderr.write(`${ok ? "PASS" : "FAIL"}  ${r.id}${timing}${caught}\n`);
  for (const p of r.problems) process.stderr.write(`      ${p}\n`);
}
process.stderr.write(`${bad === 0 ? "PASS" : "FAIL"} task-lint: ${results.length - bad} of ${results.length} tasks clean${staticOnly ? " (static checks only)" : ""}\n`);
process.exit(bad === 0 ? 0 : 1);
