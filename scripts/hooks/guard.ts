// Claude Code PreToolUse hook (.claude/settings.json): blocks edits to golden files
// (examples/*/expected.json), tolerance changes in bench/tasks/*/task.json, changes to the
// licence allowlist in scripts/license-gate.ts, and secrets, unless the operator started
// Claude Code with OPEN3DJ_ALLOW_PROTECTED naming the category. Exit 2 blocks the tool call
// and shows the reason to the agent; exit 0 lets it through. Rules: scripts/hooks/lib.ts.
import { readFileSync } from "node:fs";
import { blockMessage, guard } from "./lib.ts";
import type { ToolCall } from "./lib.ts";

let call: ToolCall;
try {
  call = JSON.parse(readFileSync(0, "utf8")) as ToolCall;
} catch {
  process.exit(0); // not a hook payload: nothing to check
}
const root = process.env.CLAUDE_PROJECT_DIR || call.cwd || process.cwd();
const blocks = guard(call, root, process.env);
if (blocks.length > 0) {
  process.stderr.write(`${blockMessage(blocks)}\n`);
  process.exit(2);
}
process.exit(0);
