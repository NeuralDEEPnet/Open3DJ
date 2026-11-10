// Certified Envelopes spike (RFC 0002 draft, experiment branch): check a brief across its
// whole declared parameter box on the compute pool, write a certificate, replay it in a fresh
// process, and score the pre-registered seeded corpus against uniform random sampling.
//
//   node scripts/envelope-spike.ts certify <brief.json ...> [--budget 64] [--seed 1] [--workers 4] [--lane batch|interactive] [--out dir] [--jobs 4]
//   node scripts/envelope-spike.ts random  <brief.json ...> [--budget 64] [--seeds 1-10] [--workers 4] [--lane ...] [--out dir]
//   node scripts/envelope-spike.ts verify  <cert.json ...> [--workers 4] [--lane ...] [--out file]
//   node scripts/envelope-spike.ts score   [--results dir]
//
// certify writes <out>/<brief>.cert.json and <out>/timing.json; random writes <out>/<brief>.json;
// verify re-runs every point of each certificate on fresh kernels in this (new) process; score
// reads the results folder and writes summary.json. Nothing here loads the kernel itself: the
// pool's workers do. All output goes to files and stderr.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createPool } from "@open3dj/compute";
import type { Lane, Pool } from "@open3dj/compute";
import { ROOT } from "../bench/lib.ts";
import { loadBrief } from "./envelope-spike/brief.ts";
import type { LoadedBrief } from "./envelope-spike/brief.ts";
import { certHash, certify, platform, randomRun, verify } from "./envelope-spike/certify.ts";
import type { Certificate, RandomRun, Timing, Verification } from "./envelope-spike/certify.ts";
import { REGIONS } from "./envelope-spike/corpus/regions.ts";

export const SPIKE = join(ROOT, "scripts", "envelope-spike");
export const RESULTS = join(SPIKE, "results");

const log = (s: string) => void process.stderr.write(s + "\n");

function flags(argv: string[]) {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) opt[a.slice(2)] = argv[++i] ?? "";
    else pos.push(a);
  }
  return { pos, opt };
}

/** Map with at most n tasks in flight; results in input order. */
async function mapLimit<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]!, i);
    }
  }));
  return out;
}

const writeJson = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(v, null, 1) + "\n");
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;

function seedsOf(s: string | undefined): number[] {
  const m = /^(\d+)-(\d+)$/.exec(s ?? "1-10");
  if (m) return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i);
  return (s ?? "1").split(",").map(Number);
}

function poolFor(opt: Record<string, string>): { pool: Pool; lane: Lane; workers: number } {
  const workers = Number(opt["workers"] ?? 4);
  const lane = (opt["lane"] ?? "batch") as Lane;
  return { pool: createPool({ size: workers, log: () => {}, jobTimeoutMs: 120_000 }), lane, workers };
}

async function cmdCertify(files: string[], opt: Record<string, string>) {
  const budget = Number(opt["budget"] ?? 64), seed = Number(opt["seed"] ?? 1);
  const out = resolve(opt["out"] ?? join(RESULTS, "certs"));
  mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  const { pool, lane, workers } = poolFor(opt);
  const timing: Record<string, Timing & { lane: Lane; workers: number }> = {};
  try {
    await mapLimit(files, Number(opt["jobs"] ?? 4), async (file) => {
      const lb = loadBrief(resolve(file));
      const { cert, timing: t } = await certify(pool, lb, { budget, seed, lane });
      writeJson(join(out, `${cert.brief}.cert.json`), cert);
      timing[cert.brief] = { ...t, lane, workers };
      log(`${cert.brief}: ${cert.statement}; ${t.points} points in ${(t.wall_ms / 1000).toFixed(1)} s`);
    });
  } finally {
    await pool.close();
  }
  const total = Math.round(performance.now() - t0);
  const prev = existsSync(join(out, "timing.json")) ? readJson<Record<string, unknown>>(join(out, "timing.json")) : {};
  writeJson(join(out, "timing.json"), { ...prev, ...timing, _last_command: { files: files.map((f) => basename(f)), wall_ms_including_pool_start: total, lane, workers, budget, seed, platform: platform(), node: process.version } });
}

