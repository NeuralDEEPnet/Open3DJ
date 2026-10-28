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

// The concise report must stay within 300 tokens (ARCHITECTURE.md section 9). Fixed counts
// cannot promise that (long names, many warnings), so the report is trimmed to a character
// budget: 1000 characters for the run result, measured in packages/mcp/src/report-budget.test.ts.
// The run tool wraps the report in about 20 characters, so the report itself gets less.
export const CONCISE_REPORT_CHARS = 970;
const CONCISE_PARTS = 5;
const CONCISE_FITS = 5;
const CONCISE_WARNINGS = 4;
const WARNING_CHARS = 160;
const NEXT_TARGETS = 6;

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

  let parts: PartReport[] = [...measures].map(([def, m]) => {
    const p: PartReport = { def, occurrences: occurrences.get(def) ?? 0, valid: m.valid, volume_mm3: r(m.volume), bbox: rb(m.bbox) };
    if (detailed) {
      p.area_mm2 = r(m.area);
      p.mass_g = r(Math.max(0, m.volume) * gPerMm3);
      p.center_of_mass = rv(m.centerOfMass);
      p.counts = { solids: m.counts.solids, faces: m.counts.faces, edges: m.counts.edges };
    } else if (m.counts.solids !== 1) {
      // Concise: say so only when a part is not one solid, the usual sign of a missed union.
      p.counts = { solids: m.counts.solids };
    }
    return p;
  });
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
  const notes: string[] = [`mass_g assumes ${density} g/cm3 (PLA).`];

  const out: GeometryReport = {
    status,
    rev: context.rev,
    assembly: { occurrences: asm.instances.length, definitions: asm.shapes.size, mass_g: r(massG) },
    parts,
    fits: [...fits].map((f) => roundFit(f, r)),
    compute: context.compute,
  };
  if (bbox) out.assembly.bbox = rb(bbox);
  if (detailed) {
    out.warnings = [...warnings, ...notes];
    out.next = nextHints(asm, invalid, clashes, fits, 6);
    return out;
  }
  // One occurrence: its part's bbox is the assembly's, so say it once.
  if (asm.instances.length === 1) delete out.assembly.bbox;

  // Concise: problems first, then trimmed to the budget, lowest-ranked entries first.
  const inClash = new Set(clashes.flatMap((f) => [f.a, f.b]));
  const pathsOf = (def: string) => asm.instances.filter((i) => i.def === def).map((i) => i.path);
  const rank = (p: PartReport) => (!p.valid ? 0 : pathsOf(p.def).some((x) => inClash.has(x)) ? 1 : 2);
  const rankedParts = [...parts].sort((a, b) => rank(a) - rank(b));
  const order = { clash: 0, contact: 1, clearance: 2 } as const;
  const rankedFits = collapseFits(out.fits).sort((a, b) => order[a.kind] - order[b.kind]);
  const fitCount = (list: FitReport[]) => list.reduce((n, f) => n + (f.n ?? 1), 0);
  const shownWarnings = warnings.slice(0, CONCISE_WARNINGS).map((w) => (w.length > WARNING_CHARS ? `${w.slice(0, WARNING_CHARS - 3)}...` : w));
  let nParts = Math.min(CONCISE_PARTS, rankedParts.length);
  let nFits = Math.min(CONCISE_FITS, rankedFits.length);
  let nTargets = NEXT_TARGETS;
  const build = () => {
    out.parts = rankedParts.slice(0, nParts);
    out.fits = rankedFits.slice(0, nFits);
    const extra: string[] = [];
    if (warnings.length > shownWarnings.length) extra.push(`${warnings.length - shownWarnings.length} more warnings; use detail=detailed.`);
    if (rankedParts.length > nParts) extra.push(`${rankedParts.length - nParts} more definitions not listed; use detail=detailed.`);
    const hidden = fitCount(rankedFits) - fitCount(out.fits);
    if (hidden > 0) extra.push(`${hidden} more fits not listed; use inspect fields=[fits].`);
    out.warnings = [...shownWarnings, ...extra, ...notes];
    out.next = nextHints(asm, invalid, clashes, fits, nTargets);
    return JSON.stringify(out).length;
  };
  // Shrink one step at a time, cheapest information first: render targets, then fits, then
  // parts (problem parts and clashes are ranked first, so they stay longest).
  while (build() > CONCISE_REPORT_CHARS) {
    if (nTargets > 1) nTargets--;
    else if (nFits > 1) nFits--;
    else if (nParts > 1) nParts--;
    else break;
  }
  return out;
}

/**
 * Collapse fits that differ only in the #n of their occurrence names (four screws that sit
 * the same way in the base) into one line with n, naming the range: screw#1..4.
 */
export function collapseFits(fits: FitReport[]): FitReport[] {
  const base = (path: string) => /^(.*)#(\d+)$/.exec(path);
  const groups = new Map<string, FitReport[]>();
  for (const f of fits) {
    const key = [f.kind, f.volume_mm3 ?? "", f.distance_mm ?? "", f.confidence, base(f.a)?.[1] ?? f.a, base(f.b)?.[1] ?? f.b].join("\u0000");
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0]!;
    return { ...g[0]!, a: rangeName(g.map((f) => f.a)), b: rangeName(g.map((f) => f.b)), n: g.length };
  });
}

/** One name for several paths: the path itself when all agree, else stem#first..last or stem#1,3,7. */
function rangeName(paths: string[]): string {
  const unique = [...new Set(paths)];
  if (unique.length === 1) return unique[0]!;
  const parsed = unique.map((p) => /^(.*)#(\d+)$/.exec(p));
  const stem = parsed[0]?.[1];
  if (!stem || parsed.some((m) => !m || m[1] !== stem)) return unique.join(",");
  const nums = parsed.map((m) => Number(m![2])).sort((a, b) => a - b);
  const consecutive = nums.every((x, i) => i === 0 || x === nums[i - 1]! + 1);
  return consecutive ? `${stem}#${nums[0]}..${nums[nums.length - 1]}` : `${stem}#${nums.join(",")}`;
}

function roundFit(f: FitReport, r: (x: number) => number): FitReport {
  const out: FitReport = { a: f.a, b: f.b, kind: f.kind, confidence: f.confidence };
  if (f.volume_mm3 !== undefined) out.volume_mm3 = Math.max(0, r(f.volume_mm3));
  if (f.distance_mm !== undefined) out.distance_mm = Math.max(0, r(f.distance_mm));
  return out;
}

function nextHints(asm: Assembly, invalid: PartReport[], clashes: FitReport[], fits: FitReport[], maxTargets: number): string[] {
  const next: string[] = [];
  for (const p of invalid.slice(0, 2)) next.push(`inspect fields=[measure] targets=[${p.def}] detail=detailed`);
  if (clashes.length > 0) {
    const targets = [...new Set(clashes.flatMap((c) => [c.a, c.b]))].slice(0, maxTargets);
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
