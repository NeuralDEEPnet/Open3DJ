// inspect fields=[continuity] (#78): how smoothly the faces of each placed part definition meet,
// from the kernel's continuity table, in the definition's own frame. Problems come first, so a
// capped list still shows them: gaps, then tangent edges with a curvature step (by size), then
// creases (shallowest first: a 2 degree crease is likelier a mistake than a 90 degree corner),
// then curvature-continuous edges.
import type { EdgeContinuity, KernelAdapter } from "@open3dj/kernel";
import type { ContinuityRun, EdgeContinuityEntry, PartContinuity } from "@open3dj/schemas";
import type { Assembly } from "./types.ts";

export interface ContinuityOptions {
  /** Only these definitions. Default: every placed definition. */
  defs?: string[];
  /** Most edges listed per part (the counts include every edge). Default 200. */
  limit?: number;
  /** Sample points per edge. Default 16. */
  samples?: number;
}

const RANK: Record<EdgeContinuity["class"], number> = { gap: 0, G1: 1, G0: 2, G2: 3 };

export function continuityRun(kernel: KernelAdapter, asm: Assembly, options: ContinuityOptions = {}): ContinuityRun {
  const placed = new Set(asm.instances.map((i) => i.def));
  const want = options.defs ? new Set(options.defs) : undefined;
  const limit = options.limit ?? 200;
  let samples = options.samples ?? 16;
  let tolerances = { gap_mm: 0, angle_deg: 0, curvature_per_mm: 0, relative: 0 };
  const parts: PartContinuity[] = [];
  for (const [def, shape] of asm.shapes) {
    if (!placed.has(def) || (want && !want.has(def))) continue;
    const mark = kernel.checkpoint();
    try {
      const table = kernel.continuity(shape, { samples });
      samples = table.samples;
      tolerances = { gap_mm: table.tolerances.gap, angle_deg: table.tolerances.angle, curvature_per_mm: table.tolerances.curvature, relative: table.tolerances.relative };
      const counts = { G2: 0, G1: 0, G0: 0, gap: 0 };
      for (const e of table.edges) counts[e.class]++;
      const ordered = [...table.edges].sort((a, b) => RANK[a.class] - RANK[b.class] || (a.class === "G1" ? (b.curvatureJump ?? 0) - (a.curvatureJump ?? 0) : a.class === "G0" ? a.angle - b.angle : a.edge - b.edge));
      const part: PartContinuity = { def, edges: ordered.slice(0, limit).map(entry), counts };
      if (ordered.length > limit) part.omitted = ordered.length - limit;
      parts.push(part);
    } finally {
      kernel.releaseSince(mark);
    }
  }
  return {
    samples, tolerances, parts,
    notes: [
      `For every edge shared by two faces, measured at ${samples} points spaced evenly inside the edge: the largest gap between the two faces' surfaces (G0), the largest angle between their outward normals (G1) and, where they are tangent, the largest jump in normal curvature along the edge, across it and twisted (G2), on the CPU kernel. class is the highest continuity held at every sample. Continuity numbers, not a Class-A sign-off: a person approves the form in the zebra view.`,
      "Edges on a part's outer boundary or a periodic face's seam are not listed: no second face meets them there. A smooth fill (fill() of a curved boundary) is G0 with its neighbours by construction.",
    ],
  };
}

const r = (x: number, digits = 6) => Number(x.toPrecision(digits));

function entry(e: EdgeContinuity): EdgeContinuityEntry {
  const out: EdgeContinuityEntry = { edge: `edge:${e.edge}`, faces: [`face:${e.faces[0]}`, `face:${e.faces[1]}`], gap_mm: r(e.gap, 3), angle_deg: r(e.angle), class: e.class };
  if (e.curvatureJump !== null) out.curvature_jump_per_mm = r(e.curvatureJump, 3);
  if (e.relativeJump !== null) out.relative_jump = r(e.relativeJump, 3);
  return out;
}
