// The egress log: owner-only file and folder, append-only lines, schema-checked records,
// never prompt text and never a key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EgressLog } from "./egress-log.ts";
import type { EgressRecord } from "./egress-log.ts";

const HASH = "b".repeat(64);
const approval: EgressRecord = {
  ts: "2026-11-08T12:00:00.000Z", kind: "approval", approval_id: "a_0123456789abcdef", payload_hash: HASH, engine: "api", host: "api.anthropic.com", model: "model-a",
  decision: "approved", scope: "prompt", by: "computer",
};
const request: EgressRecord = {
  ts: "2026-11-08T12:00:02.000Z", kind: "request", approval_id: "a_0123456789abcdef", payload_hash: HASH, engine: "api", host: "api.anthropic.com", model: "model-a",
  request_bytes: 21000, attempts: 2, usage: { input: 100, output: 20, cache_read: 5000, cache_write: 0 }, outcome: "ok",
};
const posix = process.platform !== "win32";

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "o3j-egress-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test("a new log: the folder is 0700 and the file 0600", { skip: posix ? false : "POSIX modes" }, () => {
  withDir((dir) => {
    const path = join(dir, "state", "open3dj", "egress.jsonl");
    const log = new EgressLog(path);
    assert.equal(log.path, path);
    assert.equal(statSync(join(dir, "state", "open3dj")).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, "utf8"), "");
    log.append(approval);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

test("an existing log is kept and made owner-only", { skip: posix ? false : "POSIX modes" }, () => {
  withDir((dir) => {
    const path = join(dir, "egress.jsonl");
    writeFileSync(path, `${JSON.stringify(approval)}\n`);
    chmodSync(path, 0o644);
    const log = new EgressLog(path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    log.append(request);
    assert.equal(readFileSync(path, "utf8").split("\n").filter(Boolean).length, 2);
  });
});

test("append-only: each record is one more line and earlier lines never change", () => {
  withDir((dir) => {
    const path = join(dir, "egress.jsonl");
    const log = new EgressLog(path);
    log.append(approval);
    const first = readFileSync(path, "utf8");
    log.append(request);
    log.append({ ...request, usage: null, outcome: "stopped", attempts: 1 });
    const text = readFileSync(path, "utf8");
    assert.ok(text.startsWith(first));
    const lines = text.trimEnd().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines, [approval, request, { ...request, usage: null, outcome: "stopped", attempts: 1 }]);
    // A second EgressLog on the same file appends too.
    new EgressLog(path).append({ ...approval, decision: "denied", scope: undefined } as never);
    assert.equal(readFileSync(path, "utf8").trimEnd().split("\n").length, 4);
  });
});

test("a record outside the schema, with prompt text or with a key, throws and writes nothing", () => {
  withDir((dir) => {
    const path = join(dir, "egress.jsonl");
    const log = new EgressLog(path);
    const key = ["sk", "ant", "api03", "R2d2C3po".repeat(4)].join("-");
    const bad: unknown[] = [
      { ...approval, prompt: "Make the wall 2 mm thick" },
      { ...request, text: "the conversation" },
      { ...approval, decision: "maybe" },
      { ...request, request_bytes: -1 },
      { ...approval, by: "anyone" },
    ];
    for (const r of bad) assert.throws(() => log.append(r as EgressRecord), /does not match its schema/, JSON.stringify(r));
    // A key-shaped model id fits the id pattern, so it is refused by its shape.
    assert.throws(() => log.append({ ...approval, model: key }), /shaped like an API key/);
    assert.equal(readFileSync(path, "utf8"), "");
  });
  assert.throws(() => new EgressLog("relative/egress.jsonl"), /absolute path/);
});
