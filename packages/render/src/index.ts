// @open3dj/render: deterministic CPU renders for agents and CI goldens (ARCHITECTURE.md
// section 10). S1 ships the four-view hidden-line drawing (front, top, right, iso) of the
// whole assembly or chosen targets, as PNG and SVG, from occt-wasm's HLR renderer.
//
// Each instance is placed with kernel.place() at its world transform, the instances are
// grouped with kernel.compound(), and the kernel draws the multiview. Same input, same bytes.
//
// Targets are drawn alone, at their world positions. A highlight drawing (targets dark, the
// rest dimmed) is not possible yet: the kernel's HLR renderer draws one style per drawing, so
// each image carries a note saying the rest of the assembly is not shown.
import type { PackageStatus, RenderFormat, RenderView } from "@open3dj/schemas";
import type { KernelAdapter, MultiviewOptions } from "@open3dj/kernel";
import { AssemblyError, resolveTargets } from "@open3dj/assembly";
import type { Assembly, AssemblyInstance } from "@open3dj/assembly";

export const PACKAGE_STATUS: PackageStatus = "ready";

export interface RenderOptions {
  view: RenderView;
  /** Occurrence paths, sub-assembly paths or definition ids. Default: the whole assembly. */
  targets?: string[];
  /** Default both. */
  format?: RenderFormat;
  /** Image size in px. Default 1200 x 900. */
  width?: number;
  height?: number;
}

export interface RenderImage {
  format: "png" | "svg";
  /** Suggested file name, for example multiview.png or multiview-lid-screw_1.png. */
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** What the image leaves out, for example the rest of the assembly when targets are set. */
  note?: string;
}

export const DEFAULT_SIZE = Object.freeze({ width: 1200, height: 900 });

/** Size limits of the render tool's input schema. */
export const SIZE_LIMITS = Object.freeze({ min: 64, max: 4096 });

const VIEWS: NonNullable<MultiviewOptions["views"]> = ["front", "top", "right", "iso"];
const COLUMNS = 2;
/** Height of the kernel's dimension footer under the grid, in px (occt-wasm 5.8.1). */
const FOOTER = 22;

export class RenderError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.hint = hint;
  }
}

/** Render the assembly. Throws RenderError (code UNKNOWN_TARGET) for a target that does not exist. */
export async function renderAssembly(kernel: KernelAdapter, asm: Assembly, options: RenderOptions): Promise<RenderImage[]> {
  if (options.view !== "multiview") throw new RenderError("UNSUPPORTED_VIEW", `view '${String(options.view)}' is not available yet`, "Use view=multiview.");
  const format = options.format ?? "both";
  if (!["png", "svg", "both"].includes(format)) throw new RenderError("BAD_FORMAT", `format '${String(format)}' is not png, svg or both`);
  const width = size("width", options.width ?? DEFAULT_SIZE.width);
  const height = size("height", options.height ?? DEFAULT_SIZE.height);
  const targets = options.targets?.length ? options.targets : undefined;
  const instances = targets ? selectTargets(asm, targets) : asm.instances;
  if (instances.length === 0) throw new RenderError("EMPTY_ASSEMBLY", "the assembly has no occurrences to draw");

  // The kernel lays out panels of a fixed size in a 2 x 2 grid with a footer underneath.
  const panelWidth = Math.floor(width / COLUMNS);
  const panelHeight = Math.floor((height - FOOTER) / Math.ceil(VIEWS.length / COLUMNS));
  const drawing: MultiviewOptions = { views: VIEWS, columns: COLUMNS, width: panelWidth, height: panelHeight, showHidden: true, showLabels: true, showDimensions: true };
  const outWidth = panelWidth * COLUMNS;
  const outHeight = panelHeight * Math.ceil(VIEWS.length / COLUMNS) + FOOTER;
  const stem = targets ? `multiview-${slug(targets)}` : "multiview";
  const note = targets
    ? `Only ${instances.map((i) => i.path).join(", ")} drawn, at world positions; the kernel renderer has one line style, so the rest of the assembly is left out rather than dimmed.`
    : undefined;

  const mark = kernel.checkpoint();
  try {
    const shape = kernel.compound(instances.map((i) => kernel.place(asm.shapes.get(i.def)!, i.world)));
    const images: RenderImage[] = [];
    if (format === "png" || format === "both") {
      const bytes = await kernel.multiviewPng(shape, drawing);
      images.push(withNote({ format: "png", name: `${stem}.png`, bytes, width: outWidth, height: outHeight }, note));
    }
    if (format === "svg" || format === "both") {
      const svg = titled(kernel.multiviewSvg(shape, drawing), asm, instances, targets);
      images.push(withNote({ format: "svg", name: `${stem}.svg`, bytes: new TextEncoder().encode(svg), width: outWidth, height: outHeight }, note));
    }
    return images;
  } finally {
    kernel.releaseSince(mark);
  }
}

function selectTargets(asm: Assembly, targets: string[]): AssemblyInstance[] {
  try {
    return resolveTargets(asm, targets);
  } catch (e) {
    if (e instanceof AssemblyError) throw new RenderError(e.code, e.message, e.hint);
    throw e;
  }
}

function size(name: string, value: number): number {
  if (!Number.isInteger(value) || value < SIZE_LIMITS.min || value > SIZE_LIMITS.max) {
    throw new RenderError("BAD_SIZE", `${name} must be a whole number from ${SIZE_LIMITS.min} to ${SIZE_LIMITS.max} px, got ${value}`);
  }
  return value;
}

/** A file-name-safe summary of the targets, for example lid-screw_1. */
function slug(targets: string[]): string {
  const s = targets.map((t) => t.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")).filter(Boolean).join("-");
  return (s || "targets").slice(0, 60);
}

/** Add a <title> and <desc> after the opening tag, so the SVG says what it shows. */
function titled(svg: string, asm: Assembly, instances: AssemblyInstance[], targets: string[] | undefined): string {
  const end = svg.indexOf(">");
  if (!svg.startsWith("<svg") || end < 0) return svg;
  const what = targets ? instances.map((i) => i.path).join(", ") : `${asm.file.root} (${instances.length} occurrences)`;
  const desc = "Front, top, right and iso hidden-line views; hidden edges dashed; size in mm in the footer.";
  return `${svg.slice(0, end + 1)}<title>${xml(what)}</title><desc>${xml(desc)}</desc>${svg.slice(end + 1)}`;
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function withNote(image: RenderImage, note: string | undefined): RenderImage {
  return note ? { ...image, note } : image;
}
