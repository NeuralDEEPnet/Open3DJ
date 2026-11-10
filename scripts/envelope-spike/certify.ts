// Certified Envelopes spike: run the search of search.ts on the compute pool for one brief,
// and write or replay its certificate. The evaluator sends ordinary run jobs (point.ts),
// scores them with bench assertions (brief.ts) and keeps every result in index order. The
// certificate body holds no time stamps and no timings: those go next to it, so two runs of
// one brief on one platform give the same certificate hash when the kernel is deterministic.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lane, Pool } from "@open3dj/compute";
import { ANALYSIS_VERSION } from "@open3dj/schemas";
import type { ParamValue } from "@open3dj/schemas";
import { ROOT } from "../../bench/lib.ts";
import { canonical, evaluatePoint, reportHash, sha256, signature, watchDistance } from "./brief.ts";
import type { LoadedBrief, Margin, PointRun } from "./brief.ts";
import { boxCorners } from "./lint-corpus.ts";
import { runPoint } from "./point.ts";
import { axesOf, guardEvents, search, uniformPoints } from "./search.ts";
import type { GuardEvent, P, Phase, Scored, SearchResult } from "./search.ts";

export const CERT_FORMAT = "o3dj-envelope-cert/spike-0";

export interface PointRecord {
  index: number;
  phase: Phase;
  params: P;
  ok: boolean;
  error?: string;
  report_hash: string;
  signature_hash: string;
  /** shape_hash of each gated part definition. */
  shape_hash?: Record<string, string>;
  failing: string[];
  /** Failing assertions that pass at nominal. */
  fresh: string[];
  margins: Array<Pick<Margin, "id" | "pass" | "signed" | "scale"> & { censored?: true; detail?: string }>;
}

export interface Certificate {
  certificate: typeof CERT_FORMAT;
  brief: string;
  brief_hash: string;
  script_hash: string;
  inputs_hash: string;
  engine: { occt_wasm: string; node: string; analysis: string };
  platform: string;
  seed: number;
  budget: number;
  watch_mm: number;
  verdict: "counterexample" | "holds";
  /** The wording the spike promises: never 'for all values'. */
  statement: string;
  nominal_failures: string[];
  counterexamples: number[];
  shrunk?: number;
  compass_on?: string;
  line?: SearchResult["line"];
  events: GuardEvent[];
  smallest_margins: Array<{ id: string; signed: number | null; scale: number; normalized: number | null; at: number; censored?: true }>;
  coverage: Record<string, unknown>;
  limits: string[];
  points: PointRecord[];
}

export interface Timing {
  wall_ms: number;
  worker_ms: number;
  points: number;
}

export function enginePins() {
  const occt = JSON.parse(readFileSync(join(ROOT, "node_modules", "occt-wasm", "package.json"), "utf8")) as { version: string };
  return { occt_wasm: occt.version, node: process.version, analysis: String(ANALYSIS_VERSION) };
}

export const platform = () => `${process.platform}-${process.arch}`;

export interface EvalOptions {
  lane?: Lane;
  freshKernel?: boolean;
}

/** Score one finished run: the evaluator's view and the certificate's record. */
export function score(lb: LoadedBrief, params: P, run: PointRun, watch: number): { scored: Scored; record: Omit<PointRecord, "index" | "phase" | "fresh"> } {
  let margins: Margin[];
  try {
    margins = evaluatePoint(lb.brief, params, run, watch).margins;
  } catch (e) {
    margins = [{ id: "builds", pass: false, signed: null, scale: 1, detail: `brief: ${(e as Error).message}` }];
  }
  const failing = margins.filter((m) => !m.pass).map((m) => m.id);
  const scored: Scored = {
    failing,
    margins: Object.fromEntries(margins.map((m) => [m.id, m.signed === null || m.skipped ? null : m.signed / m.scale])),
    signature: signature(run),
  };
  const shapes = (run.gates ?? []).flatMap((g) => g.parts.map((p) => [p.def, p.shape_hash] as const));
  const record = {
    params,
    ok: run.ok,
    ...(run.ok ? {} : { error: run.error?.code ?? "unknown" }),
    report_hash: reportHash(run),
    signature_hash: sha256(scored.signature),
    ...(shapes.length ? { shape_hash: Object.fromEntries(shapes) } : {}),
    failing,
    margins: margins.map((m) => ({ id: m.id, pass: m.pass, signed: m.signed, scale: m.scale, ...(m.censored ? { censored: true as const } : {}), ...(m.pass ? {} : { detail: m.detail }) })),
  };
  return { scored, record };
}

