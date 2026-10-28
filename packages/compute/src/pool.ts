// The CPU worker pool (COMPUTE.md section 4). Our own small pool on worker_threads, because
// every worker must be created with stdout: true and stderr: true (piscina cannot pass them),
// so kernel output is drained into the log and never reaches the MCP stdout.
//
// - Slots: size fixed at creation. Slot 0 is reserved for the interactive lane when size > 1.
//   Workers start on first demand (or all at once with warm: true) and a slot whose worker
//   was retired is refilled at once, so a warm pool stays warm.
// - One job per worker at a time. The parent's wall-clock watchdog terminates a worker whose
//   job passes its deadline: the QuickJS interrupt deadline can overshoot, and nothing inside
//   the worker can stop a long kernel call.
// - Recycling: after maxJobsPerWorker jobs, when kernel WASM memory plus JS heap passes
//   recycleBytes (WebAssembly memory never shrinks), or when the job saw a kernel error.
// - Memory bound during a job: WebAssembly memory may not grow past memoryLimitBytes (the
//   worker's guard reports it and the pool terminates the worker with JOB_MEMORY), and the
//   JS heap has a V8 old-generation limit.
import { Worker } from "node:worker_threads";
import type { Readable } from "node:stream";
import type { ComputeBlock, ComputeMode, ScriptError } from "@open3dj/schemas";
import { DEFAULT_POOL_OPTIONS, deviceInventory, interactiveReserved, poolSize } from "./inventory.ts";
import { ComputeError, place } from "./place.ts";
import type { FromWorker, ToWorker, WorkerInit } from "./protocol.ts";
import type { JobKind, JobRequest, JobResult, Lane, Pool, PoolOptions, PoolStats, RunOptions } from "./types.ts";

/** Path of the worker entry, for new Worker(WORKER_ENTRY, { stdout: true, stderr: true }). */
export const WORKER_ENTRY: URL = new URL("./worker.ts", import.meta.url);

const DEFAULT_CANCEL_GRACE_MS = 2000;
/** Consecutive workers that may die before reporting ready, before queued jobs are failed. */
const MAX_START_FAILURES = 3;

interface Pending {
  job: JobRequest;
  lane: Lane;
  compute: ComputeBlock;
  timeoutMs: number;
  queuedAt: number;
  settled: boolean;
  resolve: (r: JobResult) => void;
  reject: (e: Error) => void;
  detach: () => void;
  /** Set while a worker runs the job. */
  live?: Live;
}

interface Live {
  id: number;
  slot: Slot;
  worker: Worker;
  state: "starting" | "idle" | "busy" | "stopping";
  jobs: number;
  flag: Int32Array;
  current?: { msgId: number; pending: Pending; timer?: NodeJS.Timeout; cancelTimer?: NodeJS.Timeout };
  exited: Promise<void>;
}

interface Slot {
  index: number;
  reserved: boolean;
  live?: Live;
}

