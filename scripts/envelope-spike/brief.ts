// Certified Envelopes spike: briefs, parameter expressions and signed margins. A brief is a
// list of bench-style assertions plus each Param's range (briefs/index.json gives the format).
// Pass and fail always come from bench/lib.ts (evaluate and meets); this module adds the signed
// margin next to them and checks that its sign agrees. No kernel is loaded here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FitReport, GateRun, GeometryReport, ParamValue, Vec3 } from "@open3dj/schemas";
import { ROOT, evaluate, glob, meets, slack } from "../../bench/lib.ts";
import type { Assertion, Expect, OccurrenceRow, Outcome, Tol } from "../../bench/lib.ts";

/** A number, or a parameter expression such as "$Thickness + 12" or "9 + ${Bolt holes}". */
export type Num = number | string;
export interface BriefExpect { eq?: Num; min?: Num; max?: Num; tol?: Tol }

export interface ParamDecl {
  name: string;
  type: "number" | "bool" | "choice";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  unit?: string;
  options?: Array<string | number>;
}

export interface GateGroup { targets: string[]; build: Vec3; build_source?: string }

export type GateName = "watertight" | "min_wall" | "overhang" | "bed";
interface Base { id: string; from?: string; note?: string }
export type BriefAssertion =
  | (Base & { kind: "builds" })
  | (Base & { kind: "gate"; gate: GateName; target: string })
  | (Base & { kind: "status"; in: Array<GeometryReport["status"]> })
  | (Base & { kind: "valid"; target?: string })
  | (Base & { kind: "measure"; quantity: Extract<Assertion, { kind: "measure" }>["quantity"]; target: string; expect: BriefExpect })
  | (Base & { kind: "count"; quantity: Extract<Assertion, { kind: "count" }>["quantity"]; target?: string; expect: BriefExpect })
  | (Base & { kind: "fits"; fit: "clash" | "contact" | "clearance" | "any"; a?: string; b?: string; expect: BriefExpect; distance?: BriefExpect; gap?: BriefExpect })
  | (Base & { kind: "occurrences"; name: string; def?: string; expect: BriefExpect })
  | (Base & { kind: "same_definition"; name: string });

export interface Brief {
  brief: string;
  id: string;
  /** Repository-relative path of the DSL script. */
  script: string;
  params: ParamDecl[];
  gates: GateGroup[];
  assertions: BriefAssertion[];
  /** Fit watch distance; default max(0.5, 2 x the largest gap or distance bound over the box). */
  fit_watch_mm?: number;
  [k: string]: unknown;
}

export interface LoadedBrief {
  brief: Brief;
  file: string;
  script: string;
  /** sha256 of the brief file and of the script, hex. */
  briefHash: string;
  scriptHash: string;
}

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export function loadBrief(file: string): LoadedBrief {
  const text = readFileSync(file, "utf8");
  const brief = JSON.parse(text) as Brief;
  const script = readFileSync(join(ROOT, brief.script), "utf8");
  return { brief, file, script, briefHash: sha256(text), scriptHash: sha256(script) };
}

// ---- Parameter expressions: numbers, $Name, ${Name with spaces}, + - * / and parentheses ----

type Token = { t: "num"; v: number } | { t: "param"; v: string } | { t: "op"; v: string };

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " ") { i++; continue; }
    if ("+-*/()".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "$") {
      if (src[i + 1] === "{") {
        const end = src.indexOf("}", i + 2);
        if (end < 0) throw new Error(`unclosed \${ in "${src}"`);
        out.push({ t: "param", v: src.slice(i + 2, end) });
        i = end + 1;
      } else {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
        if (!m) throw new Error(`bad parameter name in "${src}"`);
        out.push({ t: "param", v: m[0] });
        i += 1 + m[0].length;
      }
      continue;
    }
    const m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error(`unexpected "${c}" in "${src}"`);
    out.push({ t: "num", v: Number(m[0]) });
    i += m[0].length;
  }
  return out;
}

