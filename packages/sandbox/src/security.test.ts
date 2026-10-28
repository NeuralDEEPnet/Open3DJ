// The hostile and faulty scripts of the sandbox spike (spikes/sandbox/src/lib/cases.mjs),
// ported as regression tests. Every case must end safely: a structured result, no host
// capability reached, and a sane run afterwards in the same process.
//
// Spike cases that are not here, and why:
// - cpu-getter-on-thrown-error-disarmed, stack-recursion-no-limit, mem-no-limit-push-loop:
//   they tested options that no longer exist (disarming the deadline, stack 0, no memory
//   cap). resolveLimits() refuses stack 0 and an uncapped memory instead (tested below).
// - cpu-microtask-flood-drained: promise jobs are never drained.
// - kernel-long-single-op and the simulated worker exit: bounded by the pool's wall-clock
//   kill in @open3dj/compute, not by the sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript } from "./index.ts";
import type { RunScriptResult, SandboxLimits } from "./index.ts";
import { FAST_LIMITS, fakeHost } from "./testing.ts";

const OK = "return box(10, 10, 10);";
const SANITY = "const b = box(20, 20, 10); return union(b, box(1, 1, 1).translate(30, 0, 0));";

interface Case {
  id: string;
  code: string;
  limits?: SandboxLimits;
  /** Acceptable error codes; "ok" means the run may also succeed. */
  expect: string[];
  /** Extra checks on the result and the reports the script sent. */
  check?: (r: RunScriptResult, reports: unknown[]) => void;
}

const notReached = (r: RunScriptResult, reports: unknown[]) => {
  const text = JSON.stringify([r, reports]);
  assert.doesNotMatch(text, /IMPORTED|PWNED|object Process|\/home\/|node:internal/);
};