/** Run one point on the pool and score it. */
export async function evalPoint(pool: Pool, lb: LoadedBrief, params: P, watch: number, o: EvalOptions = {}) {
  const run = await runPoint(pool, lb.brief, lb.script, params as Record<string, ParamValue>, { watch, ...(o.lane ? { lane: o.lane } : {}), ...(o.freshKernel ? { freshKernel: true } : {}) });
  return { run, ...score(lb, params, run, watch) };
}

export const watchOf = (lb: LoadedBrief) => watchDistance(lb.brief, boxCorners(lb));

const LIMITS = [
  "Sampling is not proof: the brief was checked at the points listed under this model, never for all values. A thin band can hide between samples.",
  "The gates are fdm.v1 rule checks on the kernel's geometry (watertight, 0.8 mm min_wall from rays, 45 degree overhang, bed), never a print simulation.",
  "Fits are exact OCCT clash, contact and clearance checks within the fit watch distance; a pair with no line inside it is censored, not a measured pass.",
  "Bit-identical replay is only claimed for the platform named here.",
];

export async function certify(pool: Pool, lb: LoadedBrief, o: { budget: number; seed: number; lane?: Lane }): Promise<{ cert: Certificate; timing: Timing }> {
  const watch = watchOf(lb);
  const records: Array<Omit<PointRecord, "index" | "phase" | "fresh">> = [];
  let workerMs = 0;
  const t0 = performance.now();
  const r = await search(lb.brief.params, async (points) => {
    const out = await Promise.all(points.map((p) => evalPoint(pool, lb, p, watch, { ...(o.lane ? { lane: o.lane } : {}) })));
    for (const x of out) {
      records.push(x.record);
      workerMs += x.run.ms;
    }
    return out.map((x) => x.scored);
  }, { budget: o.budget, seed: o.seed });
  const wall = performance.now() - t0;
  const points: PointRecord[] = r.visits.map((v, i) => ({ index: v.index, phase: v.phase, fresh: v.fresh, ...records[i]! }));
  const cert = buildCertificate(lb, r, points, { seed: o.seed, budget: o.budget, watch });
  return { cert, timing: { wall_ms: Math.round(wall), worker_ms: Math.round(workerMs), points: points.length } };
}

export function buildCertificate(lb: LoadedBrief, r: SearchResult, points: PointRecord[], o: { seed: number; budget: number; watch: number }): Certificate {
  const engine = enginePins();
  const counterexamples = points.filter((p) => p.fresh.length > 0).map((p) => p.index);
  const ids = [...new Set(points.flatMap((p) => p.margins.map((m) => m.id)))];
  // Per assertion: a failing point ranks before a passing one; then the smaller normalized
  // margin (an unknown magnitude counts as -infinity when failing, +infinity when passing);
  // then the lower index.
  const smallest = ids.filter((id) => !r.nominalFailures.includes(id)).flatMap((id) => {
    let best: { rank: [number, number]; row: Certificate["smallest_margins"][number] } | undefined;
    for (const p of points) {
      const m = p.margins.find((x) => x.id === id);
      if (!m) continue;
      const norm = m.signed === null ? null : m.signed / m.scale;
      const rank: [number, number] = [m.pass ? 1 : 0, norm ?? (m.pass ? Infinity : -Infinity)];
      if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) {
        best = { rank, row: { id, signed: m.signed, scale: m.scale, normalized: norm, at: p.index, ...(m.censored ? { censored: true as const } : {}) } };
      }
    }
    return best ? [best.row] : [];
  });
  const axes = axesOf(lb.brief.params);
  const phases: Record<string, number> = {};
  for (const p of points) phases[p.phase] = (phases[p.phase] ?? 0) + 1;
  const coverage = {
    points: points.length,
    phases,
    corners_planned: r.planned.corners,
    special_planned: r.planned.special,
    axes: axes.map((a) => ({
      name: a.name,
      ...(a.discrete ? { values_seen: [...new Set(points.map((p) => p.params[a.name]))].length, values: a.values.length } : { min_seen: Math.min(...points.map((p) => p.params[a.name] as number)), max_seen: Math.max(...points.map((p) => p.params[a.name] as number)), min: a.min, max: a.max }),
    })),
  };
  const n = points.length;
  const verdict = counterexamples.length > 0 ? "counterexample" : "holds";
  const statement = verdict === "holds"
    ? `holds at ${n} points under this model${r.nominalFailures.length ? ` (apart from ${r.nominalFailures.length} nominal failure(s))` : ""}`
    : `counterexample: ${counterexamples.length} of ${n} points fail an assertion that passes at nominal`;
  const inputs = { brief_hash: lb.briefHash, script_hash: lb.scriptHash, engine, platform: platform(), seed: o.seed, budget: o.budget, watch_mm: o.watch };
  return {
    certificate: CERT_FORMAT,
    brief: lb.brief.id,
    brief_hash: lb.briefHash,
    script_hash: lb.scriptHash,
    inputs_hash: sha256(canonical(inputs)),
    engine,
    platform: platform(),
    seed: o.seed,
    budget: o.budget,
    watch_mm: o.watch,
    verdict,
    statement,
    nominal_failures: r.nominalFailures,
    counterexamples,
    ...(r.shrunk !== undefined ? { shrunk: r.shrunk } : {}),
    ...(r.compassOn ? { compass_on: r.compassOn } : {}),
    ...(r.line ? { line: r.line } : {}),
    events: guardEvents(r),
    smallest_margins: smallest,
    coverage,
    limits: [...LIMITS, `Fit watch distance ${o.watch} mm.`],
    points,
  };
}

