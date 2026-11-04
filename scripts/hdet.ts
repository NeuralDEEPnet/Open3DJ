// H-det (ARCHITECTURE.md section 8, PLAN.md S0): is a kernel result bit-identical across fresh
// processes and across warm reuses of one worker? Runs the corpus in scripts/hdet-lib.ts
// (three examples plus a shell and an offset case) N times, each in a fresh process with a
// fresh pool worker, and N times round-robin on one warm worker. Compares the bits of every
// part's volume and area, the bounding boxes, the face and edge counts and the STEP file with
// its timestamp stripped, both as bytes and with the writer's assembly usage ids blanked.
//
//   node scripts/hdet.ts                 20 fresh + 20 warm per case; prints a Markdown summary
//   node scripts/hdet.ts --runs 5        fewer runs
//   node scripts/hdet.ts --cases shell,offset
//   node scripts/hdet.ts --json          the full result as JSON on stdout
//
// Exit 0 when every field of every case is identical everywhere, 1 when any field differs
// (record which one, and pick a fallback from ARCHITECTURE.md section 8), 2 on an error.
// Fresh processes run in parallel (cores minus one); the warm series runs on one worker.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, runtimeVersions } from "@open3dj/compute";
import type { JobRequest } from "@open3dj/compute";
import { CASES, FIELDS, compareSamples, instrument, sampleOf } from "./hdet-lib.ts";
import type { CaseResult, Sample } from "./hdet-lib.ts";
import { ROOT } from "./lib.ts";

const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function job(name: string): JobRequest {
  const path = CASES[name];
  if (!path) throw new Error(`unknown case ${name}; cases: ${Object.keys(CASES).join(", ")}`);
  return {
    kind: "export",
    script: instrument(readFileSync(join(ROOT, path), "utf8")),
    rev: "r_0001",
    detail: "detailed",
    export: { formats: ["step"], baseName: "hdet" },
  };
}

// Child mode: one case on a fresh pool worker in this fresh process; the sample goes to stdout.
if (args[0] === "--child") {
  const pool = createPool({ size: 1, log: () => {} });
  try {
    const r = await pool.run(job(args[1]!), { lane: "interactive", timeoutMs: 120_000 });
    process.stdout.write(`${JSON.stringify(sampleOf(r))}\n`);
  } finally {
    await pool.close();
  }
  process.exit(0);
}

const runs = Math.max(1, Number(opt("--runs") ?? 20));
const names = (opt("--cases") ?? Object.keys(CASES).join(",")).split(",").filter(Boolean);
for (const n of names) if (!CASES[n]) {
  process.stderr.write(`hdet: unknown case ${n}; cases: ${Object.keys(CASES).join(", ")}\n`);
  process.exit(2);
}
const json = args.includes("--json");
const started = new Date();
const t0 = performance.now();

function child(name: string): Promise<Sample> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SELF, "--child", name], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`fresh process for ${name} exited ${code}: ${err.slice(0, 800)}`));
      try {
        resolve(JSON.parse(out.trim()) as Sample);
      } catch {
        reject(new Error(`fresh process for ${name} printed no sample: ${out.slice(0, 400)} ${err.slice(0, 400)}`));
      }
    });
  });
}

// 1. Fresh processes, a few at a time.
const fresh = new Map<string, Sample[]>(names.map((n) => [n, []]));
const queue = names.flatMap((n) => Array.from({ length: runs }, () => n));
const width = Math.max(1, availableParallelism() - 1);
const tFresh = performance.now();
await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
  for (let n = queue.shift(); n !== undefined; n = queue.shift()) fresh.get(n)!.push(await child(n));
}));
const freshMs = performance.now() - tFresh;

// 2. Warm reuses: one worker runs every case round-robin, runs times, without recycling.
const warm = new Map<string, Sample[]>(names.map((n) => [n, []]));
const tWarm = performance.now();
const pool = createPool({ size: 1, maxJobsPerWorker: runs * names.length + 10, log: () => {} });
const jobs = new Map(names.map((n) => [n, job(n)]));
try {
  for (let i = 0; i < runs; i++) {
    for (const n of names) warm.get(n)!.push(sampleOf(await pool.run(jobs.get(n)!, { lane: "interactive", timeoutMs: 120_000 })));
  }
} finally {
  await pool.close();
}
const warmMs = performance.now() - tWarm;
const workers = new Set([...warm.values()].flat().map((s) => s.worker));

const results: CaseResult[] = names.map((n) => compareSamples(n, fresh.get(n)!, warm.get(n)!));
const ok = results.every((r) => r.identical) && workers.size === 1;
const geometryOk = results.every((r) => r.geometry_identical) && workers.size === 1;
const v = runtimeVersions();
const machine = {
  platform: `${platform()} ${release()} ${arch()}`,
  cpu: `${cpus()[0]?.model ?? "unknown"} (${availableParallelism()} logical cores)`,
  memory_gb: Math.round(totalmem() / 2 ** 30),
  node: process.version,
  occt_wasm: v.occt_wasm ?? "unknown",
  brepjs: v.brepjs ?? "unknown",
};
const summary = {
  date: started.toISOString(),
  machine,
  runs,
  cases: names,
  warm_worker_recycled: workers.size !== 1,
  fresh_ms: Math.round(freshMs),
  warm_ms: Math.round(warmMs),
  total_ms: Math.round(performance.now() - t0),
  identical: ok,
  geometry_identical: geometryOk,
  results,
};

if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
else {
  const cell = (f: { fresh: number; warm: number; identical: boolean }) => (f.identical ? "same" : `${f.fresh} fresh / ${f.warm} warm${f.fresh === 1 && f.warm === 1 ? ", differ" : ""}`);
  process.stdout.write([
    `H-det on ${summary.date.slice(0, 10)}: ${runs} fresh processes and ${runs} warm reuses per case.`,
    `Machine: ${machine.platform}, ${machine.cpu}, ${machine.memory_gb} GB, Node ${machine.node}, occt-wasm ${machine.occt_wasm}, brepjs ${machine.brepjs}.`,
    "",
    `| Case | ${FIELDS.map((f) => ({ bits: "Volume and area bits", bbox: "Bounding boxes", counts: "Face and edge counts", step_ids: "STEP without timestamp and usage ids", step: "STEP without timestamp" })[f]).join(" | ")} | Result |`,
    `|---|${FIELDS.map(() => "---").join("|")}|---|`,
    ...results.map((r) => `| ${r.case} | ${FIELDS.map((f) => cell(r.fields[f])).join(" | ")} | ${r.identical ? "identical" : "DIFFERS"} |`),
    "",
    `Fresh series ${(freshMs / 1000).toFixed(1)} s, warm series ${(warmMs / 1000).toFixed(1)} s${workers.size !== 1 ? "; WARNING: the warm worker was recycled, so the warm series is not one instance" : ", one warm worker throughout"}.`,
    `Geometry (measure bits, boxes, counts, STEP entities): ${geometryOk ? "identical" : "DIFFERS"}. STEP bytes: ${results.every((r) => r.fields.step.identical) ? "identical" : "DIFFER"}.`,
    `H-det ${ok ? "holds" : geometryOk ? "holds for the geometry but not for the STEP bytes" : "FAILS"} for this corpus on this machine.`,
    "",
  ].join("\n"));
}
process.exit(ok ? 0 : 1);
