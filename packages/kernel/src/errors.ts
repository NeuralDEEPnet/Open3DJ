// KernelError: the one error type the kernel adapter throws. It carries a stable code,
// the operation, and the faulty elements as addresses (edge:7, face:3) so the DSL can
// turn it into a ScriptError an agent can act on.
import { OcctError } from "occt-wasm";

export type KernelErrorCode =
  | "CONSTRUCTION_FAILED"
  | "BOOLEAN_FAILED"
  | "FILLET_FAILED"
  | "CHAMFER_FAILED"
  | "SHELL_FAILED"
  | "INVALID_RESULT"
  | "NOT_A_SOLID"
  | "BAD_ARGUMENT"
  | "INVALID_HANDLE"
  | "TESSELLATION_FAILED"
  | "IO_FAILED"
  | "HEALING_FAILED"
  | "KERNEL_ABORT"
  | "UNKNOWN";

export interface KernelErrorDetail {
  /** Faulty sub-shapes as element addresses, for example edge:7 or face:3 (1-based). */
  elements?: string[];
  /** A suggested fix in one sentence. */
  hint?: string;
  cause?: unknown;
}

export class KernelError extends Error {
  readonly code: KernelErrorCode;
  readonly op: string;
  readonly elements: string[];
  readonly hint: string | undefined;
  /**
   * True when the WebAssembly instance may be corrupt (abort, out of bounds, out of
   * memory). The worker that owns this kernel must be recycled before the next job.
   */
  readonly fatal: boolean;

  constructor(code: KernelErrorCode, op: string, message: string, detail: KernelErrorDetail = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = "KernelError";
    this.code = code;
    this.op = op;
    this.elements = detail.elements ?? [];
    this.hint = detail.hint;
    this.fatal = code === "KERNEL_ABORT";
  }
}

const OP_CODES: Record<string, KernelErrorCode> = {
  fillet: "FILLET_FAILED",
  chamfer: "CHAMFER_FAILED",
  shell: "SHELL_FAILED",
};

const OCCT_CODES: Record<string, KernelErrorCode> = {
  CONSTRUCTION_FAILED: "CONSTRUCTION_FAILED",
  BOOLEAN_FAILED: "BOOLEAN_FAILED",
  INVALID_SHAPE_ID: "INVALID_HANDLE",
  INVALID_LABEL_ID: "INVALID_HANDLE",
  TESSELLATION_FAILED: "TESSELLATION_FAILED",
  IMPORT_EXPORT_FAILED: "IO_FAILED",
  HEALING_FAILED: "HEALING_FAILED",
  DOCUMENT_CLOSED: "INVALID_HANDLE",
  KERNEL_ERROR: "CONSTRUCTION_FAILED",
  UNKNOWN: "UNKNOWN",
};

/** True for failures that may leave the WebAssembly instance in a bad state. */
export function isFatalWasmError(e: unknown): boolean {
  if (e instanceof WebAssembly.RuntimeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Aborted\(|unreachable|memory access out of bounds|out of memory|Cannot enlarge memory/i.test(msg);
}

/**
 * Convert anything the kernel threw into a KernelError. faultyEdge maps an edge handle
 * reported by OCCT to its element address; the caller supplies it because only the caller
 * knows which solid the edges belong to.
 */
export function toKernelError(op: string, e: unknown, faultyEdge?: (handle: number) => string | undefined): KernelError {
  if (e instanceof KernelError) return e;
  if (isFatalWasmError(e)) {
    return new KernelError("KERNEL_ABORT", op, `${op}: the kernel aborted (${messageOf(e)}); the worker will restart`, { cause: e });
  }
  if (e instanceof OcctError) {
    const elements = (e.faultyEdges ?? []).map((h) => faultyEdge?.(h)).filter((x): x is string => x !== undefined);
    const code = OP_CODES[op] ?? OCCT_CODES[e.code] ?? "UNKNOWN";
    return new KernelError(code, op, `${op} failed: ${cleanMessage(e.message)}`, { elements, cause: e, hint: hintFor(code) });
  }
  return new KernelError(OP_CODES[op] ?? "UNKNOWN", op, `${op} failed: ${cleanMessage(messageOf(e))}`, { cause: e, hint: hintFor(OP_CODES[op]) });
}

function hintFor(code: KernelErrorCode | undefined): string | undefined {
  switch (code) {
    case "FILLET_FAILED": return "Use a smaller radius, or fillet fewer edges at once (the radius must fit the adjacent faces).";
    case "CHAMFER_FAILED": return "Use a smaller distance, or chamfer fewer edges at once.";
    case "SHELL_FAILED": return "Use a thinner wall, or shell before adding fillets that are smaller than the wall.";
    case "BOOLEAN_FAILED": return "Check that the tools overlap the base by more than a hair; avoid coincident faces by offsetting 0.01 mm.";
    default: return undefined;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The facade appends " [faulty edges: 3,7]" with arena ids; the addresses replace it.
function cleanMessage(m: string): string {
  return m.replace(/\s*\[faulty edges: [\d,]+\]/, "").trim();
}
