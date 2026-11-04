// Host side of the QuickJS <-> CAD-kernel bridge.
// - Agent scripts run in a fresh QuickJS runtime+context per run (no state carries over).
// - Only numbers and short strings cross the boundary. Shapes are per-run integer
//   handles (1, 2, 3, ...) mapped to kernel handles in a host-side table; the guest
//   never sees kernel ids, host objects, or host functions' real identities.
// - Limits: QuickJS heap (setMemoryLimit), C stack (setMaxStackSize), CPU deadline
//   (interrupt handler), kernel-op budget, handle budget, batch-size cap, result-size cap.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { now } from "./util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRELUDE = readFileSync(join(HERE, "guest-prelude.js"), "utf8");
export const HARDEN = readFileSync(join(HERE, "guest-harden.js"), "utf8");

const VARIANTS = {
  quickjs: "@jitl/quickjs-wasmfile-release-sync",
  ng: "@jitl/quickjs-ng-wasmfile-release-sync",
  asyncify: "@jitl/quickjs-wasmfile-release-asyncify",
};

export async function loadQuickJS(deps, which = "quickjs") {
  const core = await import(`file://${deps}/node_modules/quickjs-emscripten-core/dist/index.mjs`);
  const variant = (await import(`file://${deps}/node_modules/${VARIANTS[which]}/dist/index.mjs`)).default;
  const mod = which === "asyncify"
    ? await core.newQuickJSAsyncWASMModuleFromVariant(variant)
    : await core.newQuickJSWASMModuleFromVariant(variant);
  // fresh(maxMiB): a NEW wasm instance with its own capped WebAssembly.Memory. This is the
  // only hard memory bound we found: setMemoryLimit() bounds single allocations only
  // (quickjs-emscripten 0.32.0, upstream issue #271). Compiling once makes this ~1-2 ms.
  let compiled = null;
  const fresh = async (maxMiB = 128) => {
    if (which === "asyncify") throw new Error("fresh() implemented for sync variants only");
    if (!compiled) compiled = await WebAssembly.compile(readFileSync(`${deps}/node_modules/${VARIANTS[which]}/dist/emscripten-module.wasm`));
    const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: Math.max(256, Math.floor(maxMiB * 16)) });
    return { core, which, mod: await core.newQuickJSWASMModuleFromVariant(core.newVariant(variant, { wasmModule: compiled, wasmMemory })) };
  };
  return { core, mod, which, fresh };
}

export async function loadKernel(deps) {
  const { OcctKernel } = await import(`file://${deps}/node_modules/occt-wasm/dist/index.js`);
  return OcctKernel.init();
}

export const DEFAULT_LIMITS = {
  memoryBytes: 64 * 1024 * 1024, // QuickJS heap
  stackBytes: 256 * 1024,        // QuickJS C stack. MUST stay well below the host thread's native
                                 // stack: >=192 KiB overflowed V8's ~1 MB main-thread stack first.
                                 // Run in a Worker with resourceLimits.stackSizeMb = 8.
  cpuMs: 2000,                   // guest JS deadline (does NOT cover time inside a kernel call)
  maxOps: 5000,                  // kernel calls per run
  maxHandles: 20000,             // live shape handles per run
  maxBatch: 1000,                // shapes per fuseAll/cutAll
  maxStringArg: 4096,            // bytes per string argument
  maxResultBytes: 64 * 1024,     // JSON result from guest
  freezeIntrinsics: true,
  maxJobs: 0,                    // promise jobs drained after the script (0 = none)
  removeDate: true,
  deterministicRandom: true,
};

class GuestFault extends Error {}

