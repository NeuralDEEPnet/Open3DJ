// open3dj view and an agent on one project: the file watcher must not run an agent's revision
// again, must not apply its start-up --param values over the agent's, and must never let a
// save replace an agent's revision without saying so (RFC 0001, the first viewer fix).
//
// The agent is a second set of tool handlers over the same fake pool, in this process, so the
// test counts the watcher's own pool jobs. No kernel and no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "@open3dj/mcp";
import type { RevisionRecord, ToolHandlers } from "@open3dj/mcp";
import type { ParamValue, RunInput } from "@open3dj/schemas";
import { FAKE_INVENTORY, fakePlace, fakePool } from "../../mcp/src/testing.ts";
import type { FakePool } from "../../mcp/src/testing.ts";
import { replaceFile, startViewServer } from "./view.ts";
import type { RunState, ViewServer } from "./view.ts";

const NONCE = "watch-nonce-0123456789abcdef";
const DEBOUNCE_MS = 20;
const POLL_MS = 30;
// Long enough for a save to be seen, debounced and run, and for the head to be polled.
const SETTLE_MS = 400;

const S1 = `return { name: "plate", shape: box(40, 20, 4) };\n`;
const S2 = `return { name: "plate", shape: box(40, 20, 6) };\n// made thicker by the agent\n`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, cond: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Bench {
  root: string;
  projectDir: string;
  file: string;
  pool: FakePool;
  agent: ToolHandlers;
  server: ViewServer;
  runs: RunState[];
  logs: string[];
  /** Every run input the watcher sent, refused ones included. */
  inputs: RunInput[];
  /** Pool jobs of the watcher's own runs (not the agent's, not the page's detailed measures). */
  watcherJobs(): number;
  /** The project's head, or undefined when the project or its head is missing. */
  head(): string | undefined;
  rev(r: string): RevisionRecord;
  revs(): number;
  /** Stop the viewer, so a test can work while it is closed. */
  stop(): Promise<void>;
  /** Start the viewer again on the same script, as a person who runs open3dj view again. */
  start(o?: { params?: Record<string, ParamValue>; syncScript?: boolean }): Promise<void>;
  close(): Promise<void>;
}

interface BenchOptions {
  mode: "script" | "project";
  params?: Record<string, ParamValue>;
  syncScript?: boolean;
  slowMs?: number;
  /** Script mode: part.o3j.js is a symlink to real.o3j.js. */
  link?: boolean;
  names?: { script: string; project: string; run: string };
}

async function bench(o: BenchOptions): Promise<Bench> {
  const root = mkdtempSync(join(tmpdir(), "o3j-view-watch-"));
  const projectDir = join(root, "part.o3j");
  const pool = fakePool(o.slowMs === undefined ? {} : { slowMs: o.slowMs });
  const deps = { pool, inventory: FAKE_INVENTORY, place: fakePlace, root, interactiveMs: 5_000 };
  const viewer = createHandlers(deps);
  const agent = createHandlers(deps);
  const inputs: RunInput[] = [];
  const watched: ToolHandlers = { ...viewer, run: (input) => (inputs.push(structuredClone(input)), viewer.run(input)) };
  let file: string;
  if (o.mode === "script") {
    file = join(root, "part.o3j.js");
    if (o.link) {
      writeFileSync(join(root, "real.o3j.js"), S1);
      symlinkSync(join(root, "real.o3j.js"), file);
    } else {
      writeFileSync(file, S1);
    }
  } else {
    // The project exists before the viewer starts, as open3dj view <project> needs.
    const first = await agent.run({ project: "part.o3j", script: S1 });
    assert.equal(first.rev, "r_0001", JSON.stringify(first.error));
    file = join(projectDir, "main.o3j.js");
  }
  const runs: RunState[] = [];
  const logs: string[] = [];
  const serve = async (s: { params?: Record<string, ParamValue>; syncScript?: boolean }) => {
    const options: Parameters<typeof startViewServer>[0] = {
      handlers: watched, root, project: projectDir, nonce: NONCE, debounceMs: DEBOUNCE_MS, pollMs: POLL_MS,
      log: (line) => logs.push(line), onRun: (run) => runs.push(structuredClone(run)),
    };
    if (o.mode === "script") options.script = file;
    if (s.params) options.params = s.params;
    if (s.syncScript !== undefined) options.syncScript = s.syncScript;
    if (o.names) options.names = o.names;
    const started = await startViewServer(options);
    await started.ready;
    return started;
  };
  const rev = (r: string) => JSON.parse(readFileSync(join(projectDir, "revisions", `${r}.json`), "utf8")) as RevisionRecord;
  const b: Bench = {
    root, projectDir, file, pool, agent, runs, logs, inputs,
    server: await serve(o),
    watcherJobs: () => pool.calls.filter((c) => c.kind === "run" && c.detail === "detailed" && !c.compute?.placement_reason.startsWith("inspect")).length,
    head: () => {
      try {
        return (JSON.parse(readFileSync(join(projectDir, "project.o3j.json"), "utf8")) as { rev?: string }).rev;
      } catch {
        return undefined;
      }
    },
    rev,
    revs: () => {
      let n = 0;
      while (true) {
        try {
          rev(`r_${String(n + 1).padStart(4, "0")}`);
        } catch {
          return n;
        }
        n++;
      }
    },
    stop: () => b.server.close(),
    async start(s = {}) {
      b.server = await serve(s);
    },
    async close() {
      await b.server.close();
      viewer.shutdown();
      agent.shutdown();
      rmSync(root, { recursive: true, force: true });
    },
  };
  return b;
}

