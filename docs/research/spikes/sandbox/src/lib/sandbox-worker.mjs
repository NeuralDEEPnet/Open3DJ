// Worker entry: owns one occt-wasm kernel and compiles QuickJS once. Every run gets a FRESH
// QuickJS wasm instance with a capped WebAssembly.Memory. Kernel stdout (OCCT prints from
// its STEP writer via console.log) goes to this worker's stdout stream, which the parent
// captures (Worker option stdout: true) instead of letting it reach the MCP stdio channel.
import { parentPort, workerData } from "node:worker_threads";
import { loadQuickJS, loadKernel, runScript } from "./bridge.mjs";
import { now } from "./util.mjs";

const t0 = now();
const qjs = await loadQuickJS(workerData.deps, workerData.variant || "quickjs");
const kernel = await loadKernel(workerData.deps);
await qjs.fresh(workerData.qjsMaxMiB || 128); // warm the compile cache
parentPort.postMessage({ type: "ready", init_ms: now() - t0 });

parentPort.on("message", async (m) => {
  if (m.type !== "run") return;
  const t = now();
  const fresh = await qjs.fresh(m.limits?.qjsMaxMiB || workerData.qjsMaxMiB || 128);
  const instMs = now() - t;
  const reports = [];
  const extraOps = m.test ? {
    report: (s) => { reports.push(String(s).slice(0, 4000)); return 0; },
    // test-only hooks that simulate host-side failures
    hostThrow: () => { throw new Error("simulated kernel exception"); },
    workerExit: () => { process.exit(70); },
    stepExport: () => 0,
  } : null;
  let res;
  try {
    res = runScript({ qjs: fresh, kernel, code: m.code, params: m.params || {}, limits: m.limits || {}, extraOps,
      onPart: m.exportStep ? (kh, part) => { part.step_bytes = kernel.exportStep(kh).length; } : null });
  } catch (e) { res = { ok: false, error: { kind: "host-exception", message: String(e && e.message || e).slice(0, 500) } }; }
  res.timings.instantiate_ms = instMs;
  res.reports = reports;
  res.kernel_heap_mib = kernelHeapMiB();
  parentPort.postMessage({ type: "result", id: m.id, res });
});

function kernelHeapMiB() {
  try { return Math.round(process.memoryUsage().arrayBuffers / 1048576); } catch { return null; }
}
