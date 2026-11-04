// Is a fresh WASM instance (same process, shared compiled Module) as deterministic as a fresh process?
import { readFileSync } from "node:fs";
import { loadKernel, buildPart, f64hex, sha } from "./lib.mjs";
const [DEPS] = process.argv.slice(2);
const mod = await WebAssembly.compile(readFileSync(`${DEPS}/node_modules/occt-wasm/dist/occt-wasm.wasm`));
const fp = (k, s) => { const m = k.tessellate(s, { linearDeflection: 0.1, angularDeflection: 0.5 });
  return `${f64hex(k.getVolume(s))} faces=${sha(k.subShapeHashes(s, "face", 2147483647).join(","))} mesh=${sha(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength))}`; };
const offsetPart = (k) => k.offset(buildPart(k, { w: 70 }), 0.8, 1e-3);
const rows = [];
for (let inst = 0; inst < 3; inst++) {
  const { k } = await loadKernel(DEPS, { wasmModule: mod });
  for (let rep = 0; rep < 3; rep++) { rows.push(`instance ${inst} build ${rep}: ${fp(k, offsetPart(k))}`); if (rep === 1) k.releaseAll(); }
  k[Symbol.dispose]?.();
}
console.log(rows.join("\n"));
