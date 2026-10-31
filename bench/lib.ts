// o3dj-bench library: load tasks (C7, packages/schemas/json/bench-task.schema.json), run a
// solution script through the real compute pool or the real CLI, and evaluate the task's
// executable assertions on the detailed GeometryReport and the occurrence tree.
// Used by bench/lint.ts (task-lint), bench/run-regression.ts, bench/grade.ts and
// scripts/bench.test.ts. No LLM and no network anywhere in here.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SchemaRegistry } from "@open3dj/schemas";
import type { AssemblyFile, FitReport, GeometryReport, ParamValue, RunOutput, SchemaObject, ScriptError } from "@open3dj/schemas";
import type { Pool } from "@open3dj/compute";
import taskSchema from "../packages/schemas/json/bench-task.schema.json" with { type: "json" };

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TASKS_DIR = join(ROOT, "bench", "tasks");
export const CLI = join(ROOT, "packages", "open3dj", "src", "cli.ts");
export const TASK_SCHEMA_ID = "urn:open3dj:v0:bench-task";

// ---- Task types (mirror bench-task.schema.json) -----------------------------------------

export type Split = "regression" | "capability";
export interface Tol { abs?: number; rel?: number }
export interface Expect { eq?: number; min?: number; max?: number; tol?: Tol }
export type Quantity = "volume_mm3" | "area_mm2" | "mass_g" | "size_x" | "size_y" | "size_z" | "size_max" | "size_mid" | "size_min" | "min_x" | "min_y" | "min_z" | "max_x" | "max_y" | "max_z";
export type CountQuantity = "occurrences" | "definitions" | "solids" | "faces" | "edges";

interface Base { id: string; note?: string }
export type Assertion =
  | (Base & { kind: "status"; in: Array<GeometryReport["status"]> })
  | (Base & { kind: "valid"; target?: string })
  | (Base & { kind: "measure"; quantity: Quantity; target: string; expect: Expect })
  | (Base & { kind: "count"; quantity: CountQuantity; target?: string; expect: Expect })
  | (Base & { kind: "fits"; fit: "clash" | "contact" | "clearance" | "any"; a?: string; b?: string; expect: Expect; distance?: Expect; gap?: Expect })
  | (Base & { kind: "occurrences"; name: string; def?: string; expect: Expect })
  | (Base & { kind: "same_definition"; name: string });

export interface BenchTask {
  id: string;
  version: number;
  split: Split;
  title: string;
  brief: string;
  params: Record<string, ParamValue>;
  assertions: Assertion[];
  reference: string;
  mutant: string;
  mutant_defect: string;
  mutant_fails: string[];
  /** Further seeded mutants, each checked like mutant. */
  more_mutants?: Array<{ file: string; defect: string; fails: string[] }>;
  tags: string[];
  source: string;
  licence: "MIT";
  authors: string[];
}

export interface LoadedTask {
  task: BenchTask;
  dir: string;
  file: string;
  /** Schema and layout problems found without running anything. Empty when the task is well formed. */
  problems: string[];
}

// ---- Loading and static checks ----------------------------------------------------------

const registry = (() => {
  const r = new SchemaRegistry();
  r.add(taskSchema as SchemaObject);
  r.checkRefs();
  return r;
})();

/** Validate a parsed task.json against the C7 schema. */
export function validateTask(value: unknown): string[] {
  const r = registry.validate(TASK_SCHEMA_ID, value);
  return r.errors.map((e) => `${e.path || "/"} ${e.message}`);
}

/** Every task folder under bench/tasks (or dir), sorted by id, with its static problems. */
export function loadTasks(dir = TASKS_DIR): LoadedTask[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadTask(join(dir, e.name), e.name))
    .sort((a, b) => a.task.id.localeCompare(b.task.id));
}

