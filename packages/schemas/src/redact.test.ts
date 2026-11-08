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

// Regression test (agent review, home folders): the last segment of a bare home folder is the
// user name, so keeping the last segment sent "/home/jane/" on as "…/jane/".
test("a bare home folder becomes ~, never its last segment", () => {
  const keep = (last: string) => `…/${last}`;
  const cases: Array<[string, string]> = [
    ["cannot create /home/jane/ (read-only file system)", "cannot create ~/ (read-only file system)"],
    ["cwd is /home/jane", "cwd is ~"],
    ["mkdir 'C:\\Users\\Jane Doe\\' failed", "mkdir '~' failed"],
    ["missing C:\\Users\\Jane Doe\\ now", "missing ~\\ now"],
    ["open 'c:\\users\\jane'", "open '~'"],
    ["in C:/USERS/JANE/", "in ~/"],
    ["at file:///home/jane/", "at ~/"],
    // Paths below the home folder keep their last segment, as before.
    ["see /home/jane/designs/ and /Users/jane/a.step", "see …/designs/ and …/a.step"],
  ];
  for (const [input, want] of cases) assert.equal(redactPaths(input, keep), want, JSON.stringify(input));
  assert.equal(redactPaths("cwd is /home/jane"), "cwd is ~", "the default replacement too");
  // A Windows home folder seen from WSL keeps the user name as its last segment too (review).
  assert.equal(redactPaths("EACCES: permission denied, mkdir '/mnt/c/Users/jane'", keep), "EACCES: permission denied, mkdir '~'");
  assert.equal(redactPaths("cannot create /mnt/c/Users/jane/ (read-only file system)", keep), "cannot create ~/ (read-only file system)");
  assert.equal(redactPaths("a/home/jane and x.home/jane stay"), "a/home/jane and x.home/jane stay");
});
