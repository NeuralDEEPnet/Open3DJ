import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NotImplementedError } from "@open3dj/schemas";
import { DEFAULT_POOL_OPTIONS, PACKAGE_STATUS, WORKER_ENTRY, createPool, deviceInventory, place } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "compute is a stub" : false;

test("exports the compute entry points and a worker entry that exists", () => {
  for (const f of [createPool, deviceInventory, place]) assert.equal(typeof f, "function");
  assert.ok(existsSync(fileURLToPath(WORKER_ENTRY)));
  assert.equal(DEFAULT_POOL_OPTIONS.recycleBytes, 1.5 * 1024 ** 3);
  if (PACKAGE_STATUS === "stub") assert.throws(() => createPool(), NotImplementedError);
});

test("device inventory validates against the schema", { skip: stub }, async () => {
  const { validate } = await import("@open3dj/schemas");
  const r = validate("device-inventory", deviceInventory());
  assert.ok(r.valid, JSON.stringify(r.errors));
});

test("gpu placement without a gpu backend is a structured error", { skip: stub }, () => {
  assert.throws(() => place("gpu", "run", deviceInventory()), (e: unknown) => (e as { code?: string }).code === "NO_BACKEND");
});
