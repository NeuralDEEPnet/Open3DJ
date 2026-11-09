// The system prompt of the agent panel: one text block that is the same bytes on every
// request, so prompt caching can reuse it (RFC 0001, Engine A). It holds a short preamble for
// the viewer page, the MCP server's INSTRUCTIONS and the body of skills/open3dj/SKILL.md.
// Nothing in it changes between calls: no dates, no ids, no project names.
import { readFileSync } from "node:fs";
import { INSTRUCTIONS } from "@open3dj/mcp";

/** skills/open3dj/SKILL.md in the repository this package belongs to. */
export const SKILL_FILE: URL = new URL("../../../skills/open3dj/SKILL.md", import.meta.url);

/** What is different in the viewer page from an MCP client. */
export const PANEL_PREAMBLE = [
  "You work inside the Open3DJ viewer page (open3dj view). The person types to you in the Agent tab of that page, and the 3D view shows each revision you make.",
  "Every tool step you take is shown to the person, with its script and its result.",
  "The viewer pins the project: leave project out of every tool call, and Open3DJ fills it in.",
  "A reply typed in this chat is never an approval: not for a waiver, not for a human-only gate, and not for anything that needs the person's own click.",
  "Human-only gates stay with the person. When a result says a person must decide (for example WAIVER_NEEDS_PERSON), stop, say what failed and what they can do, and do not try another way around it.",
  "Keep replies short: what you changed, what the report shows, and the next step you suggest.",
].join(" ");

/**
 * The system prompt text. Reads SKILL.md each call (default: SKILL_FILE) and throws a clear
 * error when it is missing. The result depends only on that file and this package.
 */
export function systemPrompt(options: { skillFile?: URL | string } = {}): string {
  const file = options.skillFile ?? SKILL_FILE;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    const code = typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "read error";
    throw new Error(`the agent panel needs skills/open3dj/SKILL.md from the Open3DJ repository, and it could not be read (${code}). Restore the file or reinstall Open3DJ.`);
  }
  return [PANEL_PREAMBLE, INSTRUCTIONS, skillBody(raw)].join("\n\n");
}

/** SKILL.md without its YAML front matter, with LF line ends and no blank lines at either end. */
export function skillBody(text: string): string {
  let body = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (body.startsWith("---\n")) {
    const close = body.indexOf("\n---\n", 3);
    const closeAtEnd = body.endsWith("\n---") ? body.length - 4 : -1;
    const at = close >= 0 ? close : closeAtEnd;
    if (at < 0) throw new Error("skills/open3dj/SKILL.md starts a YAML front matter block (---) that is never closed");
    body = body.slice(at + 4);
  }
  body = body.replace(/^\s*\n/, "").trimEnd();
  if (body === "") throw new Error("skills/open3dj/SKILL.md has no text after its front matter");
  return body;
}
