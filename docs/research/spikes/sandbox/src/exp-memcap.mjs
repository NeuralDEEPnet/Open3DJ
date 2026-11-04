// Hard memory cap: give QuickJS's wasm instance a WebAssembly.Memory with a small `maximum`.
// Also measures the cost of a FRESH module instance per run (precompiled WebAssembly.Module reused).
import { readFileSync } from "node:fs";
import { depsPath, now, stats, r2 } from "./lib/util.mjs";
const deps = depsPath();
const which = process.argv[3] || "quickjs";
const pkg = which === "ng" ? "@jitl/quickjs-ng-wasmfile-release-sync" : "@jitl/quickjs-wasmfile-release-sync";
const core = await import(`file://${deps}/node_modules/quickjs-emscripten-core/dist/index.mjs`);
const base = (await import(`file://${deps}/node_modules/${pkg}/dist/index.mjs`)).default;
const tc = now();
const wasmModule = await WebAssembly.compile(readFileSync(`${deps}/node_modules/${pkg}/dist/emscripten-module.wasm`));
const compileMs = now() - tc;
async function freshModule(maxMiB) {
  const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: maxMiB * 16 }); // pages of 64 KiB; 256 pages = 16 MiB (the module's declared minimum)
  return core.newQuickJSWASMModuleFromVariant(core.newVariant(base, { wasmModule, wasmMemory }));
}
const inst = [];
for (let i = 0; i < 20; i++) { const t = now(); await freshModule(128); inst.push(now() - t); }
const out = { variant: which, compile_once_ms: r2(compileMs), fresh_module_instance_ms: stats(inst), cases: [] };
for (const [label, src] of [
  ["push Array(1e4).fill loop", "const a=[]; while(true) a.push(new Array(1e4).fill(1.5));"],
  ["push 1 MiB Uint8Array loop", "const a=[]; while(true) a.push(new Uint8Array(1<<20));"],
  ["push objects loop", "const a=[]; let n=0; while(true) a.push({x:n++, y:[n], z:'k'+n});"],
  ["push 100 kB strings loop", "const a=[]; let n=0; while(true) a.push('y'.repeat(1e5)+(n++));"],
]) {
  const mod = await freshModule(128);
  const rt = mod.newRuntime(); rt.setMemoryLimit(64 << 20); rt.setMaxStackSize(128 * 1024);
  const dl = Date.now() + 10000; rt.setInterruptHandler(() => Date.now() > dl);
  const ctx = rt.newContext();
  const t = now(); let res;
  try { const r = ctx.evalCode(src); if (r.error) { let e; try { e = ctx.dump(r.error); } catch (de) { e = { message: "dump failed: " + de.message }; } r.error.dispose(); res = `guest ${e && e.name}: ${e && e.message}`; } else { r.value.dispose(); res = "ok"; } }
  catch (e) { res = `HOST ${e.constructor.name}: ${String(e.message).slice(0, 120)}`; }
  const ms = r2(now() - t);
  let disp = "ok"; try { ctx.dispose(); rt.dispose(); } catch (e) { disp = "ABORT " + String(e.message).slice(0, 80); }
  // Is the module still usable afterwards?
  let after = "?"; try { const rt2 = mod.newRuntime(); const c2 = rt2.newContext(); const r2_ = c2.evalCode("6*7"); after = r2_.error ? "error" : c2.dump(r2_.value); r2_.value && r2_.value.dispose(); c2.dispose(); rt2.dispose(); } catch (e) { after = "UNUSABLE: " + String(e.message).slice(0, 80); }
  out.cases.push({ label, cap_MiB: 128, result: res, ms, wasm_heap_MiB: mod.getWasmMemory().buffer.byteLength / 1048576, dispose: disp, module_after: after });
}
out.rss_mb = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