const CASES: Case[] = [
  // ---- CPU ----
  { id: "cpu-infinite-loop", code: "while (true) {}", expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-loop-catch-interrupt", code: "for (;;) { try { while (true) {} } catch (e) {} }", expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-redos-regex", code: "/(a+)+$/.test('a'.repeat(40) + 'b'); " + OK, expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-sort-comparator-loop", code: "[3,2,1].sort(() => { while (true) {} });", expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-getter-on-thrown-error", code: "throw { get message() { while (true) {} }, get name() { while (true) {} } };", expect: ["SCRIPT_TIMEOUT"] },
  // Regression (review round 2): an interrupt inside an async function became a rejected
  // promise, so a synchronous loop that kept calling one ran on past cpuMs and returned ok.
  {
    id: "cpu-async-shield",
    code: "const burn = async () => { let x = 0; for (let i = 0; i < 200000; i++) x += i; return x; }; for (let k = 0; k < 20000; k++) burn(); " + OK,
    expect: ["SCRIPT_TIMEOUT"],
    check: (r) => assert.ok(r.stats.cpuMs < 5 * FAST_LIMITS.cpuMs + 1000, `cpuMs ${r.stats.cpuMs}`),
  },
  {
    id: "cpu-async-shield-caught",
    code: "const burn = async () => { let x = 0; for (let i = 0; i < 200000; i++) x += i; return x; }; for (let k = 0; k < 300000; k++) { try { burn(); } catch (e) {} } " + OK,
    expect: ["SCRIPT_TIMEOUT"],
    check: (r) => assert.ok(r.stats.cpuMs < 5 * FAST_LIMITS.cpuMs + 1000, `cpuMs ${r.stats.cpuMs}`),
  },
  { id: "cpu-async-infinite", code: "async function f() { while (true) {} } f(); " + OK, expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-async-then-host-call", code: "async function f() { while (true) {} } f(); box(1, 1, 1); box(2, 2, 2); " + OK, expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-timeout-then-throw-own-code", code: "async function f() { while (true) {} } f(); throw { code: 'MY_CODE', message: 'x' };", expect: ["SCRIPT_TIMEOUT"] },
  { id: "cpu-microtask-flood-not-drained", code: "Promise.resolve().then(function f() { return Promise.resolve().then(f); }); " + OK, expect: ["ok"] },
  // ---- memory ----
  { id: "mem-array-1e9", code: "const a = new Array(1e9).fill(0); " + OK, expect: ["SCRIPT_MEMORY", "SCRIPT_RUNTIME", "SCRIPT_TIMEOUT"] },
  { id: "mem-push-loop", code: "const a = []; while (true) a.push(new Array(1e4).fill(1.5));", limits: { cpuMs: 10_000 }, expect: ["SCRIPT_MEMORY"] },
  { id: "mem-string-doubling", code: "let s = 'x'; while (true) s += s;", limits: { cpuMs: 10_000 }, expect: ["SCRIPT_MEMORY", "SCRIPT_RUNTIME"] },
  { id: "mem-arraybuffer-1GiB", code: "new ArrayBuffer(2 ** 30); " + OK, expect: ["SCRIPT_MEMORY", "SCRIPT_RUNTIME"] },
  { id: "mem-float64array-1e8", code: "new Float64Array(1e8); " + OK, expect: ["SCRIPT_MEMORY", "SCRIPT_RUNTIME"] },
  { id: "mem-oom-then-catch-and-continue", code: "try { const a = []; while (true) a.push(new Array(1e4).fill(1)); } catch (e) {} " + OK, limits: { cpuMs: 10_000 }, expect: ["ok", "SCRIPT_MEMORY"] },
  // ---- stack ----
  { id: "stack-recursion", code: "function f(n) { return f(n + 1) + 1; } f(0);", expect: ["SCRIPT_STACK"] },
  { id: "stack-recursion-catch-retry", code: "function f() { try { return f(); } catch (e) { return f(); } } f();", expect: ["SCRIPT_STACK", "SCRIPT_TIMEOUT"] },
  { id: "stack-json-parse-deep", code: "JSON.parse('['.repeat(1e6));", expect: ["SCRIPT_STACK"] },
  { id: "stack-regex-deep", code: "new RegExp('('.repeat(1e5) + 'a' + ')'.repeat(1e5)).test('a');", expect: ["SCRIPT_STACK", "SCRIPT_SYNTAX"] },
  // ---- capabilities: none of these may reach the host ----
  {
    id: "cap-globals",
    code: "report(Object.fromEntries(['process','require','module','exports','fetch','XMLHttpRequest','WebSocket','setTimeout','setInterval','queueMicrotask','WebAssembly','Deno','Bun','std','os','__host','__hostCall','__hostLog','__hostNames','__params','__paramsJson','__finish','Date','Buffer'].map(k => [k, typeof globalThis[k]]))); " + OK,
    expect: ["ok"],
    check: (_r, reports) => {
      const seen = reports[0] as Record<string, string>;
      for (const [k, t] of Object.entries(seen)) assert.equal(t, "undefined", `${k} must not exist in the guest`);
    },
  },
  { id: "cap-require", code: "require('fs');", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-process-exit", code: "process.exit(1);", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-fetch", code: "fetch('https://example.com');", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-static-import", code: "import fs from 'fs';", expect: ["SCRIPT_SYNTAX"] },
  { id: "cap-dynamic-import", code: "import('fs').then(() => report('IMPORTED'), (e) => report('rejected')); " + OK, expect: ["ok", "SCRIPT_RUNTIME", "SCRIPT_SYNTAX"], check: notReached },
  {
    id: "cap-function-ctor-global",
    code: "const g = (function () {}).constructor('return this')(); report({ same: g === globalThis, process: typeof g.process, require: typeof g.require }); " + OK,
    expect: ["ok"],
    check: (_r, reports) => assert.deepEqual(reports[0], { same: true, process: "undefined", require: "undefined" }),
  },
  {
    id: "cap-host-fn-ctor-escape",
    code: "const F = report.constructor; report({ isGuest: F === Function, viaCtor: F('return typeof process')(), viaCtorCtor: report.constructor.constructor('return typeof require')() }); " + OK,
    expect: ["ok"],
    check: (_r, reports) => assert.deepEqual(reports[0], { isGuest: true, viaCtor: "undefined", viaCtorCtor: "undefined" }),
  },
  {
    id: "cap-host-error-escape",
    code: "try { box(-1, 1, 1); } catch (e) { report({ isGuestError: e instanceof Error, code: e.code, message: e.message, proc: e.constructor.constructor('return typeof process')() }); } " + OK,
    expect: ["ok"],
    check: (_r, reports) => {
      const r = reports[0] as Record<string, unknown>;
      assert.equal(r["isGuestError"], true);
      assert.equal(r["code"], "DSL_BAD_ARGUMENT");
      assert.equal(r["proc"], "undefined");
    },
  },
  {
    id: "cap-host-exception-text",
    code: "try { hostThrow(); } catch (e) { report({ code: e.code, message: e.message, stack: e.stack }); } " + OK,
    expect: ["ok"],
    check: (_r, reports) => {
      const r = reports[0] as Record<string, string>;
      assert.equal(r["code"], "HOST_ERROR");
      assert.doesNotMatch(r["stack"] ?? "", /node:|\.ts:\d/);
    },
  },
  {
    id: "cap-eval-stays-inside",
    code: "report(eval('typeof process + \"/\" + typeof require')); " + OK,
    expect: ["ok"],
    check: (_r, reports) => assert.equal(reports[0], "undefined/undefined"),
  },
  { id: "cap-date-removed", code: "Date.now();", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-proto-poison-frozen", code: "Array.prototype.map = function () { return []; };", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-object-proto-pollution-frozen", code: "Object.prototype.polluted = 1;", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-json-poison-frozen", code: "JSON.stringify = () => '[]';", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-global-override-finish", code: "globalThis.__finish = (x) => 'PWNED'; " + OK, expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-shape-class-frozen", code: "Object.defineProperty(box(1, 1, 1).constructor, Symbol.hasInstance, { value: () => true });", expect: ["SCRIPT_RUNTIME"] },
  { id: "cap-wrapper-breakout", code: "return box(1,1,1); })()); globalThis.x = 1; ((function () {", expect: ["SCRIPT_SYNTAX", "SCRIPT_RUNTIME"] },
  {
    id: "cap-wrapper-breakout-reach",
    code: "return 1; }); (function () { report(typeof __host + typeof __hostCall + typeof __finish); return box(1, 1, 1);",
    expect: ["ok"],
    check: (_r, reports) => assert.equal(reports[0], "undefinedundefinedundefined"),
  },
  // ---- handles ----
  { id: "handle-forge-constructor", code: "const S = box(1, 1, 1).constructor; return new S({}, 1);", expect: ["SCRIPT_RUNTIME"] },
  { id: "handle-forge-plain-object", code: "return fillet({ id: 1 }, 1);", expect: ["SCRIPT_RUNTIME"] },
  { id: "handle-non-shape-result", code: "return { name: 'x', shape: 5 };", expect: ["SCRIPT_RUNTIME"] },
  // ---- host abuse ----
  { id: "host-bad-args-negative", code: "return box(-1, 1, 1);", expect: ["DSL_BAD_ARGUMENT"] },
  { id: "host-bad-args-nan", code: "return box(NaN, 1, 1);", expect: ["DSL_BAD_ARGUMENT"] },
  { id: "host-bad-args-string", code: "return box('10', 1, 1);", expect: ["DSL_BAD_ARGUMENT"] },
  { id: "host-bad-args-huge", code: "return box(1e300, 1, 1);", expect: ["DSL_BAD_ARGUMENT"] },
  { id: "host-call-budget", code: "for (let i = 0; i < 100000; i++) box(1, 1, 1);", limits: { cpuMs: 10_000 }, expect: ["SCRIPT_LIMIT"] },
  { id: "host-call-budget-swallowed", code: "try { for (let i = 0; i < 100000; i++) box(1, 1, 1); } catch (e) {} " + OK, limits: { cpuMs: 10_000 }, expect: ["SCRIPT_LIMIT"] },
  { id: "host-handle-budget", code: "for (let i = 0; i < 200; i++) box(1, 1, 1);", limits: { maxHandles: 100 }, expect: ["SCRIPT_LIMIT"] },
  {
    id: "host-batch-cap",
    code: "return union(Array.from({ length: 2000 }, (_, i) => box(1, 1, 1)));",
    limits: { cpuMs: 10_000 },
    expect: ["SCRIPT_LIMIT"],
    // Regression (review round 2): the batch-limit error had no hint, and the playbook said to batch more.
    check: (r) => assert.match(!r.ok ? r.error.hint ?? "" : "", /split the list into calls of at most 1000 items/i),
  },
  { id: "host-long-string", code: "report('x'.repeat(1e5)); " + OK, expect: ["SCRIPT_LIMIT"] },
  // ---- output ----
  { id: "result-too-large", code: "const b = box(1, 1, 1); return Array.from({ length: 3000 }, () => ({ name: 'x'.repeat(100), shape: b }));", expect: ["SCRIPT_RESULT_TOO_LARGE"] },
  { id: "result-throw-non-error", code: "throw 42;", expect: ["SCRIPT_RUNTIME"], check: (r) => assert.equal(!r.ok && r.error.message, "42") },
  {
    id: "result-huge-error-message",
    code: "throw new Error('x'.repeat(1e6));",
    expect: ["SCRIPT_RUNTIME"],
    check: (r) => assert.ok(!r.ok && r.error.message.length < 2100),
  },
  { id: "result-nothing", code: "const a = 1;", expect: ["SCRIPT_RUNTIME", "SCRIPT_NO_RESULT"] },
];

for (const c of CASES) {
  test(`hostile case ${c.id} ends safely`, async () => {
    const host = fakeHost();
    const r = await runScript(c.code, { hostApi: host.hostApi, limits: { ...FAST_LIMITS, ...c.limits } });
    const got = r.ok ? "ok" : r.error.code;
    assert.ok(c.expect.includes(got), `${c.id}: got ${got}${r.ok ? "" : ` (${r.error.message})`}, expected one of ${c.expect.join(", ")}`);
    if (!r.ok) {
      assert.ok(r.error.message.length > 0);
      assert.ok(r.error.message.length < 2100);
    }
    notReached(r, host.reports);
    c.check?.(r, host.reports);
    // The process and the module still work after the case.
    const sane = await runScript(SANITY, { hostApi: fakeHost().hostApi });
    assert.equal(sane.ok, true, sane.ok ? "" : sane.error.message);
  });
}

test("Math.random is seeded and the same in every run", async () => {
  const code = "report([Math.random(), Math.random()]); " + OK;
  const a = fakeHost();
  const b = fakeHost();
  await runScript(code, { hostApi: a.hostApi });
  await runScript(code, { hostApi: b.hostApi });
  assert.deepEqual(a.reports, b.reports);
  const [x, y] = a.reports[0] as number[];
  assert.ok(x! >= 0 && x! < 1 && y! >= 0 && y! < 1 && x !== y);
});

test("unsafe limits are refused as host bugs", async () => {
  const hostApi = fakeHost().hostApi;
  await assert.rejects(runScript(OK, { hostApi, limits: { stackBytes: 0 } }), RangeError);
  await assert.rejects(runScript(OK, { hostApi, limits: { memoryBytes: -1 } }), RangeError);
  await assert.rejects(runScript(OK, { hostApi, limits: { cpuMs: 0 } }), RangeError);
  await assert.rejects(runScript(OK, { hostApi, filename: "open3dj:bridge.js" }), RangeError);
});

test("a host failure carries its code, elements, hint and the user's line", async () => {
  const host = fakeHost();
  const r = await runScript("const a = box(10, 10, 10);\n\nconst b = fillet(a, 50);\nreturn b;", { hostApi: host.hostApi });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.code, "KERNEL_FILLET_FAILED");
  assert.equal(r.error.line, 3);
  assert.equal(typeof r.error.column, "number");
  assert.deepEqual(r.error.elements, ["edge:1", "edge:2"]);
  assert.equal(r.error.hint, "Use a smaller radius.");
});

test("beforeCall receives the user's line of each host call", async () => {
  const host = fakeHost();
  const r = await runScript("const a = box(1, 2, 3);\nconst b = a.translate(1, 0, 0);\nreturn b;", { hostApi: host.hostApi });
  assert.equal(r.ok, true);
  assert.deepEqual(host.sites, [{ name: "box", line: 1 }, { name: "translate", line: 2 }]);
});

test("a runtime error deep in user functions points at the throwing line", async () => {
  const r = await runScript("function inner() {\n  return null.x;\n}\nreturn inner();", { hostApi: fakeHost().hostApi });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "SCRIPT_RUNTIME");
    assert.equal(r.error.line, 2);
    assert.match(r.error.message, /TypeError/);
  }
});

