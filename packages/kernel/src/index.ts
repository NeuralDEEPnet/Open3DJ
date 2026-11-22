// @open3dj/kernel: the KernelAdapter contract (C3) and its occt-wasm implementation.
import type { PackageStatus } from "@open3dj/schemas";

export type {
  Axis, CurvePoint, EdgeInfo, FaceInfo, KernelAdapter, KernelStats, KernelVersions, Label, MeshData, MultiviewOptions,
  NurbsCurve, Plane, ShapeCounts, ShapeHandle, ShapeKind, ShapeMeasure, SplineOptions, SubShapeKind, TessellateOptions,
  ViewName, XcafDocument, XcafLabelInfo, XcafLocation,
} from "./adapter.ts";
export { initKernel } from "./occt.ts";
export type { InitKernelOptions, Kernel, PrintSink, PrintStream } from "./occt.ts";
export { KernelError, isFatalWasmError, toKernelError } from "./errors.ts";
export type { KernelErrorCode, KernelErrorDetail } from "./errors.ts";
export { IDENTITY, QUATERNION_TOLERANCE, applyTransform, isUnitQuaternion, matrixFromTransform, quaternionFromAxisAngle } from "./transform.ts";
export { withScope } from "./scope.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";
