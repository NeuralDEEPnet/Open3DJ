// inspect fields=[continuity] (#78): how smoothly the faces of each placed part definition meet,
// from the kernel's continuity table, in the definition's own frame. Problems come first, so a
// capped list still shows them: gaps, then tangent edges with a curvature step (by size), then
// creases (shallowest first: a 2 degree crease is likelier a mistake than a 90 degree corner),
// then curvature-continuous edges. The same run says how each curved face bends (#78, B2): faces
// that inflect come first, then the tightest radii, since both are what a designer looks for.
import type { EdgeContinuity, FaceCurvature, KernelAdapter } from "@open3dj/kernel";
import type { ContinuityRun, EdgeContinuityEntry, FaceCurvatureEntry, PartContinuity } from "@open3dj/schemas";
import type { Assembly } from "./types.ts";

export interface ContinuityOptions {
  /** Only these definitions. Default: every placed definition. */
  defs?: string[];
  /** Most edges listed per part (the counts include every edge). Default 200. */
  limit?: number;
  /** Sample points per edge. Default 16. */
  samples?: number;
  /** Face curvature samples per face direction. Default 8 (an 8 x 8 lattice). */
  grid?: number;
}

const RANK: Record<EdgeContinuity["class"], number> = { gap: 0, G1: 1, G0: 2, G2: 3 };

export function continuityRun(kernel: KernelAdapter, asm: Assembly, options: ContinuityOptions = {}): ContinuityRun {
  const placed = new Set(asm.instances.map((i) => i.def));
  const want = options.defs ? new Set(options.defs) : undefined;
  const limit = options.limit ?? 200;
  let samples = options.samples ?? 16;
  let grid = options.grid ?? 8;
  let tolerances = { gap_mm: 0, angle_deg: 0, curvature_per_mm: 0, relative: 0, flat_per_mm: 1e-5 };
  const parts: PartContinuity[] = [];
  for (const [def, shape] of asm.shapes) {
    if (!placed.has(def) || (want && !want.has(def))) continue;
    const mark = kernel.checkpoint();
    try {
      const table = kernel.continuity(shape, { samples });
      const bends = kernel.curvature(shape, { grid });
      samples = table.samples;
      grid = bends.grid;
      tolerances = { gap_mm: table.tolerances.gap, angle_deg: table.tolerances.angle, curvature_per_mm: table.tolerances.curvature, relative: table.tolerances.relative, flat_per_mm: bends.tolerance };
      const counts = { G2: 0, G1: 0, G0: 0, gap: 0 };
      for (const e of table.edges) counts[e.class]++;
      const ordered = [...table.edges].sort((a, b) => RANK[a.class] - RANK[b.class] || (a.class === "G1" ? (b.curvatureJump ?? 0) - (a.curvatureJump ?? 0) : a.class === "G0" ? a.angle - b.angle : a.edge - b.edge));
      const faceCounts = { flat: 0, convex: 0, concave: 0, saddle: 0, mixed: 0, inflected: 0 };
      for (const f of bends.faces) {
        faceCounts[f.kind]++;
        if (f.inflection) faceCounts.inflected++;
      }
      const curved = bends.faces.filter((f) => f.kind !== "flat").sort((a, b) => Number(b.inflection) - Number(a.inflection) || a.minRadius! - b.minRadius! || a.face - b.face);
      const part: PartContinuity = { def, edges: ordered.slice(0, limit).map(entry), counts, faces: curved.slice(0, limit).map(faceEntry), face_counts: faceCounts };
      if (ordered.length > limit) part.omitted = ordered.length - limit;
      if (curved.length > limit) part.faces_omitted = curved.length - limit;
      const tight = curved.reduce<FaceCurvature | undefined>((a, f) => (!a || f.minRadius! < a.minRadius! ? f : a), undefined);
      if (tight) part.tightest = { face: `face:${tight.face}`, min_radius_mm: r(tight.minRadius!) };
      parts.push(part);
    } finally {
      kernel.releaseSince(mark);
    }
  }
  return {
    samples, grid, tolerances, parts,
    notes: [
      `For every edge shared by two faces, measured at ${samples} points spaced evenly inside the edge: the largest gap between the two faces' surfaces (G0), the largest angle between their outward normals (G1) and, where they are tangent, the largest jump in normal curvature along the edge, across it and twisted (G2), on the CPU kernel. class is the highest continuity held at every sample. Continuity numbers, not a Class-A sign-off: a person approves the form in the zebra view.`,
      "Edges on a part's outer boundary or a periodic face's seam are not listed: no second face meets them there. A smooth fill (fill() of a curved boundary) is G0 with its neighbours by construction.",
      `For every curved face, from its principal curvatures at up to ${grid} x ${grid} points inside it: the range of each (1/mm, positive where the face bulges outward), the tightest radius, its kind, and whether it inflects (its mean curvature takes both signs). Flat faces (every curvature at or under ${tolerances.flat_per_mm} /mm) are only counted.`,
    ],
  };
}

const r = (x: number, digits = 6) => Number(x.toPrecision(digits));

function faceEntry(f: FaceCurvature): FaceCurvatureEntry {
  return {
    face: `face:${f.face}`, surface: f.surface, kind: f.kind as FaceCurvatureEntry["kind"], min_radius_mm: r(f.minRadius!),
    k_min_per_mm: [r(f.kMin[0]), r(f.kMin[1])], k_max_per_mm: [r(f.kMax[0]), r(f.kMax[1])], inflection: f.inflection, samples: f.samples,
  };
}

function entry(e: EdgeContinuity): EdgeContinuityEntry {
  const out: EdgeContinuityEntry = { edge: `edge:${e.edge}`, faces: [`face:${e.faces[0]}`, `face:${e.faces[1]}`], gap_mm: r(e.gap, 3), angle_deg: r(e.angle), class: e.class };
  if (e.curvatureJump !== null) out.curvature_jump_per_mm = r(e.curvatureJump, 3);
  if (e.relativeJump !== null) out.relative_jump = r(e.relativeJump, 3);
  return out;
}
