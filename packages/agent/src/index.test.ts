// The package contract: status, exports, no third-party dependencies, and no kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as agent from "./index.ts";

const { PACKAGE_STATUS } = agent;

test("a stub until Engine A runs a turn, with the first-slice helpers exported", () => {
  assert.equal(PACKAGE_STATUS, "stub");
  for (const name of ["apiTools", "withProject", "toApiContent", "redactText", "systemPrompt", "skillBody"]) {
    assert.equal(typeof (agent as Record<string, unknown>)[name], "function", name);
  }
  assert.deepEqual([...agent.API_TOOL_ORDER], ["run", "inspect", "render", "export", "docs"]);
});

test("only workspace dependencies, pinned", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown>;
  assert.equal(pkg.name, "@open3dj/agent");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.dependencies, { "@open3dj/mcp": "0.0.0", "@open3dj/schemas": "0.0.0" });
  assert.equal(pkg.devDependencies, undefined);
});

// The agent runs inside the open3dj view process, which must never load the kernel: it prints
// to stdout. A child process imports the package with a resolve hook that records every module.
test("importing the package never loads the kernel or a compute worker", () => {
  const index = new URL("./index.ts", import.meta.url).href;
  const code = `import { registerHooks } from "node:module";
const seen = [];
registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); seen.push(r.url); return r; } });
await import(${JSON.stringify(index)});
process.stderr.write(JSON.stringify(seen));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", "nothing on stdout");
  const seen = JSON.parse(r.stderr) as string[];
  assert.ok(seen.some((u) => u.includes("/packages/mcp/src/")), "the hook saw the imports");
  const loaded = seen.filter((u) => /occt-wasm|\/packages\/kernel\/|\/packages\/compute\/src\/(job|worker)/.test(u));
  assert.deepEqual(loaded, []);
});

// A placeholder that fails on purpose once the status flips (packages/README.md): the change
// that makes Engine A run a turn (plan step B4) replaces it with real tests.
test("Engine A runs a turn against a fake Messages API", { skip: PACKAGE_STATUS === "stub" ? "agent is a stub until plan step B4" : false }, () => {
  assert.fail("write the Engine A turn tests (B4) before PACKAGE_STATUS flips to ready");
});
