// @open3dj/compute: the compute contract (C5) for S1 (COMPUTE.md sections 3 and 4).
// - deviceInventory(): node:os facts and engine versions; gpus is empty until GPU discovery lands.
// - place(): auto and cpu give the cpu.wasm compute block; gpu and cloud throw NO_BACKEND.
// - createPool(): the CPU worker pool with captured stdout, two lanes, a wall-clock watchdog
//   and recycling. The kernel loads only inside its workers.
// - doctor(): the inventory plus quick benchmarks and pool scaling.
//
// This entry point loads no kernel, DSL, assembly or render code, so the daemon and the CLI
// start fast. The job runner itself is at "@open3dj/compute/job" (worker side only).
import type { PackageStatus } from "@open3dj/schemas";
import type { JobRequest, JobResult } from "./types.ts";

export type * from "./types.ts";
export type { DoctorBench, DoctorOptions, DoctorReport, KernelOp, ScalingPoint } from "./doctor.ts";
export type { JobContext, JobOutcome, JobRunner } from "./job.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";

export { DEFAULT_POOL_OPTIONS, GPU_NOTE, deviceInventory, interactiveReserved, inventoryHash, poolSize, runtimeVersions } from "./inventory.ts";
export { ComputeError, INLINE_COMPUTE, cpuDevice, place } from "./place.ts";
export { WORKER_ENTRY, createPool } from "./pool.ts";
export { BENCH_SCRIPT, doctor } from "./doctor.ts";

let inlineChain: Promise<unknown> = Promise.resolve();

/**
 * Run one job in the current thread with a fresh kernel. For tests and the CLI's --inline
 * mode; never call it in the MCP daemon (the kernel prints to stdout without the worker's
 * capture). Calls are serialised, because the DSL registers brepjs per thread.
 */
export function runJobInline(job: JobRequest): Promise<JobResult> {
  const next = inlineChain.then(async () => {
    const [{ initKernel }, { createJobRunner }] = await Promise.all([import("@open3dj/kernel"), import("./job.ts")]);
    const kernel = await initKernel();
    const { result } = await createJobRunner(kernel).run(job, { workerId: 0, jobs: 1 });
    return result;
  });
  inlineChain = next.catch(() => {});
  return next;
}
