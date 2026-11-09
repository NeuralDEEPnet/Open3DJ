// The Messages API tool entries and the pinned project. Offline: no request is made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_DEFINITIONS, callTool, createHandlers } from "@open3dj/mcp";
import { validate } from "@open3dj/schemas";
import type { ToolName } from "@open3dj/schemas";
// The fake compute pool is test data of @open3dj/mcp, not part of its public exports.
import { FAKE_INVENTORY, fakePlace, fakePool } from "../../mcp/src/testing.ts";
import { API_TOOL_ORDER, PINNED_TOOLS, apiTools, withProject } from "./api-tools.ts";

test("five tool entries in a fixed order, with only name, description and input_schema", () => {
  const tools = apiTools();
  assert.deepEqual(tools.map((t) => t.name), ["run", "inspect", "render", "export", "docs"]);
  assert.deepEqual([...API_TOOL_ORDER], ["run", "inspect", "render", "export", "docs"]);
  for (const t of tools) {
    assert.deepEqual(Object.keys(t), ["name", "description", "input_schema"]);
    // The Messages API tool name rule (platform.claude.com, "Define tools", checked 2026-11-08).
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.ok(t.description.startsWith(TOOL_DEFINITIONS[t.name].description), `${t.name}: the MCP description comes first`);
    const s = t.input_schema;
    assert.equal(s.type, "object", `${t.name}: an object schema`);
    for (const k of ["$schema", "$id", "title", "anyOf", "oneOf", "allOf"]) assert.equal(k in s, false, `${t.name}: ${k} is removed`);
    assert.ok(!JSON.stringify(s).includes("$ref"), `${t.name}: self-contained`);
  }
});

test("project is removed from run, inspect, render and export, and nothing else changes", () => {
  for (const t of apiTools()) {
    const full = TOOL_DEFINITIONS[t.name].inputSchema as Record<string, unknown>;
    const props = t.input_schema.properties as Record<string, unknown>;
    const fullProps = full.properties as Record<string, unknown>;
    if (PINNED_TOOLS.includes(t.name)) {
      assert.equal("project" in props, false, `${t.name}: no project property`);
      assert.ok(!((t.input_schema.required as string[] | undefined) ?? []).includes("project"), `${t.name}: project is not required`);
    }
    const expectedProps = Object.keys(fullProps).filter((k) => !(PINNED_TOOLS.includes(t.name) && k === "project"));
    assert.deepEqual(Object.keys(props), expectedProps, `${t.name}: the other properties stay, in order`);
    for (const k of expectedProps) assert.deepEqual(props[k], fullProps[k], `${t.name}.${k} is unchanged`);
    assert.equal(t.input_schema.additionalProperties, full.additionalProperties);
  }
  const byName = Object.fromEntries(apiTools().map((t) => [t.name, t.input_schema]));
  assert.equal("required" in byName.run!, false, "run required only project");
  assert.deepEqual(byName.inspect!.required, ["fields"]);
  assert.deepEqual(byName.render!.required, ["view"]);
  assert.deepEqual(byName.export!.required, ["format"]);
  assert.deepEqual(byName.docs!.required, ["query"]);
  assert.ok("query" in (byName.docs!.properties as object));
});

test("run's anyOf becomes one sentence of its description", () => {
  const run = apiTools()[0]!;
  assert.equal(run.description, `${TOOL_DEFINITIONS.run.description} Pass script or ops: at least one is required.`);
  for (const t of apiTools().slice(1)) assert.equal(t.description, TOOL_DEFINITIONS[t.name].description, `${t.name}: had no top-level combinator`);
});

test("a top-level combinator that cannot be described stops apiTools instead of being dropped", () => {
  // TOOL_DEFINITIONS is frozen only at the top; the schema object is changed and restored here.
  const docs = TOOL_DEFINITIONS.docs.inputSchema as Record<string, unknown>;
  for (const [key, value] of [["oneOf", [{ required: ["query"] }, { required: ["page"] }]], ["anyOf", [{ required: ["query"], properties: {} }, { required: ["page"] }]], ["allOf", [{ required: ["query"] }]]] as const) {
    docs[key] = value;
    try {
      assert.throws(() => apiTools(), new RegExp(`docs input schema has a top-level ${key}`));
    } finally {
      delete docs[key];
    }
  }
  assert.equal(apiTools()[4]!.description, TOOL_DEFINITIONS.docs.description);
});