async function cmdRandom(files: string[], opt: Record<string, string>) {
  const budget = Number(opt["budget"] ?? 64);
  const seeds = seedsOf(opt["seeds"]);
  const out = resolve(opt["out"] ?? join(RESULTS, "random"));
  const certs = resolve(opt["certs"] ?? join(RESULTS, "certs"));
  mkdirSync(out, { recursive: true });
  const { pool, lane } = poolFor(opt);
  try {
    const jobs = files.flatMap((f) => seeds.map((seed) => ({ f, seed })));
    const runs = await mapLimit(jobs, Number(opt["jobs"] ?? 2), async ({ f, seed }) => {
      const lb = loadBrief(resolve(f));
      // The nominal failures come from the guided certificate's nominal point (same inputs).
      const cert = readJson<Certificate>(join(certs, `${lb.brief.id}.cert.json`));
      const r = await randomRun(pool, lb, { budget, seed, lane, nominalFailures: cert.nominal_failures });
      log(`${lb.brief.id} seed ${seed}: ${r.points.filter((p) => p.fresh.length > 0).length} failing points`);
      return r;
    });
    const byBrief = new Map<string, RandomRun[]>();
    for (const r of runs) byBrief.set(r.brief, [...(byBrief.get(r.brief) ?? []), r]);
    for (const [id, rs] of byBrief) writeJson(join(out, `${id}.json`), rs);
  } finally {
    await pool.close();
  }
}

async function cmdVerify(files: string[], opt: Record<string, string>) {
  const { pool, lane } = poolFor(opt);
  const outFile = resolve(opt["out"] ?? join(RESULTS, "verify.json"));
  const results: Verification[] = [];
  try {
    for (const f of files) {
      const cert = readJson<Certificate>(resolve(f));
      const briefFile = [join(SPIKE, "corpus", `${cert.brief}.brief.json`), join(SPIKE, "briefs", `${cert.brief}.brief.json`)].find(existsSync)!;
      const lb: LoadedBrief = loadBrief(briefFile);
      const v = await verify(pool, cert, lb, { lane });
      results.push(v);
      const falseCx = v.counterexamples.filter((c) => !c.fails_again).length;
      log(`${cert.brief}: ${v.identical} of ${v.points} bit-identical; ${v.counterexamples.length - falseCx} of ${v.counterexamples.length} counterexamples fail again`);
    }
  } finally {
    await pool.close();
  }
  writeJson(outFile, { platform: platform(), node: process.version, pid_note: "run in its own process, every point on a fresh kernel", results });
}

// ---- Scoring -----------------------------------------------------------------------------------

