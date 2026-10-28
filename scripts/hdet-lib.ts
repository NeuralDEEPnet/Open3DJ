// Helpers for scripts/hdet.ts (hypothesis H-det, ARCHITECTURE.md section 8): instrument a DSL
// script so it logs the exact bits of every part's volume and area, normalise STEP text, turn
// a job result into a sample, and compare samples. Pure functions, so they are unit tested.
import { createHash } from "node:crypto";
import type { JobResult } from "@open3dj/compute";

/** The corpus: three examples plus the shell and offset cases written for the DSL. */
export const CASES: Readonly<Record<string, string>> = Object.freeze({
  bracket: "examples/bracket/bracket.o3j.js",
  "tapered-cup": "examples/tapered-cup/tapered-cup.o3j.js",
  enclosure: "examples/enclosure/enclosure.o3j.js",
  shell: "corpora/hdet/shell.o3j.js",
  offset: "corpora/hdet/offset.o3j.js",
});

export const LOG_PREFIX = "HDET ";

/**
 * Wrap a script so that, after it builds its result, it logs [name, volume bits, area bits]
 * for every returned shape. The report rounds measures to 6 decimals; the logged hex is the
 * IEEE 754 double the kernel returned, so one flipped bit shows. The geometry is unchanged.
 */
export function instrument(source: string): string {
  return `const __hdetResult = (() => {
${source}
})();
{
  const bits = (x) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); let s = ""; for (let i = 0; i < 8; i++) s += v.getUint8(i).toString(16).padStart(2, "0"); return s; };
  const isShape = (s) => s !== null && typeof s === "object" && typeof s.volume === "function";
  const r = __hdetResult;
  const list = isShape(r) ? [["part", r]]
    : Array.isArray(r) ? r.map((p, i) => (isShape(p) ? [String(i), p] : [String(p.name ?? i), p.shape]))
    : Object.entries(r);
  console.log(${JSON.stringify(LOG_PREFIX)} + JSON.stringify(list.map(([n, s]) => [n, bits(s.volume()), bits(s.area())])));
}
return __hdetResult;
`;
}

/** STEP text with the FILE_NAME timestamp blanked and line endings unified. */
export function normaliseStep(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^']*'/g, "'TIMESTAMP'");
}

/**
 * normaliseStep plus the id string of every NEXT_ASSEMBLY_USAGE_OCCURRENCE blanked. The OCCT
 * STEP writer numbers these from a counter that lives as long as the kernel instance, so a
 * warm worker writes '1', then '2', and so on, while the geometry stays the same. A longer id
 * also moves where the writer wraps that line, so whitespace outside strings is removed too
 * (entities still end with ";", one per line).
 */
export function normaliseStepIds(text: string): string {
  const blanked = normaliseStep(text).replace(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('[^']*'/g, "NEXT_ASSEMBLY_USAGE_OCCURRENCE('ID'");
  let out = "";
  let quoted = false;
  for (const c of blanked) {
    // STEP strings are in single quotes, with '' for a quote inside: toggling on every quote
    // keeps the inside of '' runs right.
    if (c === "'") quoted = !quoted;
    if (!quoted && /\s/.test(c)) continue;
    out += c;
    if (!quoted && c === ";") out += "\n";
  }
  return out;
}

export interface Sample {
  /** [part, volume hex, area hex] per returned shape, from the kernel's own doubles. */
  bits: string;
  /** Detailed report: bbox per definition and of the assembly (rounded to 6 decimals). */
  bbox: string;
  /** Solid, face and edge counts per definition. */
  counts: string;
  /** sha256 of the STEP file with its timestamp stripped (normaliseStep). */
  step: string;
  /** sha256 of the STEP file with its timestamp and assembly usage ids stripped (normaliseStepIds). */
  step_ids: string;
  /** Pool worker that ran the job (warm runs must stay on one worker). */
  worker: number;
}

export const FIELDS = ["bits", "bbox", "counts", "step_ids", "step"] as const;

/** Fields that describe the geometry; step (the bytes) is reported apart. */
export const GEOMETRY_FIELDS = ["bits", "bbox", "counts", "step_ids"] as const;

export function sampleOf(r: JobResult): Sample {
  if (!r.ok) throw new Error(`job failed: ${r.error.code} ${r.error.message}`);
  const line = r.logs.find((l) => l.message.startsWith(LOG_PREFIX));
  if (!line) throw new Error("the instrumented script logged no measures");
  const step = (r.artifacts ?? []).find((a) => a.format === "step");
  if (!step) throw new Error("the job returned no STEP file");
  const text = Buffer.from(step.bytes).toString("latin1");
  return {
    bits: line.message.slice(LOG_PREFIX.length),
    bbox: JSON.stringify([r.report.assembly.bbox, r.report.parts.map((p) => [p.def, p.bbox])]),
    counts: JSON.stringify(r.report.parts.map((p) => [p.def, p.counts])),
    step: createHash("sha256").update(normaliseStep(text)).digest("hex"),
    step_ids: createHash("sha256").update(normaliseStepIds(text)).digest("hex"),
    worker: r.stats.workerId,
  };
}

export interface FieldResult {
  /** Distinct values among the fresh-process samples (1 means bit-identical). */
  fresh: number;
  /** Distinct values among the warm-reuse samples. */
  warm: number;
  /** True when every fresh and every warm sample agree. */
  identical: boolean;
}

export interface CaseResult {
  case: string;
  fresh_runs: number;
  warm_runs: number;
  fields: Record<(typeof FIELDS)[number], FieldResult>;
  /** Every geometry field (all but the STEP bytes) agrees. */
  geometry_identical: boolean;
  /** Every field, the STEP bytes included, agrees. */
  identical: boolean;
}

export function compareSamples(name: string, fresh: Sample[], warm: Sample[]): CaseResult {
  const fields = {} as CaseResult["fields"];
  for (const f of FIELDS) {
    const a = new Set(fresh.map((s) => s[f]));
    const b = new Set(warm.map((s) => s[f]));
    const all = new Set([...a, ...b]);
    fields[f] = { fresh: a.size, warm: b.size, identical: all.size === 1 };
  }
  return {
    case: name,
    fresh_runs: fresh.length,
    warm_runs: warm.length,
    fields,
    geometry_identical: GEOMETRY_FIELDS.every((f) => fields[f].identical),
    identical: FIELDS.every((f) => fields[f].identical),
  };
}
