// worker_threads entry: one OCCT kernel per worker; messages {id, method, params} -> {id, ok, result|error}
import { parentPort, workerData } from "node:worker_threads";
import { createKernelCore } from "./kernel-core.mjs";

const core = await createKernelCore({ deps: workerData.deps, printHook: workerData.printHook });
parentPort.on("message", async ({ id, method, params }) => {
  try {
    const result = await core.handle(method, params);
    const transfer = result?.png ? [result.png.buffer] : [];
    parentPort.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: { message: String(e?.message ?? e), code: e?.code } });
  }
});
parentPort.postMessage({ ready: true, initMs: core.initMs });
