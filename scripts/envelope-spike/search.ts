// Certified Envelopes spike: the search over a brief's declared parameter box. Pure: it loads
// no kernel and never runs a script itself. It asks an evaluator for batches of points and
// keeps every result in index order, so the order in which a pool finishes jobs cannot change
// the trace. Phases, in order, within one budget:
//   nominal  the default values (assertions that fail here are nominal failures, not targets)
//   corner   every numeric axis at min or max (pairwise covering above 8 axes), crossed with
//            every value of the choice, bool and small integer axes, in an order that covers
//            each corner and each value early, capped at 3/8 of the budget
//   special  each axis alone at its ends, 0 inside a range, the step grid, each discrete value
//   halton   a seeded (rotated, leaped) Halton sequence over the whole box, up to 3/4 of the budget
//   compass  no counterexample yet: compass search on the assertion with the smallest margin,
//            among those whose margin varies between the points seen (an equality has no slope)
//   shrink   a counterexample: move axes back to nominal while it still fails (QuickCheck style)
//   bisect   then multisection between it and nominal down to max(step, 0.01) on every axis
//   halton   whatever budget is left: further points of the same Halton sequence
// The random baseline uses the same evaluator with uniform points (phase random).
import type { ParamValue } from "@open3dj/schemas";
import type { ParamDecl } from "./brief.ts";

export type P = Record<string, ParamValue>;
export type Phase = "nominal" | "corner" | "special" | "halton" | "compass" | "shrink" | "bisect" | "random";

export interface Axis {
  name: string;
  /** Enumerated: bool, choice, or an integer with 32 or fewer values. */
  discrete: boolean;
  /** Values are rounded to whole numbers (a large integer range searched as a continuous axis). */
  integer: boolean;
  min: number;
  max: number;
  step?: number;
  values: ParamValue[];
  nominal: ParamValue;
}

/** What the evaluator returns for one point. */
export interface Scored {
  /** Ids of the assertions that fail here. */
  failing: string[];
  /** Normalized signed margin (signed / scale) per assertion id; null when only pass or fail is known. */
  margins: Record<string, number | null>;
  /** The event guard's signature: counts, fit set, gate verdicts, status or the error code. */
  signature: string;
}

export interface Visit extends Scored {
  index: number;
  phase: Phase;
  params: P;
  /** Failing assertions that pass at nominal: non-empty means a counterexample. */
  fresh: string[];
}

export type Evaluator = (points: P[]) => Promise<Scored[]>;

export const MAX_ENUMERATED = 32;

export function axesOf(params: ParamDecl[]): Axis[] {
  return params.map((d) => {
    if (d.type === "bool") return { name: d.name, discrete: true, integer: false, min: 0, max: 1, values: [false, true], nominal: d.default };
    if (d.type === "choice") return { name: d.name, discrete: true, integer: false, min: 0, max: d.options!.length - 1, values: d.options!, nominal: d.default };
    const integer = d.integer === true;
    const count = integer ? d.max! - d.min! + 1 : Infinity;
    const values = count <= MAX_ENUMERATED ? Array.from({ length: count }, (_, i) => d.min! + i) : [];
    return { name: d.name, discrete: values.length > 0, integer, min: d.min!, max: d.max!, ...(d.step ? { step: d.step } : {}), values, nominal: d.default };
  });
}

const tidy = (x: number) => Number(x.toFixed(6)) + 0;

/** A continuous axis value clamped to the box and rounded (whole numbers on integer axes). */
export function clampAxis(a: Axis, x: number): number {
  const v = Math.min(a.max, Math.max(a.min, x));
  return a.integer ? Math.round(v) : tidy(v);
}

/** Stable text key of a point, in axis order. */
export function keyOf(axes: Axis[], p: P): string {
  return JSON.stringify(axes.map((a) => p[a.name]));
}

export const nominalOf = (axes: Axis[]): P => Object.fromEntries(axes.map((a) => [a.name, a.nominal]));

/** Resolution of an axis for bisection and compass: max(step, 0.01), or 1 on an integer axis. */
export const resolution = (a: Axis) => (a.integer ? 1 : Math.max(a.step ?? 0, 0.01));

// ---- Seeded sequences ---------------------------------------------------------------------

/** mulberry32: a small seeded generator, enough for reproducible sampling. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

export function radicalInverse(i: number, base: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Map a unit coordinate onto an axis: uniform over a continuous range, or over the values. */
export function fromUnit(a: Axis, u: number): ParamValue {
  if (a.discrete) return a.values[Math.min(a.values.length - 1, Math.floor(u * a.values.length))]!;
  if (a.integer) return Math.min(a.max, a.min + Math.floor(u * (a.max - a.min + 1)));
  return tidy(a.min + u * (a.max - a.min));
}

