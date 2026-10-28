// @open3dj/assembly: the assembly graph, exact fits, the GeometryReport and multi-part exports
// (ARCHITECTURE.md section 5, ASSEMBLIES.md sections 2, 3, 6 and 12).
//
// Intended implementation:
// - buildAssembly: one definition per named descriptor; identical clones share a definition
//   ("measured" from clone provenance, "inferred" from a geometry hash of volume, area, bbox
//   and counts at a stated tolerance); each part's shape is moved to its definition frame and
//   the occurrence gets the inverse as its transform (translation plus unit quaternion).
//   Names exist at both levels (definition id and instance name#n). matchTo mates are
//   script-owned fastened mates; a second mate on one occurrence is reported redundant or
//   conflicting with its residual, never ignored.
// - computeFits: tier 0 AABB filter inflated by the watch distance, then tier 2 exact OCCT
//   common + volume and distance ("measured"). Clash, contact or clearance per pair.
// - report: concise GeometryReport per ARCHITECTURE.md section 9 (validated against the
//   geometry-report schema in tests).
// - exportArtifacts: STEP through an XCAF document (pure assembly root, shared definitions,
//   names on referred and instance labels); STL per definition; glTF from an own writer (one
//   mesh per definition, a node per occurrence); 3MF with components and build items (fflate).
import { NotImplementedError } from "@open3dj/schemas";
import type { FileRef, GeometryReport, FitReport, PackageStatus } from "@open3dj/schemas";
import type { KernelAdapter } from "@open3dj/kernel";
import type { ScriptReturn } from "@open3dj/dsl";
import type { ArtifactFormat, Assembly, BuildOptions, ExportArtifact, ExportOptions, FitOptions, ReportContext } from "./types.ts";

export type * from "./types.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

export const DEFAULT_FIT_OPTIONS: Readonly<Required<FitOptions>> = Object.freeze({
  watchDistance: 0.5,
  volumeTolerance: 1e-3,
  contactTolerance: 1e-4,
});

/** Build the checked assembly from what a script returned. Throws AssemblyError on bad input. */
export function buildAssembly(kernel: KernelAdapter, script: ScriptReturn, options?: BuildOptions): Assembly {
  void kernel; void script; void options;
  throw new NotImplementedError("assembly.buildAssembly");
}

/** Clash, contact and clearance between every pair of part occurrences within the watch distance. */
export function computeFits(kernel: KernelAdapter, asm: Assembly, options?: FitOptions): FitReport[] {
  void kernel; void asm; void options;
  throw new NotImplementedError("assembly.computeFits");
}

/** The concise GeometryReport for an assembly. */
export function report(kernel: KernelAdapter, asm: Assembly, context: ReportContext): GeometryReport {
  void kernel; void asm; void context;
  throw new NotImplementedError("assembly.report");
}

/** Exported files in memory (the worker side). */
export function exportArtifacts(kernel: KernelAdapter, asm: Assembly, formats: ArtifactFormat[], options?: ExportOptions): ExportArtifact[] {
  void kernel; void asm; void formats; void options;
  throw new NotImplementedError("assembly.exportArtifacts");
}

/**
 * Export and write into dir (created if needed). Writes only plain file names inside dir,
 * never through symlinks, and returns the files with their sha256.
 */
export async function exportFiles(kernel: KernelAdapter, asm: Assembly, formats: ArtifactFormat[], dir: string, options?: ExportOptions): Promise<FileRef[]> {
  void kernel; void asm; void formats; void dir; void options;
  throw new NotImplementedError("assembly.exportFiles");
}

export class AssemblyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssemblyError";
    this.code = code;
  }
}
