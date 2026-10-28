// Tests for the gates themselves: a gate that cannot fail is not a gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spdxAllowed } from "./license-gate-lib.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const gate = (env: Record<string, string>) =>
  spawnSync(process.execPath, [here("./leak-gate.ts"), "--server", here("./fixtures/fake-mcp-server.ts")], {
    encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000,
  });

test("leak gate passes a clean server", () => {
  const r = gate({});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /PASS leak gate/);
});

test("leak gate fails when a stray line reaches stdout", () => {
  const r = gate({ FAKE_LEAK: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not JSON-RPC/);
  assert.match(r.stderr, /Statistics on Transfer/);
});

test("leak gate fails when the tool calls fail (no vacuous pass)", () => {
  const r = gate({ FAKE_FAIL: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run returned status error/);
});

test("SPDX expressions: OR needs one allowed side, AND needs both", () => {
  const allowed = new Set(["MIT", "Apache-2.0"]);
  assert.equal(spdxAllowed("MIT", allowed), true);
  assert.equal(spdxAllowed("MIT OR Apache-2.0", allowed), true);
  assert.equal(spdxAllowed("(GPL-3.0-only OR MIT)", allowed), true);
  assert.equal(spdxAllowed("MIT AND GPL-3.0-only", allowed), false);
  assert.equal(spdxAllowed("LGPL-2.1-only", allowed), false);
  assert.equal(spdxAllowed("Apache-2.0 WITH LLVM-exception", allowed), true);
  assert.throws(() => spdxAllowed("(MIT", allowed));
});
