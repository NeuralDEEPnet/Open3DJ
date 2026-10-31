// Atomic writes on Windows: replacing a file that another process is reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renameWithRetry } from "./paths.ts";

const busy = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

// Regression (first Windows ARM CI run): "two processes running one project never claim the
// same revision" failed with EPERM (rename) on '.project.o3j.json.<hex>.tmp'. Windows refuses
// to replace a file while another process has it open, if only for the moment of a read.
test("a rename that Windows refuses while the target is open is tried again", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    let calls = 0;
    const slept: number[] = [];
    renameWithRetry("a.tmp", "a", {
      platform: "win32",
      rename: () => {
        if (++calls < 3) throw busy(code);
      },
      sleep: (ms) => slept.push(ms),
    });
    assert.equal(calls, 3, code);
    assert.deepEqual(slept, [1, 2], code);
  }
});

test("a rename is not retried for other errors, or on other systems", () => {
  let calls = 0;
  const fail = (code: string) => () => {
    calls++;
    throw busy(code);
  };
  assert.throws(() => renameWithRetry("a.tmp", "a", { platform: "win32", rename: fail("ENOENT"), sleep: () => {} }), /ENOENT/);
  assert.equal(calls, 1);
  calls = 0;
  assert.throws(() => renameWithRetry("a.tmp", "a", { platform: "linux", rename: fail("EPERM"), sleep: () => {} }), /EPERM/);
  assert.equal(calls, 1, "on Linux and macOS EPERM is a real permission error");
});

test("a rename that stays refused gives up after the retry time", () => {
  let calls = 0;
  let waited = 0;
  assert.throws(
    () =>
      renameWithRetry("a.tmp", "a", {
        platform: "win32",
        retryMs: 500,
        rename: () => {
          calls++;
          throw busy("EPERM");
        },
        sleep: (ms) => (waited += ms),
      }),
    /EPERM/,
  );
  assert.ok(waited >= 500 && waited < 700, `waited ${waited} ms`);
  assert.ok(calls > 5 && calls < 20, `${calls} tries`);
});
