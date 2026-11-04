// Hostile / faulty agent scripts. Each case is run by security-case.mjs in its own process,
// followed by a sanity build in the same process to prove the host and module survived.
// `report(x)` is a test-only host hook (installed as __x.report) to get probe data out.
const R = "const report = (x) => __x.report(typeof x === 'string' ? x : JSON.stringify(x));";
const OK = "return box(10, 10, 10);";

export const CASES = [
  // ---- CPU ----
  { id: "cpu-infinite-loop", group: "cpu", code: "while (true) {}" },
  { id: "cpu-loop-catch-interrupt", group: "cpu", code: "for (;;) { try { while (true) {} } catch (e) {} }" },
  { id: "cpu-redos-regex", group: "cpu", code: "/(a+)+$/.test('a'.repeat(40) + 'b'); " + OK },
  { id: "cpu-sort-comparator-loop", group: "cpu", code: "[3,2,1].sort(() => { while (true) {} });" },
  { id: "cpu-getter-on-thrown-error", group: "cpu", code: "throw { get message() { while (true) {} }, get name() { while (true) {} } };" },
  { id: "cpu-getter-on-thrown-error-disarmed", group: "cpu", hostMayHang: true, limits: { disarmBeforeDump: true }, code: "throw { get message() { while (true) {} } };" },
  { id: "cpu-microtask-flood-not-drained", group: "cpu", code: "Promise.resolve().then(function f() { return Promise.resolve().then(f); }); " + OK },
  { id: "cpu-microtask-flood-drained", group: "cpu", limits: { maxJobs: 1e9 }, code: "Promise.resolve().then(function f() { return Promise.resolve().then(f); }); " + OK },
  // ---- memory ----
  { id: "mem-array-1e9", group: "memory", code: "const a = new Array(1e9).fill(0); " + OK },
  { id: "mem-push-loop", group: "memory", code: "const a = []; while (true) a.push(new Array(1e4).fill(1.5));" },
  { id: "mem-string-doubling", group: "memory", code: "let s = 'x'; while (true) s += s;" },
  { id: "mem-arraybuffer-1GiB", group: "memory", code: "new ArrayBuffer(2 ** 30); " + OK },
  { id: "mem-float64array-1e8", group: "memory", code: "new Float64Array(1e8); " + OK },
  { id: "mem-oom-then-catch-and-continue", group: "memory", code: "try { const a = []; while (true) a.push(new Array(1e4).fill(1)); } catch (e) {} " + OK },
  { id: "mem-no-limit-push-loop", group: "memory", limits: { memoryBytes: -1, cpuMs: 20000 }, code: "const a = []; while (true) a.push(new Array(1e4).fill(1.5));" },
  // ---- stack ----
  { id: "stack-recursion", group: "stack", code: "function f(n) { return f(n + 1) + 1; } f(0);" },
  { id: "stack-recursion-catch-retry", group: "stack", code: "function f() { try { return f(); } catch (e) { return f(); } } f();" },
  { id: "stack-json-parse-deep", group: "stack", code: "JSON.parse('['.repeat(1e6));" },
  { id: "stack-regex-deep", group: "stack", code: "new RegExp('('.repeat(1e5) + 'a' + ')'.repeat(1e5)).test('a');" },
  { id: "stack-recursion-default-stack", group: "stack", limits: { stackBytes: undefined }, code: "function f(n) { return f(n + 1) + 1; } f(0);" },
  { id: "stack-recursion-no-limit", group: "stack", hostMayHang: true, limits: { stackBytes: 0 }, code: "function f(n) { return f(n + 1) + 1; } f(0);" },
  // ---- capabilities: none of these may reach the host ----
  { id: "cap-globals", group: "capability", code: R + "report(Object.fromEntries(['process','require','module','exports','fetch','XMLHttpRequest','WebSocket','setTimeout','setInterval','queueMicrotask','console','WebAssembly','SharedArrayBuffer','Atomics','Deno','Bun','std','os','__k','__params','Date','eval','Function','Proxy','Reflect','globalThis'].map(k => [k, typeof globalThis[k]]))); report(Object.getOwnPropertyNames(globalThis).sort().join(',')); " + OK },
  { id: "cap-require", group: "capability", code: "require('fs');" },
  { id: "cap-process-exit", group: "capability", code: "process.exit(1);" },
  { id: "cap-fetch", group: "capability", code: "fetch('https://example.com');" },
  { id: "cap-static-import", group: "capability", code: "import fs from 'fs';" },
  { id: "cap-dynamic-import", group: "capability", limits: { maxJobs: 100 }, code: R + "import('fs').then(() => report('IMPORTED'), (e) => report('rejected: ' + e)); import('std').then(() => report('IMPORTED std'), (e) => report('rejected: ' + e)); " + OK },
  { id: "cap-function-ctor-global", group: "capability", code: R + "const g = (function () {}).constructor('return this')(); report({ sameGlobal: g === globalThis, process: typeof g.process, require: typeof g.require }); " + OK },
  { id: "cap-host-fn-ctor-escape", group: "capability", code: R + "const F = __x.report.constructor; report({ isGuestFunction: F === Function, viaCtor: F('return typeof process')(), viaCtorCtor: __x.report.constructor.constructor('return typeof require')() }); " + OK },
  { id: "cap-host-error-escape", group: "capability", code: R + "try { box(-1, 1, 1); } catch (e) { report({ isGuestError: e instanceof Error, message: e.message, stack: e.stack, proc: e.constructor.constructor('return typeof process')() }); } " + OK },
  { id: "cap-kernel-error-text", group: "capability", code: R + "try { fillet(box(10,10,10), 50); } catch (e) { report({ message: e.message, stack: e.stack }); } " + OK },
  { id: "cap-eval-stays-inside", group: "capability", code: R + "report({ evalResult: eval('typeof process + \"/\" + typeof require') }); " + OK },
  { id: "cap-date-removed", group: "capability", code: "Date.now();" },
  { id: "cap-math-random-deterministic", group: "capability", twice: true, code: R + "report([Math.random(), Math.random()]); " + OK },
  { id: "cap-math-random-native", group: "capability", twice: true, limits: { deterministicRandom: false }, code: R + "report([Math.random(), Math.random()]); " + OK },
  { id: "cap-proto-poison-frozen", group: "capability", code: "Array.prototype.map = function () { return []; };" },
  { id: "cap-object-proto-pollution-frozen", group: "capability", code: "Object.prototype.polluted = 1;" },
  { id: "cap-proto-poison-unfrozen", group: "capability", limits: { freezeIntrinsics: false }, code: R + "Array.prototype.map = function () { return []; }; const s = box(10, 10, 10).subtract([cylinder(20, 2).translate(0, 0, -5)]); report({ volume: s.volume(), expected: 1000 - Math.PI * 4 * 10 }); return s;" },
  { id: "cap-global-override-finish", group: "capability", code: "globalThis.__finish = (x) => 'pwned';" },
  { id: "cap-wrapper-breakout", group: "capability", code: "return box(1,1,1); })()); globalThis.x = 1; ((function () {" },
  // ---- handles ----
  { id: "handle-forge-constructor", group: "handles", code: "const S = box(1, 1, 1).constructor; return new S({}, 1);" },
  { id: "handle-forge-plain-object", group: "handles", code: "return fillet({ id: 1 }, 1);" },
  { id: "handle-non-shape-result", group: "handles", code: "return { name: 'x', shape: 5 };" },
  // ---- kernel abuse ----
  { id: "kernel-bad-args-negative", group: "kernel", code: "return box(-1, 1, 1);" },
  { id: "kernel-bad-args-nan", group: "kernel", code: "return box(NaN, 1, 1);" },
  { id: "kernel-bad-args-string", group: "kernel", code: "return box('10', 1, 1);" },
  { id: "kernel-bad-args-huge", group: "kernel", code: "return box(1e300, 1, 1);" },
  { id: "kernel-op-budget", group: "kernel", code: "for (let i = 0; i < 100000; i++) box(1, 1, 1);" },
  { id: "kernel-batch-cap", group: "kernel", code: "return union(Array.from({ length: 2000 }, (_, i) => box(1, 1, 1).translate(i, 0, 0)));" },
  { id: "kernel-long-single-op", group: "kernel", hostMayHang: true, limits: { maxBatch: 2000 }, code: "return union(Array.from({ length: 1500 }, (_, i) => box(1, 1, 1).translate(i * 0.9, (i % 7) * 0.3, 0)));" },
  // ---- output ----
  { id: "result-too-large", group: "output", code: "const b = box(1, 1, 1); return Array.from({ length: 3000 }, () => ({ name: 'x'.repeat(100), shape: b }));" },
  { id: "result-throw-non-error", group: "output", code: "throw 42;" },
  { id: "result-huge-error-message", group: "output", code: "throw new Error('x'.repeat(1e6));" },
];

export const SANITY = "const b = fillet(box(20, 20, 10), 1); return b.subtract([cylinder(20, 2).translate(0, 0, -5)]);";
