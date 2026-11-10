// On Windows a folder tree cannot be deleted while any process, worker or virus scanner
// still holds a file in it open. A child process or a kernel worker that has just exited can
// keep its handles for a moment longer, so a recursive delete right after it fails with
// EPERM or EBUSY, and the test or CI script fails although nothing is wrong (seen on the
// Windows arm64 runner, scripts/install/install.test.ts, pull request #53).
// Node retries such a delete only when it is given maxRetries, so this checks that every
// recursive rmSync or rm in the tests and in the scripts that CI runs passes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findFiles, rel, ROOT } from "./lib.ts";

/** Line numbers of every recursive rmSync( or rm( call in the source that has no maxRetries. */
function unretriedDeletes(source: string): number[] {
  const found: number[] = [];
  const call = /\b(?:rmSync|rm)\(/g;
  for (let m = call.exec(source); m !== null; m = call.exec(source)) {
    let depth = 1;
    let end = m.index + m[0].length;
    while (end < source.length && depth > 0) {
      const c = source[end];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      end++;
    }
    const args = source.slice(m.index, end);
    if (/recursive:\s*true/.test(args) && !/maxRetries:/.test(args)) {
      found.push(source.slice(0, m.index).split("\n").length);
    }
  }
  return found;
}

test("unretriedDeletes finds a recursive delete without maxRetries, on one line or several", () => {
  const src = [
    'rmSync(dir, { recursive: true, force: true });',
    'rmSync(join(dir, "a"));',
    'rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });',
    'await rm(root, { recursive: true, force: true });',
    "rmSync(",
    "  join(base, name),",
    "  { recursive: true },",
    ");",
    "farmSync(dir, { recursive: true });",
  ].join("\n");
  assert.deepEqual(unretriedDeletes(src), [1, 4, 5]);
});

test("every recursive delete in the tests and the CI scripts retries a busy file", () => {
  const files = [
    ...findFiles(join(ROOT, "packages"), (n) => n.endsWith(".test.ts")),
    ...findFiles(join(ROOT, "scripts"), (n) => n.endsWith(".ts")),
    ...findFiles(join(ROOT, "bench"), (n) => n.endsWith(".ts")),
  ];
  assert.ok(files.length > 50, `found only ${files.length} files: is the walk broken?`);
  const self = rel(join(ROOT, "scripts", "cleanup.test.ts"));
  const bad = files
    .filter((f) => rel(f) !== self)
    .flatMap((f) => unretriedDeletes(readFileSync(f, "utf8")).map((line) => `${rel(f)}:${line}`));
  assert.deepEqual(
    bad,
    [],
    "add maxRetries and retryDelay (for example { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) so a Windows file that is still busy is retried",
  );
});
