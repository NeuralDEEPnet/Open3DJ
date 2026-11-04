// Regression tests (review round 2, issue 9): anchor, reference and connector names were read
// from plain objects, so names such as "constructor" found inherited functions instead of
// failing with a clear DSL error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./testing.ts";

const NAMES = ["constructor", "toString", "__proto__", "hasOwnProperty"];

for (const name of NAMES) {
  test(`"${name}" is an unknown anchor, not an inherited property`, async () => {
    const h = await harness();
    for (const code of [
      `return box(10, 10, 10).referencePoint(${JSON.stringify(name)});`,
      `return box(10, 10, 10).placeReference(${JSON.stringify(name)}, [0, 0, 0]);`,
      `const a = box(10, 10, 10);\nreturn box(2, 2, 2).attachTo(a, ${JSON.stringify(name)}, "top");`,
    ]) {
      const r = await h.run(code);
      assert.equal(r.ok, false, code);
      assert.equal(r.error!.code, "DSL_UNKNOWN_ANCHOR", `${code}: ${JSON.stringify(r.error)}`);
    }
  });

  test(`"${name}" is a missing connector in matchTo`, async () => {
    const h = await harness();
    const r = await h.run(`const a = box(10, 10, 10);\nreturn box(2, 2, 2).matchTo(a, ${JSON.stringify(name)}, ${JSON.stringify(name)});`);
    assert.equal(r.ok, false);
    assert.equal(r.error!.code, "DSL_MISSING_CONNECTOR", JSON.stringify(r.error));
  });
}

test("a reference named constructor works when it is declared", async () => {
  const h = await harness();
  const r = await h.run(`const b = box(10, 10, 10).withReferences({ constructor: [1, 2, 3] });\nconsole.log(JSON.stringify(b.referencePoint("constructor")));\nreturn b;`);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.logs[0], [1, 2, 3]);
});

// Regression (review round 2, issue 16): common errors came back without a hint.
test("a bad argument names the entry and points at its docs", async () => {
  const h = await harness();
  const r = await h.run("return box(10, -5, 4);");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "DSL_BAD_ARGUMENT");
  assert.equal(r.error!.line, 1);
  assert.match(r.error!.hint ?? "", /docs \{query: "box"\}/);
});

test("a syntax error comes with a hint", async () => {
  const h = await harness();
  const r = await h.run("const a = box(1, 1, 1;\nreturn a;");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "SCRIPT_SYNTAX");
  assert.ok((r.error!.hint ?? "").length > 0, JSON.stringify(r.error));
});
