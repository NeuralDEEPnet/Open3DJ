import type {
  AssemblyFile, ComputeBlock, ComputeMode, DeviceInventory, GeometryReport, ParamValue, Rev, ScriptError,
} from "@open3dj/schemas";
import type { SandboxLimits, ScriptLog } from "@open3dj/sandbox";
import type { ArtifactFormat, ExportArtifact } from "@open3dj/assembly";
import type { RenderImage, RenderOptions } from "@open3dj/render";

export type { ArtifactFormat, ExportArtifact, RenderImage, RenderOptions };

/** Job kinds the CPU pool runs in S1. Each declares runsOn ["cpu.wasm"]. */
export type JobKind = "run" | "render" | "export";
export type Lane = "interactive" | "batch";

/**
 * One job for a worker. Workers are stateless: each job re-runs the script inside
 * checkpoint()/releaseSince(), so any worker can take any job and a recycled worker loses
 * nothing. A tessellation and result cache keyed by inputsHash comes later.
 */
export interface JobRequest {
  kind: JobKind;
  /** DSL source. */
  script: string;
  params?: Record<string, ParamValue>;
  /** Revision the result belongs to; goes into the report. */
  rev: Rev;
  /** Placement decided by the pool; goes into the report and the result. */
  compute?: ComputeBlock;
  /** The project's previous graph, so occurrence ids stay stable. */
  previous?: AssemblyFile;
  render?: RenderOptions;
  export?: { formats: ArtifactFormat[]; baseName?: string; scope?: string };
  limits?: SandboxLimits;
  detail?: "concise" | "detailed";
}

export interface WorkerStats {
  workerId: number;
  /** Jobs this worker has run, including this one. */
  jobs: number;
  wallMs: number;
  /** Kernel WebAssembly memory plus JS heap after the job; the pool recycles above its limit. */
  memoryBytes: number;
  liveShapes: number;
}

export type JobResult =
  | {
    ok: true;
    kind: JobKind;
    report: GeometryReport;
    assembly: AssemblyFile;
    images?: RenderImage[];
    artifacts?: ExportArtifact[];
    logs: ScriptLog[];
    stats: WorkerStats;
  }
  | { ok: false; kind: JobKind; error: ScriptError; logs: ScriptLog[]; stats: WorkerStats };

export interface PoolOptions {
  /** Worker count. Default min(cores - 1, floor(freeRAM x 0.7 / recycleBytes)), at least 1. */
  size?: number;
  /** Recycle a worker when its WASM memory plus JS heap exceeds this. Default 1.5 GiB. */
  recycleBytes?: number;
  /** Recycle after this many jobs. Default 200. */
  maxJobsPerWorker?: number;
  /** Wall-clock kill per job; the QuickJS deadline alone can overshoot. Default 30000 ms. */
  jobTimeoutMs?: number;
  /** Where worker stdout and stderr lines go. Never process.stdout. Default: process.stderr. */
  log?: (line: string) => void;
}

export interface PoolStats {
  workers: number;
  busy: number;
  queued: { interactive: number; batch: number };
  recycled: number;
  completed: number;
}

/**
 * The CPU worker pool (COMPUTE.md section 4). Workers are worker_threads created with
 * stdout: true and stderr: true and drained to options.log, so kernel output never reaches
 * MCP stdout. One kernel per worker. One worker is reserved for the interactive lane.
 */
export interface Pool {
  run(job: JobRequest, options?: { lane?: Lane; mode?: ComputeMode; signal?: AbortSignal }): Promise<JobResult>;
  stats(): PoolStats;
  close(): Promise<void>;
}

/** Thrown for placement failures, for example compute: "gpu" with no GPU backend. */
export interface ComputeErrorShape {
  code: "NO_BACKEND" | "JOB_TIMEOUT" | "WORKER_CRASHED" | "POOL_CLOSED" | "CANCELLED";
  message: string;
}

export interface InventoryOptions {
  /** Include the pool sizing that would be used. */
  pool?: PoolOptions;
}

export type { DeviceInventory };