// Per-op argument signatures: n = finite number, h = integer handle, s = string, trailing * = repeat last.
export const SIGNATURES = {
  box: "nnn", cylinder: "nn", cone: "nnn", sphere: "n", translate: "hnnn", rotate: "hnnnn",
  fuse: "hh", cut: "hh", common: "hh", fuseAll: "h*", cutAll: "hh*", fillet: "hns", chamfer: "hns",
  volume: "h", bounds: "h", noop: "",
};
function checkSig(name, sig, args) {
  if (sig === undefined) return null; // untyped (test hooks only)
  const rest = sig.endsWith("*"); const base = rest ? sig.slice(0, -1) : sig;
  if (!rest && args.length !== base.length) return `${name}: expected ${base.length} arguments, got ${args.length}`;
  if (rest && args.length < base.length) return `${name}: expected at least ${base.length} arguments, got ${args.length}`;
  for (let i = 0; i < args.length; i++) {
    const t = base[Math.min(i, base.length - 1)];
    const a = args[i];
    if (t === "n" && (typeof a !== "number" || !Number.isFinite(a))) return `${name}: argument ${i + 1} must be a finite number`;
    if (t === "h" && !Number.isInteger(a)) return `${name}: argument ${i + 1} must be a shape handle`;
    if (t === "s" && typeof a !== "string") return `${name}: argument ${i + 1} must be a string`;
  }
  return null;
}

// Host operations exposed to the guest. Each receives plain numbers/strings (already
// validated) and returns a number or string. `H` is the per-run handle table.
export function makeOps(kernel, H, L) {
  const S = (id) => H.get(id);
  const edgesMatching = (solid, q) => {
    const edges = kernel.getSubShapes(solid, "edge");
    if (!q || Object.keys(q).length === 0) return edges;
    const tol = 1e-6;
    return edges.filter((e) => {
      const b = kernel.getBoundingBox(e);
      const dx = b.xmax - b.xmin, dy = b.ymax - b.ymin, dz = b.zmax - b.zmin;
      const len = Math.hypot(dx, dy, dz);
      if (q.atZ !== undefined && !(Math.abs(b.zmin - q.atZ) < 1e-3 && Math.abs(b.zmax - q.atZ) < 1e-3)) return false;
      if (q.atX !== undefined && !(Math.abs(b.xmin - q.atX) < 1e-3 && Math.abs(b.xmax - q.atX) < 1e-3)) return false;
      if (q.atY !== undefined && !(Math.abs(b.ymin - q.atY) < 1e-3 && Math.abs(b.ymax - q.atY) < 1e-3)) return false;
      if (q.parallel === "Z" && !(dx < tol && dy < tol)) return false;
      if (q.parallel === "X" && !(dy < tol && dz < tol)) return false;
      if (q.parallel === "Y" && !(dx < tol && dz < tol)) return false;
      if (q.perpendicular === "Z" && !(dz < tol)) return false;
      if (q.minLength !== undefined && len < q.minLength) return false;
      if (q.maxLength !== undefined && len > q.maxLength) return false;
      return true;
    });
  };
  const parseQuery = (s) => { const q = JSON.parse(s); if (typeof q !== "object" || q === null || Array.isArray(q)) throw new GuestFault("edge query must be an object"); return q; };
  const pos = (x, what) => { if (!(x > 0)) throw new GuestFault(`${what} must be > 0, got ${x}`); if (x > 1e6) throw new GuestFault(`${what} too large (${x} > 1e6 mm)`); return x; };
  const batch = (ids) => { if (ids.length > L.maxBatch) throw new GuestFault(`batch of ${ids.length} exceeds limit ${L.maxBatch}`); return ids.map(S); };
  return {
    box: (w, d, h) => H.add(kernel.translate(kernel.makeBox(pos(w, "w"), pos(d, "d"), pos(h, "h")), -w / 2, -d / 2, 0)),
    cylinder: (h, r) => H.add(kernel.makeCylinder(pos(r, "r"), pos(h, "h"))),
    cone: (h, r1, r2) => H.add(kernel.makeCone(pos(r1, "r"), r2, pos(h, "h"))),
    sphere: (r) => H.add(kernel.makeSphere(pos(r, "r"))),
    translate: (id, x, y, z) => H.add(kernel.translate(S(id), x, y, z)),
    rotate: (id, ax, ay, az, deg) => H.add(kernel.rotate(S(id), { point: { x: 0, y: 0, z: 0 }, direction: { x: ax, y: ay, z: az } }, (deg * Math.PI) / 180)),
    fuse: (a, b) => H.add(kernel.fuse(S(a), S(b))),
    cut: (a, b) => H.add(kernel.cut(S(a), S(b))),
    common: (a, b) => H.add(kernel.common(S(a), S(b))),
    fuseAll: (...ids) => H.add(kernel.fuseAll(batch(ids))),
    cutAll: (a, ...ids) => H.add(kernel.cutAll(S(a), batch(ids))),
    fillet: (id, r, q) => { const s = S(id); const e = edgesMatching(s, parseQuery(q)); if (!e.length) throw new GuestFault("fillet: edge query matched no edges"); return H.add(kernel.fillet(s, e, pos(r, "radius"))); },
    chamfer: (id, d, q) => { const s = S(id); const e = edgesMatching(s, parseQuery(q)); if (!e.length) throw new GuestFault("chamfer: edge query matched no edges"); return H.add(kernel.chamfer(s, e, pos(d, "distance"))); },
    volume: (id) => kernel.getVolume(S(id)),
    bounds: (id) => JSON.stringify(kernel.getBoundingBox(S(id))),
    noop: () => 0,
  };
}