const conflicts = (b: Bench) => b.runs.filter((r) => r.error?.code === "REV_CONFLICT");

test("project mode: an agent's revision is not run again by the watcher, and the agent's base_rev still holds", async () => {
  const b = await bench({ mode: "project" });
  try {
    const before = b.watcherJobs();
    const r2 = await b.agent.run({ project: "part.o3j", script: S2, base_rev: "r_0001" });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await sleep(SETTLE_MS);
    assert.equal(b.watcherJobs(), before, "no pool job: main.o3j.js holds the head's script");
    assert.equal(b.head(), "r_0002");
    const r3 = await b.agent.run({ project: "part.o3j", ops: [{ op: "set_param", name: "w", value: 7 }], base_rev: "r_0002" });
    assert.equal(r3.status, "ok", JSON.stringify(r3.error));
    assert.equal(r3.rev, "r_0003");
    await sleep(SETTLE_MS);
    assert.equal(b.watcherJobs(), before, "a parameter change by the agent is not run again either");
    assert.deepEqual(conflicts(b), []);
  } finally {
    await b.close();
  }
});

test("project mode with --param: the start-up values are not applied over an agent's revision, and the terminal says so once", async () => {
  const b = await bench({ mode: "project", params: { w: 3 } });
  try {
    assert.equal(b.head(), "r_0002", "the start-up run applies --param");
    assert.equal(b.rev("r_0002").params.w, 3);
    const r3 = await b.agent.run({ project: "part.o3j", script: S2, params: { w: 5 }, base_rev: "r_0002" });
    assert.equal(r3.rev, "r_0003", JSON.stringify(r3.error));
    await sleep(SETTLE_MS);
    assert.equal(b.head(), "r_0003", "the watcher made no revision over the agent's");
    const r4 = await b.agent.run({ project: "part.o3j", ops: [{ op: "set_param", name: "w", value: 6 }], base_rev: "r_0003" });
    assert.equal(r4.status, "ok", `the agent's next base_rev holds: ${JSON.stringify(r4.error)}`);
    assert.equal(r4.rev, "r_0004");
    await sleep(SETTLE_MS);
    // The person adds a note to main.o3j.js: the run keeps the agent's value, not --param w=3.
    writeFileSync(b.file, `${S2}// a note from the person\n`);
    await until("the person's save to run", () => b.head() === "r_0005");
    assert.equal(b.rev("r_0005").params.w, 6);
    assert.equal(b.rev("r_0005").base_rev, "r_0004");
    assert.equal(b.inputs.at(-1)?.params, undefined, "--param is no longer sent");
    assert.equal(b.inputs.at(-1)?.base_rev, "r_0004");
    const notices = b.logs.filter((l) => /--param/.test(l));
    assert.equal(notices.length, 1, b.logs.join("\n"));
    assert.match(notices[0]!, /r_0003 was made by an agent/);
  } finally {
    await b.close();
  }
});

