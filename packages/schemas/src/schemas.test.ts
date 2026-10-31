import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SCHEMA_IDS, SchemaRegistry, assertValid, dereferencedSchema, getSchema, registry, validate } from "./index.ts";
import { INVALID, VALID } from "./fixtures.ts";

const JSON_DIR = fileURLToPath(new URL("../json/", import.meta.url));

test("every schema file is registered under its short name", () => {
  const files = readdirSync(JSON_DIR).filter((f) => f.endsWith(".schema.json")).sort();
  const names = files.map((f) => f.replace(/\.schema\.json$/, "")).sort();
  assert.deepEqual(names, Object.keys(SCHEMA_IDS).sort());
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(JSON_DIR, f), "utf8"));
    assert.equal(s.$schema, "https://json-schema.org/draft/2020-12/schema", f);
    assert.equal(s.$id, (SCHEMA_IDS as Record<string, string>)[f.replace(/\.schema\.json$/, "")], f);
  }
  assert.equal(registry.ids().length, files.length);
});

test("valid fixtures pass", () => {
  for (const [name, value] of VALID) {
    const r = validate(name, value);
    assert.ok(r.valid, `${name}: ${JSON.stringify(r.errors)}`);
  }
});

test("invalid fixtures fail at the expected path", () => {
  for (const [name, value, path, why] of INVALID) {
    const r = validate(name, value);
    assert.equal(r.valid, false, `${name} should reject: ${why}`);
    assert.ok(r.errors.some((e) => e.path === path), `${name} (${why}): expected an error at "${path}", got ${JSON.stringify(r.errors)}`);
  }
});

test("validate accepts a full $id and assertValid throws a readable error", () => {
  assert.equal(validate("urn:open3dj:v0:compute", { backend: "cpu.wasm", device: "cpu", placement_reason: "x" }).valid, true);
  assert.throws(() => assertValid("compute", {}), /placement_reason/);
  assert.equal(getSchema("compute").$id, "urn:open3dj:v0:compute");
  assert.throws(() => validate("nope", {}), /unknown schema/);
});

test("the registry refuses keywords it would ignore and broken refs", () => {
  const r = new SchemaRegistry();
  assert.throws(
    () => r.add({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:t:a", type: "string", format2: "x" }),
    /unsupported keyword "format2"/,
  );
  assert.throws(
    () => r.add({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:t:b", if: { type: "string" } }),
    /unsupported keyword "if"/,
  );
  r.add({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:t:c", $ref: "urn:t:missing#/$defs/x" });
  assert.throws(() => r.checkRefs(), /unresolved \$ref/);
});

test("oneOf, anyOf, const and integer behave per draft 2020-12", () => {
  const r = new SchemaRegistry();
  r.add({
    $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:t:k",
    type: "object",
    properties: {
      n: { type: "integer" },
      c: { const: "x" },
      o: { oneOf: [{ type: "number" }, { type: "integer" }] },
      a: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  });
  assert.equal(r.validate("urn:t:k", { n: 2 }).valid, true);
  assert.equal(r.validate("urn:t:k", { n: 2.5 }).valid, false);
  assert.equal(r.validate("urn:t:k", { c: "y" }).valid, false);
  assert.equal(r.validate("urn:t:k", { o: 1.5 }).valid, true);
  assert.equal(r.validate("urn:t:k", { o: 1 }).valid, false, "1 matches both oneOf branches");
  assert.equal(r.validate("urn:t:k", { a: null }).valid, true);
  assert.equal(r.validate("urn:t:k", { a: 3 }).valid, false);
});

test("dereferenced schemas are self-contained and judge fixtures the same way", () => {
  for (const name of Object.keys(SCHEMA_IDS)) {
    const d = dereferencedSchema(name);
    assert.ok(!JSON.stringify(d).includes("$ref"), `${name} still has a $ref`);
    const solo = new SchemaRegistry();
    solo.add(d);
    solo.checkRefs();
    for (const [n, value] of VALID.filter(([n]) => n === name)) assert.ok(solo.validate(d.$id as string, value).valid, `${n} valid fixture`);
    for (const [n, value, , why] of INVALID.filter(([n]) => n === name)) assert.equal(solo.validate(d.$id as string, value).valid, false, `${n}: ${why}`);
  }
});
