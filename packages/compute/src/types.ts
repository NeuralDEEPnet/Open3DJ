import type {
  AssemblyFile, ComputeBlock, ComputeMode, DeviceInventory, FileRef, GeometryReport, ParamValue, Rev, ScriptError,
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
  export?: ExportJob;
  limits?: SandboxLimits;
  detail?: "concise" | "detailed";
  /** Root definition id of the assembly. Default "root". */
  rootName?: string;
}

export interface ExportJob {
  formats: ArtifactFormat[];
  baseName?: string;
  scope?: string;
  /**
   * When set, the worker also writes the artifacts here with writeArtifacts() from
   * @open3dj/assembly (path policy included) and returns the FileRefs in JobResult.files.
   */
  dir?: string;
  /** Project folder for the path policy: dir must stay inside it. */
  root?: string;
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
    /** Parameter values the script ran with (defaults merged with the caller's values). */
    params: Record<string, ParamValue>;
    images?: RenderImage[];
    artifacts?: ExportArtifact[];
    /** Files written when the export job named a dir. */
    files?: FileRef[];
    logs: ScriptLog[];
    stats: WorkerStats;
    compute: ComputeBlock;
  }
  | { ok: false; kind: JobKind; error: ScriptError; logs: ScriptLog[]; stats: WorkerStats; compute: ComputeBlock };

export interface PoolOptions {
  /** Worker count. Default min(cores - 1, floor(freeRAM x 0.7 / recycleBytes)), at least 1. */
  size?: number;
  /** Recycle a worker when its WASM memory plus JS heap exceeds this. Default 1.5 GiB. */
  recycleBytes?: number;
  /**
   * Hard cap on any WebAssembly memory of a worker while a job runs. Growth past it fails the
   * job with JOB_MEMORY and replaces the worker. Default 2 GiB (recycleBytes plus headroom).
   */
  memoryLimitBytes?: number;
  /** Recycle after this many jobs. Default 200. */
  maxJobsPerWorker?: number;
  /** Wall-clock kill per job; the QuickJS deadline alone can overshoot. Default 30000 ms. */
  jobTimeoutMs?: number;
  /** Where worker stdout and stderr lines go. Never process.stdout. Default: process.stderr. */
  log?: (line: string) => void;
  /** Start every worker now instead of on first demand (the daemon wants warm workers). Default false. */
  warm?: boolean;
  /** How long a cancelled job's worker may take to stop before it is terminated. Default 2000 ms. */
  cancelGraceMs?: number;
  /** Worker entry. Default WORKER_ENTRY. Tests pass a fake that speaks the same protocol. */
  workerEntry?: URL;
}

export interface RunOptions {
  /** Default: interactive for run and render, batch for export. */
  lane?: Lane;
  /** Placement request. Default "auto". Ignored when the job already carries a compute block. */
  mode?: ComputeMode;
  /** Abort: a queued job is dropped, a running one is cancelled (its worker is stopped if it does not finish). */
  signal?: AbortSignal;
  /** Wall-clock deadline for this job once a worker starts it. Default PoolOptions.jobTimeoutMs. */
  timeoutMs?: number;
}

export interface PoolStats {
  /** Maximum worker count. */
  size: number;
  /** Live workers (starting, idle or busy). */
  workers: number;
  busy: number;
  queued: { interactive: number; batch: number };
  /** Workers retired after maxJobsPerWorker, the memory limit or a kernel error. */
  recycled: number;
  /** Workers terminated by the wall-clock watchdog. */
  timedOut: number;
  /** Workers that died on their own (an uncaught error, exit or out of memory). */
  crashed: number;
  completed: number;
  /** Kernel load time of the most recent worker that became ready. */
  workerInitMs?: number;
}

/**
 * The CPU worker pool (COMPUTE.md section 4). Workers are worker_threads created with
 * stdout: true and stderr: true and drained to options.log, so kernel output never reaches
 * MCP stdout. One kernel per worker. One worker is reserved for the interactive lane.
 */
export interface Pool {
  /**
   * Run one job. Resolves with a JobResult for everything that concerns the job, including
   * failures: script errors, NO_BACKEND, JOB_TIMEOUT, JOB_CANCELLED and WORKER_CRASHED come
   * back as { ok: false, error }. Rejects only with ComputeError POOL_CLOSED.
   */
  run(job: JobRequest, options?: RunOptions): Promise<JobResult>;
  stats(): PoolStats;
  /** The compute block a job placed with this mode would get (throws ComputeError NO_BACKEND). */
  place(mode: ComputeMode, kind: JobKind): ComputeBlock;
  close(): Promise<void>;
}

/** Codes of ComputeError and of the pool's own ScriptErrors (JOB_TIMEOUT, JOB_MEMORY, JOB_CANCELLED, WORKER_CRASHED, NO_BACKEND). */
export interface ComputeErrorShape {
  code: "NO_BACKEND" | "JOB_TIMEOUT" | "JOB_MEMORY" | "JOB_CANCELLED" | "WORKER_CRASHED" | "POOL_CLOSED";
  message: string;
}

export interface InventoryOptions {
  /** Include the pool sizing that would be used. */
  pool?: PoolOptions;
}

export type { DeviceInventory };
