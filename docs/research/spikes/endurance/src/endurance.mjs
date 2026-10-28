// Endurance: N parametric rebuilds in ONE kernel instance under a memory strategy.
// usage: node endurance.mjs <deps> <strategy:none|release|checkpoint|releaseAll> <iters> <out.json> [sampleEvery] [noEval]
import { writeFileSync } from "node:fs";
import { loadKernel, buildPart, heapMiB, heapHighWaterMiB, procMem, now, median, pct, depsInfo } from "./lib.mjs";

const [DEPS, STRATEGY, ITERS = "5000", OUT, EVERY = "250", NOEVAL] = process.argv.slice(2);
const N = +ITERS, every = +EVERY, doEval = NOEVAL !== "noEval";
const { k, mod, timings } = await loadKernel(DEPS);
const res = {
  strategy: STRATEGY, iters: N, eval: doEval, node: process.version, occt_wasm: depsInfo(DEPS),
  init: timings, start: { heap_mib: heapMiB(mod), ...procMem() }, samples: [], error: null,
};
let win = [], all = [], volSum = 0, tris = 0;
const t0 = now();
let i = 0;
try {
  for (i = 0; i < N; i++) {
    const p = { w: 60 + i * 0.004, holeR: 1.6 + (i % 5) * 0.05 };
    const s = now();
    const mark = STRATEGY === "checkpoint" ? k.checkpoint() : null;
    const made = STRATEGY === "release" ? [] : null;
    const part = buildPart(k, p, made);
    if (doEval) {
      volSum += k.getVolume(part);
      const m = k.tessellate(part, { linearDeflection: 0.1, angularDeflection: 0.5 });
      tris = m.triangleCount;
    }
    if (STRATEGY === "release") for (const h of made) k.release(h);
    else if (STRATEGY === "checkpoint") k.releaseSince(mark);
    else if (STRATEGY === "releaseAll") k.releaseAll();
    const ms = now() - s;
    win.push(ms); all.push(ms);
    if ((i + 1) % every === 0 || i === 0) {
      const mu = process.memoryUsage();
      const smp = {
        iter: i + 1, elapsed_s: +((now() - t0) / 1000).toFixed(1), heap_mib: heapMiB(mod), heap_hw_mib: heapHighWaterMiB(mod), ...procMem(),
        js_heap_mib: +(mu.heapUsed / 1048576).toFixed(1), shapeCount: k.shapeCount,
        win_median_ms: +median(win).toFixed(1), win_p95_ms: +pct(win, 95).toFixed(1), tris,
      };
      res.samples.push(smp); win = [];
      process.stderr.write(`[${STRATEGY}] ${JSON.stringify(smp)}\n`);
    }
  }
} catch (e) {
  res.error = { iter: i, message: String(e?.message ?? e).slice(0, 400), name: e?.name, code: e?.code, heap_mib: heapMiB(mod), ...procMem() };
  process.stderr.write(`[${STRATEGY}] ERROR at ${i}: ${res.error.message}\n`);
  // Is the kernel still usable after the failure?
  try { k.releaseAll(); const b = k.makeBox(1, 2, 3); res.error.usable_after = { vol: k.getVolume(b), heap_mib: heapMiB(mod) }; }
  catch (e2) { res.error.usable_after = { error: String(e2?.message ?? e2).slice(0, 300) }; }
}
res.completed = i;
res.total_s = +((now() - t0) / 1000).toFixed(1);
res.ms = { median: +median(all).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1), max: +Math.max(...all).toFixed(1),
  first250_median: +median(all.slice(0, 250)).toFixed(1), last250_median: +median(all.slice(-250)).toFixed(1) };
res.end = { heap_mib: heapMiB(mod), ...procMem(), shapeCount: k.shapeCount };
res.volSum = volSum;
writeFileSync(OUT, JSON.stringify(res, null, 1));
process.stderr.write(`[${STRATEGY}] done ${JSON.stringify({ completed: i, total_s: res.total_s, ms: res.ms, end: res.end })}\n`);
