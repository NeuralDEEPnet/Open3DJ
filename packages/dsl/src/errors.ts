// DSL errors and the conversion of kernel failures into the sandbox's error convention:
// a host function throws an Error with a string code, optional elements and hint, and the
// sandbox turns it into a ScriptError at the user's line.
import { KernelError } from "@open3dj/kernel";

/** Thrown for DSL misuse that is not a kernel failure, for example a bad argument or return value. */
export class DslError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly op: string | undefined;
  readonly elements: string[] | undefined;
  constructor(code: string, message: string, hint?: string, detail: { op?: string; elements?: string[] } = {}) {
    super(message);
    this.name = "DslError";
    this.code = code;
    this.hint = hint;
    this.op = detail.op;
    this.elements = detail.elements;
  }
}

export const badArgument = (message: string, hint?: string) => new DslError("DSL_BAD_ARGUMENT", message, hint);
export const notImplemented = (entry: string) =>
  new DslError("DSL_NOT_IMPLEMENTED", `${entry} is not implemented in Open3DJ DSL v1 yet`, "Build the same shape from the implemented entries, or ask for this entry in an issue.");

/** Hints for kernel failures as the DSL user sees them (the kernel's hints name kernel terms). */
const HINTS: Partial<Record<string, string>> = {
  SHELL_FAILED: "shell failed: try a smaller thickness, or shell before adding fillets (keep corner radii larger than the wall). The fallback for straight extrusions needs the extrusion upright (only moved or turned about Z): shell before rotating it any other way.",
  FILLET_FAILED: "fillet failed: try a smaller radius, or fillet fewer edges at once (narrow the edge query).",
  CHAMFER_FAILED: "chamfer failed: try a smaller size, or chamfer fewer edges at once (narrow the edge query).",
  BOOLEAN_FAILED: "the boolean failed: make tools overlap the body clearly and avoid coincident faces (offset by 0.01 mm).",
  NOT_A_SOLID: "this feature needs one solid: union the bodies first, or apply it to each body.",
};

/** The error a host function throws for a kernel failure: code KERNEL_<code>. */
export function fromKernelError(e: KernelError, op?: string): DslError {
  const hint = e.code === "INVALID_RESULT" && e.op === "shell" ? HINTS["SHELL_FAILED"] : HINTS[e.code] ?? e.hint;
  return new DslError(`KERNEL_${e.code}`, e.message, hint, { op: op ?? e.op, elements: e.elements });
}

/** Run fn and convert kernel failures; DslErrors and everything else pass through. */
export function guard<T>(op: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KernelError) throw fromKernelError(e, op);
    if (e instanceof RangeError) throw new DslError("DSL_BAD_ARGUMENT", `${op}: ${e.message}`, docsHint(op));
    // A bad argument without its own hint points at the entry's docs.
    if (e instanceof DslError && e.code === "DSL_BAD_ARGUMENT" && e.hint === undefined) {
      const detail: { op?: string; elements?: string[] } = { op: e.op ?? op };
      if (e.elements) detail.elements = e.elements;
      throw new DslError(e.code, e.message, docsHint(op), detail);
    }
    throw e;
  }
}

function docsHint(op: string): string {
  return `Check the arguments of ${op}: docs {query: "${op}"} gives its signature and an example. Sizes are positive millimetres, angles are degrees.`;
}