/** Evaluate a parameter expression without eval. Throws on a syntax error or an unknown or non-numeric parameter. */
export function evalExpr(src: string, params: Record<string, ParamValue>): number {
  const ts = tokens(src);
  let k = 0;
  const peek = () => ts[k];
  const op = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const factor = (): number => {
    const t = ts[k++];
    if (!t) throw new Error(`unexpected end of "${src}"`);
    if (t.t === "num") return t.v;
    if (t.t === "param") {
      const v = params[t.v];
      if (typeof v !== "number") throw new Error(`parameter ${t.v} in "${src}" is not a number`);
      return v;
    }
    if (t.v === "-") return -factor();
    if (t.v === "(") {
      const v = expr();
      if (!op(")")) throw new Error(`missing ) in "${src}"`);
      k++;
      return v;
    }
    throw new Error(`unexpected "${t.v}" in "${src}"`);
  };
  const term = (): number => {
    let v = factor();
    while (op("*") || op("/")) v = ts[k++]!.v === "*" ? v * factor() : v / factor();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (op("+") || op("-")) v = ts[k++]!.v === "+" ? v + term() : v - term();
    return v;
  };
  const v = expr();
  if (k !== ts.length) throw new Error(`trailing tokens in "${src}"`);
  return v;
}

const num = (x: Num | undefined, p: Record<string, ParamValue>) => (x === undefined ? undefined : typeof x === "number" ? x : evalExpr(x, p));

export function resolveExpect(e: BriefExpect, p: Record<string, ParamValue>): Expect {
  const out: Expect = {};
  const eq = num(e.eq, p), min = num(e.min, p), max = num(e.max, p);
  if (eq !== undefined) out.eq = eq;
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  if (e.tol) out.tol = e.tol;
  return out;
}

/** The bench assertion for a brief assertion at these parameter values (undefined for builds and gate). */
export function toBench(a: BriefAssertion, p: Record<string, ParamValue>): Assertion | undefined {
  switch (a.kind) {
    case "builds":
    case "gate":
      return undefined;
    case "status":
    case "valid":
    case "same_definition":
      return a as Assertion;
    case "measure":
    case "count":
    case "occurrences":
      return { ...a, expect: resolveExpect(a.expect, p) } as Assertion;
    case "fits": {
      const out = { ...a, expect: resolveExpect(a.expect, p) } as Extract<Assertion, { kind: "fits" }>;
      if (a.gap) out.gap = resolveExpect(a.gap, p);
      if (a.distance) out.distance = resolveExpect(a.distance, p);
      return out;
    }
  }
}

/** The fit watch distance for a brief: max(0.5, 2 x the largest |bound| of any gap or distance over the corners of the box). */
export function watchDistance(brief: Brief, corners: Array<Record<string, ParamValue>>): number {
  if (brief.fit_watch_mm !== undefined) return brief.fit_watch_mm;
  let w = 0.5;
  for (const a of brief.assertions) {
    if (a.kind !== "fits") continue;
    for (const e of [a.gap, a.distance]) {
      if (!e) continue;
      for (const p of corners) for (const x of [e.eq, e.min, e.max]) {
        const v = num(x, p);
        if (v !== undefined) w = Math.max(w, 2 * Math.abs(v));
      }
    }
  }
  return w;
}

// ---- One evaluated point ------------------------------------------------------------------

/** What the pool returned for one point: the report, the occurrence tree and one gate run per gate group. */
export interface PointRun {
  ok: boolean;
  error?: { code: string; message: string };
  report?: GeometryReport;
  occurrences?: OccurrenceRow[];
  gates?: GateRun[];
  /** Worker milliseconds summed over the point's jobs. */
  ms: number;
}

export interface Margin {
  id: string;
  pass: boolean;
  /**
   * Signed distance to the bound in the assertion's unit (mm, mm3 or a count): positive inside,
   * negative outside. null when the check has no magnitude (status, valid, watertight, a
   * passing overhang), so only pass or fail is known.
   */
  signed: number | null;
  /** max(slack, 1e-3 x |bound|, 0.01) in the same unit; 1 for counts. */
  scale: number;
  /** The margin is a lower bound: nothing was seen within the fit watch distance. */
  censored?: true;
  /** The run failed, so the assertion was not evaluated (it counts as a builds failure only). */
  skipped?: true;
  detail: string;
}