test("script mode: an agent's revision is written back to the script, and the next save builds on it", async () => {
  const b = await bench({ mode: "script" });
  try {
    assert.equal(b.head(), "r_0001");
    const before = b.watcherJobs();
    const r2 = await b.agent.run({ project: "part.o3j", script: S2 });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await until("the agent's script in part.o3j.js", () => readFileSync(b.file, "utf8") === S2);
    await sleep(SETTLE_MS);
    assert.equal(b.watcherJobs(), before, "the written file is not run again");
    assert.ok(b.logs.some((l) => /wrote r_0002 .*to part\.o3j\.js/.test(l)), b.logs.join("\n"));
    const S3 = S2.replace("box(40, 20, 6)", "box(40, 24, 6)");
    writeFileSync(b.file, S3);
    await until("the person's save to run", () => b.head() === "r_0003");
    assert.equal(b.rev("r_0003").script, S3);
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
    assert.equal(b.inputs.at(-1)?.base_rev, "r_0002");
    assert.equal(b.watcherJobs(), before + 1);
    assert.deepEqual(conflicts(b), []);
  } finally {
    await b.close();
  }
});

test("script mode: a script with changes that did not run is never overwritten, and saving it is a conflict", async () => {
  const b = await bench({ mode: "script" });
  try {
    // The person is in the middle of an edit: the save fails to run.
    const broken = `${S1}throw new Error("half done");\n`;
    writeFileSync(b.file, broken);
    await until("the broken save to fail", () => b.runs.at(-1)?.error?.code === "SCRIPT_RUNTIME");
    const r2 = await b.agent.run({ project: "part.o3j", script: S2 });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await until("a conflict notice", () => conflicts(b).length === 1);
    assert.equal(readFileSync(b.file, "utf8"), broken, "the person's file is left as it is");
    const notice = conflicts(b)[0]!;
    assert.equal(notice.state, "error");
    assert.match(notice.error!.message, /^part\.o3j\.js is based on r_0001; r_0002 was made by an agent/);
    assert.deepEqual(notice.conflict, { file: "part.o3j.js", base: "r_0001", head: "r_0002" });

    // The person finishes the edit and saves: refused, never run over the agent's revision.
    const jobs = b.watcherJobs();
    const fixed = S1.replace("box(40, 20, 4)", "box(40, 20, 5)");
    writeFileSync(b.file, fixed);
    await until("a second conflict", () => conflicts(b).length === 2);
    await sleep(SETTLE_MS);
    assert.equal(b.head(), "r_0002");
    assert.equal(b.revs(), 2);
    assert.equal(readFileSync(b.file, "utf8"), fixed, "still the person's text");
    assert.equal(b.watcherJobs(), jobs, "a save behind the head is not run");
    assert.match(conflicts(b)[1]!.error!.message, /^part\.o3j\.js is based on r_0001; r_0002 was made by an agent/);

    // The person takes the agent's version: the file now equals the head, so nothing runs.
    writeFileSync(b.file, S2);
    await until("the conflict to clear", () => b.runs.at(-1)?.state === "done");
    assert.equal(b.runs.at(-1)?.rev, "r_0002");
    assert.equal(b.watcherJobs(), jobs);
    const S3 = S2.replace("box(40, 20, 6)", "box(40, 22, 6)");
    writeFileSync(b.file, S3);
    await until("the next save to run", () => b.head() === "r_0003");
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
  } finally {
    await b.close();
  }
});

