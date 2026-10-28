// @open3dj/assembly: the assembly graph, exact fits, the GeometryReport and multi-part exports
// (ARCHITECTURE.md section 5, ASSEMBLIES.md sections 2, 3, 6 and 12).
//
// - buildAssembly: one definition per named part; clones share a definition, "measured" from
//   the DSL's clone provenance or "inferred" from equal measures plus an exact common()
//   check of a translated copy. Occurrences carry translation plus unit quaternion.
// - computeFits: AABB broad phase grown by the watch distance, then exact common() volume
//   and distance. Clash, contact or clearance per pair, labelled "measured".
// - report: the concise GeometryReport (detailed on request).
// - exportArtifacts / exportFiles: STEP through XCAF with names at both levels, STL, GLB and
//   3MF from own writers, and an evidence sidecar; writeArtifacts applies the path policy.
import type { PackageStatus } from "@open3dj/schemas";

export type * from "./types.ts";
export type { ExportNode, ExportTree } from "./resolve.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";

export { AssemblyError } from "./errors.ts";
export { buildAssembly } from "./build.ts";
export { DEFAULT_FIT_OPTIONS, computeFits } from "./fits.ts";
export { DEFAULT_DENSITY_G_PER_CM3, report } from "./report.ts";
export { exportArtifacts, exportFiles } from "./export/index.ts";
export { prepareDir, writeArtifacts } from "./export/files.ts";
export { exportTree, resolveTarget, resolveTargets } from "./resolve.ts";
export { compose, invert, xcafLocation } from "./math.ts";
