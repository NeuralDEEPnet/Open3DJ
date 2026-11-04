// Tests for the Claude Code hooks (scripts/hooks/lib.ts, guard.ts): protected golden files,
// bench tolerances, the licence allowlist and secrets, with and without the operator's
// acknowledgement, plus the Stop hook's source-file filter. Credential-shaped strings are
// built at run time, so this file itself passes the secrets check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib.ts";
import { acknowledged, allowlist, blockMessage, checkBash, checkFileEdit, guard, isSource, textAfter, tolerances } from "./lib.ts";
import type { ToolCall } from "./lib.ts";

const TASK_PATH = join(ROOT, "bench", "tasks", "reg-hinge", "task.json");
const TASK = readFileSync(TASK_PATH, "utf8");
const GATE_PATH = join(ROOT, "scripts", "license-gate.ts");
const GATE = readFileSync(GATE_PATH, "utf8");
const files: Record<string, string> = { [TASK_PATH]: TASK, [GATE_PATH]: GATE };
const read = (abs: string) => files[abs];
const edit = (file_path: string, old_string: string, new_string: string): ToolCall => ({ tool_name: "Edit", tool_input: { file_path, old_string, new_string } });
const cats = (call: ToolCall) => checkFileEdit(call, ROOT, read).map((b) => b.category);

test("golden files: any edit or write to examples/*/expected.json is blocked", () => {
  assert.deepEqual(cats(edit(join(ROOT, "examples/flange/expected.json"), "1", "2")), ["goldens"]);
  assert.deepEqual(cats({ tool_name: "Write", tool_input: { file_path: "examples/knob/expected.json", content: "{}" } }), ["goldens"]);
  assert.deepEqual(cats(edit(join(ROOT, "examples/flange/flange.o3j.js"), "a", "b")), []);
});

test("bench tolerances: a changed, added or removed tol is blocked; other task edits pass", () => {
  assert.ok(TASK.includes('"abs": 0.000001'));
  assert.deepEqual(cats(edit(TASK_PATH, '"abs": 0.000001', '"abs": 0.01')), ["tolerances"]);
  assert.deepEqual(cats(edit(TASK_PATH, '"rel": 0.000001', '"rel": 0.000001, "abs": 1')), ["tolerances"]);
  assert.deepEqual(cats(edit(TASK_PATH, '"title": "Butt hinge with pin"', '"title": "Butt hinge"')), []);
  // A new task file has no tolerances to protect yet.
  assert.deepEqual(cats({ tool_name: "Write", tool_input: { file_path: join(ROOT, "bench/tasks/reg-new/task.json"), content: TASK } }), []);
  assert.equal(tolerances(TASK).length, 3);
});

test("licence allowlist: touching ALLOWED or the LGPL exceptions is blocked; the rest of the gate is not", () => {
  assert.deepEqual(cats(edit(GATE_PATH, '"MIT", "Apache-2.0"', '"MIT", "GPL-3.0-only", "Apache-2.0"')), ["licences"]);
  assert.deepEqual(cats(edit(GATE_PATH, '"occt-wasm": "dist/occt-wasm.wasm",', '"occt-wasm": "dist/occt-wasm.wasm",\n  "other": "x.wasm",')), ["licences"]);
  assert.deepEqual(cats(edit(GATE_PATH, "let checked = 0;", "let checked = 0; // count")), []);
  assert.ok(!allowlist(GATE).includes("<missing>"), "the allowlist pattern still finds both parts");
});

test("secrets: .env files and credential-shaped text are blocked", () => {
  const key = ["sk", "ant", "api03", "x".repeat(30)].join("-");
  const pem = ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ");
  assert.deepEqual(cats({ tool_name: "Write", tool_input: { file_path: join(ROOT, ".env"), content: "A=1" } }), ["secrets"]);
  assert.deepEqual(cats({ tool_name: "Write", tool_input: { file_path: join(ROOT, ".env.example"), content: "A=" } }), []);
  assert.deepEqual(cats(edit(join(ROOT, "README.md"), "x", `token ${key}`)), ["secrets"]);
  assert.deepEqual(cats(edit(join(ROOT, "README.md"), "x", pem)), ["secrets"]);
});

