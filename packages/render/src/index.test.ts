import { test } from "node:test";
import assert from "node:assert/strict";
import { NotImplementedError } from "@open3dj/schemas";
import { PACKAGE_STATUS, renderAssembly } from "./index.ts";

const stub = PACKAGE_STATUS === "stub" ? "render is a stub" : false;

test("exports renderAssembly", async () => {
  assert.equal(typeof renderAssembly, "function");
  if (PACKAGE_STATUS === "stub") await assert.rejects(renderAssembly({} as never, {} as never, { view: "multiview" }), NotImplementedError);
});

test("renders the same PNG bytes twice", { skip: stub }, async () => {
  assert.fail("write with the implementation: build a one-part assembly, render twice, compare bytes");
});