export function loadTask(dir: string, folder: string): LoadedTask {
  const file = join(dir, "task.json");
  const problems: string[] = [];
  let task: BenchTask;
  try {
    task = JSON.parse(readFileSync(file, "utf8")) as BenchTask;
  } catch (e) {
    return { task: { id: folder } as BenchTask, dir, file, problems: [`task.json: ${(e as Error).message}`] };
  }
  problems.push(...validateTask(task).map((p) => `task.json ${p}`));
  if (problems.length > 0) return { task, dir, file, problems };
  problems.push(...staticProblems(task, dir, folder));
  return { task, dir, file, problems };
}

function staticProblems(task: BenchTask, dir: string, folder: string): string[] {
  const out: string[] = [];
  if (task.id !== folder) out.push(`id "${task.id}" must equal the folder name "${folder}"`);
  if (!task.id.startsWith(task.split === "regression" ? "reg-" : "cap-")) out.push(`a ${task.split} task id starts with ${task.split === "regression" ? "reg-" : "cap-"}`);
  for (const f of [task.reference, task.mutant]) if (!existsSync(join(dir, f))) out.push(`${f} is missing`);
  if (task.reference === task.mutant) out.push("reference and mutant must be different files");
  else if (existsSync(join(dir, task.reference)) && existsSync(join(dir, task.mutant))
    && readFileSync(join(dir, task.reference), "utf8") === readFileSync(join(dir, task.mutant), "utf8")) out.push("the mutant is identical to the reference");
  const ids = task.assertions.map((a) => a.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length > 0) out.push(`duplicate assertion ids: ${[...new Set(dup)].join(", ")}`);
  for (const id of task.mutant_fails) if (!ids.includes(id)) out.push(`mutant_fails names "${id}", which is not an assertion id`);
  for (const m of task.more_mutants ?? []) {
    if (!existsSync(join(dir, m.file))) out.push(`${m.file} is missing`);
    if (m.file === task.reference || m.file === task.mutant) out.push(`more_mutants: ${m.file} must differ from the reference and the mutant`);
    for (const id of m.fails) if (!ids.includes(id)) out.push(`more_mutants ${m.file} names "${id}", which is not an assertion id`);
  }
  for (const a of task.assertions) {
    if (a.kind === "fits" && a.gap && (a.fit !== "clearance" || a.distance)) out.push(`assertion ${a.id}: gap counts clearance lines; use it with fit clearance and without distance`);
    const e = "expect" in a ? a.expect : undefined;
    if (e && e.min !== undefined && e.max !== undefined && e.min > e.max) out.push(`assertion ${a.id}: min is above max`);
  }
  if (!task.assertions.some((a) => a.kind === "status")) out.push("every task needs a status assertion");
  if (!task.assertions.some((a) => a.kind === "valid")) out.push("every task needs a valid assertion");
  if (task.split === "regression" && !task.assertions.some((a) => a.kind === "measure" && a.expect.eq !== undefined)) {
    out.push("a regression task needs at least one measure with eq, so a drift in the numbers fails it");
  }
  if (task.split === "capability" && !task.assertions.some((a) => a.kind === "occurrences" || (a.kind === "count" && a.quantity === "occurrences"))) {
    out.push("a capability task is a multi-part brief: assert its occurrences");
  }
  return out;
}

// ---- Outcomes and assertions ------------------------------------------------------------

export interface OccurrenceRow { path: string; def: string }

/** What a solution produced: the detailed report and the leaf occurrences of its tree. */
export interface Outcome {
  report: GeometryReport;
  occurrences: OccurrenceRow[];
}

export interface AssertionResult {
  id: string;
  pass: boolean;
  /** What was measured and what was expected, in one line. */
  detail: string;
}

/** Leaf occurrences of an assembly graph with their paths (pcb_assy/standoff#1). */
export function flattenAssembly(asm: AssemblyFile): OccurrenceRow[] {
  const out: OccurrenceRow[] = [];
  const walk = (defId: string, prefix: string, depth: number) => {
    if (depth > 32) return;
    for (const o of asm.definitions[defId]?.occurrences ?? []) {
      if (o.suppressed) continue;
      const path = `${prefix}${o.name}`;
      if (asm.definitions[o.def]?.kind === "assembly") walk(o.def, `${path}/`, depth + 1);
      else out.push({ path, def: o.def });
    }
  };
  walk(asm.root, "", 0);
  return out;
}

