// What differs in normalised STEP of a multi-solid compound built twice in one process?
import { loadKernel, normStep } from "./lib.mjs";
const [DEPS] = process.argv.slice(2);
const { k } = await loadKernel(DEPS);
const build = () => { const parts = []; for (let i = 0; i < 6; i++) parts.push(k.translate(k.makeSphere(3), i * 10, 0, 0)); parts.push(k.makeBox(2, 2, 2)); return k.fuseAll(parts); };
const a = normStep(k.exportStep(build())).split("\n"), b = normStep(k.exportStep(build())).split("\n");
let n = 0; const ex = [];
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { n++; if (ex.length < 8) ex.push(`${i}: ${a[i]}  ||  ${b[i]}`); }
console.log("lines", a.length, b.length, "diff", n, "same multiset", [...a].sort().join() === [...b].sort().join());
console.log(ex.join("\n"));
