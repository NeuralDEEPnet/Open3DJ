// Shared helpers for the endurance / memory / determinism spike.
// Loads occt-wasm from a deps directory passed on the command line (never from src).
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

export const now = () => performance.now();

export function procMem() {
  const out = {};
  for (const line of readFileSync("/proc/self/status", "utf8").split("\n")) {
    const m = /^(VmRSS|VmHWM|VmSize|VmPeak):\s+(\d+)/.exec(line);
    if (m) out[m[1]] = +(+m[2] / 1024).toFixed(1); // MiB
  }
  return out;
}

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function pct(a, p) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export function depsInfo(deps) {
  return JSON.parse(readFileSync(`${deps}/node_modules/occt-wasm/package.json`, "utf8")).version;
}

/**
 * Load the kernel. Returns { k, mod, OcctKernel, printed, timings }.
 * - Captures Emscripten print/printErr so nothing reaches process.stdout.
 * - Exposes the Emscripten Module (mod) so we can read the WASM heap size.
 * - opts.wasmModule: a precompiled WebAssembly.Module (warm path).
 * - opts.wasmBytes: preloaded bytes.
 */
export async function loadKernel(deps, opts = {}) {
  const t0 = now();
  const idx = await import(`file://${deps}/node_modules/occt-wasm/dist/index.js`);
  const factory = (await import(`file://${deps}/node_modules/occt-wasm/dist/occt-wasm.js`)).default;
  const tImport = now();
  const printed = { out: [], err: [] };
  let mod = null;
  let instantiateMs = null;
  const createModule = async (moduleOpts) => {
    const o = {
      ...moduleOpts,
      print: (s) => printed.out.push(String(s)),
      printErr: (s) => printed.err.push(String(s)),
    };
    if (opts.wasmModule) {
      o.instantiateWasm = (imports, cb) => {
        const s = now();
        WebAssembly.instantiate(opts.wasmModule, imports).then((inst) => {
          instantiateMs = now() - s;
          cb(inst, opts.wasmModule);
        });
        return {};
      };
    }
    mod = await factory(o);
    return mod;
  };
  const initOpts = { createModule };
  if (opts.wasmBytes) initOpts.wasm = opts.wasmBytes;
  const k = await idx.OcctKernel.init(initOpts);
  const tInit = now();
  return {
    k, mod, idx, printed,
    timings: { import_ms: tImport - t0, init_ms: tInit - tImport, total_ms: tInit - t0, instantiate_ms: instantiateMs },
  };
}

export const heapMiB = (mod) => +(mod.HEAP32.buffer.byteLength / 1048576).toFixed(1);

/**
 * Realistic parametric part: rounded box, shelled (top face removed),
 * 4 floor holes cut in one cutAll, an internal screw boss fused to the floor,
 * then the boss top edge filleted. Parameter p varies the size.
 * Every handle created is pushed to `made` so the "release" strategy can free it.
 */
export function buildPart(k, p, made = null) {
  const T = (h) => { if (made) made.push(h); return h; };
  const W = p.w, D = p.d ?? 50, H = p.h ?? 30, R = p.r ?? 3, wall = p.wall ?? 2;
  const box = T(k.translate(T(k.makeBox(W, D, H)), -W / 2, -D / 2, 0));
  // Round the 4 vertical + 4 bottom edges; keep the top rim sharp. (Filleting all 12 edges
  // and then shelling the top face away gives an INVALID solid without an error, see REPORT.)
  const edges = k.getSubShapes(box, "edge"); edges.forEach(T);
  const ed = edges.filter((e) => { const bb = k.getBoundingBox(e); return !(Math.abs(bb.zmin - H) < 1e-6 && Math.abs(bb.zmax - H) < 1e-6); });
  const rounded = T(k.fillet(box, ed, R));
  // top face = planar face whose bbox zmin==zmax==H
  const faces = k.getSubShapes(rounded, "face"); faces.forEach(T);
  let top = null;
  for (const f of faces) {
    const bb = k.getBoundingBox(f);
    if (Math.abs(bb.zmin - H) < 1e-6 && Math.abs(bb.zmax - H) < 1e-6) { top = f; break; }
  }
  if (!top) throw new Error("top face not found");
  const shelled = T(k.shell(rounded, [top], wall, 1e-6));
  const hx = W / 2 - 8, hy = D / 2 - 8, hr = p.holeR ?? 1.7;
  const cutters = [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy]].map(([x, y]) =>
    T(k.translate(T(k.makeCylinder(hr, H + 10)), x, y, -5)));
  let holed = T(k.cutAll(shelled, cutters));
  const bossH = p.bossH ?? 12, bossR = p.bossR ?? 5;
  const boss = T(k.translate(T(k.makeCylinder(bossR, bossH)), 0, 0, wall - 0.5));
  let fused = T(k.fuse(holed, boss));
  if (!k.isSolid(fused)) {
    const solids = k.getSubShapes(fused, "solid"); solids.forEach(T);
    if (solids.length !== 1) throw new Error(`fuse produced ${solids.length} solids`);
    fused = solids[0];
  }
  // fillet boss top circular edge(s): edges entirely at z = wall-0.5+bossH, within boss radius
  const zTop = wall - 0.5 + bossH;
  const fe = k.getSubShapes(fused, "edge"); fe.forEach(T);
  const sel = fe.filter((e) => {
    const bb = k.getBoundingBox(e);
    return Math.abs(bb.zmin - zTop) < 1e-6 && Math.abs(bb.zmax - zTop) < 1e-6 && bb.xmax <= bossR + 1e-6;
  });
  const out = T(k.fillet(fused, sel, p.bossFillet ?? 1));
  return out;
}

export const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);
export function f64hex(x) {
  const b = Buffer.alloc(8); b.writeDoubleBE(x); return b.toString("hex");
}
export function bboxHex(bb) {
  return ["xmin", "ymin", "zmin", "xmax", "ymax", "zmax"].map((k) => f64hex(bb[k])).join(":");
}
// Strip timestamps / volatile header bits from STEP text before hashing.
export function normStep(s) {
  return s
    .replace(/FILE_NAME\s*\([^;]*;/s, "FILE_NAME(<stripped>);")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "<ts>")
    // OCCT numbers each export in a process: PRODUCT('Open CASCADE STEP translator 8.0 <n>')
    .replace(/(Open CASCADE STEP translator [\d.]+) \d+/g, "$1 <n>")
    // ...and numbers assembly occurrences with a process-wide counter too
    .replace(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('\d+'/g, "NEXT_ASSEMBLY_USAGE_OCCURRENCE('<n>'");
}

// Highest written address in the WASM heap (MiB). Fresh wasm pages are zero, and the allocator
// grows upward with sbrk, so this approximates the allocator's high-water mark ("break").
export function heapHighWaterMiB(mod) {
  const u = new Uint32Array(mod.HEAP32.buffer);
  let i = u.length - 1;
  while (i > 0 && u[i] === 0) i--;
  return +((i * 4) / 1048576).toFixed(2);
}