/** Case-insensitive glob: * matches any run of characters, everything else is literal. */
export function glob(pattern: string): RegExp {
  const body = pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, "i");
}

/** Slack allowed around an expected number: max(abs, rel x |expected|). */
export function slack(expected: number, tol: Tol | undefined): number {
  return Math.max(tol?.abs ?? 0, (tol?.rel ?? 0) * Math.abs(expected));
}

export function meets(value: number, e: Expect): boolean {
  if (e.eq !== undefined) return Math.abs(value - e.eq) <= slack(e.eq, e.tol);
  if (e.min !== undefined && value < e.min - slack(e.min, e.tol)) return false;
  if (e.max !== undefined && value > e.max + slack(e.max, e.tol)) return false;
  return true;
}

export function describeExpect(e: Expect): string {
  const t = e.tol ? ` (tol ${[e.tol.abs !== undefined ? `abs ${e.tol.abs}` : "", e.tol.rel !== undefined ? `rel ${e.tol.rel}` : ""].filter(Boolean).join(", ")})` : "";
  if (e.eq !== undefined) return `= ${e.eq}${t}`;
  if (e.min !== undefined && e.max !== undefined) return `in [${e.min}, ${e.max}]${t}`;
  return e.min !== undefined ? `>= ${e.min}${t}` : `<= ${e.max}${t}`;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6));

function measureOf(report: GeometryReport, q: Quantity, target: string): number | string {
  let box;
  let parts = report.parts;
  if (target === "assembly") {
    if (q === "mass_g" && report.assembly.mass_g !== undefined) return report.assembly.mass_g;
    box = report.assembly.bbox;
  } else {
    const re = glob(target);
    parts = report.parts.filter((p) => re.test(p.def));
    if (parts.length === 0) return `no definition matches "${target}"`;
    box = {
      min: [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.bbox.min[i]!))),
      max: [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.bbox.max[i]!))),
    };
  }
  const sum = (f: (p: GeometryReport["parts"][number]) => number | undefined, what: string): number | string => {
    let s = 0;
    for (const p of parts) {
      const v = f(p);
      if (v === undefined) return `the report has no ${what} for ${p.def}; run with a detailed report`;
      s += v * (p.occurrences ?? 1);
    }
    return s;
  };
  switch (q) {
    case "volume_mm3": return sum((p) => p.volume_mm3, "volume");
    case "area_mm2": return sum((p) => p.area_mm2, "area");
    case "mass_g": return sum((p) => p.mass_g, "mass");
    default: {
      if (!box) return "the report has no bounding box";
      if (q === "size_max" || q === "size_mid" || q === "size_min") {
        // Sorted extents: the same whichever horizontal axis the design runs along.
        const sizes = [0, 1, 2].map((i) => box.max[i]! - box.min[i]!).sort((x, y) => y - x);
        return sizes[q === "size_max" ? 0 : q === "size_mid" ? 1 : 2]!;
      }
      const axis = { x: 0, y: 1, z: 2 }[q.slice(-1) as "x" | "y" | "z"];
      if (q.startsWith("size")) return box.max[axis]! - box.min[axis]!;
      return q.startsWith("min") ? box.min[axis]! : box.max[axis]!;
    }
  }
}

