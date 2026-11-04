import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
const DEPS = process.argv[2]; const JOBS = 48, PER = 2;
const workerFile = fileURLToPath(new URL("./pool_worker.mjs", import.meta.url));
async function run(nWorkers) {
  const ws = await Promise.all(Array.from({ length: nWorkers }, () => new Promise(res => { const w = new Worker(workerFile, { workerData: { deps: DEPS }, stdout: true }); w.once("message", () => res(w)); })));
  const t = performance.now(); let next = 0, done = 0;
  await new Promise(res => { const feed = (w) => { if (next >= JOBS) return; const seed = next++; w.once("message", () => { done++; if (done === JOBS) res(); else feed(w); }); w.postMessage({ n: PER, seed }); }; ws.forEach(feed); });
  const ms = performance.now() - t; await Promise.all(ws.map(w => w.terminate()));
  return { workers: nWorkers, rebuilds: JOBS * PER, wall_ms: Math.round(ms), rebuilds_per_s: +((JOBS * PER) / (ms / 1000)).toFixed(1) };
}
const out = []; for (const n of [1, 2, 3, 4]) out.push(await run(n));
const base = out[0].rebuilds_per_s; out.forEach(o => o.speedup = +(o.rebuilds_per_s / base).toFixed(2));
console.log(JSON.stringify(out)); console.log("rss_mb", Math.round(process.memoryUsage().rss / 1e6));
