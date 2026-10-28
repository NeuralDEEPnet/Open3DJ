// @open3dj/dsl: DSL v1 (contract C2), a 3dj-compatible modelling surface on the kernel adapter
// and brepjs 20.11.1, exposed to scripts through the sandbox.
//
// Intended implementation (port from docs/research/spikes/dsl-brepjs/src/dsl.mjs, 47/47 conformance):
// - Host side keeps a per-run table guest-id -> ShapeHandle; the guest sees integer ids only.
// - brepjs shares the worker's kernel: B.registerKernel("occt-wasm", B.OcctWasmAdapter.fromKernel(kernel.raw)).
//   Booleans, fillet, chamfer and shell go through the KernelAdapter so isValid runs after each.
// - S1 surface: Param.*, primitives, sketches, batched booleans (fuseAll, cutAll), fillet and
//   chamfer with edge queries, shell, patterns, named descriptor returns, connector.male/female,
//   matchTo, attachTo, withReferences, .color(), .name(), lib.bolt, lib.nut, lib.washer, .cutPlane.
// - Known spike bugs to fix while porting: sketch mirror used the vector as a direction, not
//   the plane normal; shell and chamfer failed on some inputs (now reported as KernelError).
// - Kernel failures become ScriptErrors through the sandbox: throw an Error with code
//   KERNEL_<KernelError.code>, elements and hint.
import { NotImplementedError } from "@open3dj/schemas";
import type { PackageStatus } from "@open3dj/schemas";
import type { KernelAdapter } from "@open3dj/kernel";
import type { Dsl, DslEntry, DslOptions } from "./types.ts";

export type * from "./types.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

/** Thrown for DSL misuse that is not a kernel failure, for example a bad return value. */
export class DslError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "DslError";
    this.code = code;
    this.hint = hint;
  }
}

/** The DSL v1 entries planned for S1, for the docs tool and the conformance checklist. */
export const DSL_ENTRIES: ReadonlyArray<DslEntry> = [];

/**
 * Bind the DSL to a kernel. The kernel must be the full Kernel from initKernel() when brepjs
 * is used (it needs kernel.raw); the parameter is typed as the adapter so tests can pass fakes.
 */
export function createDsl(kernel: KernelAdapter, options?: DslOptions): Dsl {
  void kernel;
  void options;
  throw new NotImplementedError("dsl.createDsl");
}