test("--no-sync-script: the script is left alone, a save behind the head is refused, and a script equal to the head is adopted", async () => {
  const b = await bench({ mode: "script", syncScript: false });
  try {
    const before = b.watcherJobs();
    const r2 = await b.agent.run({ project: "part.o3j", script: S2 });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await sleep(SETTLE_MS);
    assert.equal(readFileSync(b.file, "utf8"), S1, "nothing is written to the script");
    assert.equal(b.watcherJobs(), before);
    assert.ok(b.logs.some((l) => /r_0002 was made by an agent; part\.o3j\.js was not updated \(--no-sync-script\)/.test(l)), b.logs.join("\n"));

    // A save of the old script is refused instead of replacing the agent's revision.
    writeFileSync(b.file, S1.replace("box(40, 20, 4)", "box(40, 20, 5)"));
    await until("a conflict", () => conflicts(b).length === 1);
    assert.equal(b.head(), "r_0002");
    assert.equal(b.watcherJobs(), before);

    // The echo rule still holds: a script equal to the head's is adopted without a run.
    writeFileSync(b.file, S2);
    await until("the conflict to clear", () => b.runs.at(-1)?.state === "done");
    assert.equal(b.watcherJobs(), before);
    const S3 = S2.replace("box(40, 20, 6)", "box(40, 26, 6)");
    writeFileSync(b.file, S3);
    await until("the next save to run", () => b.head() === "r_0003");
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
    assert.equal(b.inputs.at(-1)?.base_rev, "r_0002");
  } finally {
    await b.close();
  }
});

test("script mode: an agent's parameter change keeps the script, so the person's next save runs on top of it", async () => {
  const b = await bench({ mode: "script" });
  try {
    const r2 = await b.agent.run({ project: "part.o3j", ops: [{ op: "set_param", name: "w", value: 9 }] });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    // Saved at once, before the viewer polls the head: the script did not change, so this is no conflict.
    writeFileSync(b.file, `${S1}// a note from the person\n`);
    await until("the person's save to run", () => b.head() === "r_0003");
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
    assert.equal(b.rev("r_0003").params.w, 9, "the agent's value is kept");
    assert.deepEqual(conflicts(b), []);
  } finally {
    await b.close();
  }
});

test("project mode: an agent's commit while a save runs wins, the person is told the save did not run, and the save's text is kept", async () => {
  const b = await bench({ mode: "project", slowMs: 600 });
  try {
    const slow = `${S1.replace("box(40, 20, 4)", "box(40, 20, 5)")}// slow to build\n`;
    writeFileSync(b.file, slow);
    await until("the save to start running", () => b.inputs.some((i) => i.script === slow));
    const r2 = await b.agent.run({ project: "part.o3j", script: S2, base_rev: "r_0001" });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await until("the save's run to end", () => conflicts(b).length === 1);
    await sleep(SETTLE_MS);
    assert.equal(b.head(), "r_0002", "the save was not committed over the agent's revision");
    assert.equal(b.revs(), 2);
    assert.equal(b.runs.length, 2, "the start-up run, then the notice; no misleading done line");
    const notice = conflicts(b)[0]!;
    assert.deepEqual(notice.conflict, { file: "part.o3j/main.o3j.js", base: "r_0001", head: "r_0002" });
    assert.match(notice.error!.hint ?? "", /r_0002 was made while it ran, and it rewrote part\.o3j\/main\.o3j\.js/);
    // The agent's commit rewrote main.o3j.js, and an editor may reload it: the save's text
    // must still be on disk, in a file the notice names, readable by this user only.
    assert.equal(readFileSync(b.file, "utf8"), S2);
    const kept = join(b.projectDir, ".o3j-view", "unrun.o3j.js");
    assert.equal(readFileSync(kept, "utf8"), slow, "the save that did not run is kept");
    assert.match(notice.error!.hint ?? "", /Your version is in part\.o3j\/\.o3j-view\/unrun\.o3j\.js/);
    if (process.platform !== "win32") assert.equal(statSync(kept).mode & 0o777, 0o600);
    // Saving it again runs it on the agent's revision.
    writeFileSync(b.file, slow);
    await until("the second save to run", () => b.head() === "r_0003");
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
  } finally {
    await b.close();
  }
});

