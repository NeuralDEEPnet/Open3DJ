// The GeometryReport (ARCHITECTURE.md sections 9 and 10): per definition and for the whole
// assembly, validity, volume, area, bbox, centre of mass, mass and counts, plus fits and
// next-step hints. Concise by default (rounded, problems first, capped lists); detailed on
// request (everything, more digits).
import type { BBox, FitReport, GeometryReport, PartReport, RefReport, Vec3 } from "@open3dj/schemas";
import { collapseFits, rankFits } from "@open3dj/schemas";
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
const CONCISE_FITS = 6;
const CONCISE_REFS = 6;
const CONCISE_WARNINGS = 4;
const WARNING_CHARS = 160;
const NEXT_TARGETS = 6;
/** Names (definitions, occurrence paths, refs) are cut to this many characters, then halved down to MIN_NAME_CHARS. */
const NAME_CHARS = 64;
const MIN_NAME_CHARS = 16;

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
  const refs = refReports(asm, detailed);
  const badRefs = refs.filter((x) => x.state === "ambiguous" || x.state === "broken");
  const status: GeometryReport["status"] = invalid.length > 0 ? "error" : clashes.length > 0 || problems.length > 0 || badRefs.length > 0 ? "warning" : "ok";

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
  if (refs.length > 0) out.refs = refs;
  if (bbox) out.assembly.bbox = rb(bbox);
  if (detailed) {
    out.warnings = [...warnings, ...notes];
    out.next = nextHints(asm, invalid, clashes, fits, badRefs, 6);
    return out;
  }
  // One occurrence: its part's bbox is the assembly's, so say it once.
  if (asm.instances.length === 1) delete out.assembly.bbox;
  return trimConcise(out, {
    parts: rankParts(parts, asm, clashes),
    fits: rankFits(collapseFits(out.fits)),
    refs: [...badRefs, ...refs.filter((x) => !badRefs.includes(x))],
    warnings,
    notes,
    next: (targets) => nextHints(asm, invalid, clashes, fits, badRefs, targets),
  });
}

/** Problem parts first: invalid, then in a clash, then the rest. */
function rankParts(parts: PartReport[], asm: Assembly, clashes: FitReport[]): PartReport[] {
  const inClash = new Set(clashes.flatMap((f) => [f.a, f.b]));
  const pathsOf = (def: string) => asm.instances.filter((i) => i.def === def).map((i) => i.path);
  const rank = (p: PartReport) => (!p.valid ? 0 : pathsOf(p.def).some((x) => inClash.has(x)) ? 1 : 2);
  return [...parts].sort((a, b) => rank(a) - rank(b));
}

interface ConciseInput {
  parts: PartReport[];
  fits: FitReport[];
  refs: RefReport[];
  warnings: string[];
  notes: string[];
  next: (targets: number) => string[];
}

/**
 * Fit the concise report into CONCISE_REPORT_CHARS (about 300 tokens at 4 characters a token,
 * ARCHITECTURE.md section 9) whatever the assembly holds: many parts, long names, many fits,
 * warnings and references. Entries are ranked (problems first) and dropped from the end,
 * one step at a time, cheapest information first; long names are shortened; every list that
 * lost entries says how many in a closing note. The steps end with empty lists, so the budget
 * always holds.
 */
