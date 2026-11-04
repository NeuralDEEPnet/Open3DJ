// Build the same part twice in one process and diff the normalised STEP text.
import { writeFileSync } from "node:fs";
import { loadKernel, buildPart, normStep } from "./lib.mjs";
const [DEPS, OUT] = process.argv.slice(2);
const { k } = await loadKernel(DEPS);
const a = normStep(k.exportStep(buildPart(k, { w: 70 })));
const b = normStep(k.exportStep(buildPart(k, { w: 70 })));
const c = normStep(k.exportStep(buildPart(k, { w: 70 })));
writeFileSync(`${OUT}/step-a.step`, a); writeFileSync(`${OUT}/step-b.step`, b); writeFileSync(`${OUT}/step-c.step`, c);
const la = a.split("\n"), lb = b.split("\n");
let diffs = 0; const ex = [];
for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) { diffs++; if (ex.length < 6) ex.push([i, la[i], lb[i]]); }
console.log(JSON.stringify({ lines: [la.length, lb.length], diffLines: diffs, b_eq_c: b === c, examples: ex }, null, 1));
// Sorted-lines comparison (is it only entity order?)
console.log("same multiset of lines:", [...la].sort().join("\n") === [...lb].sort().join("\n"));
