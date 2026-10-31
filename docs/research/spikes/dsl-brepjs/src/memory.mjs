// Arena/RSS growth over repeated rebuilds of one starter. mode: none | gc | checkpoint
import { readFileSync } from "node:fs";
import { createRuntime } from "./dsl.mjs";
const [DEPS, DIR, id, N, mode] = process.argv.slice(2);
const rt = await createRuntime(DEPS);
const code = readFileSync(`${DIR}/${id}.js`, "utf8");
const k = rt.kernel;
const wasmMB = () => { try { return Math.round(k.module?.HEAP8?.buffer?.byteLength / 1e6) || null; } catch { return null; } };
const rows = [];
let lastVol = null, err = null;
for (let i = 1; i <= +N; i++) {
  const mark = mode === "checkpoint" ? k.checkpoint() : null;
  try {
    const { parts } = rt.run(code);
    lastVol = parts.map(p => p.shape.volume().toFixed(3)).join("+");
  } catch (e) { err = `iter ${i}: ${e.message}`; break; }
  if (mode === "checkpoint") k.releaseSince(mark);
  if (mode === "gc" || mode === "checkpoint") globalThis.gc?.();
  if (i === 1 || i % (+N / 5) === 0) rows.push({ i, shapeCount: k.shapeCount, rss_mb: Math.round(process.memoryUsage().rss / 1e6), wasm_heap_mb: wasmMB() });
}
// after loop: let finalizers run, then check a fresh build still works
globalThis.gc?.(); await new Promise(r => setTimeout(r, 200)); globalThis.gc?.();
let postCheck;
try { postCheck = rt.run(code).parts.map(p => p.shape.volume().toFixed(3)).join("+"); } catch (e) { postCheck = "THROW " + e.message; }
console.log(JSON.stringify({ id, N: +N, mode, rows, lastVol, postCheck, final_shapeCount: k.shapeCount, err }));
