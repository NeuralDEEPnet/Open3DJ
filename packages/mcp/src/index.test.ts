import { test } from "node:test";
import assert from "node:assert/strict";
import { NotImplementedError } from "@open3dj/schemas";
import { PACKAGE_STATUS, TOOL_DEFINITIONS, TOOL_NAMES, createHandlers, serveStdio } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "mcp is a stub" : false;

test("five tools with self-contained object schemas", () => {
  assert.deepEqual(Object.keys(TOOL_DEFINITIONS).sort(), [...TOOL_NAMES].sort());
  for (const name of TOOL_NAMES) {
    const t = TOOL_DEFINITIONS[name];
    assert.equal(t.name, name);
    assert.equal(t.inputSchema.type, "object", `${name} input must be an object schema`);
    assert.equal(t.outputSchema.type, "object", `${name} output must be an object schema`);
    assert.ok(!JSON.stringify(t.inputSchema).includes("$ref"));
    assert.ok(!JSON.stringify(t.outputSchema).includes("$ref"));
    assert.ok(t.description.length > 40);
  }
});

test("stub entry points are typed and throw NotImplemented", async () => {
  if (PACKAGE_STATUS !== "stub") return;
  assert.throws(() => createHandlers({} as never), NotImplementedError);
  await assert.rejects(serveStdio({} as never), NotImplementedError);
});

test("tools/list over stdio matches TOOL_DEFINITIONS", { skip: stub }, async () => {
  assert.fail("write with the implementation: spawn the server, list tools with the v2 and v1 clients, compare names and schemas");
});