test("project mode: main.o3j.js written just before the head moves is adopted when its run is refused, with no conflict", async () => {
  const b = await bench({ mode: "project", slowMs: 600 });
  try {
    const S2slow = `${S2}// slow to build\n`;
    // An agent in another process: its commit writes main.o3j.js a moment before it moves the
    // head. Here the agent's run starts first, and the file is written by hand meanwhile.
    const agentRun = b.agent.run({ project: "part.o3j", script: S2slow, base_rev: "r_0001" });
    await until("the agent's job", () => b.pool.calls.some((c) => c.script === S2slow));
    writeFileSync(b.file, S2slow);
    await until("the watcher to run it", () => b.inputs.some((i) => i.script === S2slow));
    const r2 = await agentRun;
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await until("the watcher's run to end", () => b.runs.length >= 2);
    await sleep(SETTLE_MS);
    assert.deepEqual(conflicts(b), []);
    assert.equal(b.runs.at(-1)?.state, "done");
    assert.equal(b.runs.at(-1)?.rev, "r_0002");
    assert.equal(b.head(), "r_0002");
    assert.equal(b.revs(), 2);
  } finally {
    await b.close();
  }
});

test("script mode: an agent's parameter change while a save runs is no conflict: the save runs again on top of it", async () => {
  const b = await bench({ mode: "script", slowMs: 600 });
  try {
    const slow = `${S1}// slow to build\n`;
    writeFileSync(b.file, slow);
    await until("the save to start running", () => b.inputs.some((i) => i.script === slow));
    const r2 = await b.agent.run({ project: "part.o3j", ops: [{ op: "set_param", name: "w", value: 9 }], base_rev: "r_0001" });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    await until("the save to run on the agent's revision", () => b.head() === "r_0003", 10_000);
    assert.equal(b.rev("r_0003").script, slow);
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
    assert.equal(b.rev("r_0003").params.w, 9, "a comment-only change keeps the agent's value");
    assert.deepEqual(b.inputs.filter((i) => i.script === slow).map((i) => i.base_rev), ["r_0001", "r_0002"]);
    await until("the run state to settle", () => b.runs.at(-1)?.rev === "r_0003");
    assert.equal(b.runs.at(-1)?.state, "done");
    assert.deepEqual(conflicts(b), []);
  } finally {
    await b.close();
  }
});

test("script mode: after the project folder is deleted, the next save makes a new first revision", async () => {
  const b = await bench({ mode: "script" });
  try {
    const S1b = S1.replace("box(40, 20, 4)", "box(40, 20, 5)");
    writeFileSync(b.file, S1b);
    await until("the save to run", () => b.head() === "r_0002");
    // The person starts over: the project goes, the script stays.
    rmSync(b.projectDir, { recursive: true, force: true });
    await sleep(SETTLE_MS);
    const S1c = S1.replace("box(40, 20, 4)", "box(40, 20, 3)");
    writeFileSync(b.file, S1c);
    await until("the save to make r_0001", () => b.head() === "r_0001");
    assert.equal(b.rev("r_0001").script, S1c);
    assert.equal(b.inputs.at(-1)?.base_rev, undefined, "no base_rev of a revision that is gone");
    await until("the run state to settle", () => b.runs.at(-1)?.rev === "r_0001");
    assert.equal(b.runs.at(-1)?.state, "done");
    // The next save builds on the new first revision.
    writeFileSync(b.file, S1);
    await until("the next save to run", () => b.head() === "r_0002");
    assert.equal(b.inputs.at(-1)?.base_rev, "r_0001");
    assert.deepEqual(b.runs.filter((r) => r.error), []);
  } finally {
    await b.close();
  }
});

test("script mode: a project made again by an agent never has its script written over a script whose revision is gone", async () => {
  const b = await bench({ mode: "script" });
  try {
    const S1b = S1.replace("box(40, 20, 4)", "box(40, 20, 5)");
    writeFileSync(b.file, S1b);
    await until("the save to run", () => b.head() === "r_0002");
    rmSync(b.projectDir, { recursive: true, force: true });
    // The agent starts a new project at once.
    assert.equal((await b.agent.run({ project: "part.o3j", script: S2 })).rev, "r_0001");
    await until("a conflict notice", () => conflicts(b).length === 1);
    await sleep(SETTLE_MS);
    assert.equal(readFileSync(b.file, "utf8"), S1b, "the person's script, whose revision is gone, is not overwritten");
    assert.equal(b.head(), "r_0001");
    assert.equal(conflicts(b)[0]!.conflict?.base, null);
    assert.equal(conflicts(b).length, 1);
    // A save of it is refused too, instead of replacing the agent's new project.
    writeFileSync(b.file, S1);
    await until("a second notice", () => conflicts(b).length === 2);
    assert.equal(b.head(), "r_0001");
  } finally {
    await b.close();
  }
});

