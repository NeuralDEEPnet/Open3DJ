// The GeometryReport (ARCHITECTURE.md sections 9 and 10): per definition and for the whole
// assembly, validity, volume, area, bbox, centre of mass, mass and counts, plus fits and
// next-step hints. Concise by default (rounded, problems first, capped lists); detailed on
// request (everything, more digits).
import type { BBox, FitReport, GeometryReport, PartReport, Vec3 } from "@open3dj/schemas";
import type { KernelAdapter, ShapeMeasure } from "@open3dj/kernel";
import type { Assembly, ReportContext } from "./types.ts";
import { computeFits } from "./fits.ts";
import { bboxUnion, clean } from "./math.ts";

/** PLA, used until materials arrive (S9). Reported as an assumption. */
export const DEFAULT_DENSITY_G_PER_CM3 = 1.24;

const CONCISE_PARTS = 6;
const CONCISE_FITS = 10;

export function report(kernel: KernelAdapter, asm: Assembly, context: ReportContext): GeometryReport {
  const detailed = context.detail === "detailed";
  const digits = detailed ? 6 : 3;
  const r = (x: number) => clean(Number(x.toFixed(digits)));
  const rv = (v: Vec3): Vec3 => [r(v[0]), r(v[1]), r(v[2])];
  const rb = (b: BBox): BBox => ({ min: rv(b.min), max: rv(b.max) });
  const density = context.densityGPerCm3 ?? DEFAULT_DENSITY_G_PER_CM3;
  const gPerMm3 = density / 1000;

  const fits = context.fits ?? computeFits(kernel, asm);
  const occurrences = new Map<string, number>();
  for (const i of asm.instances) occurrences.set(i.def, (occurrences.get(i.def) ?? 0) + 1);

  const measures = new Map<string, ShapeMeasure>();
  for (const [def, shape] of asm.shapes) measures.set(def, kernel.measure(shape));

  let parts: PartReport[] = [...measures].map(([def, m]) => ({
    def,
    occurrences: occurrences.get(def) ?? 0,
    valid: m.valid,
    volume_mm3: r(m.volume),
    area_mm2: r(m.area),
    mass_g: r(Math.max(0, m.volume) * gPerMm3),
    bbox: rb(m.bbox),
    center_of_mass: rv(m.centerOfMass),
    counts: { solids: m.counts.solids, faces: m.counts.faces, edges: m.counts.edges },
  }));
  // A definition nobody places is never reported with occurrences: 0 (the schema wants >= 1).
  parts = parts.filter((p) => (p.occurrences ?? 0) > 0);

  const mark = kernel.checkpoint();
  let bbox: BBox | undefined;
  try {
    bbox = bboxUnion(asm.instances.map((i) => kernel.bbox(kernel.place(asm.shapes.get(i.def)!, i.world))));
  } finally {
    kernel.releaseSince(mark);
  }
  const massG = asm.instances.reduce((sum, i) => sum + Math.max(0, measures.get(i.def)?.volume ?? 0) * gPerMm3, 0);

  const clashes = fits.filter((f) => f.kind === "clash");
  const invalid = parts.filter((p) => !p.valid);
  const problems = [...asm.warnings, ...(context.warnings ?? [])];
  const status: GeometryReport["status"] = invalid.length > 0 ? "error" : clashes.length > 0 || problems.length > 0 ? "warning" : "ok";

  const warnings = [...problems];
  const notes: string[] = [`mass_g assumes a density of ${density} g/cm3 (PLA, assumed).`];

  let reportedParts = parts;
  let reportedFits = [...fits].map((f) => roundFit(f, r));
  if (!detailed) {
    const inClash = new Set(clashes.flatMap((f) => [f.a, f.b]));
    const pathsOf = (def: string) => asm.instances.filter((i) => i.def === def).map((i) => i.path);
    const rank = (p: PartReport) => (!p.valid ? 0 : pathsOf(p.def).some((x) => inClash.has(x)) ? 1 : 2);
    reportedParts = [...parts].sort((a, b) => rank(a) - rank(b)).slice(0, CONCISE_PARTS);
    const order = { clash: 0, contact: 1, clearance: 2 } as const;
    reportedFits = reportedFits.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, CONCISE_FITS);
    if (parts.length > reportedParts.length) notes.push(`${parts.length - reportedParts.length} more definitions not listed; use detail=detailed.`);
    if (fits.length > reportedFits.length) notes.push(`${fits.length - reportedFits.length} more fits not listed; use inspect fields=[fits].`);
  }

  const out: GeometryReport = {
    status,
    rev: context.rev,
    assembly: { occurrences: asm.instances.length, definitions: asm.shapes.size, mass_g: r(massG) },
    parts: reportedParts,
    fits: reportedFits,
    compute: context.compute,
  };
  if (bbox) out.assembly.bbox = rb(bbox);
  out.warnings = [...warnings, ...notes];
  out.next = nextHints(asm, invalid, clashes, fits);
  return out;
}

function roundFit(f: FitReport, r: (x: number) => number): FitReport {
  const out: FitReport = { a: f.a, b: f.b, kind: f.kind, confidence: f.confidence };
  if (f.volume_mm3 !== undefined) out.volume_mm3 = Math.max(0, r(f.volume_mm3));
  if (f.distance_mm !== undefined) out.distance_mm = Math.max(0, r(f.distance_mm));
  return out;
}

function nextHints(asm: Assembly, invalid: PartReport[], clashes: FitReport[], fits: FitReport[]): string[] {
  const next: string[] = [];
  for (const p of invalid.slice(0, 2)) next.push(`inspect fields=[measure] targets=[${p.def}] detail=detailed`);
  if (clashes.length > 0) {
    const targets = [...new Set(clashes.flatMap((c) => [c.a, c.b]))].slice(0, 6);
    next.push(`render view=multiview targets=[${targets.join(",")}]`);
    next.push("fix the clash: move or resize one part, then run again");
  }
  if (next.length === 0) {
    next.push("render view=multiview");
    next.push("export format=step");
    if (fits.length === 0 && asm.instances.length > 1) next.push("inspect fields=[tree]");
  }
  return next.slice(0, 4);
}