/** Evaluate one assertion on an outcome. */
export function evaluate(a: Assertion, o: Outcome): AssertionResult {
  const r = o.report;
  const res = (pass: boolean, detail: string): AssertionResult => ({ id: a.id, pass, detail });
  switch (a.kind) {
    case "status":
      return res(a.in.includes(r.status), `status ${r.status}, expected ${a.in.join(" or ")}`);
    case "valid": {
      const re = glob(a.target ?? "*");
      const parts = r.parts.filter((p) => re.test(p.def));
      const bad = parts.filter((p) => !p.valid).map((p) => p.def);
      if (parts.length === 0) return res(false, `no definition matches "${a.target ?? "*"}"`);
      return res(bad.length === 0, bad.length ? `invalid: ${bad.join(", ")}` : `${parts.length} definition(s) valid`);
    }
    case "measure": {
      const v = measureOf(r, a.quantity, a.target);
      if (typeof v === "string") return res(false, v);
      return res(meets(v, a.expect), `${a.quantity} of ${a.target} = ${fmt(v)}, expected ${describeExpect(a.expect)}`);
    }
    case "count": {
      const q = a.quantity;
      let v: number;
      let what = "";
      if (q === "occurrences") v = r.assembly.occurrences;
      else if (q === "definitions") v = r.assembly.definitions;
      else {
        const re = glob(a.target ?? "*");
        const parts = r.parts.filter((p) => re.test(p.def));
        if (parts.length === 0) return res(false, `no definition matches "${a.target ?? "*"}"`);
        const missing = parts.find((p) => p.counts?.[q] === undefined);
        if (missing) return res(false, `the report has no ${q} count for ${missing.def}; run with a detailed report`);
        v = parts.reduce((s, p) => s + (p.counts?.[q] ?? 0), 0);
        if (a.target) what = ` of ${a.target}`;
      }
      return res(meets(v, a.expect), `${q}${what} = ${v}, expected ${describeExpect(a.expect)}`);
    }
    case "fits": {
      const ra = glob(a.a ?? "*"), rb = glob(a.b ?? "*");
      const kindOk = (f: FitReport) => a.fit === "any" || f.kind === a.fit;
      const matches = (f: FitReport) => (ra.test(f.a) && rb.test(f.b)) || (ra.test(f.b) && rb.test(f.a));
      // Pairs are counted by their closest relation. Lines marked extra are further gaps of a
      // pair already counted (or of a mated pair whose contact is exempt), so a pair whose
      // closest relation is a contact never counts as a clearance because of its lip gap.
      const pair = `${a.a ?? "*"} / ${a.b ?? "*"}`;
      if (a.gap) {
        // Gaps of a size: every clearance line of the matching pairs, a pair's further gaps
        // (extra lines) included, whose distance is in the range. A mated pair's only listed
        // line is extra (its contact is exempt), so this is how a lid's lip gap is asserted.
        const gaps = r.fits.filter((f) => f.kind === "clearance" && matches(f) && f.distance_mm !== undefined && meets(f.distance_mm, a.gap!));
        const n = gaps.reduce((s, f) => s + (f.n ?? 1), 0);
        return res(meets(n, a.expect), `${n} gap(s) ${describeExpect(a.gap)} between ${pair}, expected ${describeExpect(a.expect)}`);
      }
      const fits = r.fits.filter((f) => !f.extra && kindOk(f) && matches(f));
      const n = fits.reduce((s, f) => s + (f.n ?? 1), 0);
      if (!meets(n, a.expect)) return res(false, `${n} ${a.fit} fit(s) between ${pair}, expected ${describeExpect(a.expect)}`);
      if (a.distance) {
        // The distance bounds every gap of a counted pair, its further gaps included: a brief
        // that bounds a plunger's hole gap and its flange gap must fail when either is off.
        const counted = new Set(fits.map((f) => `${f.a}\u0000${f.b}`));
        const extras = r.fits.filter((f) => f.extra && kindOk(f) && counted.has(`${f.a}\u0000${f.b}`));
        const off = [...fits, ...extras].filter((f) => f.distance_mm === undefined || !meets(f.distance_mm, a.distance!));
        if (off.length > 0) {
          const f = off[0]!;
          return res(false, `${f.a} / ${f.b}: ${f.kind} distance ${f.distance_mm ?? "none"}, expected ${describeExpect(a.distance)}`);
        }
      }
      return res(true, `${n} ${a.fit} fit(s) between ${pair}${a.distance ? `, distances ${describeExpect(a.distance)}` : ""}`);
    }
    case "occurrences": {
      const rn = glob(a.name), rd = glob(a.def ?? "*");
      const n = o.occurrences.filter((x) => rn.test(x.path) && rd.test(x.def)).length;
      return res(meets(n, a.expect), `${n} occurrence(s) named ${a.name}${a.def ? ` of ${a.def}` : ""}, expected ${describeExpect(a.expect)}`);
    }
    case "same_definition": {
      const rn = glob(a.name);
      const rows = o.occurrences.filter((x) => rn.test(x.path));
      const defs = [...new Set(rows.map((x) => x.def))];
      return res(rows.length >= 2 && defs.length === 1, `${rows.length} occurrence(s) named ${a.name} use ${defs.length} definition(s)${defs.length ? ` (${defs.join(", ")})` : ""}`);
    }
  }
}

