// The seeded gate corpus (PLAN.md S3 exit: zero false passes on the seeded gate corpus). Loads
// corpora/gates/cases.json and the one-case files in corpora/gates/cases/, runs every case
// through the gate job that inspect fields=[gates]
// uses (a run job with gates, without the fit check) on the compute pool or the real CLI, and
// compares each gate's verdict and value with the expected ones. scripts/gate-corpus.ts prints
// the table; scripts/gate-corpus.test.ts runs it in npm test.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lane, Pool } from "@open3dj/compute";
import type { GateFailure, GateProfile, GateRun, ParamValue, PartGateRun, Vec3 } from "@open3dj/schemas";
import { ROOT } from "./lib.ts";

export const CORPUS_DIR = join(ROOT, "corpora", "gates");
export const CLI = join(ROOT, "packages", "open3dj", "src", "cli.ts");
/** The fdm.v1 gates, in the order the report lists them. */
export const GATES = ["watertight", "min_wall", "overhang", "bed"] as const;
export type GateName = (typeof GATES)[number];
export type Verdict = "pass" | "fail";

/** The expected verdict of one gate, with the checks that matter for the case. */
export interface GateExpect {
  /** The true verdict: fail for a seeded defect, pass for a control. */
  verdict: Verdict;
  /**
   * [min, max] for the gate's number: the failure's value, or for a min_wall pass the thinnest
   * wall found (wall.min_mm), so a control cannot pass without its wall being measured.
   */
  value?: [number, number];
  /** A failure inside the guard band. Default false: a seeded defect must fail outright. */
  marginal?: boolean;
  /** A min_wall failure without a value (no wall measured). Default false. */
  unmeasured?: boolean;
  /**
   * A documented miss: the truth is a fail, the gate passes today. The run reports it and does
   * not count it as a false pass; once the gate catches it, the run fails until the case is
   * updated, so the docs that describe the miss get updated too.
   */
  known_miss?: string;
}

export type CaseKind = "defect" | "control" | "known-miss";
export type CaseExpect = Record<GateName, Verdict | GateExpect> | { error: string };

export interface GateCase {
  id: string;
  kind: CaseKind;
  /** What the case seeds, in one sentence. */
  seeds: string;
  build?: Vec3;
  bed?: Vec3;
  params?: Record<string, ParamValue>;
  expect: CaseExpect;
}

export interface Corpus {
  profile: GateProfile;
  cases: GateCase[];
  /** Where each case came from, by index, relative to the corpus folder: cases.json or cases/<id>.json. */
  sources?: string[];
  /** Files in cases/ that could not be read as one case. */
  problems?: string[];
}

/** The folder of one-case files, inside the corpus folder: cases/<id>.json, each one entry of cases.json. */
export const CASE_FILES = "cases";
const MANIFEST = "cases.json";
const CASE_FIELDS = ["id", "kind", "seeds", "build", "bed", "params", "expect"];
const EXPECT_FIELDS = ["verdict", "value", "marginal", "unmeasured", "known_miss"];

export const scriptOf = (c: GateCase, dir = CORPUS_DIR) => join(dir, `${c.id}.o3j.js`);
const expectsError = (e: CaseExpect): e is { error: string } => "error" in e;
export const gateExpect = (e: Verdict | GateExpect): GateExpect => (typeof e === "string" ? { verdict: e } : e);

/**
 * The corpus: the profile and cases of cases.json, then one case from each cases/<id>.json in
 * name order. A new case goes in a file of its own, so adding one changes no existing file.
 * A file that is not one case object is reported by checkCorpus, not thrown.
 */
