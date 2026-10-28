// Does terminating a worker give its WASM memory back? And what does a recycle cost?
// usage: node recycle.mjs <deps> <iters-without-release>
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { procMem, now } from "./lib.mjs";
const [DEPS, NS = "1500"] = process.argv.slice(2);
const WASM = `${DEPS}/node_modules/occt-wasm/dist/occt-wasm.wasm`;
const src = `
  import { parentPort, workerData } from "node:worker_threads";
  const lib = await import(workerData.lib);
  const r = await lib.loadKernel(workerData.deps, workerData.mod ? { wasmModule: workerData.mod } : {});
  parentPort.postMessage({ ready: true, heap: lib.heapMiB(r.mod) });
  parentPort.on("message", ({ n, release }) => {
    const t = performance.now();
    for (let i = 0; i < n; i++) { const m = r.k.checkpoint(); lib.buildPart(r.k, { w: 60 + i * 0.01 }); if (release) r.k.releaseSince(m); }
    if (release === "all") r.k.releaseAll();
    parentPort.postMessage({ done: true, ms: performance.now() - t, heap: lib.heapMiB(r.mod), shapes: r.k.shapeCount });
  });`;
const url = new URL(`data:text/javascript,${encodeURIComponent(src)}`);
const mod = await WebAssembly.compile(readFileSync(WASM));
const spawn = async () => {
  const s = now();
  const w = new Worker(url, { workerData: { lib: new URL("./lib.mjs", import.meta.url).href, deps: DEPS, mod } });
  const m = await new Promise((res, rej) => { w.once("message", res); w.once("error", rej); });
  return { w, spawn_ms: +(now() - s).toFixed(1), heap: m.heap };
};
const ask = (w, msg) => new Promise((res) => { w.once("message", res); w.postMessage(msg); });
const log = [];
const mark = (label, extra = {}) => { const e = { label, ...procMem(), ...extra }; log.push(e); process.stderr.write(JSON.stringify(e) + "\n"); };
mark("main start");
let { w, spawn_ms, heap } = await spawn(); mark("worker1 ready", { spawn_ms, heap });
let r = await ask(w, { n: +NS, release: false }); mark(`worker1 after ${NS} rebuilds, no release`, r);
r = await ask(w, { n: 1, release: "all" }); mark("worker1 after releaseAll", r);
let s = now(); await w.terminate(); const term_ms = +(now() - s).toFixed(1);
globalThis.gc?.(); mark("after terminate", { term_ms });
({ w, spawn_ms, heap } = await spawn()); mark("worker2 ready (recycled, shared Module)", { spawn_ms, heap });
s = now(); r = await ask(w, { n: 1, release: true }); mark("worker2 first rebuild", { ms: +(now() - s).toFixed(1) });
r = await ask(w, { n: 20, release: true }); mark("worker2 next 20 rebuilds", { per_ms: +(r.ms / 20).toFixed(1) });
await w.terminate(); mark("end");
process.stdout.write(JSON.stringify(log) + "\n");
