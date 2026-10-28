import type { AssemblyFile, ComputeBlock, FitReport, Rev, Transform } from "@open3dj/schemas";
import type { ShapeHandle } from "@open3dj/kernel";

/** One placed occurrence, flattened through sub-assemblies. */
export interface AssemblyInstance {
  /** Occurrence id (stable across runs for the same script and name). */
  id: string;
  /**
   * Path of occurrence names below the root, for example pcb_assy/standoff#2 or lid. The
   * root's own name is not part of the path; resolveTargets() also accepts it as a prefix.
   */
  path: string;
  /** Instance name, for example standoff#2. */
  name: string;
  /** Definition id of the part (never an assembly-kind definition). */
  def: string;
  /** World transform (parent transforms composed). */
  world: Transform;
}

/**
 * A checked assembly: the C4 graph plus kernel geometry. Every design is an assembly; one
 * part is a root with one occurrence.
 */
export interface Assembly {
  /** The graph as written to assembly.o3j.json. */
  file: AssemblyFile;
  /** Kernel geometry per part definition id, in the definition's local frame. */
  shapes: Map<string, ShapeHandle>;
  /** Every part occurrence with its world transform. */
  instances: AssemblyInstance[];
  /** Warnings from building, for example rotated copies that could not share a definition. */
  warnings: string[];
}

export interface BuildOptions {
  /** Root definition id. Default "root" (or the project name when known). */
  rootName?: string;
  /** Previous graph, so occurrence ids stay stable across runs. */
  previous?: AssemblyFile;
}

export interface FitOptions {
  /** Pairs farther apart than this are not reported. Default 0.5 mm (proposed). */
  watchDistance?: number;
  /** Overlap volume above this is a clash. Default 1e-6 mm3. */
  volumeTolerance?: number;
  /** Distance at or below this, with no overlap, is contact. Default 1e-6 mm. */
  contactTolerance?: number;
}

export interface ReportContext {
  rev: Rev;
  compute: ComputeBlock;
  /** Fits from computeFits(). Computed with the default options when omitted. */
  fits?: FitReport[];
  warnings?: string[];
  /** concise (default, about 300 tokens) or detailed. */
  detail?: "concise" | "detailed";
  /** Density for mass_g in g/cm3. Default 1.24 (PLA), reported as assumed. */
  densityGPerCm3?: number;
}

export type ArtifactFormat = "step" | "stl" | "gltf" | "3mf";

/** An exported file held in memory, before the host writes it under its path policy. */
export interface ExportArtifact {
  /** File name only, no directories, for example bracket.step or bracket-screw.stl. */
  name: string;
  /** The export format, or "evidence" for the JSON sidecar (hashes, measures, engine pins). */
  format: ArtifactFormat | "evidence";
  bytes: Uint8Array;
  /** Things the exporter could not carry into this format, for the export tool's warnings. */
  warnings?: string[];
}

export interface ExportOptions {
  /** Base file name. Default: the root definition id. */
  baseName?: string;
  /** root (default), a sub-assembly path or an occurrence path. */
  scope?: string;
  /** Tessellation chord for STL, glTF and 3MF in mm. Default 0.1. */
  linearDeflection?: number;
  /** Add the <base>.evidence.json sidecar to the artifacts. Default true. */
  evidence?: boolean;
  /** Revision recorded in the sidecar. */
  rev?: Rev;
  /** Extra engine pins for the sidecar (open3dj, brepjs, quickjs); occt_wasm is always added. */
  engine?: Record<string, string>;
  /** Also write one STL per definition when the scope holds several. Default true. */
  stlPerDefinition?: boolean;
}

export interface WriteOptions {
  /**
   * Project folder. When set, dir must be relative to it, contain no "..", and stay inside
   * it after symlinks are resolved; returned paths are relative to it.
   */
  root?: string;
}

export interface ExportFilesOptions extends ExportOptions, WriteOptions {}
