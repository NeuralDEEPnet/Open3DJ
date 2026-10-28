import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@open3dj/schemas";
import { PACKAGE_STATUS, defaultProject, main, parseCommand, parseParams } from "./index.ts";

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) }, out, err };
};

test("help and version print to the io, never fail", async () => {
  const c = capture();
  assert.equal(await main(["help"], c.io), 0);
  assert.match(c.out.join(""), /open3dj run <script\.o3j\.js>/);
  const v = capture();
  assert.equal(await main(["--version"], v.io), 0);
  assert.match(v.out.join(""), /^\d+\.\d+\.\d+/);
});

test("usage errors exit 2 with a message", async () => {
  const c = capture();
  assert.equal(await main(["frobnicate"], c.io), 2);
  assert.match(c.err.join(""), /unknown command/);
  const e = capture();
  assert.equal(await main(["export"], e.io), 2);
  assert.match(e.err.join(""), /--format/);
});

test("arguments become valid tool inputs (CLI parity)", () => {
  const run = parseCommand(["run", "parts/bracket.o3j.js", "--param", "width=40", "--param", "label=A", "--param", "solid=true"]).command;
  assert.equal(run.cmd, "run");
  if (run.cmd === "run") {
    assert.equal(run.input.project, "parts/bracket.o3j");
    assert.deepEqual(run.input.params, { width: 40, label: "A", solid: true });
    assert.ok(validate("tool-run-input", { ...run.input, script: "return box(1,1,1)" }).valid);
  }
  for (const argv of [["inspect", "--fields", "tree,devices"], ["render", "-p", "x.o3j"], ["export", "-f", "step", "-p", "x.o3j"], ["docs", "fillet", "edges"]]) {
    const c = parseCommand(argv).command;
    assert.ok("input" in c);
    if ("input" in c) assert.ok(validate(`tool-${c.cmd}-input`, c.input).valid, argv.join(" "));
  }
  assert.deepEqual(parseParams(["n=1e3", "s=", "neg=-2"]), { n: 1000, s: "", neg: -2 });
  assert.equal(defaultProject("C:\\work\\lid.o3j.js"), "C:/work/lid.o3j");
});

test("commands report not implemented while the CLI is a stub", { skip: PACKAGE_STATUS === "stub" ? false : "implemented" }, async () => {
  const c = capture();
  assert.equal(await main(["doctor"], c.io), 1);
  assert.match(c.err.join(""), /not implemented/);
});
