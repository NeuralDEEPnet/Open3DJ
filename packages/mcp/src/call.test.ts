// callTool() replaced the inline tool switch in createServer (server.ts at 3c9e8fc). These
// tests keep a verbatim copy of that switch as the reference and check, for every tool and
// for handlers that throw, that callTool gives byte-identical results and that the MCP server
// sends exactly what callTool returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { RenderImage } from "@open3dj/compute";
import { callTool } from "./call.ts";
import { ToolError, toScriptError } from "./errors.ts";
import { createHandlers, noJob } from "./handlers.ts";
import { createServer } from "./server.ts";
import { FAKE_INVENTORY, fakePlace, fakePool } from "./testing.ts";
import type { ToolHandlers } from "./types.ts";

// ---- The reference: server.ts at 3c9e8fc, lines 23-57 and 70-95, copied verbatim. ----
type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; text: string } };
interface CallResult {
  structuredContent: Record<string, unknown>;
  content: Content[];
  isError?: boolean;
  [key: string]: unknown;
}
function toolResult(structured: object, extra: Content[] = []): CallResult {
  const sc = structured as Record<string, unknown>;
  const result: CallResult = { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }, ...extra] };
  if (sc.status === "error" || (sc.status === undefined && sc.error !== undefined)) result.isError = true;
  return result;
}
function imageContent(images: RenderImage[], projectArg: string, rev: string | undefined): Content[] {
  const project = projectArg.split(/[\\/]/).filter((s) => s !== "").pop() ?? "";
  const out: Content[] = [];
  for (const img of images) {
    if (img.format === "png") out.push({ type: "image", data: Buffer.from(img.bytes).toString("base64"), mimeType: "image/png" });
    else out.push({ type: "resource", resource: { uri: `open3dj://${encodeURIComponent(project)}/${rev ?? "head"}/${encodeURIComponent(img.name)}`, mimeType: "image/svg+xml", text: Buffer.from(img.bytes).toString("utf8") } });
  }
  return out;
}
async function before(handlers: ToolHandlers, name: string, args: Record<string, unknown>): Promise<CallResult | undefined> {
  const failed = (e: unknown) => toolResult({ status: "error", error: toScriptError(e), compute: noJob("the handler failed") });
  try {
    switch (name) {
      case "run": return toolResult(await handlers.run(args as never));
      case "inspect": return toolResult(await handlers.inspect(args as never));
      case "export": return toolResult(await handlers.export(args as never));
      case "docs": return toolResult(await handlers.docs(args as never));
      case "render": {
        const r = await handlers.render(args as never);
        return toolResult(r.output, imageContent(r.images, String(args.project ?? ""), r.output.rev));
      }
    }
  } catch (e) {
    return failed(e);
  }
  return undefined;
}
// ---- End of the reference. ----

const SCRIPT = `const plate = box(60, 40, 8);
return [{ name: "plate", shape: plate }, { name: "pin", shape: cylinder(12, 2.8) }];`;

type Tool = "run" | "inspect" | "render" | "export" | "docs";
interface Case {
  label: string;
  tool: Tool;
  args: Record<string, unknown>;
  /** What the handler does: return the value captured from a real handler, or throw. */
  outcome: { value: unknown } | { throws: () => unknown };
}

/**
 * Handlers that replay one outcome for one tool, so the reference, callTool and the MCP
 * server all see exactly the same handler result (real handlers would make a new revision on
 * every call). Every call gets a fresh copy, and the arguments are recorded.
 */
function replay(c: Case, seen: Array<Record<string, unknown>>): ToolHandlers {
  const answer = async (args: unknown): Promise<never> => {
    seen.push(args as Record<string, unknown>);
    if ("throws" in c.outcome) throw c.outcome.throws();
    return structuredClone(c.outcome.value) as never;
  };
  const wrong = async (): Promise<never> => {
    throw new Error(`the ${c.tool} case called another tool`);
  };
  const h: ToolHandlers = { run: wrong, inspect: wrong, render: wrong, export: wrong, docs: wrong, shutdown: () => {} };
  h[c.tool] = answer;
  return h;
}