const FAIL_WALL_MM = 0.8 + 0.04; // fdm.v1 min_wall limit plus the guard band (gates.ts WALL_BAND_MM)
const OVERHANG_FAIL_DEG = 45 - 1; // overhang limit minus the angle band (gates.ts ANGLE_BAND_DEG)

const scaleOf = (bound: number, s: number) => Math.max(s, 1e-3 * Math.abs(bound), 0.01);

/** Signed margin of a value against a resolved expect, with the scale. Pass is bench meets(). */
function expectMargin(v: number, e: Expect, unitScale?: number): { signed: number; scale: number } {
  if (e.eq !== undefined) {
    const s = slack(e.eq, e.tol);
    return { signed: s - Math.abs(v - e.eq), scale: unitScale ?? scaleOf(e.eq, s) };
  }
  let signed = Infinity;
  let scale = unitScale ?? 0.01;
  if (e.min !== undefined) {
    const s = slack(e.min, e.tol);
    signed = Math.min(signed, v - (e.min - s));
    scale = unitScale ?? Math.max(scale, scaleOf(e.min, s));
  }
  if (e.max !== undefined) {
    const s = slack(e.max, e.tol);
    signed = Math.min(signed, e.max + s - v);
    scale = unitScale ?? Math.max(scale, scaleOf(e.max, s));
  }
  return { signed, scale };
}

/** The quantity a measure assertion reads, mirroring bench/lib.ts measureOf (which is not exported). */
function measureValue(report: GeometryReport, q: string, target: string): number | undefined {
  let parts = report.parts;
  let box = report.assembly.bbox;
  if (target !== "assembly") {
    const re = glob(target);
    parts = report.parts.filter((p) => re.test(p.def));
    if (parts.length === 0) return undefined;
    box = { min: [0, 1, 2].map((i) => Math.min(...parts.map((p) => p.bbox.min[i]!))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.bbox.max[i]!))) as Vec3 };
  } else if (q === "mass_g" && report.assembly.mass_g !== undefined) return report.assembly.mass_g;
  const sum = (f: (p: GeometryReport["parts"][number]) => number | undefined) => parts.reduce((s, p) => s + (f(p) ?? NaN) * (p.occurrences ?? 1), 0);
  if (q === "volume_mm3") return sum((p) => p.volume_mm3);
  if (q === "area_mm2") return sum((p) => p.area_mm2);
  if (q === "mass_g") return sum((p) => p.mass_g);
  if (!box) return undefined;
  const sizes = [0, 1, 2].map((i) => box.max[i]! - box.min[i]!);
  if (q === "size_max" || q === "size_mid" || q === "size_min") {
    const s = [...sizes].sort((x, y) => y - x);
    return s[q === "size_max" ? 0 : q === "size_mid" ? 1 : 2];
  }
  const axis = { x: 0, y: 1, z: 2 }[q.slice(-1) as "x" | "y" | "z"];
  if (q.startsWith("size")) return sizes[axis];
  return q.startsWith("min") ? box.min[axis] : box.max[axis];
}

function countValue(report: GeometryReport, q: string, target: string | undefined): number | undefined {
  if (q === "occurrences") return report.assembly.occurrences;
  if (q === "definitions") return report.assembly.definitions;
  const re = glob(target ?? "*");
  const parts = report.parts.filter((p) => re.test(p.def));
  if (parts.length === 0) return undefined;
  return parts.reduce((s, p) => s + ((p.counts as Record<string, number> | undefined)?.[q] ?? NaN), 0);
}

function pairMatcher(a?: string, b?: string) {
  const ra = glob(a ?? "*"), rb = glob(b ?? "*");
  return (f: FitReport) => (ra.test(f.a) && rb.test(f.b)) || (ra.test(f.b) && rb.test(f.a));
}

