// Certified Envelopes spike, reconciliation of the builder's numbers with the two audits.
// Pure: it loads no kernel. It reads the committed results and the pre-registered corpus, and
// uses the spike's own sampler (search.ts) and region predicates (corpus/regions.ts).
//
//   node scripts/envelope-spike/reconcile.ts sim          uniform random baseline from the region predicates
//   node scripts/envelope-spike/reconcile.ts agreement    region predicates against the committed random runs
//   node scripts/envelope-spike/reconcile.ts score <dir>  guided certificates in <dir> against the regions
//   node scripts/envelope-spike/reconcile.ts mechanisms   tapered-cup fillet web and knob flutes, from the certificates
//   node scripts/envelope-spike/reconcile.ts brief-free   which detections need a written brief
//
// Output goes to stdout; results/reconcile/*.txt hold the outputs that the experiment report cites.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParamValue } from "@open3dj/schemas";
import type { ParamDecl } from "./brief.ts";
import { REGIONS } from "./corpus/regions.ts";
import { axesOf, cornerPoints, specialPoints, uniformPoints } from "./search.ts";
import type { Axis, P } from "./search.ts";

const SPIKE = fileURLToPath(new URL("./", import.meta.url));
const CORPUS = join(SPIKE, "corpus");
const RESULTS = join(SPIKE, "results");
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const out = (s: string) => void process.stdout.write(s + "\n");
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const pct = (x: number) => (x * 100).toFixed(1) + "%";

interface Defect { id: string; axes: Axis[]; fails: (p: P) => boolean }
interface CertPoint { index: number; phase: string; params: Record<string, ParamValue>; fresh: string[]; signature_hash: string; margins: { id: string; pass: boolean; detail?: string }[] }
interface Cert { brief: string; points: CertPoint[] }
interface RandomRun { brief: string; seed: number; points: { params: Record<string, ParamValue>; fresh: string[] }[] }

function defects(): Defect[] {
  const ids = readJson<{ defects: string[] }>(join(CORPUS, "index.json")).defects;
  return ids.map((id) => {
    const params = readJson<{ params: ParamDecl[] }>(join(CORPUS, `${id}.brief.json`)).params;
    return { id, axes: axesOf(params), fails: REGIONS[id]!.fails };
  });
}

/** How many defects n uniform points of this seed reach (inside the analytic region). */
const foundRandom = (defs: Defect[], seed: number, n: number) => defs.filter((d) => uniformPoints(d.axes, n, seed).some(d.fails)).length;

function sim() {
  const defs = defects(), N = defs.length;
  const rate = (found: number[]) => mean(found) / N;
  const s1 = range(1, 10).map((s) => foundRandom(defs, s, 64));
  const s2 = range(11, 20).map((s) => foundRandom(defs, s, 64));
  out(`budget 64, seeds 1-10: per seed ${s1.join(",")}; mean ${pct(rate(s1))}`);
  out(`budget 64, seeds 11-20: per seed ${s2.join(",")}; mean ${pct(rate(s2))}`);
  out(`budget 64, seeds 1-20: mean ${pct(rate([...s1, ...s2]))}`);
  const K = 10000;
  const big = range(1, K).map((s) => foundRandom(defs, s, 64));
  const e = rate(big);
  const sd = Math.sqrt(mean(big.map((x) => (x / N - e) ** 2)));
  let clear = 0;
  for (let b = 0; b < K / 10; b++) if (1 - rate(big.slice(b * 10, b * 10 + 10)) >= 0.15) clear++;
  out(`budget 64, seeds 1-${K}: expected ${(e * 100).toFixed(2)}%; per-seed sd ${(sd * 100).toFixed(1)} points; 10-seed standard error ${((sd / Math.sqrt(10)) * 100).toFixed(1)} points; disjoint 10-seed blocks where 100% guided is 15 points or more ahead: ${clear} of ${K / 10}`);
  for (const n of [16, 24, 32, 48, 128]) out(`budget ${n}: expected random rate over seeds 1-2000 ${pct(rate(range(1, 2000).map((s) => foundRandom(defs, s, n))))}`);
  const cr = range(1, 2000).map((s) => defs.filter((d) => [...cornerPoints(d.axes).slice(0, 24), ...uniformPoints(d.axes, 40, s)].some(d.fails)).length);
  out(`corners (the first 24, as the guided search caps them at budget 64) then 40 uniform points, seeds 1-2000: ${pct(rate(cr))}`);
  const crs = range(1, 2000).map((s) => defs.filter((d) => {
    const fixed = [...cornerPoints(d.axes).slice(0, 24), ...specialPoints(d.axes)];
    return [...fixed, ...uniformPoints(d.axes, Math.max(0, 64 - fixed.length), s)].some(d.fails);
  }).length);
  out(`corners, special points, then uniform points up to 64, seeds 1-2000: ${pct(rate(crs))}`);
  out(`per defect, uniform random at 64, seeds 1-2000: ${defs.map((d) => `${d.id.slice(0, 3)} ${pct(mean(range(1, 2000).map((s) => (uniformPoints(d.axes, 64, s).some(d.fails) ? 1 : 0))))}`).join(", ")}`);
}

