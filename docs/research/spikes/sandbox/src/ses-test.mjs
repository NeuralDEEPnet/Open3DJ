// SES / Hardened JS (ses@2.3.0): lockdown() + Compartment with hardened endowments.
// usage: node ses-test.mjs <deps>            -> runs all probes in child processes
//        node ses-test.mjs <deps> <probe>    -> one probe (internal)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { depsPath } from "./lib/util.mjs";
const deps = depsPath();
const probe = process.argv[3];
if (!probe) {
  const self = fileURLToPath(import.meta.url); const out = [];
  for (const p of ["escapes", "infinite-loop", "memory-bomb", "stack-overflow", "perf", "enclosure"]) {
    const t = performance.now();
    const args = p === "memory-bomb" ? ["--max-old-space-size=256", self, deps, p] : [self, deps, p];
    const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: p === "enclosure" ? 60000 : 8000 });
    out.push({ probe: p, wall_ms: Math.round(performance.now() - t), exit: r.status, signal: r.signal, killed_by_timeout: r.error?.code === "ETIMEDOUT",
      stdout: r.stdout.trim().slice(0, 1500), stderr: r.stderr.trim().split("\n").filter((l) => /FATAL|Error|heap|lockdown|SES/i.test(l)).slice(0, 3).join(" | ").slice(0, 400) });
  }
  console.log(JSON.stringify({ ses: JSON.parse(readFileSync(`${deps}/node_modules/ses/package.json`, "utf8")).version, probes: out }, null, 1));
  process.exit(0);
}
// Load the kernel BEFORE lockdown (emscripten glue mutates globals) - itself a finding.
let kernel = null;
if (probe === "enclosure") { const { OcctKernel } = await import(`file://${deps}/node_modules/occt-wasm/dist/index.js`); kernel = await OcctKernel.init(); }
const { makeOps, handleTable, DEFAULT_LIMITS } = await import("./lib/bridge.mjs");
const tl = performance.now();
await import(`file://${deps}/node_modules/ses/dist/ses.cjs`).catch(async () => import(`file://${deps}/node_modules/ses/index.js`));
lockdown({ errorTaming: "safe", overrideTaming: "severe", consoleTaming: "unsafe" });
const lockdownMs = performance.now() - tl;
const hostBox = harden((w, d, h) => { if (!(w > 0)) throw new Error("w must be > 0"); return harden({ w, d, h }); });
const mk = () => new Compartment({ globals: { box: hostBox }, __options__: true });
const ev = (src) => { try { return mk().evaluate(src); } catch (e) { return `${e.name}: ${e.message}`; } };
let res;
if (probe === "escapes") {
  res = {
    lockdown_ms: Math.round(lockdownMs),
    via_endowed_function: ev("box.constructor.constructor('return typeof process')()"),
    via_host_error: ev("try { box(-1) } catch (e) { e.constructor.constructor('return typeof process')() }"),
    via_returned_object: ev("box(1,1,1).constructor.constructor('return typeof process')()"),
    via_this: ev("typeof globalThis.process"),
    function_ctor_in_compartment: ev("(function(){}).constructor('return typeof globalThis.process')()"),
    proto_poison: ev("Array.prototype.map = () => []; 'poisoned'"),
    date_now: ev("typeof Date.now()"),
    math_random: ev("Math.random()"),
    dynamic_import: ev("import('fs')"),
    require: ev("require('fs')"),
  };
} else if (probe === "infinite-loop") { res = ev("while (true) {}"); }
else if (probe === "memory-bomb") { res = ev("const a = []; while (true) a.push(new Array(1e5).fill(1.5));"); }
else if (probe === "stack-overflow") { res = ev("function f(){ return f() + 1 } f()"); }
else if (probe === "perf") {
  const t = []; for (let i = 0; i < 30; i++) { const a = performance.now(); mk(); t.push(performance.now() - a); } t.sort((a, b) => a - b);
  const c = new Compartment({ globals: { noop: harden(() => 0) }, __options__: true });
  const fn = c.evaluate("() => { for (let i = 0; i < 10000; i++) noop(); }");
  const u = []; for (let i = 0; i < 9; i++) { const a = performance.now(); fn(); u.push(performance.now() - a); } u.sort((a, b) => a - b);
  res = { lockdown_ms: +lockdownMs.toFixed(1), compartment_create_ms_median: +t[15].toFixed(3), noop_10k_ms_median: +u[4].toFixed(3) };
} else if (probe === "enclosure") {
  // Same guest prelude + script, but in a Compartment with direct (no marshalling) host ops.
  const prelude = readFileSync(new URL("./lib/guest-prelude.js", import.meta.url), "utf8");
  const code = readFileSync(new URL("./scripts/enclosure.js", import.meta.url), "utf8");
  const times = [];
  let vol;
  for (let i = 0; i < 15; i++) {
    const a = performance.now();
    const cp = kernel.checkpoint(); const H = handleTable(DEFAULT_LIMITS); const ops = makeOps(kernel, H, DEFAULT_LIMITS);
    const c = new Compartment({ globals: { __k: harden({ ...ops }), __params: "{}" }, __options__: true });
    try { c.evaluate(prelude); } catch (e) { res = "prelude failed: " + e.message; break; }
    const out = JSON.parse(c.evaluate(`__finish((function main() {\n${code}\n})())`));
    vol = kernel.getVolume(H.get(out[0].id)); kernel.isValid(H.get(out[0].id));
    kernel.releaseSince(cp);
    times.push(performance.now() - a);
  }
  if (!res) { times.sort((a, b) => a - b); res = { runs: times.length, median_ms: +times[7].toFixed(2), volume: vol }; }
}
console.log(JSON.stringify({ probe, res }));
