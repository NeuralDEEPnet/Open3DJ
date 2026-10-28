// Worker entry for the CPU pool. The pool loads it with
//   new Worker(WORKER_ENTRY, { stdout: true, stderr: true, workerData: WorkerInit }).
// Protocol (protocol.ts, structured clone over parentPort):
//   parent -> worker: { type: "job", id, job: JobRequest, jobs }
//   worker -> parent: { type: "ready", initMs } once the kernel is loaded,
//                     { type: "result", id, result: JobResult, recycle? } per job,
//                     { type: "memory", bytes, limit } when WebAssembly memory hits the cap,
//                     { type: "fatal", message } when the kernel cannot load.
// Kernel output goes to this thread's stderr, which the pool captures; nothing here writes to
// stdout on purpose, and the captured stdout stream catches anything that does.
import { parentPort, workerData } from "node:worker_threads";
import { initKernel } from "@open3dj/kernel";
import { createJobRunner, redactPaths } from "./job.ts";
import { installMemoryGuard } from "./memory-guard.ts";
import type { FromWorker, ToWorker, WorkerInit } from "./protocol.ts";
import type { JobResult } from "./types.ts";

const port = parentPort;
if (!port) throw new Error("worker.ts must run in a worker thread");
const init = workerData as WorkerInit;
const flag = new Int32Array(init.cancelFlag);
const signal = { get aborted() { return Atomics.load(flag, 0) === 1; } };
const post = (message: FromWorker, transfer: ArrayBuffer[] = []) => {
  try {
    port.postMessage(message, transfer);
  } catch {
    // A buffer that cannot move (for example one backed by WebAssembly memory) is copied instead.
    port.postMessage(message);
  }
};

// Installed before the kernel loads, so every WebAssembly memory of this thread is capped.
// postMessage works while this thread is stuck in a long kernel call; the pool then ends it.
const limit = init.memoryLimitBytes;
if (limit) installMemoryGuard(limit, (bytes) => post({ type: "memory", bytes, limit }));

try {
  const t0 = performance.now();
  const kernel = await initKernel({ sink: (stream, line) => process.stderr.write(`[kernel ${stream}] ${line}\n`) });
  const runner = createJobRunner(kernel);
  // Jobs run one at a time: the pool never sends a second job before the result.
  port.on("message", (message: ToWorker) => {
    if (message.type !== "job") return;
    void runner.run(message.job, { workerId: init.workerId, jobs: message.jobs, signal }).then(({ result, recycle }) => {
      post({ type: "result", id: message.id, result, ...(recycle ? { recycle } : {}) }, transferables(result));
    });
  });
  post({ type: "ready", initMs: Math.round(performance.now() - t0) });
} catch (e) {
  post({ type: "fatal", message: redactPaths(e instanceof Error ? e.message : String(e)) });
}

// Image and artifact bytes move to the parent instead of being copied. Only whole buffers
// owned by one view can move.
function transferables(result: JobResult): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  if (!result.ok) return [];
  for (const item of [...(result.images ?? []), ...(result.artifacts ?? [])]) {
    const b = item.bytes.buffer;
    if (b instanceof ArrayBuffer && item.bytes.byteOffset === 0 && item.bytes.byteLength === b.byteLength) out.add(b);
  }
  return [...out];
}
