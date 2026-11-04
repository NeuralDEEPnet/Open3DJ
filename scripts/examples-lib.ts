// Shared by scripts/examples.ts (records expected.json) and scripts/examples.test.ts (the
// regression test). An example is a folder examples/<name>/ holding <name>.o3j.js.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BBox, FitReport, GeometryReport } from "@open3dj/schemas";
import { ROOT } from "./lib.ts";

export const EXAMPLES_DIR = join(ROOT, "examples");

export interface Example {
  name: string;
  dir: string;
  /** Absolute path of <name>.o3j.js. */
  script: string;
  /** Absolute path of the project folder a CLI run creates next to the script. */
  project: string;
  expectedFile: string;
  drawingFile: string;
}

export function listExamples(): Example[] {
  return readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(EXAMPLES_DIR, e.name, `${e.name}.o3j.js`)))
    .map((e) => {
      const dir = join(EXAMPLES_DIR, e.name);
      return {
        name: e.name,
        dir,
        script: join(dir, `${e.name}.o3j.js`),
        project: join(dir, `${e.name}.o3j`),
        expectedFile: join(dir, "expected.json"),
        drawingFile: join(dir, "drawing.png"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Relative tolerance for an example's measures: 1e-6, or 1e-4 when the script uses fillets
 * or lofts, whose surfaces the kernel approximates. Read from the script itself, so an
 * edited expected.json cannot loosen it.
 */
export function toleranceFor(source: string): number {
  return /\bfillet\s*\(|\bloft(To)?\s*\(/.test(source) ? 1e-4 : 1e-6;
}

export interface ExpectedPart {
  def: string;
  occurrences: number;
  valid: boolean;
  volume_mm3: number;
  area_mm2: number;
  bbox: BBox;
  counts: { solids: number; faces: number; edges: number };
}

export interface ExpectedFit {
  a: string;
  b: string;
  kind: FitReport["kind"];
  volume_mm3?: number;
  distance_mm?: number;
}

export interface Expected {
  example: string;
  script: string;
  /** How expected.json was made and what the regression test checks. Every example runs with its default parameters. */
  note: string;
  engine: { occt_wasm: string; brepjs: string };
  tolerance: number;
  status: GeometryReport["status"];
  assembly: { occurrences: number; definitions: number; bbox: BBox };
  parts: ExpectedPart[];
  fits: ExpectedFit[];
  exports: string[];
}

/** The measured facts of a detailed GeometryReport, in a stable order. */
export function summarize(report: Pick<GeometryReport, "status" | "assembly" | "parts" | "fits">): Pick<Expected, "status" | "assembly" | "parts" | "fits"> {
  const detailed = (what: string, v: number | undefined) => {
    if (v === undefined) throw new Error(`the report has no ${what}; examples need a detailed report`);
    return v;
  };
  const parts = report.parts.map((p) => ({
    def: p.def,
    occurrences: p.occurrences ?? 1,
    valid: p.valid,
    volume_mm3: p.volume_mm3,
    area_mm2: detailed("area_mm2", p.area_mm2),
    bbox: p.bbox,
    counts: { solids: detailed("counts", p.counts?.solids), faces: detailed("counts.faces", p.counts?.faces), edges: detailed("counts.edges", p.counts?.edges) },
  })).sort((a, b) => a.def.localeCompare(b.def));
  const fits = report.fits.map((f) => {
    const out: ExpectedFit = { a: f.a, b: f.b, kind: f.kind };
    if (f.volume_mm3 !== undefined) out.volume_mm3 = f.volume_mm3;
    if (f.distance_mm !== undefined) out.distance_mm = f.distance_mm;
    return out;
  }).sort((x, y) => `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`));
  const a = report.assembly;
  if (!a.bbox) throw new Error("the report has no assembly bbox; an example must return geometry");
  return { status: report.status, assembly: { occurrences: a.occurrences, definitions: a.definitions, bbox: a.bbox }, parts, fits };
}

/** Differences between an expected summary and a measured one; empty when they agree. */
export function compare(expected: Pick<Expected, "status" | "assembly" | "parts" | "fits">, actual: Pick<Expected, "status" | "assembly" | "parts" | "fits">, tol: number): string[] {
  const diffs: string[] = [];
  const num = (path: string, e: number | undefined, a: number | undefined) => {
    if (e === undefined && a === undefined) return;
    if (e === undefined || a === undefined) return void diffs.push(`${path}: expected ${e}, got ${a}`);
    // Relative, with an absolute floor of tol for values near zero (bbox corners at 0).
    if (Math.abs(e - a) > tol * Math.max(1, Math.abs(e), Math.abs(a))) diffs.push(`${path}: expected ${e}, got ${a} (tolerance ${tol} relative)`);
  };
  const same = (path: string, e: unknown, a: unknown) => {
    if (JSON.stringify(e) !== JSON.stringify(a)) diffs.push(`${path}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  };
  const box = (path: string, e: BBox, a: BBox) => {
    for (const k of ["min", "max"] as const) for (let i = 0; i < 3; i++) num(`${path}.${k}[${i}]`, e[k][i], a[k][i]);
  };
  same("status", expected.status, actual.status);
  same("assembly.occurrences", expected.assembly.occurrences, actual.assembly.occurrences);
  same("assembly.definitions", expected.assembly.definitions, actual.assembly.definitions);
  box("assembly.bbox", expected.assembly.bbox, actual.assembly.bbox);
  same("parts", expected.parts.map((p) => p.def), actual.parts.map((p) => p.def));
  for (const e of expected.parts) {
    const a = actual.parts.find((p) => p.def === e.def);
    if (!a) continue;
    const at = `parts[${e.def}]`;
    same(`${at}.occurrences`, e.occurrences, a.occurrences);
    same(`${at}.valid`, e.valid, a.valid);
    same(`${at}.counts`, e.counts, a.counts);
    num(`${at}.volume_mm3`, e.volume_mm3, a.volume_mm3);
    num(`${at}.area_mm2`, e.area_mm2, a.area_mm2);
    box(`${at}.bbox`, e.bbox, a.bbox);
  }
  same("fits", expected.fits.map((f) => `${f.a}|${f.b}|${f.kind}`), actual.fits.map((f) => `${f.a}|${f.b}|${f.kind}`));
  // A pair can have several fits of one kind (each distinct gap is a clearance line), so the
  // n-th expected line of a pair and kind is compared with the n-th measured one.
  const key = (f: ExpectedFit) => `${f.a}|${f.b}|${f.kind}`;
  const seen = new Map<string, number>();
  for (const e of expected.fits) {
    const n = seen.get(key(e)) ?? 0;
    seen.set(key(e), n + 1);
    const a = actual.fits.filter((f) => key(f) === key(e))[n];
    if (!a) continue;
    const at = n === 0 ? `fits[${e.a}|${e.b}]` : `fits[${e.a}|${e.b}|${e.kind}#${n + 1}]`;
    num(`${at}.volume_mm3`, e.volume_mm3, a.volume_mm3);
    num(`${at}.distance_mm`, e.distance_mm, a.distance_mm);
  }
  return diffs;
}

export function readExpected(example: Example): Expected {
  return JSON.parse(readFileSync(example.expectedFile, "utf8")) as Expected;
}