function fitsMargin(a: Extract<Assertion, { kind: "fits" }>, report: GeometryReport, pass: boolean, watch: number): Omit<Margin, "id" | "pass" | "detail"> {
  const matches = pairMatcher(a.a, a.b);
  if (a.gap) {
    const lines = report.fits.filter((f) => f.kind === "clearance" && matches(f) && f.distance_mm !== undefined);
    const gapScale = Math.max(...[a.gap.eq, a.gap.min, a.gap.max].filter((x): x is number => x !== undefined).map((x) => scaleOf(x, slack(x, a.gap!.tol))), 0.01);
    // No line within the watch distance: censored, never a measured pass or fail.
    if (lines.length === 0) return { signed: pass ? watch : null, scale: gapScale, censored: true };
    const ms = lines.map((f) => expectMargin(f.distance_mm!, a.gap!).signed);
    const inside = ms.filter((m) => m >= 0);
    if (pass) return { signed: inside.length > 0 ? Math.min(...inside) : null, scale: gapScale };
    // A failing gap assertion: the line nearest to the band says how far out it is.
    const best = Math.max(...ms);
    return { signed: best < 0 ? best : null, scale: gapScale };
  }
  if (a.distance) {
    const lines = report.fits.filter((f) => matches(f) && (a.fit === "any" || f.kind === a.fit) && f.distance_mm !== undefined);
    if (lines.length === 0) return { signed: null, scale: 0.01 };
    const ms = lines.map((f) => expectMargin(f.distance_mm!, a.distance!));
    const worst = ms.reduce((x, y) => (y.signed < x.signed ? y : x));
    if (pass !== worst.signed >= 0) return { signed: null, scale: worst.scale };
    return { signed: worst.signed, scale: worst.scale };
  }
  if (a.fit === "clash" && a.expect.eq === 0 && a.expect.min === undefined) {
    // No clash: the margin is the closest approach of the matching pairs (0 at contact) or, on
    // a clash, minus the cube root of the largest clash volume.
    const pairs = report.fits.filter((f) => matches(f) && !f.extra);
    const clashes = pairs.filter((f) => f.kind === "clash");
    if (clashes.length > 0) return { signed: -Math.cbrt(Math.max(...clashes.map((f) => f.volume_mm3 ?? 0), 1e-9)), scale: 0.01 };
    const d = pairs.map((f) => f.distance_mm ?? 0);
    if (d.length === 0) return { signed: watch, scale: 0.01, censored: true };
    return { signed: Math.min(...d), scale: 0.01 };
  }
  return { signed: null, scale: 1 };
}

function gateMargin(a: Extract<BriefAssertion, { kind: "gate" }>, gates: GateRun[]): Omit<Margin, "id" | "skipped"> {
  const re = glob(a.target);
  const parts = gates.flatMap((g) => g.parts).filter((p) => re.test(p.def));
  if (parts.length === 0) return { pass: false, signed: null, scale: 1, detail: `no gate run for "${a.target}"` };
  const pass = parts.every((p) => p.pass.includes(a.gate));
  const fails = parts.flatMap((p) => p.fail.filter((f) => f.gate === a.gate).map((f) => ({ def: p.def, f })));
  const where = fails.map(({ def, f }) => `${def}${f.at ? ` ${f.at}` : ""}${f.value !== undefined ? ` ${f.value}` : ""}`).join(", ");
  if (a.gate === "min_wall") {
    const walls = parts.map((p) => p.wall.min_mm);
    if (walls.some((w) => w === undefined)) return { pass, signed: null, scale: 0.04, detail: `min_wall not measured on ${parts.filter((p) => p.wall.min_mm === undefined).map((p) => p.def).join(", ")}` };
    const w = Math.min(...(walls as number[]));
    return { pass, signed: w - FAIL_WALL_MM, scale: 0.04, detail: `thinnest wall ${w} mm${where ? ` (fails: ${where})` : ""}` };
  }
  if (a.gate === "overhang") {
    if (pass) return { pass, signed: null, scale: 1, detail: "overhang passes" };
    const v = Math.max(...fails.map(({ f }) => f.value ?? 90));
    return { pass, signed: OVERHANG_FAIL_DEG - v, scale: 1, detail: `overhang ${v} degrees (${where})` };
  }
  if (a.gate === "bed") {
    if (pass) return { pass, signed: null, scale: 1, detail: "fits the bed" };
    const over = Math.max(...fails.map(({ f }) => (f.value ?? 0) - (f.limit ?? 0)));
    return { pass, signed: -over, scale: 1, detail: `bed exceeded by ${over} mm (${where})` };
  }
  return { pass, signed: null, scale: 1, detail: pass ? `${a.gate} passes` : `${a.gate} fails (${fails.map(({ def, f }) => `${def}: ${f.note ?? ""}`).join("; ")})` };
}