function agreement() {
  const dir = join(RESULTS, "random");
  const missBySeed: Record<number, string[]> = {};
  for (const f of readdirSync(dir).filter((f) => f.startsWith("d")).sort()) {
    const runs = readJson<RandomRun[]>(join(dir, f));
    const id = runs[0]!.brief, region = REGIONS[id]!;
    let inside = 0, insidePass = 0, outsideFail = 0, cellDisagree = 0;
    for (const run of runs) {
      const ins = run.points.filter((p) => region.fails(p.params));
      const hit = run.points.some((p) => p.fresh.length > 0);
      if (!hit) (missBySeed[run.seed] ??= []).push(id.slice(0, 3));
      if ((ins.length > 0) !== hit) cellDisagree++;
      inside += ins.length;
      insidePass += ins.filter((p) => p.fresh.length === 0).length;
      outsideFail += run.points.filter((p) => !region.fails(p.params) && p.fresh.length > 0).length;
    }
    out(`${id}: random points inside the region ${inside}, of which pass on the kernel ${insidePass}; outside the region but failing ${outsideFail}; seeds where region and kernel disagree on found ${cellDisagree}`);
  }
  out(`misses by seed (seeds 1-10): ${Object.entries(missBySeed).map(([s, ids]) => `${s}: ${ids.length} (${ids.join(" ")})`).join("; ")}`);
}

function score(dir: string) {
  let found = 0, n = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".cert.json")).sort()) {
    const c = readJson<Cert>(join(dir, f));
    const region = REGIONS[c.brief];
    if (!region) continue;
    n++;
    const hit = c.points.find((p) => p.fresh.length > 0 && region.fails(p.params));
    const outside = c.points.filter((p) => p.fresh.length > 0 && !region.fails(p.params));
    if (hit) found++;
    out(`${c.brief}: ${hit ? `first hit at index ${hit.index} (${hit.phase})` : "missed"}; ${c.points.length} points; counterexamples outside the region ${outside.length}${outside.map((p) => ` ${JSON.stringify(p.params)} [${p.fresh.join(", ")}]`).join("")}`);
  }
  out(`found ${found} of ${n}`);
}

const certOf = (id: string) => readJson<Cert>(join(RESULTS, "certs", `${id}.cert.json`));
const wallRead = (p: CertPoint) => Number(/thinnest wall ([\d.]+)/.exec(p.margins.find((m) => m.id === "gate-min-wall")?.detail ?? "")?.[1] ?? NaN);

/** Tapered cup: the outer 3 mm base fillet (a circle of radius 3 tangent to z = 0 and to the cone r = 30 + s z, s = 8 / H) against the cavity's sharp bottom corner at (30 + s W - W, W). */
export function cupWeb(H: number, W: number): number {
  const s = 8 / H, rc = 30 + 3 * s - 3 * Math.sqrt(1 + s * s), rk = 30 + s * W - W;
  return 3 - Math.hypot(rk - rc, 3 - W);
}

