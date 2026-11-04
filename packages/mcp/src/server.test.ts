// Protocol tests: the real server code over the fake compute pool, driven by the official
// clients at every era the architecture names (ARCHITECTURE.md section 9): a raw 2025-06-18
// initialize, the v1 SDK client (1.32.2, 2025-11-25), and the v2 client (2.4.0) in legacy
// mode and pinned to 2026-07-28. Errors must be tool results, never protocol errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client as ClientV2 } from "@modelcontextprotocol/client";
import { StdioClientTransport as StdioV2 } from "@modelcontextprotocol/client/stdio";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as StdioV1 } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toolList } from "./tools.ts";

const SERVER = fileURLToPath(new URL("./testing-server.ts", import.meta.url));
const SCRIPT = `const plate = box(60, 40, 8);
return [{ name: "plate", shape: plate }, { name: "pin", shape: cylinder(12, 2.8) }];`;


interface Content { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri: string; mimeType?: string; text?: string } }
interface CallResult { isError?: boolean; structuredContent?: Record<string, unknown>; content: Content[] }
interface AnyClient {
  connect(t: unknown): Promise<void>;
  listTools(): Promise<{ tools: Array<Record<string, unknown>> }>;
  callTool(p: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

const pick = (t: Record<string, unknown>) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations });

async function exercise(client: AnyClient, project: string, root: string): Promise<void> {
  const listed = (await client.listTools()).tools.map(pick).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // tools/list publishes exactly the definitions in tools.ts.
  const expected = toolList().sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), JSON.parse(JSON.stringify(expected)));

  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallResult;
  const run = await call("run", { project, script: SCRIPT });
  assert.equal(run.isError, undefined, JSON.stringify(run));
  assert.equal(run.structuredContent?.status, "ok");
  assert.equal(run.structuredContent?.rev, "r_0001");
  assert.deepEqual(JSON.parse(run.content[0]!.text!), run.structuredContent, "the text mirrors structuredContent");

  const png = await call("render", { project, view: "multiview" });
  assert.equal(png.structuredContent?.status, "ok");
  const image = png.content.find((c) => c.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.equal(Buffer.from(image!.data!, "base64").subarray(1, 4).toString(), "PNG");
  const svg = await call("render", { project, view: "multiview", format: "svg" });
  const res = svg.content.find((c) => c.type === "resource");
  assert.equal(res?.resource?.mimeType, "image/svg+xml");
  assert.match(res!.resource!.text!, /<svg/);
  assert.match(res!.resource!.uri, /^open3dj:\/\/.+\/r_0001\/multiview\.svg$/);
  // Regression (review round 2): an absolute project path put the server's local path in the URI.
  const absSvg = await call("render", { project: join(root, project), view: "multiview", format: "svg" });
  const absRes = absSvg.content.find((c) => c.type === "resource");
  assert.equal(absRes?.resource?.uri, `open3dj://${encodeURIComponent(project)}/r_0001/multiview.svg`);

  const step = await call("export", { project, format: "step" });
  assert.equal(step.structuredContent?.status, "ok");
  assert.deepEqual((step.structuredContent?.files as Array<{ path: string }>).map((f) => f.path), [`out/r_0001/${project.replace(/\.o3j$/, "")}.step`, `out/r_0001/${project.replace(/\.o3j$/, "")}.evidence.json`]);

  const devices = await call("inspect", { fields: ["devices"] });
  assert.equal((devices.structuredContent?.devices as { backends: string[] }).backends[0], "cpu.wasm");
  const docs = await call("docs", { query: "fillet" });
  assert.equal((docs.structuredContent?.hits as Array<{ title: string }>)[0]?.title, "fillet");
  // Regression (review round 2): bad docs input returned an empty hit list with no error.
  const badDocs = await call("docs", { query: "" });
  assert.equal(badDocs.isError, true);
  assert.equal((badDocs.structuredContent?.error as { code: string }).code, "BAD_INPUT");

  // Errors are tool results with a structured ScriptError, never JSON-RPC errors.
  const broken = await call("run", { project, script: "const x = 1;\nthrow new Error('boom');" });
  assert.equal(broken.isError, true);
  assert.equal((broken.structuredContent?.error as { code: string; line: number }).code, "SCRIPT_RUNTIME");
  assert.equal((broken.structuredContent?.error as { line: number }).line, 2);
  const unknownRev = await call("run", { project, script: `${SCRIPT}//2`, base_rev: "r_0009" });
  assert.equal((unknownRev.structuredContent?.error as { code: string }).code, "UNKNOWN_REV");
  const badInput = await call("inspect", { fields: ["nonsense"] });
  assert.equal(badInput.isError, true);
  assert.match(badInput.content[0]!.text!, /fields/);
  // Regression (review round 1): input errors were unstructured SDK text ("must match at
  // least one of the anyOf schemas"). They are BAD_INPUT results with a hint now.
  assert.equal((badInput.structuredContent?.error as { code: string }).code, "BAD_INPUT");
  const paramsOnly = await call("run", { project, params: { Width: 70 } });
  assert.equal(paramsOnly.isError, true);
  const err = paramsOnly.structuredContent?.error as { code: string; message: string; hint?: string };
  assert.equal(err.code, "BAD_INPUT");
  assert.match(err.message, /script|ops/);
  assert.match(err.hint ?? "", /set_param/);
}