test("the entries are byte-stable across calls and never share objects with TOOL_DEFINITIONS", () => {
  const defsBefore = JSON.stringify(TOOL_DEFINITIONS);
  const a = apiTools();
  const first = JSON.stringify(a);
  (a[0]!.input_schema.properties as Record<string, unknown>).script = "changed";
  (a[1]!.input_schema.required as string[]).push("extra");
  a[4]!.description = "changed";
  assert.equal(JSON.stringify(apiTools()), first, "a change to one result does not reach the next");
  assert.equal(JSON.stringify(apiTools()), JSON.stringify(apiTools()));
  assert.equal(JSON.stringify(TOOL_DEFINITIONS), defsBefore, "TOOL_DEFINITIONS is never changed");
});

const PINNED = "/home/someone/designs/bracket.o3j";

test("withProject fills in the pinned project, first, and keeps the other fields", () => {
  for (const name of PINNED_TOOLS) {
    const r = withProject(name, { a: 1, b: [2] }, PINNED);
    assert.ok(r.ok);
    assert.deepEqual(r.input, { project: PINNED, a: 1, b: [2] });
    assert.deepEqual(Object.keys(r.input), ["project", "a", "b"]);
  }
  // The pinned path, or just the folder name that results show, is accepted and replaced.
  for (const sent of [PINNED, "bracket.o3j"]) {
    const r = withProject("render", { project: sent, view: "multiview" }, PINNED);
    assert.ok(r.ok, sent);
    assert.deepEqual(r.input, { project: PINNED, view: "multiview" });
  }
  const input = { query: "fillet" };
  const docs = withProject("docs", input, PINNED);
  assert.ok(docs.ok);
  assert.deepEqual(docs.input, { query: "fillet" }, "docs has no project");
  assert.notEqual(docs.input, input, "a copy, never the model's object");
  const unknown = withProject("delete_all", { x: 1 }, PINNED);
  assert.ok(unknown.ok, "callTool refuses unknown names; withProject passes them on");
  assert.deepEqual(unknown.input, { x: 1 });
});

test("withProject refuses another project with a PATH_REFUSED result that names only the folder", () => {
  const others: unknown[] = ["other.o3j", "../bracket.o3j", "/elsewhere/bracket.o3j", "C:\\Users\\x\\bracket.o3j", "", 7, null, { p: 1 }, ["bracket.o3j"]];
  for (const name of PINNED_TOOLS) {
    for (const sent of others) {
      const r = withProject(name, { project: sent, fields: ["tree"] }, PINNED);
      assert.equal(r.ok, false, `${name} with ${JSON.stringify(sent)}`);
      if (r.ok) continue;
      assert.equal(r.result.isError, true);
      const sc = r.result.structuredContent;
      const err = sc.error as { code: string; message: string; hint: string };
      assert.equal(err.code, "PATH_REFUSED");
      assert.match(err.message, /bracket\.o3j only/);
      assert.match(err.hint, /Leave project out/);
      assert.ok(!JSON.stringify(r.result).includes("/home/someone"), "the pinned path never reaches the model");
      assert.ok(validate(`tool-${name}-output`, sc).valid, `${name}: the refusal is a valid ${name} result`);
      assert.deepEqual(JSON.parse((r.result.content[0] as { text: string }).text), sc);
    }
  }
});

test("withProject refuses an input that is not an object", () => {
  for (const input of [null, "run", 3, ["a"], undefined]) {
    const r = withProject("run", input, PINNED);
    assert.equal(r.ok, false, JSON.stringify(input));
    if (!r.ok) assert.equal((r.result.structuredContent.error as { code: string }).code, "BAD_INPUT");
  }
});

test("a pinned call runs through callTool on the fake pool, and a refused one never reaches it", async () => {
  const root = mkdtempSync(join(tmpdir(), "o3j-agent-"));
  try {
    const pool = fakePool();
    const h = createHandlers({ pool, inventory: FAKE_INVENTORY, place: fakePlace, root, interactiveMs: 5_000 });
    const project = join(root, "plate.o3j");
    const call = async (name: ToolName, input: Record<string, unknown>) => {
      const p = withProject(name, input, project);
      return p.ok ? callTool(h, name, p.input) : p.result;
    };
    const run = await call("run", { script: "return box(10, 10, 2);" });
    assert.equal(run.structuredContent.status, "ok", JSON.stringify(run.structuredContent));
    assert.equal(run.structuredContent.rev, "r_0001");
    const png = await call("render", { view: "multiview" });
    assert.equal(png.content.find((c) => c.type === "image")?.type, "image");
    const refused = await call("export", { project: "other.o3j", format: "step" });
    assert.equal(refused.isError, true);
    assert.equal(pool.calls.filter((j) => j.kind === "export").length, 0, "no export job ran");
    h.shutdown();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
