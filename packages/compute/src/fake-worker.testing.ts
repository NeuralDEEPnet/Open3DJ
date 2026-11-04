// A fake pool worker for the pool's failure tests. It speaks the worker protocol without a
// kernel. The script text picks the behaviour: "crash" exits the thread, "throw" throws an
// uncaught error, "hang" never answers, "print" writes to stdout and stderr, anything else
// succeeds at once. "grow" grows WebAssembly memory without end. fake-fatal-worker.testing.ts is the variant that cannot start.
import { parentPort, workerData } from "node:worker_threads";
import { installMemoryGuard } from "./memory-guard.ts";
import type { FromWorker, ToWorker, WorkerInit } from "./protocol.ts";
import type { JobResult } from "./types.ts";

const port = parentPort!;
const init = workerData as WorkerInit;
const post = (m: FromWorker) => port.postMessage(m);
if (init.memoryLimitBytes) installMemoryGuard(init.memoryLimitBytes, (bytes) => post({ type: "memory", bytes, limit: init.memoryLimitBytes! }));

port.on("message", (m: ToWorker) => {
  const { script } = m.job;
  if (script === "crash") process.exit(3);
  if (script === "throw") {
    setTimeout(() => {
      throw new Error("fake uncaught error");
    });
    return;
  }
  if (script === "hang") return;
  if (script === "grow") {
    // Grow like a kernel does, swallowing the failure (as Emscripten's resize does) and
    // spinning on, so only the pool's reaction can stop the job.
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 65536 });
    for (;;) {
      try {
        mem.grow(256);
      } catch {
        // the guard refused; a real kernel would retry or fail later
      }
    }
  }
  if (script === "print") {
    console.log("fake stdout line");
    process.stderr.write("fake stderr line\n");
  }
  const result: JobResult = {
    ok: false,
    kind: m.job.kind,
    error: { code: "FAKE_DONE", message: "fake worker finished" },
    logs: [],
    stats: { workerId: init.workerId, jobs: m.jobs, wallMs: 0, memoryBytes: 1, liveShapes: 0 },
    compute: m.job.compute!,
  };
  post({ type: "result", id: m.id, result });
});
post({ type: "ready", initMs: 0 });
