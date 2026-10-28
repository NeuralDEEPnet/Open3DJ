// @open3dj/kernel: the KernelAdapter contract (C3) and its occt-wasm implementation.
import type { PackageStatus } from "@open3dj/schemas";

export type {
  Axis, EdgeInfo, FaceInfo, KernelAdapter, KernelStats, KernelVersions, Label, MeshData, MultiviewOptions, Plane,
  ShapeCounts, ShapeHandle, ShapeKind, ShapeMeasure, SubShapeKind, TessellateOptions, ViewName, XcafDocument,
  XcafLabelInfo, XcafLocation,
} from "./adapter.ts";
export { initKernel } from "./occt.ts";
export type { InitKernelOptions, Kernel, PrintSink, PrintStream } from "./occt.ts";
export { KernelError, isFatalWasmError, toKernelError } from "./errors.ts";
export type { KernelErrorCode, KernelErrorDetail } from "./errors.ts";
export { IDENTITY, QUATERNION_TOLERANCE, applyTransform, isUnitQuaternion, matrixFromTransform, quaternionFromAxisAngle } from "./transform.ts";
export { withScope } from "./scope.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";