/** n points of a Halton sequence rotated (Cranley-Patterson) and leaped by the seed. */
export function haltonPoints(axes: Axis[], n: number, seed: number, from = 0): P[] {
  const rnd = prng(seed * 7919 + 17);
  const shift = axes.map(() => rnd());
  const start = 1 + (seed % 1000) * 31;
  const out: P[] = [];
  for (let k = from; k < from + n; k++) {
    out.push(Object.fromEntries(axes.map((a, d) => [a.name, fromUnit(a, (radicalInverse(start + k, PRIMES[d % PRIMES.length]!) + shift[d]!) % 1)])));
  }
  return out;
}

/** n uniform random points over the box (the baseline). */
export function uniformPoints(axes: Axis[], n: number, seed: number): P[] {
  const rnd = prng(seed);
  return Array.from({ length: n }, () => Object.fromEntries(axes.map((a) => [a.name, fromUnit(a, rnd())])));
}

// ---- Structured point sets ----------------------------------------------------------------

/**
 * Binary corner rows over k axes (true = max). k <= 8: all 2^k rows, each followed by its
 * complement, all-min first. Above 8: a strength-2 covering array (every pair of axes sees all
 * four min/max combinations) built from columns of equal weight, plus all-min and all-max.
 */
export function cornerRows(k: number): boolean[][] {
  if (k === 0) return [[]];
  if (k <= 8) {
    const rows: boolean[][] = [];
    for (let m = 0; m < 1 << (k - 1); m++) {
      const row = Array.from({ length: k }, (_, i) => ((m >> i) & 1) === 1);
      rows.push(row, row.map((b) => !b));
    }
    return rows;
  }
  for (let n = 4; ; n++) {
    const w = Math.ceil(n / 2);
    const cols: boolean[][] = [];
    const walk = (prefix: boolean[], ones: number) => {
      if (cols.length >= k) return;
      if (prefix.length === n) {
        if (ones === w) cols.push(prefix);
        return;
      }
      walk([...prefix, false], ones);
      if (ones < w && prefix.length > 0) walk([...prefix, true], ones + 1);
    };
    walk([], 0);
    if (cols.length >= k) {
      const rows = Array.from({ length: n }, (_, r) => cols.map((c) => c[r]!));
      return [Array(k).fill(false), Array(k).fill(true), ...rows];
    }
  }
}

/** Cap on the product of discrete values that the corner phase crosses with the corners. */
const MAX_COMBOS = 4096;

/**
 * Discrete combinations: first a diagonal pass (combination k takes value k mod n on every
 * axis), so every value of every axis appears within max(n) combinations; then the rest of the
 * product in lexicographic order, up to MAX_COMBOS.
 */
export function discreteCombos(axes: Axis[]): P[] {
  if (axes.length === 0) return [{}];
  const longest = Math.max(...axes.map((a) => a.values.length));
  const out: P[] = [];
  const seen = new Set<string>();
  const push = (p: P) => {
    const k = JSON.stringify(axes.map((a) => p[a.name]));
    if (seen.has(k) || out.length >= MAX_COMBOS) return;
    seen.add(k);
    out.push(p);
  };
  for (let k = 0; k < longest; k++) push(Object.fromEntries(axes.map((a) => [a.name, a.values[k % a.values.length]!])));
  let prod: P[] = [{}];
  for (const a of axes) {
    if (prod.length * a.values.length > MAX_COMBOS) break;
    prod = prod.flatMap((p) => a.values.map((v) => ({ ...p, [a.name]: v })));
  }
  if (Object.keys(prod[0]!).length === axes.length) for (const p of prod) push(p);
  return out;
}

/**
 * Corner points crossed with discrete combinations, ordered in rounds so that the first
 * max(corners, combos) points already hold every corner and every combination.
 */
export function cornerPoints(axes: Axis[]): P[] {
  const cont = axes.filter((a) => !a.discrete);
  const disc = axes.filter((a) => a.discrete);
  const corners = cornerRows(cont.length).map((row) => Object.fromEntries(cont.map((a, i) => [a.name, row[i] ? a.max : a.min])) as P);
  const combos = discreteCombos(disc);
  const nominal = nominalOf(axes);
  const big = corners.length >= combos.length ? corners : combos;
  const small = big === corners ? combos : corners;
  const out: P[] = [];
  for (let r = 0; r < small.length; r++) {
    for (let j = 0; j < big.length; j++) out.push({ ...nominal, ...big[j], ...small[(j + r) % small.length] });
  }
  return out;
}

