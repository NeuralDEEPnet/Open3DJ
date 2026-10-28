// @open3dj/render: deterministic CPU renders for agents and CI goldens (ARCHITECTURE.md
// section 10). S1 ships the four-view hidden-line drawing (front, top, right, iso) of the
// whole assembly or chosen targets, as PNG and SVG, from occt-wasm's HLR renderer.
//
// Intended implementation: place each target instance with kernel.place(), group them with
// kernel.compound(), then kernel.multiviewPng/multiviewSvg with showDimensions. Same input,
// same bytes: the spike measured byte-identical PNGs across processes (135 ms for 4 views).
import { NotImplementedError } from "@open3dj/schemas";
import type { PackageStatus, RenderFormat, RenderView } from "@open3dj/schemas";
import type { KernelAdapter } from "@open3dj/kernel";
import type { Assembly } from "@open3dj/assembly";

export const PACKAGE_STATUS: PackageStatus = "stub";

export interface RenderOptions {
  view: RenderView;
  /** Occurrence paths or definition ids. Default: the whole assembly. */
  targets?: string[];
  /** Default both. */
  format?: RenderFormat;
  /** Image size in px. Default 1200 x 900. */
  width?: number;
  height?: number;
}

export interface RenderImage {
  format: "png" | "svg";
  /** Suggested file name, for example multiview.png. */
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export const DEFAULT_SIZE = Object.freeze({ width: 1200, height: 900 });

/** Render the assembly. Throws RenderError (code UNKNOWN_TARGET) for a target that does not exist. */
export async function renderAssembly(kernel: KernelAdapter, asm: Assembly, options: RenderOptions): Promise<RenderImage[]> {
  void kernel; void asm; void options;
  throw new NotImplementedError("render.renderAssembly");
}

export class RenderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}
