// The stdout rule: kernel output must never reach process.stdout, because in the daemon that
// stream carries MCP JSON-RPC. A child process runs real export and render jobs through the
// pool; every byte of its stdout is captured and must be zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

test("zero bytes reach process.stdout during STEP export and render jobs", async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./stdout-child.testing.ts", import.meta.url))], { stdio: ["ignore", "pipe", "pipe"] });
  const out: Buffer[] = [];
  let err = "";
  child.stdout.on("data", (d: Buffer) => out.push(d));
  child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  assert.equal(code, 0, err);
  assert.equal(Buffer.concat(out).length, 0, `stdout must be empty, got: ${Buffer.concat(out).toString("utf8").slice(0, 200)}`);
  const line = err.split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, err);
  const summary = JSON.parse(line.slice(7)) as { export: [string, number][]; render: [string, number][] };
  assert.deepEqual(summary.export.map(([n]) => n), ["root.step", "root.3mf", "root.evidence.json"]);
  assert.ok(summary.export[0]![1] > 1000);
  assert.deepEqual(summary.render.map(([n]) => n), ["multiview.png"]);
  // The STEP writer did print, and the pool drained it into the log (stderr here).
  assert.match(err, /\[worker \d+\] \[kernel out\] .*Statistics on Transfer/);
});