test("script mode: started again after an agent's revision, the viewer writes it to the script instead of running the old script over it", async () => {
  const b = await bench({ mode: "script" });
  try {
    await b.stop();
    // The agent works through open3dj mcp while the viewer is closed.
    const r2 = await b.agent.run({ project: "part.o3j", script: S2, base_rev: "r_0001" });
    assert.equal(r2.rev, "r_0002", JSON.stringify(r2.error));
    const jobs = b.watcherJobs();
    await b.start();
    assert.equal(readFileSync(b.file, "utf8"), S2, "the agent's script is written to part.o3j.js");
    assert.equal(b.head(), "r_0002");
    assert.equal(b.revs(), 2, "the old script was not committed over the agent's revision");
    assert.equal(b.watcherJobs(), jobs, "nothing to run");
    assert.ok(b.logs.some((l) => /wrote r_0002 .*to part\.o3j\.js/.test(l)), b.logs.join("\n"));
    assert.equal(b.runs.at(-1)?.state, "done");
    assert.equal(b.runs.at(-1)?.rev, "r_0002");
    // The agent's next base_rev holds.
    const r3 = await b.agent.run({ project: "part.o3j", ops: [{ op: "set_param", name: "w", value: 7 }], base_rev: "r_0002" });
    assert.equal(r3.rev, "r_0003", JSON.stringify(r3.error));
    assert.deepEqual(conflicts(b), []);
  } finally {
    await b.close();
  }
});

test("script mode: started again with --no-sync-script after an agent's revision, the old script is not run and the person is told", async () => {
  const b = await bench({ mode: "script" });
  try {
    await b.stop();
    assert.equal((await b.agent.run({ project: "part.o3j", script: S2, base_rev: "r_0001" })).rev, "r_0002");
    await b.start({ syncScript: false });
    await sleep(SETTLE_MS);
    assert.equal(readFileSync(b.file, "utf8"), S1, "nothing is written to the script");
    assert.equal(b.head(), "r_0002");
    assert.equal(b.revs(), 2);
    assert.equal(conflicts(b).length, 1, "one notice, at start-up");
    assert.deepEqual(conflicts(b)[0]!.conflict, { file: "part.o3j.js", base: "r_0001", head: "r_0002" });
    assert.match(conflicts(b)[0]!.error!.hint ?? "", /^part\.o3j\.js holds the script of r_0001, so it was not run\./);
  } finally {
    await b.close();
  }
});

test("script mode: started again with --param after an agent's revision, the values apply on top of the agent's script", async () => {
  const b = await bench({ mode: "script" });
  try {
    await b.stop();
    assert.equal((await b.agent.run({ project: "part.o3j", script: S2, base_rev: "r_0001" })).rev, "r_0002");
    await b.start({ params: { w: 3 } });
    assert.equal(readFileSync(b.file, "utf8"), S2);
    assert.equal(b.head(), "r_0003");
    assert.equal(b.rev("r_0003").script, S2);
    assert.equal(b.rev("r_0003").base_rev, "r_0002");
    assert.equal(b.rev("r_0003").params.w, 3);
    assert.deepEqual(b.logs.filter((l) => /--param/.test(l)), [], "the start-up values are not dropped at start-up");
  } finally {
    await b.close();
  }
});