/** The certificate's own hash: sha256 of its canonical JSON. */
export const certHash = (c: Certificate) => sha256(canonical(c));

export interface Verification {
  brief: string;
  cert_hash: string;
  platform: string;
  same_platform: boolean;
  inputs_match: boolean;
  points: number;
  identical: number;
  differing: Array<{ index: number; params: P; before: string; after: string; signature_same: boolean; failing_before: string[]; failing_after: string[] }>;
  counterexamples: Array<{ index: number; params: P; fresh_before: string[]; failing_after: string[]; fails_again: boolean; same_failures: boolean }>;
  wall_ms: number;
}

/** Re-run every point of a certificate on fresh kernels and compare. */
export async function verify(pool: Pool, cert: Certificate, lb: LoadedBrief, o: { lane?: Lane } = {}): Promise<Verification> {
  const t0 = performance.now();
  const inputsMatch = lb.briefHash === cert.brief_hash && lb.scriptHash === cert.script_hash;
  const again = await Promise.all(cert.points.map((p) => evalPoint(pool, lb, p.params, cert.watch_mm, { freshKernel: true, ...(o.lane ? { lane: o.lane } : {}) })));
  const differing: Verification["differing"] = [];
  const cxs: Verification["counterexamples"] = [];
  cert.points.forEach((p, i) => {
    const a = again[i]!.record;
    if (a.report_hash !== p.report_hash) {
      differing.push({ index: p.index, params: p.params, before: p.report_hash, after: a.report_hash, signature_same: a.signature_hash === p.signature_hash, failing_before: p.failing, failing_after: a.failing });
    }
    if (p.fresh.length > 0) {
      cxs.push({ index: p.index, params: p.params, fresh_before: p.fresh, failing_after: a.failing, fails_again: p.fresh.some((id) => a.failing.includes(id)), same_failures: canonical([...p.failing].sort()) === canonical([...a.failing].sort()) });
    }
  });
  return {
    brief: cert.brief,
    cert_hash: certHash(cert),
    platform: platform(),
    same_platform: platform() === cert.platform,
    inputs_match: inputsMatch,
    points: cert.points.length,
    identical: cert.points.length - differing.length,
    differing,
    counterexamples: cxs,
    wall_ms: Math.round(performance.now() - t0),
  };
}

export interface RandomRun {
  brief: string;
  seed: number;
  budget: number;
  nominal_failures: string[];
  points: Array<{ params: P; failing: string[]; fresh: string[] }>;
}

/** The baseline: n uniform random points, nominal failures taken from a separate nominal run. */
export async function randomRun(pool: Pool, lb: LoadedBrief, o: { budget: number; seed: number; lane?: Lane; nominalFailures: string[] }): Promise<RandomRun> {
  const watch = watchOf(lb);
  const axes = axesOf(lb.brief.params);
  const pts = uniformPoints(axes, o.budget, o.seed);
  const out = await Promise.all(pts.map((p) => evalPoint(pool, lb, p, watch, { ...(o.lane ? { lane: o.lane } : {}) })));
  return {
    brief: lb.brief.id,
    seed: o.seed,
    budget: o.budget,
    nominal_failures: o.nominalFailures,
    points: out.map((x, i) => ({ params: pts[i]!, failing: x.scored.failing, fresh: x.scored.failing.filter((id) => !o.nominalFailures.includes(id)) })),
  };
}
