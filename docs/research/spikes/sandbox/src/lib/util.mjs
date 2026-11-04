// Small shared helpers for the sandbox spike. No dependencies.
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const now = () => performance.now();
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const r2 = (x) => Math.round(x * 100) / 100;
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const stats = (xs) => ({ n: xs.length, median: r3(median(xs)), min: r3(Math.min(...xs)), max: r3(Math.max(...xs)) });

export function depsPath(argv = process.argv) {
  const d = argv[2];
  if (!d) throw new Error("usage: node <script> <deps-dir> [out-dir]");
  return resolve(d);
}

export function pkgVersion(deps, name) {
  return JSON.parse(readFileSync(`${deps}/node_modules/${name}/package.json`, "utf8")).version;
}

// Read the declared memory limits (initial/maximum, in 64 KiB pages) of a wasm binary,
// from either the memory section (id 5) or an imported memory (id 2).
export function wasmMemoryLimits(path) {
  const b = readFileSync(path);
  let p = 8;
  const leb = () => { let r = 0, s = 0, x; do { x = b[p++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return r >>> 0; };
  const str = () => { const n = leb(); const v = b.subarray(p, p + n).toString(); p += n; return v; };
  const limits = () => { const flag = leb(); const min = leb(); const max = (flag & 1) ? leb() : null; return { flag, minPages: min, maxPages: max, minMiB: min / 16, maxMiB: max === null ? null : max / 16 }; };
  const out = [];
  while (p < b.length) {
    const id = b[p++]; const size = leb(); const end = p + size;
    if (id === 5) { const n = leb(); for (let i = 0; i < n; i++) out.push({ where: "defined", ...limits() }); }
    else if (id === 2) {
      const n = leb();
      for (let i = 0; i < n; i++) {
        const mod = str(), name = str(); const kind = b[p++];
        if (kind === 0) leb(); else if (kind === 1) { p++; limits(); } else if (kind === 2) out.push({ where: `import ${mod}.${name}`, ...limits() }); else if (kind === 3) { p += 2; } else if (kind === 4) { p++; leb(); }
      }
    }
    p = end;
  }
  return out;
}