function cmdScore(opt: Record<string, string>) {
  const dir = resolve(opt["results"] ?? RESULTS);
  const certsDir = join(dir, "certs");
  const certs = readdirSync(certsDir).filter((f) => f.endsWith(".cert.json")).sort().map((f) => readJson<Certificate>(join(certsDir, f)));
  const byId = new Map(certs.map((c) => [c.brief, c]));
  const corpusIndex = readJson<{ defects: string[]; controls: string[] }>(join(SPIKE, "corpus", "index.json"));
  const naturalIds = readJson<{ briefs: string[] }>(join(SPIKE, "briefs", "index.json")).briefs;

  // M1: guided, corners only, random
  const missing = [...corpusIndex.defects, ...corpusIndex.controls, ...naturalIds].filter((id) => !byId.has(id));
  const defects = corpusIndex.defects.filter((id) => byId.has(id)).map((id) => {
    const c = byId.get(id)!;
    const region = REGIONS[id]!;
    const cx = c.points.filter((p) => p.fresh.length > 0);
    const inside = cx.filter((p) => region.fails(p.params));
    const outside = cx.filter((p) => !region.fails(p.params));
    const first = inside[0];
    const rnd = existsSync(join(dir, "random", `${id}.json`)) ? readJson<RandomRun[]>(join(dir, "random", `${id}.json`)) : [];
    const rndFound = rnd.map((r) => ({ seed: r.seed, found: r.points.some((p) => p.fresh.length > 0 && region.fails(p.params)), first_hit: r.points.findIndex((p) => p.fresh.length > 0 && region.fails(p.params)), outside: r.points.filter((p) => p.fresh.length > 0 && !region.fails(p.params)).map((p) => ({ params: p.params, fresh: p.fresh })) }));
    const shrunk = c.shrunk !== undefined ? c.points[c.shrunk]! : undefined;
    return {
      id,
      region: region.text,
      found: inside.length > 0,
      first_found: first ? { index: first.index, phase: first.phase, params: first.params, fresh: first.fresh } : null,
      corners_only: inside.some((p) => p.phase === "corner"),
      found_by_phase: [...new Set(inside.map((p) => p.phase))],
      counterexamples: cx.length,
      counterexamples_inside_region: inside.length,
      unexpected_outside_region: outside.map((p) => ({ index: p.index, phase: p.phase, params: p.params, fresh: p.fresh, margins: p.margins.filter((m) => !m.pass) })),
      shrunk: shrunk ? { index: shrunk.index, params: shrunk.params, fresh: shrunk.fresh, inside_region: region.fails(shrunk.params) } : null,
      line: c.line ?? null,
      events: c.events.length,
      random: rndFound,
      random_rate: rnd.length ? rndFound.filter((r) => r.found).length / rnd.length : null,
    };
  });
  const seeds = [...new Set(defects.flatMap((d) => d.random.map((r) => r.seed)))].sort((a, b) => a - b);
  const randomPerSeed = seeds.map((s) => ({ seed: s, found: defects.filter((d) => d.random.find((r) => r.seed === s)?.found).length }));
  const n = defects.length;
  const guidedFound = defects.filter((d) => d.found).length;
  const cornersFound = defects.filter((d) => d.corners_only).length;
  const randomMean = randomPerSeed.reduce((s, r) => s + r.found, 0) / Math.max(1, randomPerSeed.length);
  const controls = corpusIndex.controls.filter((id) => byId.has(id)).map((id) => {
    const c = byId.get(id)!;
    const rnd = existsSync(join(dir, "random", `${id}.json`)) ? readJson<RandomRun[]>(join(dir, "random", `${id}.json`)) : [];
    return {
      id,
      nominal_failures: c.nominal_failures,
      guided_counterexamples: c.points.filter((p) => p.fresh.length > 0).map((p) => ({ index: p.index, phase: p.phase, params: p.params, fresh: p.fresh, margins: p.margins.filter((m) => !m.pass) })),
      random_counterexamples: rnd.flatMap((r) => r.points.filter((p) => p.fresh.length > 0).map((p) => ({ seed: r.seed, params: p.params, fresh: p.fresh }))),
      smallest_margins: c.smallest_margins.filter((m) => m.normalized !== null).sort((a, b) => a.normalized! - b.normalized!).slice(0, 3),
    };
  });

  // M2 and M3 from the fresh-process replay
  const vfile = join(dir, "verify.json");
  const ver = existsSync(vfile) ? readJson<{ results: Verification[]; platform: string }>(vfile) : undefined;
  const replay = ver ? {
    platform: ver.platform,
    points: ver.results.reduce((s, v) => s + v.points, 0),
    identical: ver.results.reduce((s, v) => s + v.identical, 0),
    differing: ver.results.flatMap((v) => v.differing.map((d) => ({ brief: v.brief, ...d }))),
    counterexamples: ver.results.reduce((s, v) => s + v.counterexamples.length, 0),
    false_counterexamples: ver.results.flatMap((v) => v.counterexamples.filter((c) => !c.fails_again).map((c) => ({ brief: v.brief, ...c }))),
    changed_failure_sets: ver.results.flatMap((v) => v.counterexamples.filter((c) => c.fails_again && !c.same_failures).map((c) => ({ brief: v.brief, ...c }))),
    cert_hashes: Object.fromEntries(ver.results.map((v) => [v.brief, v.cert_hash])),
  } : null;

  // M4: the natural scripts
  const naturals = naturalIds.map((id) => {
    const c = byId.get(id);
    if (!c) return { id, missing: true };
    const cx = c.points.filter((p) => p.fresh.length > 0);
    const modes = new Map<string, typeof cx>();
    for (const p of cx) for (const a of p.fresh) modes.set(a, [...(modes.get(a) ?? []), p]);
    return {
      id,
      statement: c.statement,
      nominal_failures: c.nominal_failures,
      counterexamples: cx.length,
      by_assertion: [...modes].map(([a, ps]) => {
        const worst = ps.map((p) => ({ p, m: p.margins.find((m) => m.id === a)! })).sort((x, y) => (x.m.signed ?? -Infinity) - (y.m.signed ?? -Infinity))[0]!;
        return { assertion: a, points: ps.length, phases: [...new Set(ps.map((p) => p.phase))], worst: { index: worst.p.index, params: worst.p.params, signed: worst.m.signed, scale: worst.m.scale, detail: worst.m.detail }, examples: ps.slice(0, 4).map((p) => ({ index: p.index, params: p.params, margin: p.margins.find((m) => m.id === a) })) };
      }),
      shrunk: c.shrunk !== undefined ? { params: c.points[c.shrunk]!.params, fresh: c.points[c.shrunk]!.fresh, margins: c.points[c.shrunk]!.margins.filter((m) => !m.pass) } : null,
      line: c.line ? { lo: c.line.lo, hi: c.line.hi, pass: c.points[c.line.pass]!.params, fail: c.points[c.line.fail]!.params } : null,
      events: c.events.slice(0, 12),
      events_total: c.events.length,
    };
  });

  // M5
  const m5dir = join(dir, "m5");
  // One folder per M5 run (results/m5/<run>/timing.json), each its own certify process.
  const m5 = existsSync(m5dir) ? readdirSync(m5dir).filter((f) => existsSync(join(m5dir, f, "timing.json"))).sort().map((f) => {
    const t = readJson<Record<string, unknown>>(join(m5dir, f, "timing.json"));
    const c = readJson<Certificate>(join(m5dir, f, "enclosure.cert.json"));
    return { run: f, ...(t["_last_command"] as object), enclosure: t["enclosure"], cert_hash: certHash(c), same_as_main_cert: byId.has("enclosure") ? certHash(c) === certHash(byId.get("enclosure")!) : null };
  }) : [];

  const m1 = guidedFound / n;
  const kill = {
    m1_below_80: m1 < 0.8,
    guided_minus_random_points: Math.round((m1 - randomMean / n) * 1000) / 10,
    guided_less_than_15_points_better: (m1 - randomMean / n) * 100 < 15,
    any_false_counterexample: replay ? replay.false_counterexamples.length > 0 : null,
    m3_below_99: replay ? replay.identical / replay.points < 0.99 : null,
  };
  const summary = {
    platform: platform(),
    node: process.version,
    missing_certificates: missing,
    m1: { found: guidedFound, of: n, rate: m1, corners_only: cornersFound, random_seeds: seeds, random_found_per_seed: randomPerSeed, random_mean_found: randomMean, random_mean_rate: randomMean / n },
    defects,
    controls,
    m2_m3: replay,
    m4: naturals,
    m5,
    certificate_hashes: Object.fromEntries(certs.map((c) => [c.brief, certHash(c)])),
    kill,
  };
  writeJson(join(dir, "summary.json"), summary);
  log(`M1 guided ${guidedFound}/${n}, corners only ${cornersFound}/${n}, random mean ${randomMean.toFixed(2)}/${n} over seeds ${seeds.join(",")}`);
  if (replay) log(`M2 false counterexamples ${replay.false_counterexamples.length} of ${replay.counterexamples}; M3 ${replay.identical}/${replay.points} bit-identical`);
}

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt } = flags(rest);
if (cmd === "certify") await cmdCertify(pos, opt);
else if (cmd === "random") await cmdRandom(pos, opt);
else if (cmd === "verify") await cmdVerify(pos, opt);
else if (cmd === "score") cmdScore(opt);
else {
  log("usage: node scripts/envelope-spike.ts certify|random|verify|score ...");
  process.exitCode = 3;
}