export function createPool(options: PoolOptions = {}): Pool {
  const size = poolSize(options);
  const recycleBytes = options.recycleBytes ?? DEFAULT_POOL_OPTIONS.recycleBytes;
  const maxJobs = options.maxJobsPerWorker ?? DEFAULT_POOL_OPTIONS.maxJobsPerWorker;
  const jobTimeoutMs = options.jobTimeoutMs ?? DEFAULT_POOL_OPTIONS.jobTimeoutMs;
  const memoryLimitBytes = options.memoryLimitBytes ?? Math.max(DEFAULT_POOL_OPTIONS.memoryLimitBytes, recycleBytes);
  const cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const entry = options.workerEntry ?? WORKER_ENTRY;
  const log = options.log ?? ((line: string) => void process.stderr.write(line + "\n"));
  for (const [name, v] of [["recycleBytes", recycleBytes], ["maxJobsPerWorker", maxJobs], ["jobTimeoutMs", jobTimeoutMs], ["memoryLimitBytes", memoryLimitBytes]] as const) {
    if (!(v > 0)) throw new RangeError(`${name} must be greater than 0, got ${v}`);
  }

  const inventory = deviceInventory({ pool: { size, recycleBytes } });
  const reserved = interactiveReserved(size);
  const slots: Slot[] = Array.from({ length: size }, (_, index) => ({ index, reserved: index < reserved }));
  const queues: Record<Lane, Pending[]> = { interactive: [], batch: [] };
  const counters = { recycled: 0, timedOut: 0, crashed: 0, completed: 0 };
  let nextWorkerId = 1;
  let nextMsgId = 1;
  let startFailures = 0;
  let workerInitMs: number | undefined;
  let closed = false;
  const stopping = new Set<Promise<void>>();

  const failure = (p: Pending, error: ScriptError, workerId = -1): JobResult => ({
    ok: false,
    kind: p.job.kind,
    error,
    logs: [],
    stats: { workerId, jobs: 0, wallMs: Math.round((performance.now() - p.queuedAt) * 10) / 10, memoryBytes: 0, liveShapes: 0 },
    compute: p.compute,
  });

  const settle = (p: Pending, result: JobResult) => {
    if (p.settled) return;
    p.settled = true;
    p.detach();
    p.resolve(result);
  };

  // ---- workers --------------------------------------------------------------------------

  function spawn(slot: Slot): Live {
    const id = nextWorkerId++;
    const cancelFlag = new SharedArrayBuffer(4);
    const init: WorkerInit = { workerId: id, cancelFlag, memoryLimitBytes };
    const resourceLimits = { stackSizeMb: 8, maxOldGenerationSizeMb: DEFAULT_POOL_OPTIONS.maxOldGenerationSizeMb };
    const worker = new Worker(entry, { workerData: init, stdout: true, stderr: true, resourceLimits });
    let markExited: () => void = () => {};
    const live: Live = { id, slot, worker, state: "starting", jobs: 0, flag: new Int32Array(cancelFlag), exited: new Promise((r) => (markExited = r)) };
    slot.live = live;
    drain(worker.stdout, `[worker ${id} stdout]`, log);
    drain(worker.stderr, `[worker ${id}]`, log);
    worker.on("message", (m: FromWorker) => onMessage(live, m));
    worker.on("error", (e) => died(live, `worker ${id} failed: ${e.message}`));
    worker.on("exit", (code) => {
      markExited();
      died(live, `worker ${id} exited with code ${code}`);
    });
    return live;
  }

  function onMessage(live: Live, m: FromWorker): void {
    if (live.state === "stopping") return;
    if (m.type === "ready") {
      startFailures = 0;
      workerInitMs = m.initMs;
      live.state = "idle";
      dispatch();
    } else if (m.type === "fatal") {
      died(live, `worker ${live.id} could not start: ${m.message}`);
    } else if (m.type === "memory") {
      overMemory(live, m.bytes, m.limit);
    } else if (m.type === "result") {
      const current = live.current;
      if (!current || current.msgId !== m.id) return;
      clearTimeout(current.timer);
      clearTimeout(current.cancelTimer);
      live.current = undefined;
      counters.completed++;
      settle(current.pending, m.result);
      const reason = m.recycle ?? (live.jobs >= maxJobs ? `${live.jobs} jobs` : m.result.stats.memoryBytes > recycleBytes ? `memory ${m.result.stats.memoryBytes} bytes` : undefined);
      if (reason) {
        counters.recycled++;
        log(`[pool] recycling worker ${live.id}: ${reason}`);
        retire(live);
        refill(live.slot);
      } else {
        live.state = "idle";
      }
      dispatch();
    }
  }

  // A worker ended without being asked to: an uncaught error, process.exit, out of memory,
  // or a fatal start. Its job fails; the pool goes on with a fresh worker.
  function died(live: Live, why: string): void {
    if (live.state === "stopping") return;
    const wasStarting = live.state === "starting";
    stop(live);
    counters.crashed++;
    log(`[pool] ${why}`);
    const current = live.current;
    if (current) {
      clearTimeout(current.timer);
      clearTimeout(current.cancelTimer);
      live.current = undefined;
      settle(current.pending, failure(current.pending, {
        code: "WORKER_CRASHED",
        message: `the worker running this job stopped: ${why}`,
        hint: "The pool replaced the worker. Run the job again; if it crashes again, report it with the script.",
      }, live.id));
    }
    if (wasStarting && ++startFailures >= MAX_START_FAILURES) {
      startFailures = 0;
      for (const lane of ["interactive", "batch"] as const) {
        for (const p of queues[lane].splice(0)) {
          settle(p, failure(p, { code: "WORKER_CRASHED", message: `workers fail to start: ${why}`, hint: "Run open3dj doctor to check the kernel install." }));
        }
      }
      return;
    }
    if (!wasStarting) refill(live.slot);
    dispatch();
  }

  // Take the worker out of its slot and terminate it. Its exit is not a crash.
  function stop(live: Live): void {
    live.state = "stopping";
    if (live.slot.live === live) live.slot.live = undefined;
    const done = live.worker.terminate().then(() => live.exited, () => live.exited);
    const tracked = done.then(() => {}, () => {});
    stopping.add(tracked);
    void tracked.then(() => stopping.delete(tracked));
  }

  function retire(live: Live): void {
    stop(live);
  }

  // A slot that had a worker gets a new one now, so recycling does not add latency later.
  function refill(slot: Slot): void {
    if (!closed && !slot.live) spawn(slot);
  }

  // ---- scheduling -----------------------------------------------------------------------

  const canTake = (slot: Slot, lane: Lane) => lane === "interactive" || !slot.reserved;

  function dispatch(): void {
    if (closed) return;
    const claimed = new Set<Slot>();
    for (const lane of ["interactive", "batch"] as const) {
      const queue = queues[lane];
      // Interactive jobs try the reserved slot first, so batch workers stay free for batch.
      const order = lane === "interactive" ? [...slots].sort((a, b) => Number(b.reserved) - Number(a.reserved)) : slots;
      for (const slot of order) {
        if (queue.length === 0) break;
        if (!canTake(slot, lane) || claimed.has(slot)) continue;
        if (slot.live?.state === "idle") start(slot.live, queue.shift()!);
      }
      // Start workers for the jobs still waiting, counting those already starting.
      let waiting = queue.length;
      for (const slot of order) {
        if (waiting === 0) break;
        if (!canTake(slot, lane) || claimed.has(slot)) continue;
        if (slot.live?.state === "starting") {
          claimed.add(slot);
          waiting--;
        } else if (!slot.live) {
          spawn(slot);
          claimed.add(slot);
          waiting--;
        }
      }
    }
  }

  function start(live: Live, pending: Pending): void {
    const msgId = nextMsgId++;
    Atomics.store(live.flag, 0, 0);
    live.state = "busy";
    live.jobs++;
    pending.live = live;
    const timer = setTimeout(() => timeout(live, msgId), pending.timeoutMs);
    live.current = { msgId, pending, timer };
    const message: ToWorker = { type: "job", id: msgId, job: { ...pending.job, compute: pending.compute }, jobs: live.jobs };
    live.worker.postMessage(message);
  }

  function timeout(live: Live, msgId: number): void {
    const current = live.current;
    if (!current || current.msgId !== msgId || live.state === "stopping") return;
    live.current = undefined;
    counters.timedOut++;
    log(`[pool] job on worker ${live.id} passed its ${current.pending.timeoutMs} ms deadline; terminating the worker`);
    settle(current.pending, failure(current.pending, {
      code: "JOB_TIMEOUT",
      message: `the job ran longer than ${current.pending.timeoutMs} ms and was stopped`,
      hint: "Simplify the script (fewer booleans, fillets or patterned features), or split the design into parts.",
    }, live.id));
    stop(live);
    refill(live.slot);
    dispatch();
  }

  // The worker's guard refused a WebAssembly memory growth: end the job now, before the
  // kernel thrashes or the machine runs out of memory, and start a fresh worker.
  function overMemory(live: Live, bytes: number, limit: number): void {
    const current = live.current;
    log(`[pool] worker ${live.id} asked for ${bytes} bytes of WebAssembly memory, over its memory limit of ${limit}; terminating it`);
    if (current) {
      clearTimeout(current.timer);
      clearTimeout(current.cancelTimer);
      live.current = undefined;
      settle(current.pending, failure(current.pending, {
        code: "JOB_MEMORY",
        message: `the job needed more than ${Math.round(limit / 1024 ** 2)} MiB of kernel memory and was stopped`,
        hint: "Make the part smaller or simpler (fewer patterned features, smaller sizes), or split it into parts. Sizes are in mm.",
      }, live.id));
    }
    counters.recycled++;
    stop(live);
    refill(live.slot);
    dispatch();
  }

  function cancel(p: Pending): void {
    if (p.settled) return;
    const queue = queues[p.lane];
    const at = queue.indexOf(p);
    if (at >= 0) queue.splice(at, 1);
    settle(p, failure(p, { code: "JOB_CANCELLED", message: "the job was cancelled" }, p.live?.id));
    const live = p.live;
    if (!live || live.current?.pending !== p) return;
    // Ask the worker to stop at its next check; terminate it if it does not answer in time.
    Atomics.store(live.flag, 0, 1);
    clearTimeout(live.current.timer);
    const msgId = live.current.msgId;
    live.current.cancelTimer = setTimeout(() => {
      if (live.current?.msgId !== msgId || live.state === "stopping") return;
      live.current = undefined;
      log(`[pool] worker ${live.id} did not stop within ${cancelGraceMs} ms of a cancel; terminating it`);
      stop(live);
      refill(live.slot);
      dispatch();
    }, cancelGraceMs);
  }

  // ---- the Pool -------------------------------------------------------------------------

  const placeFor = (mode: ComputeMode, kind: JobKind) => place(mode, kind, inventory);

  if (options.warm) for (const slot of slots) spawn(slot);

  return {
    run(job: JobRequest, runOptions: RunOptions = {}): Promise<JobResult> {
      if (closed) return Promise.reject(new ComputeError("POOL_CLOSED", "the pool is closed"));
      const lane: Lane = runOptions.lane ?? (job.kind === "export" ? "batch" : "interactive");
      const timeoutMs = runOptions.timeoutMs ?? jobTimeoutMs;
      if (!(timeoutMs > 0)) return Promise.reject(new RangeError(`timeoutMs must be greater than 0, got ${timeoutMs}`));
      return new Promise<JobResult>((resolve, reject) => {
        const pending: Pending = {
          job, lane, timeoutMs, resolve, reject,
          compute: job.compute ?? { backend: "none", device: "none", placement_reason: "not placed" },
          queuedAt: performance.now(),
          settled: false,
          detach: () => {},
        };
        if (!job.compute) {
          const mode = runOptions.mode ?? "auto";
          try {
            pending.compute = placeFor(mode, job.kind);
          } catch (e) {
            if (!(e instanceof ComputeError)) throw e;
            pending.compute = { backend: "none", device: "none", placement_reason: `${mode}: ${e.message}` };
            settle(pending, failure(pending, { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }));
            return;
          }
        }
        const signal = runOptions.signal;
        if (signal) {
          if (signal.aborted) {
            settle(pending, failure(pending, { code: "JOB_CANCELLED", message: "the job was cancelled before it started" }));
            return;
          }
          const onAbort = () => cancel(pending);
          signal.addEventListener("abort", onAbort, { once: true });
          pending.detach = () => signal.removeEventListener("abort", onAbort);
        }
        queues[lane].push(pending);
        dispatch();
      });
    },

    stats(): PoolStats {
      const lives = slots.flatMap((s) => (s.live ? [s.live] : []));
      return {
        size,
        workers: lives.length,
        busy: lives.filter((l) => l.state === "busy").length,
        queued: { interactive: queues.interactive.length, batch: queues.batch.length },
        ...counters,
        ...(workerInitMs === undefined ? {} : { workerInitMs }),
      };
    },

    place: placeFor,

    async close(): Promise<void> {
      if (closed) {
        await Promise.all([...stopping]);
        return;
      }
      closed = true;
      const error = () => new ComputeError("POOL_CLOSED", "the pool closed before the job finished");
      for (const lane of ["interactive", "batch"] as const) {
        for (const p of queues[lane].splice(0)) {
          if (!p.settled) {
            p.settled = true;
            p.detach();
            p.reject(error());
          }
        }
      }
      for (const slot of slots) {
        const live = slot.live;
        if (!live) continue;
        const current = live.current;
        if (current) {
          clearTimeout(current.timer);
          clearTimeout(current.cancelTimer);
          live.current = undefined;
          if (!current.pending.settled) {
            current.pending.settled = true;
            current.pending.detach();
            current.pending.reject(error());
          }
        }
        stop(live);
      }
      await Promise.all([...stopping]);
    },
  };
}

// Read a worker stream line by line into the log. Reading also keeps the stream from
// buffering without bound.
function drain(stream: Readable, prefix: string, log: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trimEnd();
      // OCCT pads its transfer statistics with blank lines; they carry nothing.
      if (line.trim()) log(`${prefix} ${line}`);
      buffer = buffer.slice(nl + 1);
    }
  });
  stream.on("end", () => {
    if (buffer) log(`${prefix} ${buffer}`);
    buffer = "";
  });
}