/** Each axis alone away from nominal: its ends, 0 inside the range, its step grid, each discrete value. */
export function specialPoints(axes: Axis[]): P[] {
  const nominal = nominalOf(axes);
  const ends: P[] = [], zeros: P[] = [], grid: P[] = [], values: P[] = [];
  for (const a of axes) {
    if (a.discrete) {
      for (const v of a.values) if (v !== a.nominal) values.push({ ...nominal, [a.name]: v });
      continue;
    }
    ends.push({ ...nominal, [a.name]: a.min }, { ...nominal, [a.name]: a.max });
    if (a.min < 0 && a.max > 0) zeros.push({ ...nominal, [a.name]: 0 });
    if (a.step) for (let x = a.min + a.step; x < a.max && grid.length < 64; x += a.step) grid.push({ ...nominal, [a.name]: clampAxis(a, x) });
  }
  return [...zeros, ...ends, ...values, ...grid];
}

// ---- The search -------------------------------------------------------------------------------

export interface SearchOptions {
  budget: number;
  seed: number;
}

export interface SearchResult {
  axes: Axis[];
  visits: Visit[];
  nominalFailures: string[];
  /** The assertion the compass search followed, when it ran. */
  compassOn?: string;
  /** The shrunk counterexample, when there is one. */
  shrunk?: number;
  /** The bisection line: the passing end, the failing end and the points on it, by t. */
  line?: { pass: number; fail: number; lo: number; hi: number; points: Array<{ index: number; t: number }> };
  /** Planned sizes of the structured sets before capping. */
  planned: { corners: number; special: number };
}

