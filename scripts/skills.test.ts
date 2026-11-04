// skills/: the agent skill and the Claude Code plugin (PLAN.md S1, ARCHITECTURE.md section 17).
// The skill's examples must run clean, the plugin's copy must equal the source, and the
// plugin's .mcp.json must start a server that lists the five tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runJobInline } from "@open3dj/compute";
import { TOOL_DEFINITIONS } from "@open3dj/mcp";
import { ROOT } from "./lib.ts";

const SKILL = join(ROOT, "skills", "open3dj", "SKILL.md");
const PLUGIN = join(ROOT, "skills", "claude-code-plugin");
const text = readFileSync(SKILL, "utf8");

test("the skill has frontmatter, stays under 5k tokens, and names the five tools", () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  assert.match(front, /^name: open3dj$/m);
  const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
  assert.ok(description.length > 40 && description.length <= 1024, `description of ${description.length} characters`);
  // PLAN.md section 4.7: SKILL.md under 5k tokens, at about 4 characters a token.
  assert.ok(text.length / 4 < 5000, `${text.length} characters`);
  for (const name of Object.keys(TOOL_DEFINITIONS)) assert.ok(text.includes(`\`${name}\``), `the skill names the ${name} tool`);
  assert.doesNotMatch(text, /—/, "no em-dashes (AGENTS.md writing style)");
});

test("every example in the skill runs clean", async () => {
  const examples = [...text.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.equal(examples.length, 3);
  for (const script of examples) {
    const r = await runJobInline({ kind: "run", script, rev: "r_0001" });
    assert.ok(r.ok, `${script}\n${JSON.stringify(!r.ok && r.error)}`);
    if (!r.ok) continue;
    assert.equal(r.report.status, "ok", `${script}\n${JSON.stringify(r.report)}`);
    assert.ok(r.report.parts.every((p) => p.valid));
  }
});

test("the plugin carries the same skill, a manifest and an MCP config that starts the server", async () => {
  assert.equal(readFileSync(join(PLUGIN, "skills", "open3dj", "SKILL.md"), "utf8"), text, "copy skills/open3dj/SKILL.md into the plugin");
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.match(String(manifest["name"]), /^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case name");
  assert.equal(manifest["license"], "MIT");
  assert.ok(typeof manifest["description"] === "string" && typeof (manifest["author"] as { name?: unknown })?.name === "string");
  const mcp = JSON.parse(readFileSync(join(PLUGIN, ".mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> };
  const server = mcp.mcpServers["open3dj"]!;
  assert.equal(server.command, "node");
  const args = server.args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN));
  assert.ok(existsSync(args[0]!), `${args[0]} exists`);
  assert.equal(args[1], "mcp");

  const root = mkdtempSync(join(tmpdir(), "o3j-plugin-"));
  const client = new Client({ name: "plugin-check", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args, cwd: root, stderr: "ignore" }));
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, Object.keys(TOOL_DEFINITIONS).sort());
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
