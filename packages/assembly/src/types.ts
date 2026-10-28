import type { AssemblyFile, ComputeBlock, FitReport, Rev, Transform } from "@open3dj/schemas";
import type { ShapeHandle } from "@open3dj/kernel";

/** One placed occurrence, flattened through sub-assemblies. */
export interface AssemblyInstance {
  /** Occurrence id (stable across runs for the same script and name). */
  id: string;
  /** Path from the root, for example enclosure/pcb_assy/standoff#2. */
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
  /** Warnings from building, for example clones merged by geometry hash ("inferred"). */
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
  /** Overlap volume above this is a clash. Default 1e-3 mm3 (proposed). */
  volumeTolerance?: number;
  /** Distance at or below this, with no overlap, is contact. Default 1e-4 mm (proposed). */
  contactTolerance?: number;
}

export interface ReportContext {
  rev: Rev;
  compute: ComputeBlock;
  fits?: FitReport[];
  warnings?: string[];
  /** concise (default, about 300 tokens) or detailed. */
  detail?: "concise" | "detailed";
}

export type ArtifactFormat = "step" | "stl" | "gltf" | "3mf";

/** An exported file held in memory, before the host writes it under its path policy. */
export interface ExportArtifact {
  /** File name only, no directories, for example bracket.step or bracket-screw.stl. */
  name: string;
  format: ArtifactFormat;
  bytes: Uint8Array;
}

export interface ExportOptions {
  /** Base file name. Default: the root definition id. */
  baseName?: string;
  /** root (default), a sub-assembly path or an occurrence path. */
  scope?: string;
  /** Tessellation chord for STL, glTF and 3MF in mm. Default 0.1. */
  linearDeflection?: number;
}