export async function search(params: ParamDecl[], evaluate: Evaluator, o: SearchOptions): Promise<SearchResult> {
  const axes = axesOf(params);
  const visits: Visit[] = [];
  const seen = new Map<string, number>();
  let nominalFailures: string[] = [];
  const left = () => o.budget - visits.length;

  /** Evaluate the points not seen yet (up to the budget), in order; returns their visits. */
  const run = async (points: P[], phase: Phase): Promise<Visit[]> => {
    const fresh: P[] = [];
    const keys = new Set<string>();
    for (const p of points) {
      const k = keyOf(axes, p);
      if (seen.has(k) || keys.has(k)) continue;
      if (fresh.length >= left()) break;
      keys.add(k);
      fresh.push(p);
    }
    if (fresh.length === 0) return [];
    const scored = await evaluate(fresh);
    const out = fresh.map((p, i) => {
      const s = scored[i]!;
      const v: Visit = { index: visits.length + i, phase, params: p, ...s, fresh: s.failing.filter((id) => !nominalFailures.includes(id)) };
      return v;
    });
    for (const v of out) {
      seen.set(keyOf(axes, v.params), v.index);
      visits.push(v);
    }
    return out;
  };
  const counterexample = () => visits.find((v) => v.fresh.length > 0);

  // nominal
  const nominal = nominalOf(axes);
  const [nom] = await run([nominal], "nominal");
  nominalFailures = nom ? [...nom.failing] : [];
  if (nom) nom.fresh = [];

  // corner, special, halton
  const corners = cornerPoints(axes);
  await run(corners.slice(0, Math.floor((o.budget * 3) / 8)), "corner");
  const special = specialPoints(axes);
  await run(special.slice(0, Math.max(0, Math.floor(o.budget / 8))), "special");
  const haltonEnd = o.budget - Math.max(8, Math.floor(o.budget / 4));
  let from = 0;
  while (visits.length < haltonEnd) {
    const want = haltonEnd - visits.length;
    const got = await run(haltonPoints(axes, want, o.seed, from), "halton");
    from += want;
    if (got.length === 0 && from > 50 * o.budget) break;
  }

  const result: SearchResult = { axes, visits, nominalFailures, planned: { corners: corners.length, special: special.length } };

  // compass search on the assertion with the smallest margin
  if (!counterexample()) {
    const usable = (v: Visit, id: string) => v.margins[id] ?? null;
    // Only an assertion whose margin moves between the points seen so far gives the compass a
    // slope: an equality that holds reads the same margin (often 0) everywhere it passes.
    const spread = new Map<string, [number, number]>();
    for (const v of visits) {
      for (const [id, m] of Object.entries(v.margins)) {
        if (m === null || nominalFailures.includes(id)) continue;
        const [lo, hi] = spread.get(id) ?? [Infinity, -Infinity];
        spread.set(id, [Math.min(lo, m), Math.max(hi, m)]);
      }
    }
    const moving = new Set([...spread].filter(([, [lo, hi]]) => hi - lo > 1e-9).map(([id]) => id));
    let best: { v: Visit; id: string; m: number } | undefined;
    for (const v of visits) {
      for (const [id, m] of Object.entries(v.margins)) {
        if (m === null || !moving.has(id)) continue;
        if (!best || m < best.m) best = { v, id, m };
      }
    }
    if (best) {
      result.compassOn = best.id;
      const cont = axes.filter((a) => !a.discrete || a.integer);
      const step = new Map(cont.map((a) => [a.name, a.discrete ? 1 : 0.25 * (a.max - a.min)]));
      let at = best.v, m = best.m;
      while (left() > 0 && !counterexample()) {
        const probes: P[] = [];
        for (const a of cont) {
          const d = step.get(a.name)!;
          if (d < resolution(a)) continue;
          for (const s of [-1, 1]) {
            const x = at.params[a.name] as number;
            const y = a.discrete ? a.values[Math.max(0, Math.min(a.values.length - 1, a.values.indexOf(x) + s))] as number : clampAxis(a, x + s * d);
            if (y !== x) probes.push({ ...at.params, [a.name]: y });
          }
        }
        if (probes.length === 0) break;
        const got = await run(probes, "compass");
        if (got.length === 0) {
          for (const a of cont) step.set(a.name, a.discrete ? 0 : step.get(a.name)! / 2);
          continue;
        }
        let moved = false;
        for (const g of got) {
          const gm = usable(g, best.id);
          if (gm !== null && gm < m) {
            at = g;
            m = gm;
            moved = true;
          }
        }
        if (!moved) for (const a of cont) step.set(a.name, a.discrete ? 0 : step.get(a.name)! / 2);
      }
    }
  }

  // shrink, then bisect between the shrunk counterexample and nominal
  let cx = counterexample();
  if (cx) {
    const target = cx.fresh;
    const stillFails = (v: Visit) => v.failing.some((id) => target.includes(id));
    const reserve = Math.min(6, Math.max(0, left() - 2));
    for (let round = 0; round < 8 && left() > reserve; round++) {
      const cands: P[] = [];
      for (const a of axes) if (cx.params[a.name] !== nominal[a.name]) cands.push({ ...cx.params, [a.name]: nominal[a.name]! });
      for (const a of axes) {
        if (a.discrete && !a.integer) continue;
        const x = cx.params[a.name] as number, n0 = nominal[a.name] as number;
        if (Math.abs(x - n0) <= resolution(a)) continue;
        const half = a.integer ? Math.round((x + n0) / 2) : clampAxis(a, (x + n0) / 2);
        if (half !== x && half !== n0) cands.push({ ...cx.params, [a.name]: half });
      }
      if (cands.length === 0) break;
      const got = await run(cands.slice(0, left() - reserve), "shrink");
      const ok = got.find(stillFails);
      if (!ok) break;
      cx = ok;
    }
    result.shrunk = cx.index;

    // The passing end: continuous axes at nominal, discrete axes as in the counterexample.
    const lineAxes = axes.filter((a) => !a.discrete && cx!.params[a.name] !== nominal[a.name]);
    const passEnd: P = { ...cx.params, ...Object.fromEntries(lineAxes.map((a) => [a.name, nominal[a.name]!])) };
    let passVisit = visits[seen.get(keyOf(axes, passEnd)) ?? -1];
    if (!passVisit && lineAxes.length > 0 && left() > 0) passVisit = (await run([passEnd], "bisect"))[0];
    if (passVisit && !stillFails(passVisit) && lineAxes.length > 0) {
      const at = (t: number): P => ({ ...cx!.params, ...Object.fromEntries(lineAxes.map((a) => {
        const n0 = nominal[a.name] as number, x = cx!.params[a.name] as number;
        return [a.name, clampAxis(a, n0 + t * (x - n0))];
      })) });
      const line = { pass: passVisit.index, fail: cx.index, lo: 0, hi: 1, points: [{ index: passVisit.index, t: 0 }, { index: cx.index, t: 1 }] };
      let lo = 0, hi = 1;
      const fine = () => lineAxes.every((a) => (hi - lo) * Math.abs((cx!.params[a.name] as number) - (nominal[a.name] as number)) <= resolution(a));
      const onLine = new Set([passVisit.index, cx.index]);
      while (!fine() && left() > 0) {
        const ts = [0.25, 0.5, 0.75].map((f) => lo + f * (hi - lo));
        await run(ts.map(at), "bisect");
        // Points can repeat after rounding; look each one up whether it ran now or before.
        const byT = ts.flatMap((t) => {
          const i = seen.get(keyOf(axes, at(t)));
          return i === undefined ? [] : [{ g: visits[i]!, t }];
        });
        for (const { g, t } of byT) if (!onLine.has(g.index)) onLine.add(g.index), line.points.push({ index: g.index, t });
        const firstFail = byT.filter(({ g }) => stillFails(g)).sort((x, y) => x.t - y.t)[0];
        const lastPass = byT.filter(({ g, t }) => !stillFails(g) && (!firstFail || t < firstFail.t)).sort((x, y) => y.t - x.t)[0];
        const [lo0, hi0] = [lo, hi];
        if (firstFail) hi = firstFail.t;
        if (lastPass) lo = lastPass.t;
        if (lo === lo0 && hi === hi0) break;
      }
      line.points.sort((x, y) => x.t - y.t);
      line.lo = lo;
      line.hi = hi;
      result.line = line;
    }
  }

  // Budget the compass or the bisection did not use goes to further Halton points.
  for (let tries = 0; left() > 0 && tries < 50; tries++) {
    const want = left();
    await run(haltonPoints(axes, want, o.seed, from), "halton");
    from += want;
  }
  return result;
}