test("a signal aborted before the run cancels it", async () => {
  const r = await runScript("while (true) {}", { hostApi: fakeHost().hostApi, signal: { aborted: true }, limits: { cpuMs: 5000 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "SCRIPT_CANCELLED");
});

test("a signal aborted during the run cancels it at the next interrupt check", async () => {
  const controller = new AbortController();
  const host = fakeHost({ onCall: () => controller.abort() });
  const started = Date.now();
  const r = await runScript("poke();\nwhile (true) {}", { hostApi: host.hostApi, signal: controller.signal, limits: { cpuMs: 5000 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "SCRIPT_CANCELLED");
  assert.ok(Date.now() - started < 4000);
});

test("console output goes to logs, never to stdout", async (t) => {
  const write = t.mock.method(process.stdout, "write");
  const r = await runScript("console.log('hello', 1, { a: 2 });\nconsole.warn('careful');\nreturn 1;", { hostApi: { functions: {}, prelude: "" } });
  assert.equal(write.mock.callCount(), 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.logs, [{ level: "log", message: "hello 1 {\"a\":2}" }, { level: "warn", message: "careful" }]);
});

test("stats report guest time, host calls and the capped memory", async () => {
  const r = await runScript("let x = 0; for (let i = 0; i < 1e5; i++) x += i; return box(1, 2, 3);", { hostApi: fakeHost().hostApi, limits: { memoryBytes: 32 * 1024 * 1024 } });
  assert.equal(r.ok, true);
  assert.equal(r.stats.hostCalls, 1);
  assert.ok(r.stats.cpuMs >= 0);
  assert.ok(r.stats.memoryBytes <= 32 * 1024 * 1024);
  assert.ok(r.stats.instantiateMs >= 0);
});

test("in a worker with an 8 MB stack, deep recursion stops inside QuickJS", async () => {
  const { Worker } = await import("node:worker_threads");
  const w = new Worker(new URL("./stack-worker.testing.ts", import.meta.url), { resourceLimits: { stackSizeMb: 8 }, stdout: true, stderr: true });
  const results = await new Promise<{ code: string; message: string }[]>((resolve, reject) => {
    w.once("message", resolve);
    w.once("error", reject);
  });
  await w.terminate();
  // Guest-level errors (InternalError/SyntaxError from QuickJS), not the host's RangeError.
  assert.deepEqual(results.map((r) => r.code), ["SCRIPT_STACK", "SCRIPT_STACK"]);
  for (const r of results) assert.match(r.message, /stack overflow/);
});
