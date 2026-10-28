// Claude Code Stop hook (.claude/settings.json): before an agent stops, run npm run check if
// source files changed (tracked files that differ from HEAD, plus new untracked files under
// packages/, scripts/, bench/, corpora/ and examples/). Docs-only changes skip it at once.
// The result is remembered per working-tree state in .git/open3dj-check-stamp.json, so the
// same state is never checked twice. Exit 2 (with the failing tail of the output) keeps the
// agent working; exit 0 lets it stop. OPEN3DJ_SKIP_STOP_CHECK=1 skips the hook.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSource } from "./lib.ts";

interface StopInput { stop_hook_active?: boolean; cwd?: string }
let input: StopInput = {};
try {
  input = JSON.parse(readFileSync(0, "utf8")) as StopInput;
} catch {
  // no payload: run as if called by hand
}
if (process.env.OPEN3DJ_SKIP_STOP_CHECK === "1") process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

let changed: string[];
let head: string;
let gitDir: string;
try {
  head = git("rev-parse", "HEAD").trim();
  gitDir = resolve(root, git("rev-parse", "--git-dir").trim());
  const tracked = git("diff", "--name-only", "-z", "HEAD").split("\0");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0");
  changed = [...new Set([...tracked, ...untracked])].filter((f) => f && isSource(f)).sort();
} catch (e) {
  process.stderr.write(`stop-check: skipped, ${(e as Error).message}\n`);
  process.exit(0);
}
if (changed.length === 0) process.exit(0);

// The working-tree state: HEAD plus the content of every changed source file.
const h = createHash("sha256").update(head);
for (const f of changed) {
  const p = join(root, f);
  h.update(`\0${f}\0`).update(existsSync(p) ? readFileSync(p) : "<deleted>");
}
const state = h.digest("hex");
const stampFile = join(gitDir, "open3dj-check-stamp.json");
let stamp: { state?: string; ok?: boolean; tail?: string } = {};
try {
  stamp = JSON.parse(readFileSync(stampFile, "utf8"));
} catch {
  // first run
}

if (stamp.state === state) {
  if (stamp.ok) process.exit(0);
  if (input.stop_hook_active) {
    process.stderr.write("stop-check: npm run check still fails for this state (not run again). Tell your operator what is failing.\n");
    process.exit(0);
  }
  process.stderr.write(`npm run check failed for these changes and nothing changed since. Fix it before stopping:\n${stamp.tail ?? ""}\n`);
  process.exit(2);
}

process.stderr.write(`stop-check: ${changed.length} source file(s) changed, running npm run check\n`);
const r = spawnSync(process.execPath, [join(root, "scripts", "check.ts")], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 14 * 60 * 1000 });
const ok = r.status === 0;
const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-60).join("\n");
try {
  writeFileSync(stampFile, `${JSON.stringify({ state, ok, at: new Date().toISOString(), tail: ok ? "" : tail })}\n`);
} catch {
  // a read-only .git only costs a re-run
}
if (ok) process.exit(0);
process.stderr.write(`npm run check failed. Fix it before stopping (AGENTS.md, Definition of done):\n${tail}\n`);
process.exit(2);
