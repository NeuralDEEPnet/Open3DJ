// Pure logic of the Claude Code hooks in .claude/settings.json (PLAN.md section 4.7: hooks,
// not prose, for zero-exception rules). guard.ts (PreToolUse) and stop-check.ts (Stop) are
// thin wrappers around these functions, so the rules are unit tested in hooks.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Protected categories; the operator acknowledges one with OPEN3DJ_ALLOW_PROTECTED. */
export type Category = "goldens" | "tolerances" | "licences" | "secrets";
export const ACK_ENV = "OPEN3DJ_ALLOW_PROTECTED";

export interface ToolCall {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
    edits?: Array<{ old_string?: string; new_string?: string; replace_all?: boolean }>;
    command?: string;
  };
  cwd?: string;
}

export interface Block {
  category: Category;
  file: string;
  reason: string;
}

/** Categories the operator acknowledged, from OPEN3DJ_ALLOW_PROTECTED=goldens,tolerances (or all). */
export function acknowledged(env: Record<string, string | undefined>): Set<Category> {
  const raw = (env[ACK_ENV] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const all: Category[] = ["goldens", "tolerances", "licences", "secrets"];
  return new Set(raw.includes("all") ? all : all.filter((c) => raw.includes(c) || (c === "licences" && raw.includes("licenses"))));
}

/** Repo-relative path with forward slashes, or undefined when the file is outside the repo. */
export function repoPath(root: string, file: string): string | undefined {
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const r = relative(root, abs);
  if (r === "" || r.startsWith("..") || isAbsolute(r)) return undefined;
  return r.split(sep).join("/");
}

const GOLDEN = /^examples\/[^/]+\/expected\.json$/;
const TASK = /^bench\/tasks\/[^/]+\/task\.json$/;
const LICENCE_GATE = "scripts/license-gate.ts";

/** Every "tol": {...} object in a task.json text, in order. Comparing these lists finds any tolerance change. */
export function tolerances(text: string): string[] {
  return [...text.matchAll(/"tol"\s*:\s*\{[^}]*\}/g)].map((m) => m[0].replace(/\s+/g, ""));
}

/** The allowlist parts of scripts/license-gate.ts: the ALLOWED set and the LGPL exceptions. */
export function allowlist(text: string): string[] {
  const parts = [/const ALLOWED\s*=\s*new Set\(\[[^\]]*\]\)/, /const LGPL_WASM_EXCEPTIONS[^=]*=\s*\{[^}]*\}/];
  return parts.map((re) => (text.match(re)?.[0] ?? "<missing>").replace(/\s+/g, ""));
}

/** Patterns of real credentials. Test fixtures that need one go in with OPEN3DJ_ALLOW_PROTECTED=secrets. */
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
];

export function secretIn(text: string): string | undefined {
  return SECRET_PATTERNS.find(([, re]) => re.test(text))?.[0];
}

/** The file text after an Edit, MultiEdit or Write, given its text before (undefined: new file). */
export function textAfter(call: ToolCall, before: string | undefined): string | undefined {
  const input = call.tool_input ?? {};
  if (call.tool_name === "Write") return input.content ?? "";
  const edits = call.tool_name === "MultiEdit" ? input.edits ?? [] : [input];
  let text = before ?? "";
  for (const e of edits) {
    if (e.old_string === undefined || e.new_string === undefined) return undefined;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string!);
  }
  return text;
}

/** The text a call adds: new_string(s) or the whole content. Secrets are looked for here. */
function addedText(call: ToolCall): string {
  const input = call.tool_input ?? {};
  if (call.tool_name === "Write") return input.content ?? "";
  if (call.tool_name === "MultiEdit") return (input.edits ?? []).map((e) => e.new_string ?? "").join("\n");
  return input.new_string ?? "";
}

const READ = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);

