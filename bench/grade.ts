// Grades solutions against o3dj-bench tasks. Used for capability runs (bench/run-capability.md)
// and to check any script against a task by hand.
//
//   node bench/grade.ts <task-id> <solution.o3j.js | project.o3j>   grade one solution
//   node bench/grade.ts --runs <folder>                             grade a capability run folder
//   add --cli to run through fresh CLI processes, --json for machine-readable output
//
// A run folder holds <task-id>/run-1, run-2 and run-3, each with the agent's project
// solution.o3j and the session's saved transcript (a file named transcript*). A project is
// graded as the agent left it: main.o3j.js with the values saved in params.o3j.json
// (set_param, run params) over the task's params. A run whose transcript mentions bench/tasks,
// a reference or mutant script or the canary, or whose solution holds the canary, is suspect:
// it never counts as a pass until a person has read its transcript. A run without a transcript
// is unchecked and never counts as a pass either. The summary gives the passing runs per task
// (out of 3) and pass^3 (tasks whose 3 runs all pass, none suspect or unchecked). It writes
// <folder>/grades.json. A folder that holds a symbolic link or other special file anywhere is
// refused (exit 3) before anything is read, because run folders can come from anyone.
// Exit 0 when everything graded passes cleanly, 1 when anything fails, is suspect or is
// unchecked, 3 on a usage error.
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPool } from "@open3dj/compute";
import { checkRun, cliRunner, evaluateAll, loadTasks, poolRunner, solutionOf, specialEntries, summarizeRuns } from "./lib.ts";
import type { LoadedTask, RunGrade, Runner } from "./lib.ts";

const args = process.argv.slice(2);
const useCli = args.includes("--cli");
const json = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("--"));
const runsAt = args.indexOf("--runs");

function usage(msg: string): never {
  process.stderr.write(`grade: ${msg}\nUsage: node bench/grade.ts <task-id> <solution.o3j.js|project.o3j> | --runs <folder> [--cli] [--json]\n`);
  process.exit(3);
}

async function grade(t: LoadedTask, path: string, label: string, run: Runner): Promise<RunGrade> {
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

/** One run of a run folder: the project graded, then its transcripts and solution checked. */
async function gradeRun(t: LoadedTask, runDir: string, label: string, run: Runner): Promise<RunGrade> {
  const project = join(runDir, "solution.o3j");
  const g = await grade(t, project, label, run);
  const check = checkRun(runDir, join(project, "main.o3j.js"));
  return { ...g, transcripts: check.transcripts.length, ...(check.suspect ? { suspect: check.suspect } : {}) };
}

const tasks = new Map(loadTasks().map((t) => [t.task.id, t]));
const pool = useCli ? undefined : createPool({ size: 2, log: () => {} });
const run = pool ? poolRunner(pool) : cliRunner;
let grades: RunGrade[] = [];
let folder: string | undefined;
try {
  if (runsAt >= 0) {
    folder = resolve(args[runsAt + 1] ?? usage("--runs needs a folder"));
    if (!existsSync(folder)) usage(`${folder} does not exist`);
    // Run folders can come from anyone (LEADERBOARD.md). Refuse links before reading or writing.
    const special = specialEntries(folder);
    if (special.length > 0) {
      const shown = special.slice(0, 5).join(", ") + (special.length > 5 ? ", ..." : "");
      usage(`${folder} holds ${special.length} symbolic link${special.length === 1 ? "" : "s"} or special file${special.length === 1 ? "" : "s"} (${shown}). A run folder must hold only plain files and folders`);
    }
    const jobs: Array<Promise<RunGrade>> = [];
    for (const id of readdirSync(folder).sort()) {
      const t = tasks.get(id);
      if (!t || !statSync(join(folder, id)).isDirectory()) continue;
      for (const k of [1, 2, 3]) jobs.push(gradeRun(t, join(folder, id, `run-${k}`), `run-${k}`, run));
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

const sum = summarizeRuns(grades);
const out = { graded_at: new Date().toISOString(), ...sum, grades };
if (folder) writeFileSync(join(folder, "grades.json"), `${JSON.stringify(out, null, 2)}\n`);
if (json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
else {
  for (const g of grades) {
    const unchecked = g.transcripts === 0 ? "  UNCHECKED: no transcript" : "";
    process.stdout.write(`${g.pass ? "PASS" : "FAIL"}  ${g.task} ${g.run}${g.error ? `  ${g.error}` : ""}${g.suspect ? `  SUSPECT: ${g.suspect}` : ""}${unchecked}\n`);
    for (const r of g.results) if (!r.pass) process.stdout.write(`      ${r.id}: ${r.detail}\n`);
  }
  if (folder) {
    process.stdout.write("\n| Task | Runs passed | Suspect runs | Runs without transcript | pass^3 |\n|---|---|---|---|---|\n");
    for (const s of sum.summary) {
      const pass3 = s.suspect > 0 ? "suspect" : s.without_transcript > 0 ? "unchecked" : s.pass3 ? "yes" : "no";
      process.stdout.write(`| ${s.task} | ${s.passed}/${s.runs} | ${s.suspect} | ${s.without_transcript} | ${pass3} |\n`);
    }
    const suspect = sum.suspect_tasks.length > 0 ? ` Suspect, not counted until a person reads the transcripts: ${sum.suspect_tasks.join(", ")}.` : "";
    const unchecked = sum.unchecked_tasks.length > 0 ? ` Unchecked, not counted because a run has no transcript: ${sum.unchecked_tasks.join(", ")}.` : "";
    process.stdout.write(`\npass^3: ${sum.pass3_tasks} of ${sum.tasks} tasks (${sum.pass3}%).${suspect}${unchecked} Wrote ${join(folder, "grades.json")}\n`);
  }
}
process.exit(grades.every((g) => g.pass && !g.suspect && g.transcripts !== 0) ? 0 : 1);
