// Measures: QuickJS module load (cold, this process), runtime+context creation,
// full sandbox setup (prelude + freeze), and per-call host-function overhead.
// usage: node callbench.mjs <deps> <variant: quickjs|ng|asyncify>
import { now, median, stats, r3, depsPath, wasmMemoryLimits } from "./lib/util.mjs";
import { loadQuickJS, runScript } from "./lib/bridge.mjs";

const deps = depsPath();
const which = process.argv[3] || "quickjs";
const N = 10000;
const t0 = now();
const qjs = await loadQuickJS(deps, which);
const loadMs = now() - t0;
const { mod, core } = qjs;
let disposeErrors = 0; const firstDisposeError = [];
const safeDispose = (...xs) => { for (const x of xs) { try { x.dispose(); } catch (e) { disposeErrors++; if (firstDisposeError.length < 1) firstDisposeError.push(String(e.message).slice(0, 160)); } } };

// 1. bare runtime + context create/dispose
const bare = [];
for (let i = 0; i < 60; i++) { const s = now(); const rt = mod.newRuntime(); const ctx = rt.newContext(); safeDispose(ctx, rt); bare.push(now() - s); }

// 2. per-call overhead with a raw context (no validation layer)
function rawCalls(kind) {
  const rt = mod.newRuntime(); const ctx = rt.newContext();
  let fn;
  if (kind === "noop") fn = ctx.newFunction("f", () => {});
  else if (kind === "num3") fn = ctx.newFunction("f", (a, b, c) => ctx.newNumber(ctx.getNumber(a) + ctx.getNumber(b) + ctx.getNumber(c)));
  else if (kind === "str") fn = ctx.newFunction("f", (a) => ctx.newString(ctx.getString(a)));
  else fn = null;
  if (fn) { ctx.setProp(ctx.global, "f", fn); fn.dispose(); }
  const body = kind === "guest" ? "function f(){}; for (let i=0;i<N;i++) f();"
    : kind === "noop" ? "for (let i=0;i<N;i++) f();"
    : kind === "num3" ? "let s=0; for (let i=0;i<N;i++) s=f(i,1,2);"
    : kind === "str" ? "const x='abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz'; for (let i=0;i<N;i++) f(x);"
    : "for (let i=0;i<N;i++) {}";
  const samples = [];
  for (let r = 0; r < 9; r++) {
    const s = now(); const res = ctx.evalCode(`(function(){const N=${N}; ${body}})()`);
    const t = now() - s;
    if (res.error) { console.error(ctx.dump(res.error)); res.error.dispose(); } else res.value.dispose();
    samples.push(t);
  }
  safeDispose(ctx, rt);
  return samples;
}
const raw = {};
for (const k of ["emptyloop", "guest", "noop", "num3", "str"]) raw[k] = rawCalls(k);
const perCallUs = (k) => r3(((median(raw[k]) - median(raw.emptyloop)) / N) * 1000);

// 3. Node baseline: direct JS call of a no-op 10k times
const nodeSamples = [];
const f = () => {};
for (let r = 0; r < 9; r++) { const s = now(); for (let i = 0; i < N; i++) f(); nodeSamples.push(now() - s); }

// 4. Through the real bridge: validated wrapper + frozen guest, stub kernel
const stubKernel = { checkpoint: () => 0, releaseSince() {}, getVolume: () => 0, isValid: () => true };
const setupSamples = [], bridgeNoop = [], bridgeNum = [];
for (let r = 0; r < 30; r++) {
  const res = runScript({ qjs, kernel: stubKernel, code: "return [];", limits: { maxOps: Infinity } });
  setupSamples.push(res.timings.setup_ms);
  if (res.stats.disposeError) { disposeErrors++; if (!firstDisposeError.length) firstDisposeError.push(res.stats.disposeError.slice(0, 160)); }
}
for (let r = 0; r < 9; r++) {
  let res = runScript({ qjs, kernel: stubKernel, limits: { maxOps: Infinity },
    extraOps: { noop: () => 0 }, code: `const f=__x.noop; for (let i=0;i<${N};i++) f(); return [];` });
  bridgeNoop.push(res.timings.exec_ms);
  res = runScript({ qjs, kernel: stubKernel, limits: { maxOps: Infinity },
    extraOps: { add3: (a, b, c) => a + b + c }, code: `const f=__x.add3; let s=0; for (let i=0;i<${N};i++) s=f(i,1,2); return [];` });
  bridgeNum.push(res.timings.exec_ms);
}
// variant without freezing, to cost the harden pass
const setupNoFreeze = [];
for (let r = 0; r < 30; r++) setupNoFreeze.push(runScript({ qjs, kernel: stubKernel, code: "return [];", limits: { freezeIntrinsics: false } }).timings.setup_ms);

// memory of one idle runtime+context with prelude
const rt = mod.newRuntime(); const ctx = rt.newContext();
const mem = rt.dumpMemoryUsage().split("\n").filter((l) => /memory used|malloc size/i.test(l)).map((l) => l.trim());
safeDispose(ctx, rt);

const variantPkg = { quickjs: "quickjs-wasmfile-release-sync", ng: "quickjs-ng-wasmfile-release-sync", asyncify: "quickjs-wasmfile-release-asyncify" }[which];
console.log(JSON.stringify({
  variant: which,
  wasm_memory: wasmMemoryLimits(`${deps}/node_modules/@jitl/${variantPkg}/dist/emscripten-module.wasm`),
  module_load_cold_ms: r3(loadMs),
  runtime_context_create_dispose_ms: stats(bare),
  full_sandbox_setup_ms: stats(setupSamples),
  full_sandbox_setup_without_freeze_ms: stats(setupNoFreeze),
  raw_10k_ms: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, stats(v)])),
  per_call_us: { guest_to_guest: perCallUs("guest"), host_noop: perCallUs("noop"), host_3_numbers: perCallUs("num3"), host_64char_string: perCallUs("str") },
  bridge_validated_10k_ms: { noop: stats(bridgeNoop), add3: stats(bridgeNum) },
  bridge_per_call_us: { noop: r3((median(bridgeNoop) / N) * 1000), add3: r3((median(bridgeNum) / N) * 1000) },
  node_direct_10k_ms: stats(nodeSamples),
  idle_runtime_memory: mem,
  dispose_errors: disposeErrors, first_dispose_error: firstDisposeError[0] || null,
}, null, 1));
