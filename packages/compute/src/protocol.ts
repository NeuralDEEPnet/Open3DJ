// Messages between the pool and a worker (structured clone over parentPort).
import type { JobRequest, JobResult } from "./types.ts";

/** workerData of every pool worker. */
export interface WorkerInit {
  workerId: number;
  /** Int32Array(1) over this buffer: the pool stores 1 to cancel the running job, 0 before each job. */
  cancelFlag: SharedArrayBuffer;
  /** Hard cap on any WebAssembly memory in the worker (memory-guard.ts). */
  memoryLimitBytes?: number;
}

export type ToWorker = { type: "job"; id: number; job: JobRequest; jobs: number };

export type FromWorker =
  /** The kernel is loaded; the worker takes jobs from now on. */
  | { type: "ready"; initMs: number }
  /** One per job. recycle names why this worker must not take another job. */
  | { type: "result"; id: number; result: JobResult; recycle?: string }
  /** A WebAssembly memory tried to grow past memoryLimitBytes; the pool stops the job and the worker. */
  | { type: "memory"; bytes: number; limit: number }
  /** The worker cannot start (for example the kernel failed to load). */
  | { type: "fatal"; message: string };
