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
