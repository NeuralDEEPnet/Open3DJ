import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACKAGE_STATUS, TOOL_DEFINITIONS, TOOL_NAMES, toolList } from "./index.ts";

test("five tools with self-contained object schemas", () => {
  assert.equal(PACKAGE_STATUS, "ready");
  assert.deepEqual(Object.keys(TOOL_DEFINITIONS).sort(), [...TOOL_NAMES].sort());
  for (const name of TOOL_NAMES) {
    const t = TOOL_DEFINITIONS[name];
    assert.equal(t.name, name);
    assert.equal(t.inputSchema.type, "object", `${name} input must be an object schema`);
    assert.equal(t.outputSchema.type, "object", `${name} output must be an object schema`);
    assert.ok(!JSON.stringify(t.inputSchema).includes("$ref"));
    assert.ok(!JSON.stringify(t.outputSchema).includes("$ref"));
    assert.ok(t.description.length > 40);
    assert.equal(t.annotations.openWorldHint, false);
  }
  assert.deepEqual(toolList().map((t) => t.name), [...TOOL_NAMES]);
  assert.equal(TOOL_DEFINITIONS.inspect.annotations.readOnlyHint, true);
  assert.equal(TOOL_DEFINITIONS.run.annotations.readOnlyHint, false);
});

// Regression (review round 1): tools/list was about 47 KB, most of it dereferenced output
// schemas, and every agent loads it into its context. Output schemas are published slim now
// (top-level shape); the full schemas in @open3dj/schemas still validate every result in tests.
test("tools/list stays small, and the slim output schemas accept every valid result", async () => {
  const size = JSON.stringify(toolList()).length;
  assert.ok(size <= 12_000, `tools/list is ${size} characters`);
  // The schema fixtures are test data of @open3dj/schemas, not part of its public exports.
  const { VALID } = await import("../../schemas/src/fixtures.ts");
  const { SchemaRegistry } = await import("@open3dj/schemas");
  for (const name of TOOL_NAMES) {
    const reg = new SchemaRegistry();
    reg.add({ $schema: "https://json-schema.org/draft/2020-12/schema", ...TOOL_DEFINITIONS[name].outputSchema, $id: `urn:test:${name}` });
    for (const [schema, value] of VALID) {
      if (schema === `tool-${name}-output`) assert.ok(reg.validate(`urn:test:${name}`, value).valid, `${name}: a valid output fails the published schema`);
    }
  }
});

test("guardStdout sends every console method to stderr", () => {
  const index = fileURLToPath(new URL("./index.ts", import.meta.url));
  const code = `const { guardStdout } = await import(${JSON.stringify(index)}); guardStdout();
console.log("log"); console.info("info"); console.debug("debug"); console.dir({ a: 1 }); console.table([1]); console.warn("warn");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  for (const word of ["log", "info", "debug", "a: 1", "warn"]) assert.match(r.stderr, new RegExp(word));
});