test("script mode: a symlinked script that cannot be written gets one terminal line and one notice, not one per poll", { skip: process.platform === "win32" ? "symlinks need other rights on Windows" : false }, async () => {
  const b = await bench({ mode: "script", link: true });
  try {
    assert.equal((await b.agent.run({ project: "part.o3j", script: S2 })).rev, "r_0002");
    await until("a conflict notice", () => conflicts(b).length === 1);
    await sleep(SETTLE_MS); // more than ten polls
    const lines = b.logs.filter((l) => /could not write/.test(l));
    assert.equal(lines.length, 1, b.logs.join("\n"));
    assert.match(lines[0]!, /could not write r_0002 to part\.o3j\.js: part\.o3j\.js is not a regular file/);
    assert.equal(conflicts(b).length, 1);
    const notice = conflicts(b)[0]!;
    assert.doesNotMatch(notice.error!.hint ?? "", /changes that did not run/, "the script has none");
    assert.match(notice.error!.hint ?? "", /^r_0002 could not be written to part\.o3j\.js/);
    assert.ok(lstatSync(b.file).isSymbolicLink(), "the link is left as it is");
    assert.equal(readFileSync(b.file, "utf8"), S1);
  } finally {
    await b.close();
  }
});

test("script mode: one save refused before the poll sees the agent's revision gives one notice", async () => {
  for (let i = 0; i < 3; i++) {
    const b = await bench({ mode: "script" });
    try {
      assert.equal((await b.agent.run({ project: "part.o3j", script: S2 })).rev, "r_0002");
      writeFileSync(b.file, S1.replace("box(40, 20, 4)", "box(40, 20, 5)"));
      await until("a conflict notice", () => conflicts(b).length >= 1);
      await sleep(SETTLE_MS);
      assert.equal(conflicts(b).length, 1, b.runs.map((r) => r.error?.hint).join("\n"));
      assert.equal(b.head(), "r_0002");
    } finally {
      await b.close();
    }
  }
});

test("the conflict hint names the script and the project as the person typed them", async () => {
  const names = { script: "examples/part/part.o3j.js", project: "examples/part/part.o3j", run: "examples/part/part.o3j.js" };
  const b = await bench({ mode: "script", names });
  try {
    writeFileSync(b.file, `${S1}throw new Error("half done");\n`);
    await until("the broken save to fail", () => b.runs.at(-1)?.error?.code === "SCRIPT_RUNTIME");
    assert.equal((await b.agent.run({ project: "part.o3j", script: S2 })).rev, "r_0002");
    await until("a conflict notice", () => conflicts(b).length === 1);
    const notice = conflicts(b)[0]!;
    assert.equal(notice.conflict?.file, "examples/part/part.o3j.js");
    assert.match(notice.error!.message, /^examples\/part\/part\.o3j\.js is based on r_0001/);
    assert.match(notice.error!.hint ?? "", /copy examples\/part\/part\.o3j\/main\.o3j\.js over examples\/part\/part\.o3j\.js/);
    assert.match(notice.error!.hint ?? "", /run "open3dj run examples\/part\/part\.o3j\.js" once/);
  } finally {
    await b.close();
  }
});

test("replaceFile writes only over the text it expects, keeps the mode, and never replaces a symlink", { skip: process.platform === "win32" ? "symlinks and file modes need other rights on Windows" : false }, () => {
  const d = mkdtempSync(join(tmpdir(), "o3j-replace-"));
  try {
    const f = join(d, "part.o3j.js");
    writeFileSync(f, S1);
    chmodSync(f, 0o640);
    assert.equal(replaceFile(f, S2, S1), true);
    assert.equal(readFileSync(f, "utf8"), S2);
    assert.equal(statSync(f).mode & 0o777, 0o640);
    // The person saved in the meantime: nothing is written.
    assert.equal(replaceFile(f, S1, S1), false);
    assert.equal(readFileSync(f, "utf8"), S2);
    // A symlinked script is refused; the link and its target stay as they are.
    const link = join(d, "link.o3j.js");
    symlinkSync(f, link);
    assert.throws(() => replaceFile(link, S1, S2), /not a regular file/);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), f);
    assert.equal(readFileSync(f, "utf8"), S2);
    assert.deepEqual(readdirSync(d).sort(), ["link.o3j.js", "part.o3j.js"], "no temporary file is left");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