function trimConcise(out: GeometryReport, input: ConciseInput): GeometryReport {
  const limit = {
    targets: NEXT_TARGETS,
    fits: Math.min(CONCISE_FITS, input.fits.length),
    refs: Math.min(CONCISE_REFS, input.refs.length),
    parts: Math.min(CONCISE_PARTS, input.parts.length),
    warnings: Math.min(CONCISE_WARNINGS, input.warnings.length),
    name: NAME_CHARS,
    next: 4,
    notes: true,
  };
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text);
  // Reasons end with what to do or which candidate is the query's pick: keep both ends.
  const cutMiddle = (text: string, max: number) => {
    if (text.length <= max) return text;
    const head = Math.max(1, Math.floor((max - 3) * 0.4));
    return `${text.slice(0, head)}...${text.slice(text.length - Math.max(1, max - 3 - head))}`;
  };
  const count = (list: FitReport[]) => list.reduce((n, f) => n + (f.n ?? 1), 0);
  const build = () => {
    out.parts = input.parts.slice(0, limit.parts).map((p) => (p.def.length > limit.name ? { ...p, def: cut(p.def, limit.name) } : p));
    out.fits = input.fits.slice(0, limit.fits).map((f) => ({ ...f, a: cut(f.a, limit.name), b: cut(f.b, limit.name) }));
    const refs = input.refs.slice(0, limit.refs).map((x) => {
      const ref: RefReport = { name: cut(x.name, limit.name), state: x.state };
      if (x.candidates) ref.candidates = x.candidates.slice(0, 4);
      if (x.reason) ref.reason = cutMiddle(x.reason, limit.name * 2);
      return ref;
    });
    if (refs.length > 0) out.refs = refs;
    else delete out.refs;
    const extra: string[] = [];
    if (input.warnings.length > limit.warnings) extra.push(`${input.warnings.length - limit.warnings} more warnings; use detail=detailed.`);
    if (input.parts.length > limit.parts) extra.push(`${input.parts.length - limit.parts} more definitions not listed; use detail=detailed.`);
    const hidden = count(input.fits) - count(out.fits);
    if (hidden > 0) extra.push(`${hidden} more fits not listed; use inspect fields=[fits].`);
    const hiddenRefs = input.refs.slice(limit.refs);
    if (hiddenRefs.length > 0) {
      const exact = hiddenRefs.filter((x) => x.state === "exact").length;
      extra.push(`${hiddenRefs.length} more refs not listed (${exact} exact); use inspect fields=[refs].`);
    }
    out.warnings = [...input.warnings.slice(0, limit.warnings).map((w) => cut(w, WARNING_CHARS)), ...extra, ...(limit.notes ? input.notes : [])];
    out.next = input.next(limit.targets).slice(0, limit.next).map((n) => cut(n, Math.max(90, limit.name * 3)));
    return JSON.stringify(out).length;
  };
  // Fits go after parts and warnings: they are what an assembly report is for.
  const steps: Array<() => boolean> = [
    () => limit.targets > 1 && (limit.targets--, true),
    () => limit.refs > 1 && (limit.refs--, true),
    () => limit.parts > 1 && (limit.parts--, true),
    () => limit.warnings > 1 && (limit.warnings--, true),
    () => limit.fits > 1 && (limit.fits--, true),
    () => limit.name > MIN_NAME_CHARS && ((limit.name = Math.max(MIN_NAME_CHARS, Math.floor(limit.name / 2))), true),
    () => limit.notes && ((limit.notes = false), true),
    () => limit.warnings > 0 && (limit.warnings--, true),
    () => limit.refs > 0 && (limit.refs--, true),
    () => limit.fits > 0 && (limit.fits--, true),
    () => limit.parts > 0 && (limit.parts--, true),
    () => limit.next > 1 && (limit.next--, true),
  ];
  while (build() > CONCISE_REPORT_CHARS && steps.some((step) => step())) {
    // each pass applies the first step that can still shrink the report
  }
  return out;
}

/** refs[] from the named faces and edges stored with each part definition. */
function refReports(asm: Assembly, detailed: boolean): RefReport[] {
  const out: RefReport[] = [];
  for (const [id, def] of Object.entries(asm.file.definitions)) {
    for (const x of def.refs ?? []) {
      const ref: RefReport = { name: `${id}.${x.name}`, state: x.state };
      if (x.candidates?.length) ref.candidates = x.candidates;
      if (x.reason) ref.reason = x.reason;
      if (detailed && x.at) ref.at = x.at;
      out.push(ref);
    }
  }
  return out;
}

function roundFit(f: FitReport, r: (x: number) => number): FitReport {
  const out: FitReport = { a: f.a, b: f.b, kind: f.kind, confidence: f.confidence };
  if (f.volume_mm3 !== undefined) out.volume_mm3 = Math.max(0, r(f.volume_mm3));
  if (f.distance_mm !== undefined) out.distance_mm = Math.max(0, r(f.distance_mm));
  if (f.extra) out.extra = true;
  return out;
}

function nextHints(asm: Assembly, invalid: PartReport[], clashes: FitReport[], fits: FitReport[], badRefs: RefReport[], maxTargets: number): string[] {
  const next: string[] = [];
  for (const p of invalid.slice(0, 2)) next.push(`inspect fields=[measure] targets=[${p.def}] detail=detailed`);
  if (clashes.length > 0) {
    const targets = [...new Set(clashes.flatMap((c) => [c.a, c.b]))].slice(0, maxTargets);
    next.push(`render view=multiview targets=[${targets.join(",")}]`);
    next.push("fix the clash: move or resize one part, then run again");
  }
  if (badRefs.some((x) => x.state === "ambiguous" && /query's pick/.test(x.reason ?? ""))) {
    // The query is already unique; the fingerprint cannot confirm it (a twin moved with it).
    next.push("a named face or edge moved and has an identical twin: the query's pick is candidates[0]; confirm it with inspect fields=[refs] or render, then carry on");
  } else if (badRefs.length > 0) next.push("inspect fields=[refs]: a named face or edge is ambiguous or broken; check its query");
  if (next.length === 0) {
    next.push("render view=multiview");
    next.push("export format=step");
    if (fits.length === 0 && asm.instances.length > 1) next.push("inspect fields=[tree]");
  }
  return next.slice(0, 4);
}
