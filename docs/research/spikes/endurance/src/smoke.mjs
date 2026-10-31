import { loadKernel, buildPart, heapMiB, procMem, now } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const [DEPS, OUT] = process.argv.slice(2);
const { k, mod, printed, timings } = await loadKernel(DEPS);
console.error("timings", timings, "heap", heapMiB(mod), procMem(), "shapeCount", k.shapeCount);
for (const w of [60, 61.5, 70, 79.9]) {
  const t = now();
  const part = buildPart(k, { w });
  const ms = now() - t;
  console.error(w, "ms", ms.toFixed(1), "vol", k.getVolume(part), "valid", k.isValid(part), "faces", k.subShapeCount(part, "face"), "edges", k.subShapeCount(part,"edge"), "shapes", k.shapeCount, "heap", heapMiB(mod));
}
const part = buildPart(k, { w: 70 });
const step = k.exportStep(part);
console.error("step bytes", step.length, "printed lines out", printed.out.length, "err", printed.err.length, printed.out.slice(0,5));
console.error(step.split("\n").slice(0, 12).join("\n"));
const png = await k.toMultiviewPNG(part); writeFileSync(`${OUT}/smoke-part.png`, png);
