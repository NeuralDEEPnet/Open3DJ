// Placement for S1 (COMPUTE.md section 3.3, rule 1 only): every S1 job kind runs on
// cpu.wasm. "gpu" and "cloud" are explicit requests that cannot be met yet, so they get a
// structured NO_BACKEND error instead of a silent fallback.
import type { ComputeBlock, ComputeMode, DeviceInventory } from "@open3dj/schemas";
import type { ComputeErrorShape, JobKind } from "./types.ts";

export class ComputeError extends Error implements ComputeErrorShape {
  readonly code: ComputeErrorShape["code"];
  readonly hint: string | undefined;
  constructor(code: ComputeErrorShape["code"], message: string, hint?: string) {
    super(message);
    this.name = "ComputeError";
    this.code = code;
    this.hint = hint;
  }
}

/** Used when a job reaches a runner without a placement (runJobInline, direct tests). */
export const INLINE_COMPUTE: ComputeBlock = Object.freeze({
  backend: "cpu.wasm",
  device: "cpu x1",
  placement_reason: "inline: one kernel in the calling thread",
}) as ComputeBlock;

const KINDS: readonly JobKind[] = ["run", "render", "export"];

/** The device string of the CPU backend, for example "cpu x3" for three workers. */
export function cpuDevice(inventory: DeviceInventory): string {
  return `cpu x${inventory.pool?.workers ?? Math.max(1, inventory.cpu.cores - 1)}`;
}

/** Decide where a job runs and why. Throws ComputeError NO_BACKEND for gpu or cloud in S1. */
export function place(mode: ComputeMode, kind: JobKind, inventory: DeviceInventory): ComputeBlock {
  if (!KINDS.includes(kind)) throw new RangeError(`unknown job kind '${String(kind)}'`);
  switch (mode) {
    case "auto":
      return { backend: "cpu.wasm", device: cpuDevice(inventory), placement_reason: `auto: ${kind} runs only on cpu.wasm (the B-rep kernel has no GPU path)` };
    case "cpu":
      return { backend: "cpu.wasm", device: cpuDevice(inventory), placement_reason: "cpu: requested" };
    case "gpu":
      throw new ComputeError(
        "NO_BACKEND",
        `compute "gpu" cannot run ${kind}: no GPU backend is available (GPU discovery and GPU job kinds arrive in a later step)`,
        `Use compute "auto" or "cpu"; ${kind} runs on cpu.wasm.`,
      );
    case "cloud":
      throw new ComputeError(
        "NO_BACKEND",
        `compute "cloud" cannot run ${kind}: no cloud provider is configured (cloud providers arrive in a later step)`,
        `Use compute "auto" or "cpu"; ${kind} runs on cpu.wasm.`,
      );
    default:
      throw new RangeError(`unknown compute mode '${String(mode)}'`);
  }
}