/** Checks for Edit, MultiEdit and Write. */
export function checkFileEdit(call: ToolCall, root: string, read: (abs: string) => string | undefined = READ): Block[] {
  const file = call.tool_input?.file_path;
  if (!file) return [];
  const abs = isAbsolute(file) ? file : resolve(root, file);
  const rel = repoPath(root, abs);
  const blocks: Block[] = [];
  const base = abs.split(/[\\/]/).pop() ?? "";
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
    blocks.push({ category: "secrets", file: rel ?? file, reason: "writes a .env file; secrets never go into the repository or its folder" });
  }
  const secret = secretIn(addedText(call));
  if (secret) blocks.push({ category: "secrets", file: rel ?? file, reason: `the new text contains what looks like ${secret}` });
  if (!rel) return blocks;

  if (GOLDEN.test(rel)) {
    blocks.push({ category: "goldens", file: rel, reason: "examples/*/expected.json is a golden file; regenerate it with node scripts/examples.ts --write and explain the change" });
  } else if (TASK.test(rel)) {
    const before = read(abs);
    if (before !== undefined) {
      const after = textAfter(call, before);
      if (after === undefined || JSON.stringify(tolerances(before)) !== JSON.stringify(tolerances(after))) {
        blocks.push({ category: "tolerances", file: rel, reason: "the change adds, removes or alters a tol in a bench task; tolerances only change on purpose, with the reason in the pull request" });
      }
    }
  } else if (rel === LICENCE_GATE) {
    const before = read(abs);
    const after = textAfter(call, before);
    if (before === undefined || after === undefined || JSON.stringify(allowlist(before)) !== JSON.stringify(allowlist(after))) {
      blocks.push({ category: "licences", file: rel, reason: "the change touches the licence allowlist (ALLOWED or LGPL_WASM_EXCEPTIONS); a new licence needs an accepted issue" });
    }
  }
  return blocks;
}

/**
 * Best-effort checks for Bash: regenerating the goldens, and shell writes (redirects, tee,
 * sed -i, cp, mv, rm and similar) that name an existing protected file. A determined script
 * can get around this; review and the gates in npm run check stay the real line.
 */
export function checkBash(command: string, root: string, exists: (abs: string) => boolean = existsSync): Block[] {
  const blocks: Block[] = [];
  if (/examples\.ts\b[^;&|]*--write/.test(command)) {
    blocks.push({ category: "goldens", file: "examples/*/expected.json", reason: "node scripts/examples.ts --write rewrites every golden file" });
  }
  const writes = /(^|[^>&0-9=-])>>?(?!&)|\btee\b|\bsed\s+(-[a-zA-Z]*\s+)*-i|\bperl\s+-[a-zA-Z]*i|\b(cp|mv|rm|truncate|dd|install)\b/.test(command);
  if (!writes) return blocks;
  for (const m of command.matchAll(/[A-Za-z0-9_./\\-]*(?:examples[\\/][A-Za-z0-9_.-]+[\\/]expected\.json|bench[\\/]tasks[\\/][A-Za-z0-9_.-]+[\\/]task\.json|scripts[\\/]license-gate\.ts)/g)) {
    const rel = repoPath(root, resolve(root, m[0]));
    if (!rel || !exists(resolve(root, rel))) continue;
    const category: Category = GOLDEN.test(rel) ? "goldens" : TASK.test(rel) ? "tolerances" : "licences";
    blocks.push({ category, file: rel, reason: "a shell command writes a protected file; use the Edit tool so the change can be checked" });
  }
  return blocks;
}

/** Blocks for one PreToolUse call, minus the categories the operator acknowledged. */
export function guard(call: ToolCall, root: string, env: Record<string, string | undefined>): Block[] {
  const ack = acknowledged(env);
  const blocks = call.tool_name === "Bash"
    ? checkBash(call.tool_input?.command ?? "", root)
    : ["Edit", "MultiEdit", "Write"].includes(call.tool_name ?? "") ? checkFileEdit(call, root) : [];
  return blocks.filter((b) => !ack.has(b.category));
}

export function blockMessage(blocks: Block[]): string {
  const cats = [...new Set(blocks.map((b) => b.category))].join(",");
  return [
    "Blocked by the Open3DJ protected-files hook (AGENTS.md, Claude Code hooks):",
    ...blocks.map((b) => `- ${b.file}: ${b.reason}.`),
    `If this change is intentional, stop and tell your operator why. Only the operator can allow it, by starting Claude Code with ${ACK_ENV}=${cats}; then explain the change in the pull request.`,
  ].join("\n");
}

// ---- Stop hook ----------------------------------------------------------------------------

/** Files whose change means npm run check must run again. Docs and other text do not count. */
export function isSource(rel: string): boolean {
  if (["package.json", "package-lock.json", "tsconfig.json", ".nvmrc"].includes(rel)) return true;
  return /^(packages|scripts|bench|corpora|examples)\//.test(rel) && /\.(ts|js|mjs|cjs|json)$/.test(rel) && !/\.o3j\//.test(rel);
}
