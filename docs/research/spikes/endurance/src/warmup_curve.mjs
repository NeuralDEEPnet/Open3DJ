// Rebuild latency over the first 80 rebuilds after a cold start (shows lazy compile + tier-up).
import { loadKernel, buildPart, now, median } from "./lib.mjs";
const [DEPS] = process.argv.slice(2);
const { k, timings } = await loadKernel(DEPS);
const t = [];
for (let i = 0; i < 80; i++) { const s = now(); const m = k.checkpoint(); buildPart(k, { w: 60 + i * 0.1 }); k.releaseSince(m); t.push(now() - s); }
const at = (a, b) => +median(t.slice(a, b)).toFixed(1);
console.log(JSON.stringify({ flags: process.execArgv.join(" ") || "(default)", init_ms: +timings.init_ms.toFixed(1), b1: +t[0].toFixed(1), b2_5: at(1, 5), b6_10: at(5, 10), b11_20: at(10, 20), b21_40: at(20, 40), b41_80: at(40, 80), cum_first10_ms: +t.slice(0, 10).reduce((x, y) => x + y).toFixed(0) }));
