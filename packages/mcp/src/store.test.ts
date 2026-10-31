// The project store across processes: revisions are claimed under a lock file, and a
// revision file is never replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const CHILD = fileURLToPath(new URL("./race-child.testing.ts", import.meta.url));
const run = promisify(execFile);

// Regression (review round 1): the revision lock lived in one process only. Two processes on
// one project both claimed the same next revision and the second silently replaced the first.
test("two processes running one project never claim the same revision", async () => {
  const root = mkdtempSync(join(tmpdir(), "o3j-race-"));
  try {
    const runs = 40;
    const outs = await Promise.all(["A", "B", "C"].map((who) => run(process.execPath, [CHILD, root, who, String(runs)], { cwd: root })));
    const results = outs.map((o) => JSON.parse(o.stdout) as { who: string; revs: string[]; errors: string[] });
    const claimed = results.flatMap((r) => r.revs);
    const files = readdirSync(join(root, "c.o3j", "revisions"));
    assert.equal(new Set(claimed).size, claimed.length, `a revision was claimed twice: ${claimed.length - new Set(claimed).size} duplicates`);
    assert.equal(files.length, claimed.length, "every claimed revision has its own file");
    for (const r of results) assert.deepEqual(r.errors, [], r.who);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
