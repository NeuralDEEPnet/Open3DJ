// Structured failures inside the handlers. A ToolError never leaves a handler as an
// exception: the handler turns it into status "error" with a ScriptError, so agents get a
// tool result with a code and a hint, never a protocol error.
import { redactPaths as redactAll } from "@open3dj/schemas";
import type { ScriptError } from "@open3dj/schemas";

/**
 * Error codes the daemon itself produces. The pool adds NO_BACKEND, JOB_TIMEOUT,
 * JOB_CANCELLED, JOB_MEMORY, WORKER_CRASHED and POOL_CLOSED; the worker adds SCRIPT_*, DSL_*, KERNEL_*
 * and the assembly and render codes.
 */
export type DaemonErrorCode =
  | "BAD_INPUT"
  | "PROJECT_PATH"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_REQUIRED"
  | "PROJECT_CORRUPT"
  | "PATH_REFUSED"
  | "PROJECT_BUSY"
  | "REV_CONFLICT"
  | "UNKNOWN_REV"
  | "NO_REVISION"
  | "UNKNOWN_TARGET"
  | "OP_NOT_IMPLEMENTED"
  | "JOB_NOT_FOUND"
  | "NO_BACKEND"
  | "JOB_CANCELLED"
  | "INTERNAL_ERROR";

export class ToolError extends Error {
  readonly code: DaemonErrorCode;
  readonly hint: string | undefined;
  constructor(code: DaemonErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.hint = hint;
  }

  toScriptError(): ScriptError {
    const e: ScriptError = { code: this.code, message: this.message };
    if (this.hint) e.hint = this.hint;
    return e;
  }
}

/**
 * Any thrown value as a ScriptError. Unexpected exceptions keep only their message, with
 * absolute paths removed, because tool results go to agents and may be shared.
 */
export function toScriptError(e: unknown): ScriptError {
  if (e instanceof ToolError) return e.toScriptError();
  const err = e as { code?: unknown; message?: unknown; hint?: unknown; syscall?: unknown; errno?: unknown } | undefined;
  const code = typeof err?.code === "string" ? err.code : "";
  if (/^E[A-Z0-9]+$/.test(code) && (typeof err?.syscall === "string" || typeof err?.errno === "number")) return fsError(err as { code: string });
  if (code in COMPUTE_HINTS) {
    const out: ScriptError = { code, message: redactPaths(String(err?.message ?? code)) };
    out.hint = typeof err?.hint === "string" ? err.hint : COMPUTE_HINTS[code]!;
    return out;
  }
  const out: ScriptError = { code: "INTERNAL_ERROR", message: redactPaths(String(err?.message ?? e)) };
  out.hint = "This is a bug in Open3DJ, not in the script. Run the same call again; if it repeats, report it with the script.";
  return out;
}

const COMPUTE_HINTS: Record<string, string> = {
  NO_BACKEND: "Use compute: \"auto\" or \"cpu\". GPU and cloud backends arrive in later steps.",
  JOB_TIMEOUT: "The job ran past its wall-clock limit. Simplify the script (fewer booleans or fillets per call) or split it into parts.",
  JOB_MEMORY: "The job needed more kernel memory than a worker may use. Make the part smaller or simpler, or split it into parts.",
  WORKER_CRASHED: "The worker restarted. Run the call again; if it repeats, the script hits a kernel bug, so simplify the failing operation.",
  POOL_CLOSED: "The daemon is shutting down. Start it again.",
  JOB_CANCELLED: "The job was cancelled; nothing was changed.",
};

/** Replace absolute paths in a message with their last segment (also paths with spaces). */
export function redactPaths(message: string): string {
  return redactAll(message, (last) => `…/${last}`).slice(0, 2000);
}

/** File system failures that mean the project path itself is wrong, not that Open3DJ broke. */
const PATH_ERRNOS: Record<string, string> = {
  ENOTDIR: "a part of the path is a file, not a folder",
  EISDIR: "the path is a folder where a file was expected",
  ENOENT: "a folder on the path does not exist",
  ENAMETOOLONG: "the path is too long",
  ELOOP: "the path has too many symbolic links",
  EEXIST: "something already exists at the path",
  EACCES: "permission denied",
  EPERM: "operation not permitted",
};

/**
 * A Node fs error as a ScriptError that names only the code, the system call and the last
 * path segment. Its message would carry the absolute path, which can hold a user name.
 */
function fsError(err: { code: string; syscall?: unknown; path?: unknown }): ScriptError {
  const what = typeof err.syscall === "string" ? ` (${err.syscall.replace(/[^a-z]/gi, "").slice(0, 20)})` : "";
  const name = typeof err.path === "string" ? ` on '${err.path.split(/[\\/]/).filter((x) => x !== "").pop() ?? ""}'` : "";
  const known = PATH_ERRNOS[err.code];
  if (known) {
    return { code: "PROJECT_PATH", message: `${err.code}: ${known}${what}${name}`, hint: "Use a project path inside the folder the server runs in, for example my-part.o3j, and check that no file has the name of a folder on that path." };
  }
  return { code: "INTERNAL_ERROR", message: `${err.code}: a file system call failed${what}${name}`, hint: "Check the disk (free space, permissions) and run the call again; if it repeats, report it." };
}