export function evaluateAll(task: BenchTask, o: Outcome): AssertionResult[] {
  return task.assertions.map((a) => evaluate(a, o));
}

/** Patterns that match nothing in an outcome: almost always a typo in task.json. */
export function deadPatterns(task: BenchTask, o: Outcome): string[] {
  const out: string[] = [];
  const paths = o.occurrences.map((x) => x.path);
  const defs = o.report.parts.map((p) => p.def);
  const any = (pattern: string, list: string[]) => list.some((s) => glob(pattern).test(s));
  for (const a of task.assertions) {
    if (a.kind === "fits") {
      for (const p of [a.a, a.b]) if (p !== undefined && !any(p, paths)) out.push(`assertion ${a.id}: pattern "${p}" matches no occurrence`);
    }
    if ((a.kind === "occurrences" || a.kind === "same_definition") && !any(a.name, paths)) out.push(`assertion ${a.id}: name "${a.name}" matches no occurrence`);
    if (a.kind === "occurrences" && a.def !== undefined && !any(a.def, defs)) out.push(`assertion ${a.id}: def "${a.def}" matches no definition`);
  }
  return out;
}

// ---- Running a solution -----------------------------------------------------------------

export type RunResult =
  | { ok: true; outcome: Outcome; ms: number; memoryBytes?: number }
  | { ok: false; error: Pick<ScriptError, "code" | "message"> & { line?: number }; ms: number };

/** Run a script on the real compute pool (worker threads, captured stdout) with a detailed report. ms is the job's time on its worker. */
export async function runOnPool(pool: Pool, script: string, params: Record<string, ParamValue>, timeoutMs = 120_000): Promise<RunResult> {
  const r = await pool.run({ kind: "run", script, params, rev: "r_0001", detail: "detailed" }, { lane: "interactive", timeoutMs });
  // The worker's own time for the job, without the wait in the pool's queue.
  const ms = Math.round(r.stats.wallMs);
  if (!r.ok) return { ok: false, error: { code: r.error.code, message: r.error.message, ...(r.error.line !== undefined ? { line: r.error.line } : {}) }, ms };
  return { ok: true, outcome: { report: r.report, occurrences: flattenAssembly(r.assembly) }, ms, memoryBytes: r.stats.memoryBytes };
}

