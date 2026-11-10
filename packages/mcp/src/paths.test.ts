// Atomic writes on Windows: replacing a file that another process is reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir, ensureProjectRoot, lockProject, renameWithRetry, resolveProject } from "./paths.ts";

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
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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

// Regression (PR #49, macOS CI, 2026-11-09): "two processes running one project never claim the
// same revision" failed with "PROJECT_PATH: EEXIST: something already exists at the path (mkdir)
// on 'c.o3j'". The folder check and the mkdir are two steps, so when two processes create the
// same project at the same moment, the slower one's mkdir fails. A folder made in between is
// fine; a symlink or a file made in between is still refused.
test("a project folder another process creates at the same moment is accepted", async () => {
  await withRoot(async (root) => {
    const project = resolveProject(root, "c.o3j");
    const racing = (dir: string) => {
      mkdirSync(dir); // the other process wins
      mkdirSync(dir); // ours then fails with EEXIST
    };
    ensureProjectRoot(project, racing);
    // resolveProject resolves symlinked parents (macOS: /var is /private/var), so compare with its dir.
    const d = resolveProject(root, "d.o3j");
    assert.equal(ensureDir(d, "out/r_0001", racing), join(d.dir, "out", "r_0001"));
  });
});

test("a symlink or a file put there at the same moment is still refused", async (t) => {
  await withRoot(async (root) => {
    const file = (dir: string) => {
      writeFileSync(dir, "not a folder");
      mkdirSync(dir);
    };
    assert.throws(() => ensureProjectRoot(resolveProject(root, "f.o3j"), file), /not a real folder/);
    assert.throws(() => ensureDir(resolveProject(root, "g.o3j"), "out", file), /not a folder|not a real folder/);
    const link = (dir: string) => {
      symlinkSync(root, dir);
      mkdirSync(dir);
    };
    try {
      assert.throws(() => ensureProjectRoot(resolveProject(root, "h.o3j"), link), /not a real folder/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") return t.skip("this account may not create symbolic links");
      throw e;
    }
  });
});
