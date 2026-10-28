// @open3dj/compute: the compute contract (C5) for S1: DeviceInventory, placement, the CPU
// worker pool with two lanes, and the job worker that composes sandbox + dsl + assembly +
// render (COMPUTE.md sections 3 and 4).
//
// Intended implementation:
// - deviceInventory(): node:os only in S1 (cores, arch, RAM); gpus [] and backends ["cpu.wasm"].
// - place(mode, kind): "auto" and "cpu" give { backend: "cpu.wasm", device: "cpu xN",
//   placement_reason }; "gpu" and "cloud" throw ComputeError NO_BACKEND naming the missing backend.
// - createPool(): own pool on worker_threads with stdout: true, stderr: true (piscina cannot
//   pass these); interactive and batch lanes; wall-clock kill and respawn on timeout; recycle
//   at recycleBytes, after maxJobsPerWorker, or on a fatal KernelError; re-queue innocent jobs
//   when a worker dies.
// - worker.ts: initKernel with a sink to stderr, createDsl, then for each job: checkpoint,
//   runScript, collect, buildAssembly, computeFits, report, then render or exportArtifacts,
//   releaseSince. Post plain data back; transfer image and artifact buffers.
import { NotImplementedError } from "@open3dj/schemas";
import type { ComputeBlock, ComputeMode, DeviceInventory, PackageStatus } from "@open3dj/schemas";
import type { ComputeErrorShape, InventoryOptions, JobKind, JobRequest, JobResult, Pool, PoolOptions } from "./types.ts";

export type * from "./types.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

/** Path of the worker entry, for new Worker(WORKER_ENTRY, { stdout: true, stderr: true }). */
export const WORKER_ENTRY: URL = new URL("./worker.ts", import.meta.url);

export const DEFAULT_POOL_OPTIONS = Object.freeze({
  recycleBytes: 1.5 * 1024 ** 3,
  maxJobsPerWorker: 200,
  jobTimeoutMs: 30_000,
});

export class ComputeError extends Error implements ComputeErrorShape {
  readonly code: ComputeErrorShape["code"];
  constructor(code: ComputeErrorShape["code"], message: string) {
    super(message);
    this.name = "ComputeError";
    this.code = code;
  }
}

/** What this machine can run (open3dj doctor, inspect fields=[devices]). */
export function deviceInventory(options?: InventoryOptions): DeviceInventory {
  void options;
  throw new NotImplementedError("compute.deviceInventory");
}

/** Decide where a job runs and why. Throws ComputeError NO_BACKEND for gpu or cloud in S1. */
export function place(mode: ComputeMode, kind: JobKind, inventory: DeviceInventory): ComputeBlock {
  void mode; void kind; void inventory;
  throw new NotImplementedError("compute.place");
}

export function createPool(options?: PoolOptions): Pool {
  void options;
  throw new NotImplementedError("compute.createPool");
}

/**
 * Run one job in the current thread with a fresh kernel. For tests and the CLI's --inline
 * mode; never call it in the MCP daemon (the kernel prints to stdout).
 */
export async function runJobInline(job: JobRequest): Promise<JobResult> {
  void job;
  throw new NotImplementedError("compute.runJobInline");
}
