// One init measurement in a fresh process. Prints one JSON line on stdout.
// usage: node [v8 flags] init_probe.mjs <deps> <mode> [serializedModulePath]
// modes: default | bytes | precompiled | second | serialize-write | serialize-read | worker-self | worker-shared
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import v8 from "node:v8";
import { loadKernel, buildPart, procMem, now, heapMiB } from "./lib.mjs";

const T0 = now();
const [DEPS, MODE, SER] = process.argv.slice(2);
const WASM = `${DEPS}/node_modules/occt-wasm/dist/occt-wasm.wasm`;
const out = { mode: MODE, execArgv: process.execArgv.join(" ") };

async function firstBuilds(k) {
  const t = [];
  for (let i = 0; i < 5; i++) { const s = now(); const m = k.checkpoint(); buildPart(k, { w: 60 + i }); k.releaseSince(m); t.push(+(now() - s).toFixed(1)); }
  return t;
}

if (MODE === "default") {
  const r = await loadKernel(DEPS);
  out.timings = r.timings; out.first_builds_ms = await firstBuilds(r.k);
} else if (MODE === "bytes") {
  const s = now(); const bytes = readFileSync(WASM); out.read_ms = now() - s;
  const r = await loadKernel(DEPS, { wasmBytes: bytes });
  out.timings = r.timings; out.first_builds_ms = await firstBuilds(r.k);
} else if (MODE === "precompiled") {
  const bytes = readFileSync(WASM);
  let s = now(); const mod = await WebAssembly.compile(bytes); out.compile_ms = now() - s;
  const r = await loadKernel(DEPS, { wasmModule: mod });
  out.timings = r.timings; out.first_builds_ms = await firstBuilds(r.k);
} else if (MODE === "second") {
  const r1 = await loadKernel(DEPS); out.first = r1.timings; out.first_builds_ms = await firstBuilds(r1.k);
  const r2 = await loadKernel(DEPS); out.timings = r2.timings; out.second_builds_ms = await firstBuilds(r2.k);
  out.heap_two_kernels = [heapMiB(r1.mod), heapMiB(r2.mod)];
} else if (MODE === "serialize-write") {
  const bytes = readFileSync(WASM);
  const mod = await WebAssembly.compile(bytes);
  try { const buf = v8.serialize(mod); writeFileSync(SER, buf); out.serialized_bytes = buf.length; }
  catch (e) { out.serialize_error = String(e?.message ?? e); }
} else if (MODE === "serialize-read") {
  try {
    const s = now(); const mod = v8.deserialize(readFileSync(SER)); out.deserialize_ms = now() - s;
    out.is_module = mod instanceof WebAssembly.Module;
    const r = await loadKernel(DEPS, { wasmModule: mod }); out.timings = r.timings; out.first_builds_ms = await firstBuilds(r.k);
  } catch (e) { out.deserialize_error = String(e?.message ?? e); }
} else if (MODE === "worker-self" || MODE === "worker-shared") {
  const src = `
    import { parentPort, workerData } from "node:worker_threads";
    const lib = await import(workerData.lib);
    const s = performance.now();
    const r = await lib.loadKernel(workerData.deps, workerData.mod ? { wasmModule: workerData.mod } : {});
    const init = performance.now() - s;
    const b = performance.now(); lib.buildPart(r.k, { w: 66 }); const build = performance.now() - b;
    parentPort.postMessage({ init_ms: init, timings: r.timings, first_build_ms: build });`;
  let mod = null;
  if (MODE === "worker-shared") { const s = now(); mod = await WebAssembly.compile(readFileSync(WASM)); out.compile_ms = now() - s; }
  const results = [];
  for (let i = 0; i < 4; i++) {
    const s = now();
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(src)}`), {
      workerData: { lib: new URL("./lib.mjs", import.meta.url).href, deps: DEPS, mod }, stdout: true, stderr: true,
    });
    const msg = await new Promise((res, rej) => { w.once("message", res); w.once("error", rej); });
    msg.spawn_to_ready_ms = now() - s - msg.first_build_ms;
    results.push(msg); await w.terminate();
  }
  out.workers = results;
}
out.process_total_ms = now() - T0;
out.mem = procMem();
process.stdout.write(JSON.stringify(out) + "\n");
