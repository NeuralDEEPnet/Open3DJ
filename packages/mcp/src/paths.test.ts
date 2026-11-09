// Atomic writes on Windows: replacing a file that another process is reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockProject, renameWithRetry, resolveProject } from "./paths.ts";

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

// Regression (PR #44, Windows x64 CI, 2026-11-09): "two processes running one project never
// claim the same revision" failed with "PROJECT_PATH: EPERM: operation not permitted (open) on
// '.o3j-lock'". Windows refuses to create a file while the old one with that name is still being
// deleted, or is open for a moment in another process (a virus scanner, a stat). The lock then
// treated a busy lock as a broken project.
const withRoot = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), "o3j-lock-"));
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("a lock file that Windows refuses for a moment is waited for, not reported as an error", async () => {
  await withRoot(async (root) => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      let creates = 0;
      let removes = 0;
      const release = await lockProject(resolveProject(root, "c.o3j"), 2_000, {
        platform: "win32",
        create: () => {
          if (++creates < 3) throw busy(code);
        },
        remove: () => {
          if (++removes < 2) throw busy(code);
        },
        sleep: () => {},
      });
      assert.equal(creates, 3, code);
      release();
      assert.equal(removes, 2, `${code}: the release is tried again too`);
    }
  });
});

test("on other systems a refused lock file is a real error at once", async () => {
  await withRoot(async (root) => {
    let creates = 0;
    const create = () => {
      creates++;
      throw busy("EPERM");
    };
    await assert.rejects(lockProject(resolveProject(root, "c.o3j"), 2_000, { platform: "linux", create }), /EPERM/);
    assert.equal(creates, 1, "on Linux and macOS EPERM is a real permission error");
    const release = await lockProject(resolveProject(root, "c.o3j"), 2_000, { platform: "linux", create: () => {}, remove: () => { throw busy("EPERM"); } });
    assert.throws(release, /EPERM/);
  });
});

test("a lock file that Windows refuses for the whole wait gives the real error, not a busy project", async () => {
  await withRoot(async (root) => {
    let creates = 0;
    const create = () => {
      creates++;
      throw busy("EPERM");
    };
    await assert.rejects(lockProject(resolveProject(root, "c.o3j"), 150, { platform: "win32", create }), /EPERM/);
    assert.ok(creates > 2, `${creates} tries`);
  });
});
