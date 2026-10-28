// What happens at the 4 GiB wasm32 ceiling? Fill the heap fast inside a worker, then keep rebuilding
// the part one at a time while the main thread watches. A stuck worker is terminated by a watchdog.
// usage: node ceiling_probe.mjs <deps> <fillTargetMiB> <watchdogMs>
import { Worker } from "node:worker_threads";
import { procMem, now } from "./lib.mjs";
const [DEPS, TARGET = "3900", WATCHDOG = "60000", EVAL = "noeval"] = process.argv.slice(2);
const src = `
  import { parentPort, workerData } from "node:worker_threads";
  const lib = await import(workerData.lib);
  const r = await lib.loadKernel(workerData.deps);
  const k = r.k; const hp = () => lib.heapMiB(r.mod);
  // fast fill: keep many small box handles alive (each holds its own B-rep)
  let n = 0;
  try {
    while (hp() < workerData.target) {
      for (let j = 0; j < 1000; j++) { k.makeBox(1 + (n % 7), 2, 3); n++; }
      if (n % 200000 === 0) parentPort.postMessage({ phase: "fill", n, heap: hp() });
    }
  } catch (e) { parentPort.postMessage({ phase: "fill-error", n, heap: hp(), err: String(e?.message ?? e).slice(0, 300) }); }
  parentPort.postMessage({ phase: "filled", n, heap: hp(), hw: lib.heapHighWaterMiB(r.mod) });
  for (let i = 0; ; i++) {
    const t = performance.now();
    try { const p = lib.buildPart(k, { w: 60 + i * 0.01 }); if (workerData.eval) { k.getVolume(p); k.tessellate(p, { linearDeflection: 0.1, angularDeflection: 0.5 }); } }
    catch (e) {
      parentPort.postMessage({ phase: "build-error", i, ms: performance.now() - t, heap: hp(), hw: lib.heapHighWaterMiB(r.mod), err: String(e?.message ?? e).slice(0, 300), name: e?.name });
      // can the instance still work after the error?
      try { k.releaseAll(); const b = k.makeBox(1, 2, 3); parentPort.postMessage({ phase: "after-error", ok: true, vol: k.getVolume(b), heap: hp() }); }
      catch (e2) { parentPort.postMessage({ phase: "after-error", ok: false, err: String(e2?.message ?? e2).slice(0, 300) }); }
      break;
    }
    parentPort.postMessage({ phase: "build", i, ms: performance.now() - t, heap: hp(), hw: lib.heapHighWaterMiB(r.mod) });
  }
  parentPort.postMessage({ phase: "exit" });`;
const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(src)}`), {
  workerData: { lib: new URL("./lib.mjs", import.meta.url).href, deps: DEPS, target: +TARGET, eval: EVAL === "eval" }, stdout: true, stderr: true,
});
const events = []; let last = now(); let lastMsg = null; const T0 = now();
const log = (e) => { e.t_s = +((now() - T0) / 1000).toFixed(1); events.push(e); process.stderr.write(JSON.stringify(e) + "\n"); };
w.on("message", (m) => { last = now(); lastMsg = m; log(m); if (m.phase === "exit") finish("worker-exit"); });
w.on("error", (e) => { log({ phase: "worker-error", err: String(e?.message ?? e).slice(0, 400) }); finish("worker-error"); });
w.on("exit", (code) => { log({ phase: "worker-exited", code }); finish("exited"); });
let done = false;
async function finish(why) {
  if (done) return; done = true; clearInterval(timer);
  const s = now(); await w.terminate().catch(() => {}); const term = now() - s;
  log({ phase: "end", why, terminate_ms: +term.toFixed(1), main_mem_after_terminate: procMem() });
  process.stdout.write(JSON.stringify(events) + "\n"); process.exit(0);
}
const timer = setInterval(() => {
  if (now() - last > +WATCHDOG) { log({ phase: "WATCHDOG", silent_ms: Math.round(now() - last), lastMsg, mem: procMem() }); finish("watchdog"); }
}, 1000);
