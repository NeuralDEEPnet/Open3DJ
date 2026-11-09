// The package contract: status, exports, no third-party dependencies, and no kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "@open3dj/mcp";
// The fake compute pool is test data of @open3dj/mcp, not part of its public exports.
import { FAKE_INVENTORY, fakePlace, fakePool } from "../../mcp/src/testing.ts";
import { startFakeMessagesApi, streamReply } from "./fake-messages-api.testing.ts";
import * as agent from "./index.ts";
import type { AgentEventBody } from "./index.ts";

const { PACKAGE_STATUS } = agent;

test("ready since Engine A runs a turn, with its parts and the session exported", () => {
  assert.equal(PACKAGE_STATUS, "ready");
  for (const name of [
    "apiTools", "withProject", "toApiContent", "redactText", "systemPrompt", "skillBody",
    "SseParser", "readSse", "MessageAccumulator", "parseInput", "createApiClient", "retryWait", "listModels", "createApiEngine", "summarize",
    "Approvals", "buildPayload", "payloadHash", "isDecider", "BudgetLedger", "EgressLog", "AgentSession",
  ]) {
    assert.equal(typeof (agent as Record<string, unknown>)[name], "function", name);
  }
  assert.deepEqual([...agent.API_TOOL_ORDER], ["run", "inspect", "render", "export", "docs"]);
  assert.equal(agent.API_VERSION, "2026-10-21");
  assert.equal("startFakeMessagesApi" in agent, false, "the fake API is test data, not an export");
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

// The placeholder of the stub became this: a turn through the public exports only. The
// behaviour of the turn loop is tested in api-engine.test.ts.
test("Engine A runs a turn against a fake Messages API", async () => {
  const api = await startFakeMessagesApi();
  const root = mkdtempSync(join(tmpdir(), "o3j-agent-index-"));
  try {
    const handlers = createHandlers({ pool: fakePool(), inventory: FAKE_INVENTORY, place: fakePlace, root, interactiveMs: 5_000 });
    const client = agent.createApiClient({ apiKey: ["sk", "ant", "test", "x".repeat(24)].join("-"), baseUrl: api.url, sleep: async () => {} });
    api.reply({ json: { data: [{ id: "model-a", display_name: "Model A", max_tokens: 16000 }], has_more: false } });
    const [model] = await agent.listModels(client);
    const engine = agent.createApiEngine({ client, handlers, project: join(root, "plate.o3j") });
    api.reply(
      streamReply({ content: [{ type: "tool_use", id: "toolu_1", name: "run", input: { script: "return box(10, 10, 2);" } }], stop_reason: "tool_use" }),
      streamReply({ content: [{ type: "text", text: "Made r_0001." }], stop_reason: "end_turn" }),
    );
    const events: AgentEventBody[] = [];
    let revisions = 0;
    const end = await engine.turn({
      turn: "t_0001", text: "Make a plate", model: model!.id, limits: { maxRounds: 4, maxOutputTokens: model!.max_tokens!, timeoutMs: 10_000 },
      ledger: { remaining: () => ({ input: 1_000_000, output: 100_000 }), add: () => {} }, signal: new AbortController().signal,
      emit: (e) => void events.push(e), onRevision: () => void revisions++,
    });
    assert.deepEqual(end, { reason: "end_turn" });
    assert.equal(revisions, 1);
    assert.deepEqual(events.filter((e) => e.kind === "tool_result").map((e) => (e as { rev?: string }).rev), ["r_0001"]);
    await engine.close();
  } finally {
    await api.close();
    rmSync(root, { recursive: true, force: true });
  }
});