/** Real outputs from the handlers over the fake pool, then the throwing cases. */
async function cases(root: string): Promise<Case[]> {
  const h = createHandlers({ pool: fakePool(), inventory: FAKE_INVENTORY, place: fakePlace, root, now: () => new Date("2026-10-28T12:00:00Z"), interactiveMs: 5_000 });
  const project = "call.o3j";
  const real: Array<[string, Tool, Record<string, unknown>]> = [
    ["run ok", "run", { project, script: SCRIPT }],
    ["run with a script error", "run", { project, script: "const x = 1;\nthrow new Error('boom');" }],
    ["run with bad input", "run", { project, params: { Width: 70 } }],
    ["run with a stale base_rev", "run", { project, script: `${SCRIPT}//2`, base_rev: "r_0009" }],
    ["inspect devices", "inspect", { fields: ["devices"] }],
    ["inspect tree and fits", "inspect", { project, fields: ["tree", "fits"] }],
    ["inspect with a bad field", "inspect", { project, fields: ["nonsense"] }],
    ["render png", "render", { project, view: "multiview" }],
    ["render svg with an absolute project path", "render", { project: join(root, project), view: "multiview", format: "svg" }],
    ["render both formats", "render", { project, view: "multiview", format: "both" }],
    ["render highlight", "render", { project, view: "highlight", targets: ["plate"] }],
    ["export step", "export", { project, format: "step" }],
    ["export of an unknown project", "export", { project: "missing.o3j", format: "stl" }],
    ["docs fillet", "docs", { query: "fillet" }],
    ["docs with an empty query", "docs", { query: "" }],
  ];
  const out: Case[] = [];
  for (const [label, tool, args] of real) {
    const value = tool === "render" ? await h.render(args as never) : await (h[tool] as (a: unknown) => Promise<unknown>)(args);
    out.push({ label, tool, args, outcome: { value } });
  }
  h.shutdown();
  out.push(
    { label: "a handler that throws a ToolError", tool: "run", args: { project, script: SCRIPT }, outcome: { throws: () => new ToolError("PROJECT_BUSY", "call.o3j is busy", "Wait and run again.") } },
    { label: "a handler that throws an Error with a home path", tool: "inspect", args: { project, fields: ["tree"] }, outcome: { throws: () => new Error("open '/home/Jane Doe/designs/call.o3j/main.o3j.js' failed") } },
    { label: "a handler that throws a file system error", tool: "export", args: { project, format: "step" }, outcome: { throws: () => Object.assign(new Error("ENOENT: no such file, open '/Users/jane/x.o3j'"), { code: "ENOENT", syscall: "open", path: "/Users/jane/x.o3j" }) } },
    { label: "a render handler that throws", tool: "render", args: { project, view: "multiview" }, outcome: { throws: () => new Error("boom") } },
    { label: "a handler that throws a string", tool: "docs", args: { query: "fillet" }, outcome: { throws: () => "plain string" } },
  );
  return out;
}

function withRoot(fn: (root: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "o3j-call-"));
    try {
      await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}

test("callTool gives byte-identical results to the switch it replaced, for every tool", withRoot(async (root) => {
  const all = await cases(root);
  assert.equal(new Set(all.map((c) => c.tool)).size, 5, "every tool has a case");
  for (const c of all) {
    const seenBefore: Array<Record<string, unknown>> = [];
    const seenAfter: Array<Record<string, unknown>> = [];
    const old = await before(replay(c, seenBefore), c.tool, c.args);
    const now = await callTool(replay(c, seenAfter), c.tool, c.args);
    assert.ok(old !== undefined, c.label);
    assert.equal(JSON.stringify(now), JSON.stringify(old), c.label);
    assert.deepEqual(seenAfter, seenBefore, `${c.label}: the handler gets the same arguments`);
    assert.deepEqual(seenAfter, [c.args], `${c.label}: the arguments pass through unchanged`);
  }
}));

test("the MCP server sends exactly what callTool returns", withRoot(async (root) => {
  for (const c of await cases(root)) {
    const expected = await callTool(replay(c, []), c.tool, c.args);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer(replay(c, []));
    await server.connect(serverSide);
    const client = new Client({ name: "call-test", version: "0" });
    await client.connect(clientSide);
    try {
      const got = (await client.callTool({ name: c.tool, arguments: c.args })) as Record<string, unknown>;
      const sent: Record<string, unknown> = { structuredContent: got.structuredContent, content: got.content };
      if (got.isError !== undefined && got.isError !== false) sent.isError = got.isError;
      assert.deepEqual(sent, JSON.parse(JSON.stringify(expected)), c.label);
    } finally {
      await client.close();
      await server.close();
    }
  }
}));

test("an unknown tool name is a BAD_INPUT result, never a throw", async () => {
  const h = replay({ label: "none", tool: "docs", args: {}, outcome: { value: {} } }, []);
  const r = await callTool(h, "delete_everything\n<b>", {});
  assert.equal(r.isError, true);
  const err = r.structuredContent.error as { code: string; message: string; hint: string };
  assert.equal(err.code, "BAD_INPUT");
  assert.equal(err.message, "there is no tool called 'delete_everything__b_'");
  assert.match(err.hint, /run, inspect, render, export, docs/);
  assert.equal(r.structuredContent.status, "error");
  assert.deepEqual(JSON.parse((r.content[0] as { text: string }).text), r.structuredContent);
  const long = await callTool(h, "x".repeat(500), {});
  assert.ok((long.structuredContent.error as { message: string }).message.length < 100, "a long name is cut");
});
