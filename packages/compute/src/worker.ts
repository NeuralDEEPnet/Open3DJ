// Worker entry for the CPU pool. Loaded with new Worker(WORKER_ENTRY, { stdout: true,
// stderr: true, workerData }). Protocol (structured clone over parentPort):
//   parent -> worker: { type: "job", id: number, job: JobRequest }
//   worker -> parent: { type: "ready", initMs } once the kernel is loaded,
//                     { type: "result", id, result: JobResult } per job (buffers transferred).
// The worker never writes to process.stdout on purpose; its stdout stream is captured anyway.
import { parentPort } from "node:worker_threads";

parentPort?.postMessage({ type: "fatal", message: "compute worker is not implemented yet" });