export interface Evaluation {
  margins: Margin[];
  /** Assertions whose margin sign disagrees with bench evaluate (must stay empty). */
  disagreements: string[];
}

/** Evaluate every assertion of a brief at one point. */
export function evaluatePoint(brief: Brief, params: Record<string, ParamValue>, run: PointRun, watch: number): Evaluation {
  const margins: Margin[] = [];
  const disagreements: string[] = [];
  for (const a of brief.assertions) {
    if (a.kind === "builds") {
      margins.push({ id: a.id, pass: run.ok, signed: null, scale: 1, detail: run.ok ? "built" : `${run.error?.code}: ${run.error?.message}` });
      continue;
    }
    if (!run.ok || !run.report) {
      margins.push({ id: a.id, pass: false, signed: null, scale: 1, skipped: true, detail: "not evaluated: the run failed" });
      continue;
    }
    if (a.kind === "gate") {
      margins.push({ id: a.id, ...gateMargin(a, run.gates ?? []) });
      continue;
    }
    const bench = toBench(a, params)!;
    const outcome: Outcome = { report: run.report, occurrences: run.occurrences ?? [] };
    const r = evaluate(bench, outcome);
    let m: Omit<Margin, "id" | "pass" | "detail"> = { signed: null, scale: 1 };
    if (bench.kind === "measure") {
      const v = measureValue(run.report, bench.quantity, bench.target);
      if (v !== undefined && Number.isFinite(v)) m = expectMargin(v, bench.expect);
    } else if (bench.kind === "count") {
      const v = countValue(run.report, bench.quantity, bench.target);
      if (v !== undefined && Number.isFinite(v)) m = expectMargin(v, bench.expect, 1);
    } else if (bench.kind === "occurrences") {
      const rn = glob(bench.name), rd = glob(bench.def ?? "*");
      m = expectMargin(outcome.occurrences.filter((x) => rn.test(x.path) && rd.test(x.def)).length, bench.expect, 1);
    } else if (bench.kind === "fits") {
      m = fitsMargin(bench, run.report, r.pass, watch);
    }
    if (m.signed !== null && !m.censored && (m.signed >= 0) !== r.pass) disagreements.push(`${a.id}: evaluate says ${r.pass ? "pass" : "fail"}, margin ${m.signed}`);
    margins.push({ id: a.id, pass: r.pass, ...m, detail: r.detail });
  }
  return { margins, disagreements };
}

// ---- Hashes ---------------------------------------------------------------------------------

/** JSON with object keys sorted at every level, so equal content gives equal text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The hash of what a point produced: the report without rev and compute, the gate runs without notes, or the error. */
export function reportHash(run: PointRun): string {
  if (!run.ok || !run.report) return sha256(canonical({ error: run.error?.code ?? "unknown" }));
  const { rev: _rev, compute: _compute, ...report } = run.report;
  const gates = (run.gates ?? []).map(({ notes: _notes, ...g }) => g);
  return sha256(canonical({ report, gates, occurrences: run.occurrences ?? [] }));
}

/** What the event guard compares between neighbouring points: counts, fit set and gate verdicts per definition. */
export function signature(run: PointRun): string {
  if (!run.ok || !run.report) return `error:${run.error?.code ?? "unknown"}`;
  const counts = run.report.parts.map((p) => `${p.def}:${p.counts?.solids}/${p.counts?.faces}/${p.counts?.edges}`).sort();
  const fits = run.report.fits.map((f) => `${f.a}|${f.b}|${f.kind}${f.extra ? "|extra" : ""}`).sort();
  const gates = (run.gates ?? []).flatMap((g) => g.parts.map((p) => `${p.def}:${[...p.pass].sort().join("+")}`)).sort();
  return canonical({ status: run.report.status, counts, fits, gates });
}
