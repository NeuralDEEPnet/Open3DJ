// Grades solutions against o3dj-bench tasks. Used for capability runs (bench/run-capability.md)
// and to check any script against a task by hand.
//
//   node bench/grade.ts <task-id> <solution.o3j.js | project.o3j>   grade one solution
//   node bench/grade.ts --runs <folder>                             grade a capability run folder
//   add --cli to run through fresh CLI processes, --json for machine-readable output
//
// A run folder holds <task-id>/run-1, run-2 and run-3, each with the agent's project
// solution.o3j. A project is graded as the agent left it: main.o3j.js with the values saved
// in params.o3j.json (set_param, run params) over the task's params. The summary gives pass@1 per task (passing runs
// out of 3) and pass^3 (tasks whose 3 runs all pass). It writes <folder>/grades.json.
// Exit 0 when everything graded passes, 1 when anything fails, 3 on a usage error.
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPool } from "@open3dj/compute";
import { cliRunner, evaluateAll, loadTasks, poolRunner, solutionOf } from "./lib.ts";
import type { AssertionResult, LoadedTask, Runner } from "./lib.ts";

const args = process.argv.slice(2);
const useCli = args.includes("--cli");
const json = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("--"));
const runsAt = args.indexOf("--runs");

function usage(msg: string): never {
  process.stderr.write(`grade: ${msg}\nUsage: node bench/grade.ts <task-id> <solution.o3j.js|project.o3j> | --runs <folder> [--cli] [--json]\n`);
  process.exit(3);
}

interface Grade { task: string; run: string; pass: boolean; error?: string; results: AssertionResult[]; ms: number }

async function grade(t: LoadedTask, path: string, label: string, run: Runner): Promise<Grade> {
  let solution;
  try {
    solution = solutionOf(path, t.task.params);
  } catch (e) {
    return { task: t.task.id, run: label, pass: false, error: (e as Error).message, results: [], ms: 0 };
  }
  if (!solution) return { task: t.task.id, run: label, pass: false, error: "no solution script found", results: [], ms: 0 };
  const r = await run(solution.script, solution.params);
  if (!r.ok) return { task: t.task.id, run: label, pass: false, error: `${r.error.code}: ${r.error.message}`, results: [], ms: r.ms };
  const results = evaluateAll(t.task, r.outcome);
  return { task: t.task.id, run: label, pass: results.every((x) => x.pass), results, ms: r.ms };
}

const tasks = new Map(loadTasks().map((t) => [t.task.id, t]));
const pool = useCli ? undefined : createPool({ size: 2, log: () => {} });
const run = pool ? poolRunner(pool) : cliRunner;
let grades: Grade[] = [];
let folder: string | undefined;
try {
  if (runsAt >= 0) {
    folder = resolve(args[runsAt + 1] ?? usage("--runs needs a folder"));
    if (!existsSync(folder)) usage(`${folder} does not exist`);
    const jobs: Array<Promise<Grade>> = [];
    for (const id of readdirSync(folder).sort()) {
      const t = tasks.get(id);
      if (!t || !statSync(join(folder, id)).isDirectory()) continue;
      for (const k of [1, 2, 3]) jobs.push(grade(t, join(folder, id, `run-${k}`, "solution.o3j"), `run-${k}`, run));
    }
    if (jobs.length === 0) usage(`no task folders in ${folder}`);
    grades = await Promise.all(jobs);
  } else {
    const [id, solution] = positional;
    if (!id || !solution) usage("give a task id and a solution");
    const t = tasks.get(id) ?? usage(`unknown task ${id}`);
    if (t.problems.length > 0) usage(`task ${id} is malformed: ${t.problems.join("; ")}`);
    grades = [await grade(t, resolve(solution), solution, run)];
  }
} finally {
  await pool?.close();
}

const byTask = new Map<string, Grade[]>();
for (const g of grades) byTask.set(g.task, [...(byTask.get(g.task) ?? []), g]);
const summary = [...byTask].map(([task, gs]) => ({ task, passed: gs.filter((g) => g.pass).length, runs: gs.length, pass3: gs.length === 3 && gs.every((g) => g.pass) }));
const pass3 = summary.filter((s) => s.pass3).length;
const out = { graded_at: new Date().toISOString(), tasks: summary.length, pass3_tasks: pass3, pass3: summary.length ? Math.round((pass3 / summary.length) * 1000) / 10 : 0, summary, grades };
if (folder) writeFileSync(join(folder, "grades.json"), `${JSON.stringify(out, null, 2)}\n`);
if (json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
else {
  for (const g of grades) {
    process.stdout.write(`${g.pass ? "PASS" : "FAIL"}  ${g.task} ${g.run}${g.error ? `  ${g.error}` : ""}\n`);
    for (const r of g.results) if (!r.pass) process.stdout.write(`      ${r.id}: ${r.detail}\n`);
  }
  if (folder) {
    process.stdout.write("\n| Task | Runs passed | pass^3 |\n|---|---|---|\n");
    for (const s of summary) process.stdout.write(`| ${s.task} | ${s.passed}/${s.runs} | ${s.pass3 ? "yes" : "no"} |\n`);
    process.stdout.write(`\npass^3: ${pass3} of ${summary.length} tasks (${out.pass3}%). Wrote ${join(folder, "grades.json")}\n`);
  }
}
process.exit(grades.every((g) => g.pass) ? 0 : 1);