function mechanisms() {
  let worst = 0;
  for (const p of certOf("tapered-cup").points) {
    const read = wallRead(p), a = cupWeb(p.params["Height"] as number, p.params["Wall"] as number);
    if (Number.isNaN(read) || a >= 1.2) continue;
    worst = Math.max(worst, Math.abs(read - a));
    out(`tapered-cup H ${p.params["Height"]} W ${p.params["Wall"]}: analytic fillet web ${a.toFixed(3)} mm, gate reads ${read} mm`);
  }
  out(`tapered-cup: largest |gate - analytic| ${worst.toFixed(3)} mm over the failing points`);
  for (const H of [30, 50, 70, 90, 120]) {
    let lo = 1.2, hi = 5;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (cupWeb(H, m) < 0.84) lo = m; else hi = m; }
    out(`tapered-cup H ${H}: the fillet web is under the 0.84 mm fail line for Wall below ${hi.toFixed(3)} mm`);
  }
  out(`tapered-cup nominal (H 70, W 2.5): analytic fillet web ${cupWeb(70, 2.5).toFixed(3)} mm`);
  const knob = certOf("knob").points;
  const fluted = knob.filter((p) => p.params["Flutes"] !== 0), plain = knob.filter((p) => p.params["Flutes"] === 0);
  const fails = (p: CertPoint) => !p.margins.find((m) => m.id === "gate-min-wall")!.pass;
  const reads = fluted.map(wallRead).filter((x) => !Number.isNaN(x));
  out(`knob: min_wall fails at ${fluted.filter(fails).length} of ${fluted.length} points with Flutes > 0 (readings ${Math.min(...reads)} to ${Math.max(...reads)} mm) and at ${plain.filter(fails).length} of ${plain.length} points with Flutes 0`);
}

const briefFree = (id: string) => id === "builds" || id === "status" || id === "valid" || id.startsWith("gate-") || id.includes("clash");

function briefFreeReport() {
  const defs = defects();
  const missed: string[] = [];
  let found = 0;
  for (const d of defs) {
    const hits = certOf(d.id).points.filter((p) => p.fresh.length > 0 && d.fails(p.params));
    if (hits.some((p) => p.fresh.some(briefFree))) found++;
    else missed.push(`${d.id} (fails only ${[...new Set(hits.flatMap((p) => p.fresh))].join(", ")})`);
  }
  out(`corpus: ${found} of ${defs.length} defects have an in-region counterexample that fails builds, status, valid, a gate or a clash check; the rest: ${missed.join("; ")}`);
  for (const id of ["flange", "box-with-lid", "bracket", "knob", "tapered-cup", "vented-box"]) {
    const pts = certOf(id).points, nominal = pts[0]!.signature_hash;
    const cx = pts.filter((p) => p.fresh.length > 0);
    const bf = cx.filter((p) => p.fresh.some(briefFree));
    const rest = cx.filter((p) => !p.fresh.some(briefFree));
    const changed = rest.filter((p) => p.signature_hash !== nominal);
    out(`${id}: ${cx.length} counterexamples; ${bf.length} fail a brief-free check; ${changed.length} of the other ${rest.length} change the event signature (counts, fits or gate verdicts) from nominal; brief-only assertions ${[...new Set(rest.flatMap((p) => p.fresh))].join(", ") || "none"}`);
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "sim") sim();
else if (cmd === "agreement") agreement();
else if (cmd === "score" && arg) score(arg);
else if (cmd === "mechanisms") mechanisms();
else if (cmd === "brief-free") briefFreeReport();
else {
  process.stderr.write("usage: node scripts/envelope-spike/reconcile.ts sim | agreement | score <dir> | mechanisms | brief-free\n");
  process.exitCode = 3;
}
