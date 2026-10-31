// Node's vm module with a frozen context: why it is NOT a security boundary.
// Each probe runs in its own child process (some hang or kill the process by design).
// usage: node nodevm-test.mjs            -> runs all probes, prints JSON
//        node nodevm-test.mjs <probe>    -> runs one probe (internal)
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// A host-side "kernel" function, the way a naive design would endow it.
const hostBox = (w, d, h) => { if (!(w > 0)) throw new Error("w must be > 0"); return { w, d, h }; };
const frozenCtx = () => vm.createContext(Object.freeze({ box: Object.freeze(hostBox) }));

const PROBES = {
  "escape-via-endowed-function": () => vm.runInContext(
    "const p = box.constructor.constructor('return process')(); [typeof p.getBuiltinModule, typeof p.getBuiltinModule('child_process').execSync, p.getBuiltinModule('fs').readFileSync('/etc/hostname','utf8').trim().length > 0].join(',')",
    frozenCtx(), { timeout: 1000 }),
  "escape-via-host-error": () => vm.runInContext(
    "try { box(-1) } catch (e) { const p = e.constructor.constructor('return process')(); 'pid=' + typeof p.pid + ' env=' + typeof p.env }",
    frozenCtx(), { timeout: 1000 }),
  "escape-via-returned-object": () => vm.runInContext(
    "box(1,1,1).constructor.constructor('return process')().version", frozenCtx(), { timeout: 1000 }),
  "no-endowments-this-ctor": () => vm.runInContext(
    "typeof this.constructor.constructor('return process')()", vm.createContext(Object.freeze({})), { timeout: 1000 }),
  "frozen-context-mutation": () => vm.runInContext(
    "'use strict'; try { box.x = 1; 'mutated' } catch (e) { e.constructor.name + ': ' + e.message }", frozenCtx(), { timeout: 1000 }),
  "sync-infinite-loop-timeout": () => { const t = performance.now(); try { vm.runInContext("while(true){}", frozenCtx(), { timeout: 1000 }); } catch (e) { return `${e.code || e.name}: ${e.message} after ${Math.round(performance.now() - t)} ms`; } },
  "microtask-loop-escapes-timeout": () => { vm.runInContext("Promise.resolve().then(() => { while(true){} }); 'returned'", frozenCtx(), { timeout: 1000 }); return "runInContext returned; the loop now runs on the host event loop"; },
  "microtask-loop-afterEvaluate": () => { const ctx = vm.createContext(Object.freeze({}), { microtaskMode: "afterEvaluate" }); try { vm.runInContext("Promise.resolve().then(() => { while(true){} }); 'returned'", ctx, { timeout: 1000 }); return "returned"; } catch (e) { return `${e.code || e.name}: ${e.message}`; } },
  "memory-bomb": () => vm.runInContext("const a = []; while (true) a.push(new Array(1e5).fill(1.5));", frozenCtx(), { timeout: 60000 }),
  "stack-overflow": () => { try { vm.runInContext("function f(){ return f() + 1 } f()", frozenCtx(), { timeout: 1000 }); } catch (e) { return `${e.name}: ${e.message}`; } },
  "per-call-overhead-10k": () => {
    const ctx = vm.createContext({ noop: () => 0 });
    const s = vm.compileFunction("for (let i = 0; i < 10000; i++) noop();", [], { parsingContext: ctx });
    const t = [];
    for (let i = 0; i < 9; i++) { const a = performance.now(); vm.runInContext("for (let i = 0; i < 10000; i++) noop();", ctx); t.push(performance.now() - a); }
    void s; t.sort((a, b) => a - b); return `median ${t[4].toFixed(3)} ms for 10k calls`;
  },
  "context-create": () => { const t = []; for (let i = 0; i < 30; i++) { const a = performance.now(); vm.createContext(Object.freeze({ box: hostBox })); t.push(performance.now() - a); } t.sort((a, b) => a - b); return `median ${t[15].toFixed(3)} ms`; },
};

const which = process.argv[2];
if (which) {
  const r = PROBES[which]();
  process.stdout.write(JSON.stringify({ probe: which, result: r }) + "\n");
  if (which === "microtask-loop-escapes-timeout") setTimeout(() => process.stdout.write(JSON.stringify({ probe: which, note: "host timer never fires" }) + "\n"), 100);
} else {
  const self = fileURLToPath(import.meta.url);
  const out = [];
  for (const p of Object.keys(PROBES)) {
    const t = performance.now();
    const args = p === "memory-bomb" ? ["--max-old-space-size=256", self, p] : [self, p];
    const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 8000 });
    out.push({ probe: p, wall_ms: Math.round(performance.now() - t), exit: r.status, signal: r.signal, killed_by_timeout: r.error?.code === "ETIMEDOUT",
      stdout: r.stdout.trim().slice(0, 400), stderr: r.stderr.trim().split("\n").filter((l) => /FATAL|Error|heap/i.test(l)).slice(0, 2).join(" | ").slice(0, 300) });
  }
  console.log(JSON.stringify({ node: process.version, probes: out }, null, 1));
}