interface CliRun { code: number; stdout: string; stderr: string }
function cli(args: string[], cwd: string): CliRun {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Run a script through the real CLI in fresh processes, as a person or an agent would:
 * open3dj run (detailed, JSON) in a temporary folder, then open3dj inspect --fields tree.
 */
export function runOnCli(scriptPath: string, params: Record<string, ParamValue>): RunResult {
  const t = performance.now();
  const tmp = mkdtempSync(join(tmpdir(), "o3dj-bench-"));
  try {
    const script = join(tmp, "solution.o3j.js");
    copyFileSync(scriptPath, script);
    const paramArgs = Object.entries(params).flatMap(([k, v]) => ["--param", `${k}=${String(v)}`]);
    const run = cli(["run", script, "--detailed", "--json", ...paramArgs], tmp);
    let out: RunOutput;
    try {
      out = JSON.parse(run.stdout) as RunOutput;
    } catch {
      return { ok: false, error: { code: "CLI_FAILED", message: `open3dj run exited ${run.code}: ${(run.stderr || run.stdout).slice(0, 600)}` }, ms: Math.round(performance.now() - t) };
    }
    if (!out.report) {
      const e = out.error;
      return { ok: false, error: { code: e?.code ?? "CLI_FAILED", message: e?.message ?? `status ${out.status}`, ...(e?.line !== undefined ? { line: e.line } : {}) }, ms: Math.round(performance.now() - t) };
    }
    const tree = cli(["inspect", join(tmp, "solution.o3j"), "--fields", "tree", "--json"], tmp);
    const nodes = (JSON.parse(tree.stdout) as { tree?: Array<{ path: string; def: string; kind?: string }> }).tree ?? [];
    const occurrences = nodes.filter((n) => n.kind !== "assembly").map((n) => ({ path: n.path, def: n.def }));
    const report: GeometryReport = { ...(out.report as GeometryReport), status: out.status === "queued" ? "error" : out.status, rev: out.rev ?? "r_0001", compute: out.compute };
    return { ok: true, outcome: { report, occurrences }, ms: Math.round(performance.now() - t) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- Solutions to grade -------------------------------------------------------------------

/** A script to grade and the params to run it with. */
export interface Solution {
  script: string;
  params: Record<string, ParamValue>;
}

/**
 * What a solution path stands for. A .o3j.js file runs with the task's params. A project
 * folder is graded as the agent left its working copy: main.o3j.js with the values saved in
 * params.o3j.json (by run params or set_param) over the task's params, which is what the
 * project's next run would build. Undefined when there is no script.
 */
export function solutionOf(path: string, taskParams: Record<string, ParamValue>): Solution | undefined {
  if (!existsSync(path)) return undefined;
  if (!statSync(path).isDirectory()) return { script: path, params: { ...taskParams } };
  const script = join(path, "main.o3j.js");
  if (!existsSync(script)) return undefined;
  const file = join(path, "params.o3j.json");
  if (!existsSync(file)) return { script, params: { ...taskParams } };
  const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const ok = saved !== null && typeof saved === "object" && !Array.isArray(saved)
    && Object.values(saved).every((v) => ["number", "string", "boolean"].includes(typeof v));
  if (!ok) throw new Error(`${file}: params.o3j.json must be an object of name: value`);
  return { script, params: { ...taskParams, ...(saved as Record<string, ParamValue>) } };
}

/**
 * The script with every returned part turned by 90 degrees about axis through the origin. The
 * script runs inside a function, so its top-level return still works. Used to check that a
 * capability task does not grade which horizontal axis a design runs along.
 */
export function turnedScript(script: string, axis: [number, number, number]): string {
  const ax = JSON.stringify(axis);
  return [
    `const __turn = (s) => s.rotate(90, ${ax});`,
    `const __one = (p) => (p && typeof p.rotate === "function" ? __turn(p) : { ...p, shape: __turn(p.shape) });`,
    `const __r = (function () {`,
    script,
    `})();`,
    `return Array.isArray(__r) ? __r.map(__one) : __r && typeof __r.rotate === "function" ? __turn(__r) : __r && __r.shape ? __one(__r) : Object.fromEntries(Object.entries(__r).map(([k, v]) => [k, __turn(v)]));`,
  ].join("\n");
}

// ---- task-lint for one task ---------------------------------------------------------------

export interface LintResult {
  id: string;
  split: Split;
  problems: string[];
  reference?: { ms: number; results: AssertionResult[] };
  mutant?: { ms: number; results: AssertionResult[] };
  more_mutants?: Array<{ file: string; ms: number; results: AssertionResult[] }>;
  /** Capability tasks: the reference turned 90 degrees about Z. */
  turned?: { ms: number; results: AssertionResult[] };
}

/** Runs a solution script; turn, when given, runs it turned 90 degrees about that axis (turnedScript). */
export type Runner = (scriptPath: string, params: Record<string, ParamValue>, turn?: [number, number, number]) => Promise<RunResult>;

export function poolRunner(pool: Pool): Runner {
  return (scriptPath, params, turn) => {
    const script = readFileSync(scriptPath, "utf8");
    return runOnPool(pool, turn ? turnedScript(script, turn) : script, params);
  };
}

export const cliRunner: Runner = async (scriptPath, params, turn) => {
  if (!turn) return runOnCli(scriptPath, params);
  const dir = mkdtempSync(join(tmpdir(), "o3dj-turned-"));
  try {
    const file = join(dir, "turned.o3j.js");
    writeFileSync(file, turnedScript(readFileSync(scriptPath, "utf8"), turn));
    return runOnCli(file, params);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * task-lint: the reference must run and pass every assertion; the mutant must run and fail at
 * least one assertion, including every id in mutant_fails, and each of more_mutants must run
 * and fail every id in its fails. A capability reference turned 90 degrees about Z must still
 * pass every assertion: a brief does not say which horizontal axis is the length, so neither
 * may its grading. Static problems come first.
 */
export async function lintTask(t: LoadedTask, run: Runner): Promise<LintResult> {
  const out: LintResult = { id: t.task.id, split: t.task.split, problems: [...t.problems] };
  if (out.problems.length > 0) return out;
  const { task, dir } = t;
  const [ref, mut] = await Promise.all([run(join(dir, task.reference), task.params), run(join(dir, task.mutant), task.params)]);
  if (!ref.ok) out.problems.push(`reference failed to run: ${ref.error.code} ${ref.error.message}${ref.error.line ? ` (line ${ref.error.line})` : ""}`);
  else {
    const results = evaluateAll(task, ref.outcome);
    out.reference = { ms: ref.ms, results };
    for (const r of results) if (!r.pass) out.problems.push(`reference fails ${r.id}: ${r.detail}`);
    out.problems.push(...deadPatterns(task, ref.outcome));
  }
  if (!mut.ok) out.problems.push(`mutant failed to run (seed a geometric defect, not a script error): ${mut.error.code} ${mut.error.message}`);
  else {
    const results = evaluateAll(task, mut.outcome);
    out.mutant = { ms: mut.ms, results };
    const failed = results.filter((r) => !r.pass).map((r) => r.id);
    if (failed.length === 0) out.problems.push("mutant passes every assertion: the assertions do not catch its defect");
    for (const id of task.mutant_fails) if (!failed.includes(id)) out.problems.push(`mutant should fail ${id} but passes it`);
  }
  if (task.split === "capability") {
    const turned = await run(join(dir, task.reference), task.params, [0, 0, 1]);
    if (!turned.ok) out.problems.push(`the reference turned 90 degrees about Z failed to run: ${turned.error.code} ${turned.error.message}`);
    else {
      const results = evaluateAll(task, turned.outcome);
      out.turned = { ms: turned.ms, results };
      for (const r of results) if (!r.pass) out.problems.push(`the reference turned 90 degrees about Z fails ${r.id}: ${r.detail} (assert sizes with size_max, size_mid and size_min, not the horizontal axes)`);
    }
  }
  const more = await Promise.all((task.more_mutants ?? []).map(async (m) => ({ m, r: await run(join(dir, m.file), task.params) })));
  for (const { m, r } of more) {
    if (!r.ok) {
      out.problems.push(`${m.file} failed to run (seed a geometric defect, not a script error): ${r.error.code} ${r.error.message}`);
      continue;
    }
    const results = evaluateAll(task, r.outcome);
    (out.more_mutants ??= []).push({ file: m.file, ms: r.ms, results });
    const failed = results.filter((x) => !x.pass).map((x) => x.id);
    for (const id of m.fails) if (!failed.includes(id)) out.problems.push(`${m.file} should fail ${id} but passes it`);
  }
  return out;
}
