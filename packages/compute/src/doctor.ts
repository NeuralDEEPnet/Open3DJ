// open3dj doctor: the DeviceInventory, and with bench a few quick measurements through the
// pool (COMPUTE.md section 3.1). Every kernel runs in a pool worker, so doctor is safe to
// call from the MCP daemon too.
import type { DeviceInventory } from "@open3dj/schemas";
import { GPU_NOTE, deviceInventory, inventoryHash, poolSize } from "./inventory.ts";
import { createPool } from "./pool.ts";
import type { JobRequest, PoolOptions } from "./types.ts";

/** The bench part: a filleted box with a through hole (box, fillet and a boolean cut). */
export const BENCH_SCRIPT = `const body = fillet(box(40, 30, 20), 2, { atZ: 20 });
return body.subtract(cylinder(30, 5).translate(0, 0, -5));`;

export interface DoctorOptions {
  /** Run the micro-benchmarks and the scaling series. Default false. */
  bench?: boolean;
  /** Largest pool in the scaling series. Default: the pool size this machine would use. */
  maxWorkers?: number;
  /** Bench parts per worker at each pool size. Default 4. */
  jobsPerWorker?: number;
  /** Pool options for sizing and the worker log. */
  pool?: PoolOptions;
}

export interface ScalingPoint {
  workers: number;
  jobs: number;
  wall_ms: number;
  jobs_per_s: number;
  /** Throughput relative to one worker. */
  speedup: number;
}

export interface DoctorBench {
  /** Time to load occt-wasm in a fresh worker. */
  kernel_init_ms: number;
  /** First bench part on a fresh worker (includes warm-up). */
  part_first_ms: number;
  /** Median of the warm bench parts on one worker. */
  part_ms: number;
  part_volume_mm3: number;
  /** Largest kernel WASM memory plus JS heap a worker reported during the bench. */
  peak_worker_memory_bytes: number;
  scaling: ScalingPoint[];
}

export interface DoctorReport {
  inventory: DeviceInventory;
  inventory_hash: string;
  notes: string[];
  bench?: DoctorBench;
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const inventory = deviceInventory(options.pool ? { pool: options.pool } : {});
  const report: DoctorReport = { inventory, inventory_hash: inventoryHash(inventory), notes: [GPU_NOTE] };
  if (options.bench) report.bench = await bench(options, inventory);
  return report;
}

const benchJob = (i: number): JobRequest => ({ kind: "run", script: BENCH_SCRIPT, rev: `bench_${i}` });

async function bench(options: DoctorOptions, inventory: DeviceInventory): Promise<DoctorBench> {
  const maxWorkers = Math.max(1, options.maxWorkers ?? inventory.pool?.workers ?? poolSize(options.pool));
  const perWorker = Math.max(1, options.jobsPerWorker ?? 4);
  const base: PoolOptions = { ...options.pool, warm: true };
  delete base.size;
  let peak = 0;

  // One worker: kernel load, the first part, then warm parts.
  const single = createPool({ ...base, size: 1 });
  let kernelInit: number;
  let first: number;
  let volume: number;
  const warm: number[] = [];
  try {
    const r0 = await single.run(benchJob(0), { lane: "interactive" });
    if (!r0.ok) throw new Error(`bench part failed: ${r0.error.code} ${r0.error.message}`);
    kernelInit = single.stats().workerInitMs ?? 0;
    first = r0.stats.wallMs;
    volume = r0.report.parts[0]?.volume_mm3 ?? 0;
    peak = Math.max(peak, r0.stats.memoryBytes);
    for (let i = 1; i <= perWorker; i++) {
      const r = await single.run(benchJob(i), { lane: "interactive" });
      if (r.ok) warm.push(r.stats.wallMs);
      peak = Math.max(peak, r.stats.memoryBytes);
    }
  } finally {
    await single.close();
  }

  const scaling: ScalingPoint[] = [];
  for (let n = 1; n <= maxWorkers; n++) {
    const pool = createPool({ ...base, size: n });
    try {
      // Warm every worker with one part, then time n x perWorker parts in parallel.
      await Promise.all(Array.from({ length: n }, (_, i) => pool.run(benchJob(i), { lane: "interactive" })));
      const jobs = n * perWorker;
      const t0 = performance.now();
      const results = await Promise.all(Array.from({ length: jobs }, (_, i) => pool.run(benchJob(i), { lane: "interactive" })));
      const wall = performance.now() - t0;
      for (const r of results) peak = Math.max(peak, r.stats.memoryBytes);
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) throw new Error(`bench part failed: ${failed.error.code} ${failed.error.message}`);
      const rate = jobs / (wall / 1000);
      scaling.push({ workers: n, jobs, wall_ms: round(wall), jobs_per_s: round(rate, 2), speedup: round(rate / (scaling[0]?.jobs_per_s ?? rate), 2) });
    } finally {
      await pool.close();
    }
  }

  return {
    kernel_init_ms: kernelInit,
    part_first_ms: first,
    part_ms: median(warm),
    part_volume_mm3: round(volume, 3),
    peak_worker_memory_bytes: peak,
    scaling,
  };
}

const round = (x: number, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}
