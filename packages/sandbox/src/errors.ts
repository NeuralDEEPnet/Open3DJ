// Turning whatever ended a run into a ScriptError with the user's line and column.
import type { ScriptError } from "@open3dj/schemas";
import { WRAP_LINE_OFFSET } from "./guest.ts";

/** Longest message we copy out of the guest (the spike saw 1 MB error messages). */
export const MAX_MESSAGE = 2000;

const CODE = /^[A-Z][A-Z0-9_]*$/;

/** A failure raised on the host side that the guest must not be able to swallow. */
export class StickyFault extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "StickyFault";
    this.code = code;
    this.hint = hint;
  }
}

export interface Site {
  line: number;
  column?: number;
}

/**
 * Find the first stack frame in the user's file. QuickJS frames look like
 * "    at main (part.o3j.js:3:7)" or, for syntax errors, "    at part.o3j.js:4:1".
 */
export function userSite(stack: unknown, filename: string): Site | undefined {
  if (typeof stack !== "string") return undefined;
  for (const raw of stack.split("\n")) {
    const frame = raw.trim();
    const at = frame.lastIndexOf(`${filename}:`);
    if (at < 0) continue;
    const m = /^(\d+)(?::(\d+))?/.exec(frame.slice(at + filename.length + 1));
    if (!m) continue;
    const line = Number(m[1]) - WRAP_LINE_OFFSET;
    if (line < 1) continue;
    const site: Site = { line };
    if (m[2] !== undefined) site.column = Math.max(1, Number(m[2]));
    return site;
  }
  return undefined;
}

export function cap(text: unknown, max = MAX_MESSAGE): string {
  const s = typeof text === "string" ? text : String(text);
  return s.length > max ? `${s.slice(0, max)}... (${s.length} chars)` : s;
}

/** What we could read from a thrown guest value (already dumped to host data). */
export interface DumpedError {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  lineNumber?: unknown;
  code?: unknown;
  op?: unknown;
  elements?: unknown;
  hint?: unknown;
}

/** Classify a guest exception. interrupted/cancelled come from the host's interrupt handler. */
export function scriptErrorFromGuest(dumped: unknown, filename: string, state: { interrupted: boolean; cancelled: boolean; lines: number }): ScriptError {
  const e: DumpedError = typeof dumped === "object" && dumped !== null ? (dumped as DumpedError) : { message: dumped };
  const name = typeof e.name === "string" ? e.name : "";
  const message = cap(e.message ?? "");
  let code: string;
  if (typeof e.code === "string" && CODE.test(e.code)) code = e.code;
  // Once the interrupt handler fired, the run ended because of it, whatever was thrown last
  // (a getter on a thrown object can be the code that got interrupted).
  else if (state.cancelled) code = "SCRIPT_CANCELLED";
  else if (state.interrupted) code = "SCRIPT_TIMEOUT";
  else if (/out of memory/i.test(message)) code = "SCRIPT_MEMORY";
  else if (/stack overflow|call stack size/i.test(message)) code = "SCRIPT_STACK";
  else if (name === "SyntaxError") code = "SCRIPT_SYNTAX";
  else code = "SCRIPT_RUNTIME";

  const out: ScriptError = { code, message: describe(name, message, code) };
  const site = userSite(e.stack, filename) ?? lineOnly(e.lineNumber);
  if (site) {
    // A syntax error at the end of input is reported on the wrapper's closing line.
    out.line = Math.min(site.line, Math.max(1, state.lines));
    if (site.column !== undefined) out.column = site.column;
  }
  if (typeof e.op === "string") out.op = cap(e.op, 100);
  if (Array.isArray(e.elements)) out.elements = e.elements.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 50).map((x) => cap(x, 100));
  if (typeof e.hint === "string" && e.hint.length > 0) out.hint = cap(e.hint, 500);
  else if (code === "SCRIPT_TIMEOUT") out.hint = "The script ran past its time limit. Look for an endless loop, or build fewer shapes.";
  else if (code === "SCRIPT_MEMORY") out.hint = "The script ran out of memory. Avoid huge arrays and strings.";
  else if (code === "SCRIPT_STACK") out.hint = "The script recursed too deeply. Use a loop instead of recursion.";
  return out;
}

function lineOnly(lineNumber: unknown): Site | undefined {
  if (typeof lineNumber !== "number" || !Number.isInteger(lineNumber)) return undefined;
  const line = lineNumber - WRAP_LINE_OFFSET;
  return line >= 1 ? { line } : undefined;
}

function describe(name: string, message: string, code: string): string {
  if (code === "SCRIPT_TIMEOUT") return "The script was interrupted: it ran past its CPU time limit";
  if (code === "SCRIPT_CANCELLED") return "The script was cancelled";
  const text = message.length > 0 ? message : "(no message)";
  return name && name !== "Error" && !code.startsWith("KERNEL_") && !code.startsWith("DSL_") ? `${name}: ${text}` : text;
}

/** An error the sandbox raises itself, without a guest location. */
export function hostError(code: string, message: string, hint?: string): ScriptError {
  const e: ScriptError = { code, message: cap(message) };
  if (hint) e.hint = hint;
  return e;
}
