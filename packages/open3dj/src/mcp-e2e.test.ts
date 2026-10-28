// End to end over MCP with the real compute pool: `open3dj mcp` as agents start it, driven
// by the official clients at each protocol era (v1 SDK at 2025-11-25, v2 client in legacy
// mode and pinned to 2026-07-28). Each session lists the tools, runs the bracket example,
// renders a PNG and exports STEP into a temporary folder. Every stdout byte of the server
// is recorded, and the test fails if any line is not JSON-RPC (the stdout-leak gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client as ClientV2 } from "@modelcontextprotocol/client";
import { StdioClientTransport as StdioV2 } from "@modelcontextprotocol/client/stdio";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as StdioV1 } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolList } from "@open3dj/mcp";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TEE = fileURLToPath(new URL("./stdout-tee.testing.ts", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../../examples/bracket/", import.meta.url));
const SCRIPT = readFileSync(join(EXAMPLE, "bracket.o3j.js"), "utf8");
const EXPECTED = JSON.parse(readFileSync(join(EXAMPLE, "expected.json"), "utf8")) as {
  tolerance: number;
  parts: Array<{ def: string; volume_mm3: number }>;
};

interface Content { type: string; text?: string; data?: string; mimeType?: string }
interface CallResult { isError?: boolean; structuredContent?: Record<string, unknown>; content: Content[] }
interface AnyClient {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(p: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

/** The server command, wrapped by the tee so its stdout lands in stdoutLog as well. */
function serverCommand(root: string, stdoutLog: string): { command: string; args: string[]; cwd: string } {
  return { command: process.execPath, args: [TEE, stdoutLog, process.execPath, CLI, "mcp", "--root", root, "--workers", "2"], cwd: root };
}

async function session(client: AnyClient, root: string): Promise<void> {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, toolList().map((t) => t.name).sort());

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as CallResult;
    assert.notEqual(r.isError, true, `${name}: ${r.content[0]?.text?.slice(0, 800)}`);
    return r;
  };
  const project = "bracket.o3j";

  const run = await call("run", { project, script: SCRIPT, detail: "detailed" });
  assert.equal(run.structuredContent?.status, "ok");
  assert.equal(run.structuredContent?.rev, "r_0001");
  const report = run.structuredContent?.report as { parts: Array<{ def: string; valid: boolean; volume_mm3: number }> };
  // compute sits next to the report, once (the report inside a run result leaves it out).
  assert.equal((run.structuredContent?.compute as { backend: string }).backend, "cpu.wasm");
  const part = report.parts[0]!;
  assert.equal(part.valid, true);
  const want = EXPECTED.parts[0]!.volume_mm3;
  assert.ok(Math.abs(part.volume_mm3 - want) <= EXPECTED.tolerance * want, `volume ${part.volume_mm3} vs expected ${want}`);

  const render = await call("render", { project, view: "multiview", format: "png" });
  const image = render.content.find((c) => c.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.equal(Buffer.from(image!.data!, "base64").subarray(1, 4).toString(), "PNG");

  const exported = await call("export", { project, format: "step", out_dir: "exports" });
  const files = (exported.structuredContent?.files as Array<{ path: string }>).map((f) => f.path);
  assert.deepEqual(files, ["exports/bracket.step", "exports/bracket.evidence.json"]);
  const step = readFileSync(join(root, project, "exports", "bracket.step"), "latin1");
  assert.match(step, /^ISO-10303-21;/);
  assert.match(step, /END-ISO-10303-21;\s*$/);
}

/** Every recorded stdout line must be a JSON-RPC 2.0 message. */
function assertOnlyJsonRpc(stdoutLog: string): number {
  assert.ok(existsSync(stdoutLog), "the server wrote nothing to stdout");
  const lines = readFileSync(stdoutLog, "utf8").split("\n").filter((l) => l.length > 0);
  const foreign = lines.filter((l) => {
    try {
      return (JSON.parse(l) as { jsonrpc?: unknown }).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });
  assert.deepEqual(foreign.map((l) => l.slice(0, 200)), [], "stdout carried lines that are not JSON-RPC");
  return lines.length;
}

function e2e(connect: (root: string, stdoutLog: string) => Promise<AnyClient>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "o3j-e2e-"));
    const stdoutLog = join(root, "server-stdout.log");
    try {
      const client = await connect(root, stdoutLog);
      try {
        await session(client, root);
      } finally {
        await client.close();
      }
      // Worker output is forwarded asynchronously; give a late leak time to arrive.
      await new Promise((r) => setTimeout(r, 500));
      assert.ok(assertOnlyJsonRpc(stdoutLog) >= 5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("v1 SDK client (1.32.2, 2025-11-25) drives the real server and pool", e2e(async (root, log) => {
  const client = new ClientV1({ name: "e2e-v1", version: "0" });
  await client.connect(new StdioV1({ ...serverCommand(root, log), stderr: "ignore" }));
  assert.equal(client.getServerVersion()?.name, "open3dj");
  return client as unknown as AnyClient;
}));

test("v2 client (2.4.0) in legacy mode drives the real server and pool", e2e(async (root, log) => {
  const client = new ClientV2({ name: "e2e-v2-legacy", version: "0" });
  await client.connect(new StdioV2({ ...serverCommand(root, log), stderr: "ignore" }));
  assert.match(String(client.getNegotiatedProtocolVersion?.()), /^2025-/);
  return client as unknown as AnyClient;
}));

test("v2 client pinned to 2026-07-28 drives the real server and pool", e2e(async (root, log) => {
  const client = new ClientV2({ name: "e2e-v2-modern", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } } as never);
  await client.connect(new StdioV2({ ...serverCommand(root, log), stderr: "ignore" }));
  assert.equal(client.getNegotiatedProtocolVersion?.(), "2026-07-28");
  return client as unknown as AnyClient;
}));