test("Bash: regenerating goldens and shell writes to protected files are blocked", () => {
  const exists = () => true;
  assert.deepEqual(checkBash("node scripts/examples.ts --write", ROOT, exists).map((b) => b.category), ["goldens"]);
  assert.deepEqual(checkBash("node scripts/examples.ts bracket", ROOT, exists), []);
  assert.deepEqual(checkBash("sed -i 's/1e-6/1e-3/' bench/tasks/reg-hinge/task.json", ROOT, exists).map((b) => b.category), ["tolerances"]);
  assert.deepEqual(checkBash("echo {} > examples/knob/expected.json", ROOT, exists).map((b) => b.category), ["goldens"]);
  assert.deepEqual(checkBash("cat examples/knob/expected.json | head", ROOT, exists), [], "reading is fine");
  assert.deepEqual(checkBash("node -e 'x => x' examples/knob/expected.json", ROOT, exists), [], "an arrow is not a redirect");
  assert.deepEqual(checkBash("cat x 2>&1 > /dev/null", ROOT, exists), []);
});

test("the operator's acknowledgement lifts only the named categories", () => {
  assert.deepEqual([...acknowledged({ OPEN3DJ_ALLOW_PROTECTED: "goldens, licenses" })].sort(), ["goldens", "licences"]);
  assert.equal(acknowledged({ OPEN3DJ_ALLOW_PROTECTED: "all" }).size, 4);
  assert.equal(acknowledged({}).size, 0);
  const call = edit(join(ROOT, "examples/flange/expected.json"), "1", "2");
  assert.equal(guard(call, ROOT, {}).length, 1);
  assert.equal(guard(call, ROOT, { OPEN3DJ_ALLOW_PROTECTED: "goldens" }).length, 0);
  assert.equal(guard(call, ROOT, { OPEN3DJ_ALLOW_PROTECTED: "tolerances" }).length, 1);
  assert.match(blockMessage(guard(call, ROOT, {})), /OPEN3DJ_ALLOW_PROTECTED=goldens/);
});

test("textAfter applies Edit, replace_all and MultiEdit like the tools do", () => {
  assert.equal(textAfter(edit("f", "a", "b"), "a a"), "b a");
  assert.equal(textAfter({ tool_name: "Edit", tool_input: { old_string: "a", new_string: "$&", replace_all: true } }, "a a"), "$& $&");
  assert.equal(textAfter({ tool_name: "MultiEdit", tool_input: { edits: [{ old_string: "a", new_string: "b" }, { old_string: "b", new_string: "c" }] } }, "a"), "c");
});

test("the Stop hook counts code and data as source, not docs", () => {
  for (const f of ["packages/dsl/src/dsl.ts", "scripts/check.ts", "bench/tasks/reg-hinge/task.json", "examples/knob/knob.o3j.js", "package.json"]) assert.ok(isSource(f), f);
  for (const f of ["docs/PLAN.md", "README.md", "bench/README.md", "ops/build-log.md", "examples/knob/drawing.png", "examples/knob/knob.o3j/params.o3j.json"]) assert.ok(!isSource(f), f);
});

test("guard.ts end to end: exit 2 with the reason on stderr, exit 0 otherwise", () => {
  const run = (payload: unknown, env: Record<string, string> = {}) => spawnSync(process.execPath, [join(ROOT, "scripts", "hooks", "guard.ts")], {
    input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, OPEN3DJ_ALLOW_PROTECTED: "", ...env },
  });
  const bad = run(edit(join(ROOT, "examples/flange/expected.json"), "1", "2"));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /golden file/);
  assert.equal(bad.stdout, "");
  assert.equal(run(edit(join(ROOT, "examples/flange/expected.json"), "1", "2"), { OPEN3DJ_ALLOW_PROTECTED: "goldens" }).status, 0);
  assert.equal(run({ tool_name: "Read", tool_input: { file_path: "x" } }).status, 0);
  assert.equal(spawnSync(process.execPath, [join(ROOT, "scripts", "hooks", "guard.ts")], { input: "not json", encoding: "utf8" }).status, 0);
});
