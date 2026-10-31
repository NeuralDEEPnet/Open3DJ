import { test } from "node:test";
import assert from "node:assert/strict";
import { NotImplementedError } from "@open3dj/schemas";
import { PACKAGE_STATUS, createDsl } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "dsl is a stub" : false;

test("exports createDsl", () => {
  assert.equal(typeof createDsl, "function");
  if (PACKAGE_STATUS === "stub") assert.throws(() => createDsl({} as never), NotImplementedError);
});

test("a box script returns one part with the box volume", { skip: stub }, async () => {
  const { initKernel } = await import("@open3dj/kernel");
  const { runScript } = await import("@open3dj/sandbox");
  const kernel = await initKernel();
  const dsl = createDsl(kernel);
  dsl.reset();
  const r = await runScript("return box(10, 20, 30);", { hostApi: dsl.hostApi });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const out = dsl.collect(r.value);
  assert.equal(out.parts.length, 1);
  assert.ok(Math.abs(kernel.volume(out.parts[0]!.shape) - 6000) < 1e-6);
});

test("dispose() releases the brepjs registration: the DSL refuses later runs, a new DSL draws sketches", { skip: stub }, async () => {
  const { initKernel } = await import("@open3dj/kernel");
  const { runScript } = await import("@open3dj/sandbox");
  const kernel = await initKernel();
  const sketch = "return polygon([[0, 0], [10, 0], [10, 5], [0, 5]]).extrude(2);";
  const first = createDsl(kernel);
  first.reset();
  assert.equal((await runScript(sketch, { hostApi: first.hostApi })).ok, true);
  first.dispose();
  assert.throws(() => first.reset(), /disposed/);
  const second = createDsl(kernel);
  second.reset();
  const r = await runScript(sketch, { hostApi: second.hostApi });
  assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.error));
  if (!r.ok) return;
  assert.ok(Math.abs(kernel.volume(second.collect(r.value).parts[0]!.shape) - 100) < 1e-6);
});