export function handleTable(L) {
  const map = new Map();
  let next = 1;
  return {
    add(kh) { if (map.size >= L.maxHandles) throw new GuestFault(`handle limit ${L.maxHandles} reached`); const id = next++; map.set(id, kh); return id; },
    get(id) { if (!Number.isInteger(id) || !map.has(id)) throw new GuestFault(`invalid shape handle ${id}`); return map.get(id); },
    get size() { return map.size; },
  };
}

// Mulberry32 seeded PRNG source text, installed in the guest when deterministicRandom is on.
const RANDOM_SRC = `"use strict";(function(){let a=${0x3d1f};Object.defineProperty(Math,"random",{value:function random(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;},writable:false,configurable:false});})();`;

/**
 * Run one agent script. Returns {ok, parts?, error?, timings, stats}.
 * Never throws for guest-caused failures; throws only for host bugs.
 */
export function runScript({ qjs, kernel, code, params = {}, limits = {}, extraOps = null, onPart = null }) {
  const { core, mod } = qjs;
  const L = { ...DEFAULT_LIMITS, ...limits };
  const T = {}; const t0 = now();
  const rt = mod.newRuntime();
  rt.setMemoryLimit(L.memoryBytes);
  if (L.stackBytes !== undefined) rt.setMaxStackSize(L.stackBytes);
  let deadline = Infinity, interrupted = false, interruptPolls = 0;
  rt.setInterruptHandler(() => { interruptPolls++; if (Date.now() > deadline) { interrupted = true; return true; } return false; });
  const intrinsics = L.removeDate ? { ...core.DefaultIntrinsics, Date: false } : undefined;
  const ctx = rt.newContext(intrinsics ? { intrinsics } : undefined);
  const H = handleTable(L);
  const cp = kernel.checkpoint();
  if (L.maxOps === Infinity) L.maxOps = Number.MAX_SAFE_INTEGER;
  let ops = 0, hostMs = 0;
  // Assigning .message on a new error silently fails once Error.prototype is frozen
  // (the "override mistake"), so define it as an own property instead.
  const gErr = (msg) => {
    const e = ctx.newError(); const m = ctx.newString(String(msg).slice(0, 1000));
    ctx.defineProp(e, "message", { value: m, configurable: true, enumerable: false, writable: true }); m.dispose();
    return e;
  };
  const install = (globalName, implMap, sigs = {}) => {
    const k = ctx.newObject();
    for (const [name, fn] of Object.entries(implMap)) {
      const f = ctx.newFunction(name, (...argH) => {
        if (++ops > L.maxOps) return { error: gErr(`kernel op budget of ${L.maxOps} calls exceeded`) };
        const args = new Array(argH.length);
        for (let i = 0; i < argH.length; i++) {
          const t = ctx.typeof(argH[i]);
          if (t === "number") args[i] = ctx.getNumber(argH[i]);
          else if (t === "string") { const s = ctx.getString(argH[i]); if (s.length > L.maxStringArg) return { error: gErr(`${name}: string argument too long`) }; args[i] = s; }
          else return { error: gErr(`${name}: argument ${i} must be a number or string, got ${t}`) };
        }
        const bad = checkSig(name, sigs[name], args);
        if (bad) return { error: gErr(bad) };
        const hs = now();
        try {
          const r = fn(...args);
          if (typeof r === "number") return ctx.newNumber(r);
          if (typeof r === "string") return ctx.newString(r);
          return ctx.undefined;
        } catch (e) {
          // Do not forward host stack traces or object identities; message only, length-capped.
          const msg = e instanceof GuestFault ? e.message : `${name} failed: ${String(e && e.message || e).slice(0, 300)}`;
          return { error: gErr(msg) };
        } finally { hostMs += now() - hs; }
      });
      ctx.setProp(k, name, f);
      f.dispose();
    }
    ctx.setProp(ctx.global, globalName, k);
    k.dispose();
  };
  install("__k", makeOps(kernel, H, L), SIGNATURES);
  const ps = ctx.newString(JSON.stringify(params));
  ctx.setProp(ctx.global, "__params", ps);
  ps.dispose();
  const evalOrThrow = (src, file) => { const r = ctx.evalCode(src, file); if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); throw new Error(`host setup failed in ${file}: ${JSON.stringify(e)}`); } r.value.dispose(); };
  if (L.deterministicRandom) evalOrThrow(RANDOM_SRC, "random.js");
  evalOrThrow(PRELUDE, "prelude.js");
  if (extraOps) install("__x", extraOps); // benchmark/test hooks only, installed after the prelude
  if (L.freezeIntrinsics) evalOrThrow(HARDEN, "harden.js");
  T.setup_ms = now() - t0;

  const te = now();
  deadline = Date.now() + L.cpuMs;
  const wrapped = `"use strict"; __finish((function main() {\n${code}\n})());`;
  let result = { ok: false };
  let r;
  try {
    r = ctx.evalCode(wrapped, "agent-script.js");
  } catch (e) {
    // Should not happen for guest errors; would indicate a QuickJS/wasm-level fault.
    result = { ok: false, error: { kind: "host-exception", message: String(e && e.message || e) } };
  }
  let jobs = null;
  if (r && !r.error && L.maxJobs > 0) {
    // Optional: drain promise jobs under the same deadline (Step 1 DSL is synchronous; default 0).
    const jr = rt.executePendingJobs(L.maxJobs);
    if (jr.error) { jobs = { error: ctx.dump(jr.error) }; jr.error.dispose(); } else { jobs = { executed: jr.value }; }
    jobs.stillPending = rt.hasPendingJob();
  }
  T.exec_ms = now() - te;
  T.host_ms = hostMs;
  // NOTE: dumping a guest error can run guest code (getters, toString, toJSON), so the
  // deadline stays armed until all guest values are extracted. disarmBeforeDump exists
  // only to demonstrate the hang it prevents.
  if (L.disarmBeforeDump) deadline = Infinity;
  if (r) {
    if (r.error) {
      let e;
      try { e = ctx.dump(r.error); } catch (de) { e = { name: "DumpError", message: String(de && de.message || de) }; }
      r.error.dispose();
      const cap = (x) => (x === undefined ? undefined : String(x).slice(0, 2000));
      const err = typeof e === "object" && e ? { name: cap(e.name), message: cap(e.message), stack: cap(e.stack) } : { message: cap(e) };
      result = { ok: false, error: { kind: interrupted ? "cpu-timeout" : "guest-error", ...err } };
    } else if (ctx.typeof(r.value) !== "string") {
      r.value.dispose(); result = { ok: false, error: { kind: "bad-result", message: "wrapper did not return a string" } };
    } else {
      const s = ctx.getString(r.value); r.value.dispose();
      if (s.length > L.maxResultBytes) result = { ok: false, error: { kind: "result-too-large", message: `${s.length} bytes` } };
      else {
        try {
          const parts = JSON.parse(s).map((p) => {
            const kh = H.get(p.id);
            const part = { name: String(p.name).slice(0, 100), color: p.color, volume: kernel.getVolume(kh), valid: kernel.isValid(kh) };
            if (onPart) onPart(kh, part);
            return part;
          });
          result = { ok: true, parts };
        } catch (e) { result = { ok: false, error: { kind: "bad-result", message: String(e.message) } }; }
      }
    }
  }
  deadline = Infinity;
  const tt = now();
  let disposeError = null;
  try { ctx.dispose(); rt.dispose(); } catch (e) { disposeError = String(e && e.message || e); }
  kernel.releaseSince(cp);
  T.teardown_ms = now() - tt;
  T.total_ms = now() - t0;
  result.timings = T;
  result.stats = { kernelOps: ops, handles: H.size, interruptPolls, disposeError, jobs, qjsWasmMiB: Math.round(mod.getWasmMemory().buffer.byteLength / 1048576) };
  return result;
}