function withRoot(fn: (root: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "o3j-mcp-"));
    try {
      await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("v1 SDK client (1.32.2): initialize, list and call every tool", withRoot(async (root) => {
  const client = new ClientV1({ name: "v1-test", version: "0" });
  await client.connect(new StdioV1({ command: process.execPath, args: [SERVER, root], cwd: root, stderr: "ignore" }));
  try {
    await exercise(client as unknown as AnyClient, "v1.o3j", root);
  } finally {
    await client.close();
  }
}));

test("v2 client (2.4.0) in legacy mode negotiates a 2025 era", withRoot(async (root) => {
  const client = new ClientV2({ name: "v2-legacy", version: "0" });
  await client.connect(new StdioV2({ command: process.execPath, args: [SERVER, root], cwd: root, stderr: "ignore" }));
  try {
    assert.match(String(client.getNegotiatedProtocolVersion?.()), /^2025-/);
    await exercise(client as unknown as AnyClient, "v2legacy.o3j", root);
  } finally {
    await client.close();
  }
}));

test("v2 client pinned to 2026-07-28 uses server/discover", withRoot(async (root) => {
  const client = new ClientV2({ name: "v2-modern", version: "0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } } as never);
  await client.connect(new StdioV2({ command: process.execPath, args: [SERVER, root], cwd: root, stderr: "ignore" }));
  try {
    assert.equal(client.getNegotiatedProtocolVersion?.(), "2026-07-28");
    await exercise(client as unknown as AnyClient, "v2modern.o3j", root);
  } finally {
    await client.close();
  }
}));

test("a raw 2025-06-18 session gets 2025-06-18 back and only JSON-RPC on stdout", withRoot(async (root) => {
  const child = spawn(process.execPath, [SERVER, root], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  const waiters = new Map<number, (m: Record<string, unknown>) => void>();
  child.stdout.on("data", (d: Buffer) => {
    out += d.toString("utf8");
    for (const line of out.split("\n").slice(0, -1)) {
      try {
        const m = JSON.parse(line) as Record<string, unknown>;
        if (typeof m.id === "number") waiters.get(m.id)?.(m);
      } catch {
        // checked below
      }
    }
  });
  let id = 0;
  const request = (method: string, params: object) => new Promise<Record<string, unknown>>((resolve) => {
    const n = ++id;
    waiters.set(n, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
  });
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } });
  assert.equal((init.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  // Regression (review round 1): the instructions showed render and export without project.
  const instructions = (init.result as { instructions: string }).instructions;
  assert.match(instructions, /render \{project, view: "multiview"\}/);
  assert.match(instructions, /export \{project, format: "step"\}/);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const run = await request("tools/call", { name: "run", arguments: { project: "raw.o3j", script: SCRIPT } });
  assert.equal(((run.result as CallResult).structuredContent as { status: string }).status, "ok");
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  const lines = out.split("\n").filter(Boolean);
  for (const l of lines) assert.equal((JSON.parse(l) as { jsonrpc: string }).jsonrpc, "2.0");
}));

// Regression (review round 1): one JSON-RPC line over the SDK's 10 MiB read buffer made the
// transport close itself and pause stdin; the server then answered nothing and never exited.
// It must exit, so the client sees the daemon die and can start a new one.
test("a line over the transport limit makes the server exit instead of hanging", withRoot(async (root) => {
  const child = spawn(process.execPath, [SERVER, root], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.on("error", () => {});
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const huge = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run", arguments: { project: "big.o3j", script: "return box(1, 1, 1);", params: { s: "y".repeat(11 * 1024 * 1024) } } } };
  child.stdin.write(`${JSON.stringify(huge)}\n`);
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000).unref());
  const r = await Promise.race([exited, timeout]);
  if (r === "timeout") child.kill("SIGKILL");
  assert.equal(r, 0, "the server must exit cleanly after its transport fails");
  assert.ok(out.includes('"id":1'), "initialize was answered before the oversized line");
}));
