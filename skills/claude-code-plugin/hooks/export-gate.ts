// The export-gate hook of the Claude Code plugin (PLAN.md S3). Claude Code runs it after every
// call of this plugin's export tool (PostToolUse, matcher in hooks.json). Every export result
// carries the fdm.v1 gate status of the exported parts; when a failure is open or the check
// did not run, the hook adds that to Claude's context next to the result. It blocks nothing:
// the files are written, and the server does not refuse exports in S3.
//
// Claude Code does not document the shape of tool_response for MCP tools (hooks reference,
// read 2026-11-04), so the result is looked for in the object itself, in structuredContent,
// and in JSON text content. No dependencies: this file runs with plain Node 24.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Gates {
  profile?: unknown;
  status?: unknown;
  open?: unknown;
  waived?: unknown;
  error?: { code?: unknown; message?: unknown };
}

/** The export result inside tool_response: an object with gates, found at most a few levels down. */
function findExport(v: unknown, depth = 0): { rev?: unknown; gates: Gates } | undefined {
  if (depth > 4) return undefined;
  if (typeof v === "string") {
    try {
      return findExport(JSON.parse(v) as unknown, depth + 1);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findExport(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o["gates"] && typeof o["gates"] === "object" && typeof (o["gates"] as Gates).status === "string") return { rev: o["rev"], gates: o["gates"] as Gates };
  return findExport(o["structuredContent"], depth + 1) ?? findExport(o["content"], depth + 1) ?? (o["type"] === "text" ? findExport(o["text"], depth + 1) : undefined);
}

/** value when it matches pattern (a whole string), else undefined. */
const shaped = (value: unknown, pattern: RegExp): string | undefined => (typeof value === "string" && pattern.test(value) ? value : undefined);
/** A count, or undefined when it is not a whole number from 0 to 1e9. */
const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1e9 ? value : undefined);

/**
 * The text for Claude's context, or undefined when the exported parts pass their gates. Only
 * fields of a known shape get through: the error message, for one, can quote a cloned
 * project's files (an unknown key in waivers.o3j.json), and those are untrusted data. The
 * export result itself, which Claude also sees, keeps the full message.
 */
export function exportGateContext(input: unknown): string | undefined {
  const found = findExport((input as { tool_response?: unknown } | undefined)?.tool_response);
  if (!found) return undefined;
  const { gates } = found;
  const rev = shaped(found.rev, /^r_[0-9a-z]{1,32}$/) ?? "the exported revision";
  const profile = shaped(gates.profile, /^[a-z][a-z0-9]{0,15}\.v[0-9]{1,3}$/) ?? "fdm.v1";
  if (gates.status === "unchecked") {
    const code = shaped(gates.error?.code, /^[A-Z][A-Z0-9_]{0,63}$/);
    const why = code ? ` (${code}; the export result has the details)` : "";
    return `Open3DJ export gate: the ${profile} gate check of ${rev} did not run${why}. These files are not print-checked; inspect fields=[gates] runs the check again.`;
  }
  if (gates.status !== "fail") return undefined;
  const open = count(gates.open);
  const waived = count(gates.waived);
  return `Open3DJ export gate: ${rev} has ${open ?? "some"} open ${profile} gate failure${open === 1 ? "" : "s"} and ${waived ?? "some"} waived; the evidence sidecar lists them. These files are not print-checked until each open failure is fixed, waived by the agent with a reason (min_wall, overhang), or approved by a person (watertight, bed; approvals arrive in S5).`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, "utf8")) as unknown;
  } catch {
    input = undefined;
  }
  const context = exportGateContext(input);
  if (context) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } })}\n`);
}
