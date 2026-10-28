import { test } from "node:test";
import assert from "node:assert/strict";
import { NotImplementedError } from "@open3dj/schemas";
import { DEFAULT_LIMITS, PACKAGE_STATUS, runScript } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "sandbox is a stub" : false;

test("exports a typed entry point and default limits", async () => {
  assert.equal(typeof runScript, "function");
  assert.equal(DEFAULT_LIMITS.memoryBytes, 128 * 1024 * 1024);
  if (PACKAGE_STATUS === "stub") {
    await assert.rejects(runScript("return 1", { hostApi: { functions: {}, prelude: "" } }), NotImplementedError);
  }
});

test("returns the script value as plain data", { skip: stub }, async () => {
  const r = await runScript("return 1 + 1", { hostApi: { functions: {}, prelude: "" } });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 2);
});

test("reports syntax errors with the user's line", { skip: stub }, async () => {
  const r = await runScript("const a = 1;\nreturn (", { hostApi: { functions: {}, prelude: "" } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "SCRIPT_SYNTAX");
    assert.equal(r.error.line, 2);
  }
});

test("an infinite loop ends with SCRIPT_TIMEOUT", { skip: stub }, async () => {
  const r = await runScript("while (true) {}", { hostApi: { functions: {}, prelude: "" }, limits: { cpuMs: 200 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "SCRIPT_TIMEOUT");
});

test("a memory bomb ends with SCRIPT_MEMORY", { skip: stub }, async () => {
  const r = await runScript("const a = []; for (;;) a.push(new Array(1e5).fill(1));", {
    hostApi: { functions: {}, prelude: "" }, limits: { memoryBytes: 32 * 1024 * 1024, cpuMs: 10_000 },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "SCRIPT_MEMORY");
});

test("no host globals leak into the guest", { skip: stub }, async () => {
  const r = await runScript(
    "return [typeof process, typeof require, typeof fetch, typeof Date, (function(){ try { return typeof (0).constructor.constructor('return process')(); } catch { return 'blocked'; } })()]",
    { hostApi: { functions: {}, prelude: "" } },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, ["undefined", "undefined", "undefined", "undefined", "blocked"]);
});
