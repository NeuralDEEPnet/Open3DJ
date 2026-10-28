// Regression tests (review round 2, issue 8): the path redactors stopped at whitespace, so a
// path such as 'C:\Users\John Smith\...' reached agents with most of it intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPaths } from "./redact.ts";

const leaks = (s: string) => /John|Smith|Jane|Doe|Designs|Users|tmp/.test(s);

test("unquoted paths with spaces are redacted whole", () => {
  for (const p of ["C:\\Users\\John Smith\\Documents\\Open3DJ\\a.o3j\\main.o3j.js", "/Users/Jane Doe/My Designs/a.o3j/main.o3j.js", "file:///Users/Jane Doe/x/y.ts:1:2"]) {
    const out = redactPaths(`failed at ${p} today`);
    assert.ok(!leaks(out), out);
    assert.match(out, /^failed at /);
    assert.match(out, / today$/);
  }
});

test("quoted paths in fs messages are redacted up to the closing quote", () => {
  const out = redactPaths("ENOTDIR: not a directory, mkdir '/tmp/x/Jane Doe/My Designs/file.txt/x.o3j'");
  assert.ok(!leaks(out), out);
  assert.match(out, /^ENOTDIR: not a directory, mkdir /);
  const two = redactPaths("EXDEV: cross-device link not permitted, rename 'C:\\Users\\John Smith\\a' -> 'C:\\Users\\John Smith\\b'");
  assert.ok(!leaks(two), two);
});

test("a custom replacement keeps the last segment", () => {
  assert.equal(redactPaths("open '/Users/Jane Doe/a.o3j/main.o3j.js'", (last) => `…/${last}`), "open '…/main.o3j.js'");
  assert.equal(redactPaths("at file:///a/b/c.ts:1:2"), "at <path>:1:2");
  assert.equal(redactPaths("a ratio 1/2 and a/b stay"), "a ratio 1/2 and a/b stay");
});
