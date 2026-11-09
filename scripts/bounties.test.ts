// The bounty feed (docs/BOUNTIES.md): every capability task becomes a record whose solver half
// shows the brief and nothing that points at the task files, and whose verifier half names the
// task and the grader command. The prompt and limits match bench/run-capability.md, and the
// doc names the same format and command, so the three cannot drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_GUID, leakIn, loadTasks } from "../bench/lib.ts";
import { FEED_FORMAT, SOLVER_LIMITS, SOLVER_PROMPT, bountyFeed, capabilityBounty } from "./bounties-lib.ts";
import { ROOT } from "./lib.ts";

const tasks = loadTasks();
const feed = bountyFeed(tasks, "0123abcd");

test("the feed holds every capability task once, sorted, and no regression task", () => {
  const cap = tasks.filter((t) => t.task.split === "capability").map((t) => t.task.id).sort();
  assert.deepEqual(feed.capability.map((b) => b.verifier.task), cap);
  assert.ok(cap.length >= 10);
  assert.equal(feed.format, FEED_FORMAT);
  assert.equal(feed.commit, "0123abcd");
  for (const b of feed.capability) assert.equal(b.verifier.commit, "0123abcd");
});

test("a record's id carries the task's version and its verifier names the grader", () => {
  for (const t of tasks.filter((t) => t.task.split === "capability")) {
    const b = capabilityBounty(t, null);
    assert.equal(b.id, `open3dj:bench:${t.task.id}@${t.task.version}`);
    assert.equal(b.verifier.version, t.task.version);
    assert.equal(b.verifier.path, `bench/tasks/${t.task.id}/task.json`);
    assert.equal(b.verifier.command, `node bench/grade.ts ${t.task.id} <solution.o3j.js>`);
    assert.equal(b.verifier.commit, null);
    assert.equal(b.reward, null);
    assert.equal(b.licence, "MIT");
  }
});

test("the solver half shows the brief and the filled prompt, and leaks nothing about the task files", () => {
  for (const b of feed.capability) {
    const text = JSON.stringify(b.solver);
    assert.equal(leakIn(text), undefined, `${b.id}: ${leakIn(text)}`);
    assert.ok(!text.includes(CANARY_GUID));
    for (const word of ["assert", "reference", "mutant", "expect", "task.json", "grade.ts"]) assert.ok(!text.includes(word), `${b.id}: solver half mentions ${word}`);
    assert.ok(b.solver.brief.length > 0);
    assert.ok(b.solver.prompt.endsWith(`The client's brief:\n${b.solver.brief}`));
    assert.ok(!b.solver.prompt.includes("<brief>"));
    assert.deepEqual(b.solver.limits, SOLVER_LIMITS);
  }
});

test("the prompt and the limits are the ones in bench/run-capability.md", () => {
  const doc = readFileSync(join(ROOT, "bench", "run-capability.md"), "utf8");
  const lines = doc.split("\n").map((l) => l.replace(/^ {3}/, ""));
  for (const line of SOLVER_PROMPT.split("\n")) assert.ok(lines.includes(line), `run-capability.md lacks the prompt line: ${line}`);
  assert.ok(doc.includes(`after ${SOLVER_LIMITS.minutes} minutes`));
  assert.ok(doc.includes(`after ${SOLVER_LIMITS.tool_calls} tool calls`));
});

test("docs/BOUNTIES.md names the feed format, the script and the grader command", () => {
  const doc = readFileSync(join(ROOT, "docs", "BOUNTIES.md"), "utf8");
  assert.ok(doc.includes(FEED_FORMAT));
  assert.ok(doc.includes("node scripts/bounties.ts"));
  assert.ok(doc.includes("node bench/grade.ts <task-id> <solution.o3j.js>"));
  assert.ok(doc.includes("agent-ready"));
});

test("node scripts/bounties.ts prints the feed as JSON, deterministic for a commit", () => {
  const run = () => spawnSync(process.execPath, [join(ROOT, "scripts", "bounties.ts"), "--commit", "feedfeed"], { cwd: ROOT, encoding: "utf8" });
  const a = run();
  assert.equal(a.status, 0, a.stderr);
  const parsed = JSON.parse(a.stdout);
  assert.equal(parsed.format, FEED_FORMAT);
  assert.equal(parsed.commit, "feedfeed");
  assert.equal(parsed.capability.length, feed.capability.length);
  assert.equal(parsed.issues.label, "agent-ready");
  assert.equal(run().stdout, a.stdout);
  const bad = spawnSync(process.execPath, [join(ROOT, "scripts", "bounties.ts"), "--commit"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(bad.status, 3);
});
