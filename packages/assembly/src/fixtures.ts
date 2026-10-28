// Test geometry: the enclosure from docs/research/spike-assemblies.md (base, lid and four
// shared M3-like screws). Used by the assembly and render tests.
import type { KernelAdapter } from "@open3dj/kernel";
import type { ScriptPart, ScriptReturn } from "@open3dj/dsl";
import type { Transform } from "@open3dj/schemas";

export const W = 80;
export const D = 60;
export const H = 30;
export const WALL = 2.4;
export const HOLES: Array<[number, number]> = [[6, 6], [W - 6, 6], [6, D - 6], [W - 6, D - 6]];
/** The spike's placement: each screw 1 mm too low, so its head cuts 14.68 mm3 into the lid. */
export const SCREW_Z_CLASH = H - 10;
/** Raised 1.2 mm: the head floats 0.2 mm over the lid and the shank keeps 0.2 mm in the hole. */
export const SCREW_Z_CLEAR = H - 8.8;
/** Head ring (r 2.75 minus hole r 1.7) times the 1 mm the head sinks into the lid. */
export const CLASH_VOLUME = Math.PI * (2.75 ** 2 - 1.7 ** 2);

export interface EnclosureOptions {
  screwZ?: number;
  /** "provenance": the DSL recorded clone() and the transform; "geometry": final shapes only. */
  clones?: "provenance" | "geometry";
  mates?: boolean;
}

export function enclosureParts(k: KernelAdapter) {
  const outer = k.box(W, D, H);
  const infos = k.edges(outer);
  const vertical = k.subShapes(outer, "edge").filter((_, i) => {
    const e = infos[i]!;
    return Math.abs(e.start[0] - e.end[0]) < 1e-9 && Math.abs(e.start[1] - e.end[1]) < 1e-9;
  });
  const base = k.cut(k.fillet(outer, vertical, 3), k.translate(k.box(W - 2 * WALL, D - 2 * WALL, H), [WALL, WALL, WALL]));
  const lid = k.translate(k.cutAll(k.box(W, D, 3), HOLES.map(([x, y]) => k.translate(k.cylinder(1.7, 10), [x, y, -2]))), [0, 0, H]);
  const screw = k.fuse(k.cylinder(1.5, 12), k.translate(k.cylinder(2.75, 2), [0, 0, 12]));
  return { base, lid, screw };
}

export function enclosure(k: KernelAdapter, options: EnclosureOptions = {}): ScriptReturn {
  const z = options.screwZ ?? SCREW_Z_CLASH;
  const { base, lid, screw } = enclosureParts(k);
  const parts: ScriptPart[] = [
    { name: "base", shape: base, color: [0.36, 0.42, 0.48], line: 3 },
    { name: "lid", shape: lid, color: [0, 0.83, 1], line: 5 },
  ];
  HOLES.forEach(([x, y], i) => {
    const t: Transform = { t: [x, y, z], q: [0, 0, 0, 1] };
    const part: ScriptPart = { name: "screw", shape: k.place(screw, t), color: [0.8, 0.8, 0.8], line: 8 + i };
    if ((options.clones ?? "provenance") === "provenance") {
      part.cloneOf = "screw";
      part.cloneTransform = t;
    }
    parts.push(part);
  });
  const mates = options.mates ? [{ a: "lid.rim", b: "base.rim", flip: true, line: 12 }] : [];
  return { parts, mates, params: {}, warnings: [] };
}
