// Spike: job-level CPU parallelism with one single-threaded occt-wasm kernel per worker_thread.
// Usage: node occt-pool.mjs <path-to-occt-wasm/dist/index.js> <jobs> <workers...>
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

if (!isMainThread) {
  const { OcctKernel } = await import(`file://${workerData.lib}`);
  const t0 = performance.now();
  const k = await OcctKernel.init();
  const initMs = performance.now() - t0;
  parentPort.postMessage({ type: 'ready', initMs });
  parentPort.on('message', (job) => {
    if (job === 'stop') { parentPort.postMessage({ type: 'mem', rss: process.memoryUsage().rss }); return; }
    const t = performance.now();
    // Job: 200 x 200 x 10 plate, 100 holes with cutAll, then volume and a display mesh.
    const plate = k.makeBox(200, 200, 10);
    const tools = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) tools.push(k.translate(k.makeCylinder(3 + (job % 3) * 0.1, 20), 10 + 20 * i, 10 + 20 * j, -5));
    const part = k.cutAll(plate, tools);
    const vol = k.getVolume(part);
    const mesh = k.tessellate(part);
    for (const h of tools) k.release(h);
    k.release(plate); k.release(part);
    parentPort.postMessage({ type: 'done', job, vol, ms: performance.now() - t, tris: (mesh.indices?.length ?? 0) / 3 });
  });
} else {
  const lib = process.argv[2];
  const jobs = Number(process.argv[3] ?? 24);
  const counts = process.argv.slice(4).map(Number);
  const results = [];
  for (const n of counts) {
    const ws = await Promise.all(Array.from({ length: n }, () => new Promise((res) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { lib } });
      w.once('message', (m) => res({ w, initMs: m.initMs }));
    })));
    const queue = Array.from({ length: jobs }, (_, i) => i);
    const vols = new Map();
    const t0 = performance.now();
    await Promise.all(ws.map(({ w }) => new Promise((res) => {
      const next = () => { const j = queue.shift(); if (j === undefined) return res(); w.postMessage(j); };
      w.on('message', (m) => { if (m.type === 'done') { vols.set(m.job, m.vol); next(); } });
      next();
    })));
    const wall = performance.now() - t0;
    const rss = process.memoryUsage().rss;
    for (const { w } of ws) await w.terminate();
    results.push({ workers: n, jobs, wallMs: +wall.toFixed(0), jobsPerSec: +(jobs / (wall / 1000)).toFixed(2), meanInitMs: +(ws.reduce((a, b) => a + b.initMs, 0) / n).toFixed(0), processRssMB: +(rss / 2 ** 20).toFixed(0), vol0: vols.get(0) });
  }
  console.log(JSON.stringify({ cpus: os.availableParallelism(), results }, null, 1));
}