export function loadCorpus(dir = CORPUS_DIR): Corpus {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as Partial<Corpus>;
  const problems: string[] = [];
  if (!Array.isArray(manifest.cases)) problems.push(`${MANIFEST}: cases must be a list`);
  const cases = Array.isArray(manifest.cases) ? [...manifest.cases] : [];
  const sources = cases.map(() => MANIFEST);
  const folder = join(dir, CASE_FILES);
  const entries = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)) : [];
  for (const e of entries) {
    const at = `${CASE_FILES}/${e.name}`;
    if (!e.isFile() || !e.name.endsWith(".json")) {
      problems.push(`${at}: only case files, <id>.json, belong in ${CASE_FILES}/`);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(folder, e.name), "utf8"));
    } catch (err) {
      problems.push(`${at}: not valid JSON: ${(err as Error).message}`);
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${at}: must hold one case object, with the fields of one entry in ${MANIFEST}`);
      continue;
    }
    const c = value as GateCase;
    if (c.id !== e.name.slice(0, -".json".length)) problems.push(`${at}: the file name must be the case id plus .json, but the id is ${JSON.stringify(c.id)}`);
    cases.push(c);
    sources.push(at);
  }
  return { profile: manifest.profile as GateProfile, cases, sources, problems };
}

/** Problems with the corpus: case files, shape, scripts, and kinds that agree with the verdicts. */
export function checkCorpus(corpus: Corpus, dir = CORPUS_DIR): string[] {
  const problems: string[] = [...(corpus.problems ?? [])];
  if (corpus.profile !== "fdm.v1") problems.push(`profile must be fdm.v1, got ${String(corpus.profile)}`);
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) return [...problems, "cases must be a non-empty list"];
  const seen = new Map<string, string>();
  const vec = (v: unknown, positive: boolean) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x) && (!positive || x > 0)) && (positive || v.some((x) => x !== 0));
  for (const [i, c] of corpus.cases.entries()) {
    const from = corpus.sources?.[i] ?? MANIFEST;
    // Cases of cases.json keep their short name; a case of its own names its file too.
    const at = from === MANIFEST ? `case ${String(c.id)}` : `case ${String(c.id)} (${from})`;
    if (typeof c.id !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(c.id)) problems.push(`${at}: id must be lower case letters, digits, dots and dashes`);
    const first = seen.get(c.id);
    if (first !== undefined) problems.push(`${at}: duplicate id, also in ${first}`);
    else seen.set(c.id, from);
    if (!existsSync(scriptOf(c, dir))) problems.push(`${at}: ${c.id}.o3j.js is missing`);
    if (!["defect", "control", "known-miss"].includes(c.kind)) problems.push(`${at}: kind must be defect, control or known-miss`);
    if (typeof c.seeds !== "string" || c.seeds.trim().length < 10) problems.push(`${at}: seeds must say what the case seeds`);
    if (c.build !== undefined && !vec(c.build, false)) problems.push(`${at}: build must be three finite numbers, not all 0`);
    if (c.bed !== undefined && !vec(c.bed, true)) problems.push(`${at}: bed must be three positive numbers`);
    if (c.params !== undefined && (typeof c.params !== "object" || c.params === null || Array.isArray(c.params))) problems.push(`${at}: params must be an object of values`);
    // A misspelt field would be ignored without a word, so only known fields are allowed.
    const unknown = Object.keys(c).filter((k) => !CASE_FIELDS.includes(k));
    if (unknown.length > 0) problems.push(`${at}: unknown field ${unknown.join(", ")}`);
    const e = c.expect;
    if (!e || typeof e !== "object") {
      problems.push(`${at}: expect is missing`);
      continue;
    }
    if (expectsError(e)) {
      if (Object.keys(e).length !== 1 || typeof e.error !== "string") problems.push(`${at}: an expected error is { "error": "<code>" } alone`);
      if (c.kind !== "defect") problems.push(`${at}: only a defect can expect the run to refuse it`);
      continue;
    }
    const keys = Object.keys(e).sort();
    if (keys.join() !== [...GATES].sort().join()) problems.push(`${at}: expect must give exactly ${GATES.join(", ")}, got ${keys.join(", ")}`);
    const all = GATES.filter((g) => e[g] !== undefined).map((g) => [g, gateExpect(e[g])] as const);
    for (const [g, x] of all) {
      const extra = Object.keys(x).filter((k) => !EXPECT_FIELDS.includes(k));
      if (extra.length > 0) problems.push(`${at}: ${g} has unknown field ${extra.join(", ")}`);
      if (x.verdict !== "pass" && x.verdict !== "fail") problems.push(`${at}: ${g} verdict must be pass or fail`);
      if (x.value !== undefined && !(Array.isArray(x.value) && x.value.length === 2 && x.value.every(Number.isFinite) && x.value[0] <= x.value[1])) problems.push(`${at}: ${g} value must be [min, max] with min <= max`);
      if (x.verdict === "pass" && (x.marginal !== undefined || x.unmeasured !== undefined)) problems.push(`${at}: ${g} marginal and unmeasured go with a fail`);
      if (x.known_miss !== undefined && (x.verdict !== "fail" || typeof x.known_miss !== "string" || x.known_miss.length < 10)) problems.push(`${at}: ${g} known_miss is a fail with the reason the gate misses it`);
      if (x.unmeasured && (g !== "min_wall" || x.value !== undefined)) problems.push(`${at}: only min_wall fails unmeasured, and then without a value`);
    }
    const fails = all.filter(([, x]) => x.verdict === "fail" && !x.known_miss).length;
    const misses = all.filter(([, x]) => x.known_miss).length;
    if (c.kind === "defect" && fails === 0) problems.push(`${at}: a defect must expect at least one gate to fail`);
    if (c.kind === "control" && fails + misses > 0) problems.push(`${at}: a control must expect every gate to pass`);
    if (c.kind === "known-miss" && (misses === 0 || fails > 0)) problems.push(`${at}: a known-miss case expects known misses and passes only`);
  }
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".o3j.js"));
    for (const f of files) if (!seen.has(f.slice(0, -".o3j.js".length))) problems.push(`${f} has no case in ${MANIFEST} or ${CASE_FILES}/`);
  } catch (e) {
    problems.push(`cannot list ${dir}: ${(e as Error).message}`);
  }
  return problems;
}

// ---- running a case -----------------------------------------------------------------------

/** The gates of a case's single part, or the error that stopped the run. ms is the job's time. */
export type CaseRun =
  | { ok: true; part: PartGateRun; ms: number }
  | { ok: false; error: { code: string; message: string }; ms: number };

/** The gate job of inspect fields=[gates] on the compute pool: a run job with gates and no fit check. */
export async function runOnPool(pool: Pool, c: GateCase, profile: GateProfile, options: { dir?: string; lane?: Lane; timeoutMs?: number } = {}): Promise<CaseRun> {
  const script = readFileSync(scriptOf(c, options.dir), "utf8");
  const gates = { profile, ...(c.build ? { build: c.build } : {}), ...(c.bed ? { bed: c.bed } : {}) };
  const r = await pool.run({ kind: "run", script, rev: "r_0001", fits: false, gates, ...(c.params ? { params: c.params } : {}) }, { lane: options.lane ?? "batch", timeoutMs: options.timeoutMs ?? 120_000 });
  const ms = Math.round(r.stats.wallMs);
  if (!r.ok) return { ok: false, error: { code: r.error.code, message: r.error.message }, ms };
  return onePart(r.gates, ms);
}

/** The same through the real CLI, one fresh process per case: open3dj inspect --fields gates. */
export function runOnCli(c: GateCase, options: { dir?: string } = {}): CaseRun {
  const t = performance.now();
  const tmp = mkdtempSync(join(tmpdir(), "o3dj-gates-"));
  try {
    const script = join(tmp, `${c.id}.o3j.js`);
    copyFileSync(scriptOf(c, options.dir), script);
    // name=value, so a direction such as -1,0,0 is not read as an option.
    const args = [CLI, "inspect", script, "--fields", "gates", "--json"];
    if (c.build) args.push(`--build=${c.build.join(",")}`);
    if (c.bed) args.push(`--bed=${c.bed.join(",")}`);
    for (const [k, v] of Object.entries(c.params ?? {})) args.push("--param", `${k}=${String(v)}`);
    const r = spawnSync(process.execPath, args, { cwd: tmp, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 300_000 });
    const ms = Math.round(performance.now() - t);
    let out: { gates?: GateRun; error?: { code?: string; message?: string } };
    try {
      out = JSON.parse(r.stdout) as typeof out;
    } catch {
      // A script error is printed for people on stderr: "error <CODE> at <file>:<line>: <message>".
      const printed = /^error ([A-Z][A-Z0-9_]+)\b/m.exec(r.stderr ?? "");
      return { ok: false, error: { code: printed?.[1] ?? "CLI_FAILED", message: `open3dj inspect exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 600)}` }, ms };
    }
    if (!out.gates) return { ok: false, error: { code: out.error?.code ?? "CLI_FAILED", message: out.error?.message ?? "no gates in the output" }, ms };
    return onePart(out.gates, ms);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function onePart(gates: GateRun | undefined, ms: number): CaseRun {
  const parts = gates?.parts ?? [];
  if (parts.length !== 1) return { ok: false, error: { code: "CORPUS_PARTS", message: `a corpus case returns one part, got ${parts.length}` }, ms };
  return { ok: true, part: parts[0]!, ms };
}

// ---- judging ------------------------------------------------------------------------------

/**
 * ok: as expected. false_pass: a seeded defect passed (or the run accepted a part it must
 * refuse). false_fail: a control failed. known_miss: a documented miss, still missed.
 * miss_caught: a documented miss is now caught (update the case and the docs). value,
 * marginal, unmeasured: the verdict is right but the number or its flags are not. error: the
 * run failed where it should not, or with another code.
 */
export type Outcome = "ok" | "false_pass" | "false_fail" | "known_miss" | "miss_caught" | "value" | "marginal" | "unmeasured" | "error";
export interface Finding { gate: GateName | "run"; outcome: Outcome; got: string; detail?: string }
export interface CaseResult { id: string; kind: CaseKind; ms: number; findings: Finding[] }

/** The gate's number: the failure's value, or the thinnest wall for a min_wall pass. */
function valueOf(part: PartGateRun, gate: GateName, f: GateFailure | undefined): number | undefined {
  if (f) return f.value;
  return gate === "min_wall" ? part.wall.min_mm : undefined;
}

export function judgeCase(c: GateCase, run: CaseRun): CaseResult {
  const findings: Finding[] = [];
  const result = { id: c.id, kind: c.kind, ms: run.ms, findings };
  if (expectsError(c.expect)) {
    if (!run.ok) findings.push({ gate: "run", outcome: run.error.code === c.expect.error ? "ok" : "error", got: run.error.code, ...(run.error.code === c.expect.error ? {} : { detail: `expected ${c.expect.error}: ${run.error.message}` }) });
    else findings.push({ gate: "run", outcome: "false_pass", got: "ran", detail: `the run accepted a part it must refuse with ${c.expect.error} (gates passed: ${run.part.pass.join(", ") || "none"})` });
    return result;
  }
  if (!run.ok) {
    findings.push({ gate: "run", outcome: "error", got: run.error.code, detail: run.error.message });
    return result;
  }
  const { part } = run;
  for (const gate of GATES) {
    const want = gateExpect(c.expect[gate]);
    const f = part.fail.find((x) => x.gate === gate);
    const passed = part.pass.includes(gate);
    if (passed === Boolean(f)) {
      findings.push({ gate, outcome: "error", got: "?", detail: `the gate is ${passed ? "in both pass and fail" : "in neither pass nor fail"}` });
      continue;
    }
    const value = valueOf(part, gate, f);
    const got = `${passed ? "pass" : "fail"}${value === undefined ? "" : ` ${value}`}${f?.marginal ? " (marginal)" : ""}`;
    const add = (outcome: Outcome, detail?: string) => findings.push({ gate, outcome, got, ...(detail ? { detail } : {}) });
    if (want.known_miss) {
      if (passed) add("known_miss", want.known_miss);
      else add("miss_caught", `the gate now catches this known miss: make the case a defect and update the docs that describe the miss (${want.known_miss})`);
    } else if (want.verdict === "fail" && passed) {
      add("false_pass", "a seeded defect passed");
      continue;
    } else if (want.verdict === "pass" && !passed) {
      add("false_fail", f?.note ?? "a control failed");
      continue;
    }
    const before = findings.length;
    if (want.value) {
      const [lo, hi] = want.value;
      if (value === undefined || !(value >= lo && value <= hi)) add("value", `expected a value in [${lo}, ${hi}]`);
    }
    if (f && want.verdict === "fail" && !want.known_miss) {
      if ((want.marginal ?? false) !== (f.marginal === true)) add("marginal", want.marginal ? "expected a marginal failure" : "expected an outright failure, not a marginal one");
      if (gate === "min_wall" && (want.unmeasured ?? false) !== (f.value === undefined)) add("unmeasured", want.unmeasured ? "expected no wall to be measured" : "expected a measured wall");
    }
    if (findings.length === before && !want.known_miss) add("ok");
  }
  return result;
}

/** Findings that fail the run: everything but ok and a known miss that is still missed. */
export const problemsOf = (results: CaseResult[]) => results.flatMap((r) => r.findings.filter((f) => f.outcome !== "ok" && f.outcome !== "known_miss").map((f) => ({ id: r.id, ...f })));
export const countOf = (results: CaseResult[], outcome: Outcome) => results.reduce((n, r) => n + r.findings.filter((f) => f.outcome === outcome).length, 0);

/** One line per case: id, kind, each gate's result (marked when it is not as expected), time. */
export function table(results: CaseResult[]): string {
  const cell = (r: CaseResult, g: GateName | "run") => {
    const f = r.findings.find((x) => x.gate === g);
    if (!f) return "";
    const mark = f.outcome === "ok" ? "" : f.outcome === "known_miss" ? " [known miss]" : ` [${f.outcome.toUpperCase()}]`;
    return `${f.got}${mark}`;
  };
  const rows = results.map((r) => {
    const run = r.findings.some((f) => f.gate === "run");
    return [r.id, r.kind, ...GATES.map((g, i) => (run ? (i === 0 ? `run: ${cell(r, "run")}` : "") : cell(r, g))), String(r.ms)];
  });
  const head = ["case", "kind", ...GATES, "ms"];
  // A refused run spans the gate columns, so it does not set their width.
  const width = head.map((h, i) => Math.max(h.length, ...rows.filter((row) => i < 2 || i > GATES.length + 1 || !row[2]!.startsWith("run: ")).map((row) => row[i]!.length)));
  const line = (row: string[]) => row.map((c, i) => (i === row.length - 1 ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join("  ").trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}
