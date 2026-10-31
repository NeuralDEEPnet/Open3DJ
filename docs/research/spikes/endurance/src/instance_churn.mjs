// Cost of a fresh kernel instance per run (shared compiled Module), and whether old instances' memory is reclaimed.
import { readFileSync } from "node:fs";
import { loadKernel, buildPart, procMem, now, median } from "./lib.mjs";
const [DEPS, NS = "40"] = process.argv.slice(2);
const mod = await WebAssembly.compile(readFileSync(`${DEPS}/node_modules/occt-wasm/dist/occt-wasm.wasm`));
const inits = [], builds = [], rss = [];
for (let i = 0; i < +NS; i++) {
  let s = now(); const { k } = await loadKernel(DEPS, { wasmModule: mod }); inits.push(now() - s);
  s = now(); buildPart(k, { w: 60 + i }); builds.push(now() - s);
  k[Symbol.dispose]();
  if (globalThis.gc && i % 5 === 4) globalThis.gc();
  if (i % 5 === 4) rss.push(procMem().VmRSS);
}
console.log(JSON.stringify({ gc: !!globalThis.gc, n: +NS, init_median_ms: +median(inits).toFixed(1), init_first: +inits[0].toFixed(1),
  build_median_ms: +median(builds).toFixed(1), build_first: +builds[0].toFixed(1), rss_every5: rss, final: procMem() }));