// ---- Event guard -------------------------------------------------------------------------------

export interface GuardEvent {
  /** "axis": two points that differ in one parameter only; "line": neighbours on the bisection line. */
  kind: "axis" | "line";
  axis?: string;
  between: [number, number];
  from: P;
  to: P;
  changed: string[];
}

function sigParts(s: string): Record<string, string> {
  if (s.startsWith("error:")) return { build: s };
  const o = JSON.parse(s) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]));
}

/** What differs between two signatures: status, counts, fits, gates or the build itself. */
export function sigDiff(a: string, b: string): string[] {
  const pa = sigParts(a), pb = sigParts(b);
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  return keys.filter((k) => pa[k] !== pb[k]).map((k) => {
    if (k === "build") return pa[k] ? `build ${pa[k]} vs ok` : `build ok vs ${pb[k]}`;
    if (k === "counts" || k === "fits" || k === "gates") {
      const xa = new Set(JSON.parse(pa[k] ?? "[]") as string[]), xb = new Set(JSON.parse(pb[k] ?? "[]") as string[]);
      const gone = [...xa].filter((x) => !xb.has(x)), added = [...xb].filter((x) => !xa.has(x));
      return `${k}: ${gone.join(" ")} -> ${added.join(" ")}`;
    }
    return `${k}: ${pa[k]} -> ${pb[k]}`;
  });
}

/**
 * Topology or fit-set changes between neighbouring points: along each axis among points equal
 * on every other axis, and along the bisection line. Each is reported as an interval.
 */
export function guardEvents(r: SearchResult): GuardEvent[] {
  const out: GuardEvent[] = [];
  const { axes, visits } = r;
  for (const a of axes) {
    const groups = new Map<string, Visit[]>();
    for (const v of visits) {
      const k = JSON.stringify(axes.filter((b) => b !== a).map((b) => v.params[b.name]));
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const order = a.discrete && !a.integer ? (v: Visit) => a.values.indexOf(v.params[a.name]!) : (v: Visit) => v.params[a.name] as number;
      g.sort((x, y) => order(x) - order(y) || x.index - y.index);
      for (let i = 1; i < g.length; i++) {
        if (g[i - 1]!.signature === g[i]!.signature) continue;
        out.push({ kind: "axis", axis: a.name, between: [g[i - 1]!.index, g[i]!.index], from: g[i - 1]!.params, to: g[i]!.params, changed: sigDiff(g[i - 1]!.signature, g[i]!.signature) });
      }
    }
  }
  if (r.line) {
    const pts = r.line.points.map((p) => visits[p.index]!);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1]!.signature === pts[i]!.signature) continue;
      out.push({ kind: "line", between: [pts[i - 1]!.index, pts[i]!.index], from: pts[i - 1]!.params, to: pts[i]!.params, changed: sigDiff(pts[i - 1]!.signature, pts[i]!.signature) });
    }
  }
  return out;
}
