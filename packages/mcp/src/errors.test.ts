// Regression tests (review round 2, issue 8): fs error messages carried absolute paths with
// spaces through to agents as INTERNAL_ERROR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactPaths, toScriptError } from "./errors.ts";

test("an fs error names only the last path segment and its code", async () => {
  const root = await mkdtemp(join(tmpdir(), "open3dj-errors-"));
  try {
    const dir = join(root, "Jane Doe", "My Designs");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "file.txt"), "x");
    const e = await mkdir(join(dir, "file.txt", "x.o3j")).then(() => undefined, (err: unknown) => err);
    const out = toScriptError(e);
    assert.equal(out.code, "PROJECT_PATH");
    assert.doesNotMatch(JSON.stringify(out), /Jane|Doe|Designs|open3dj-errors/);
    // Creating a folder under a file is ENOTDIR on Linux and macOS, and ENOENT on Windows.
    assert.match(out.message, process.platform === "win32" ? /ENOENT/ : /ENOTDIR/);
    assert.match(out.message, /x\.o3j/);
    assert.ok(out.hint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redactPaths keeps the last segment of paths with spaces", () => {
  assert.equal(redactPaths("C:\\Users\\John Smith\\Documents\\Open3DJ\\a.o3j\\main.o3j.js failed"), "…/main.o3j.js failed");
  assert.equal(redactPaths("mkdir '/Users/Jane Doe/My Designs/x.o3j'"), "mkdir '…/x.o3j'");
});
