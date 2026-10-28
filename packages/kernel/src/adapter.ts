// KernelAdapter (contract C3): the synchronous, opaque-handle kernel interface that the
// DSL, assembly and render packages code against. It is written against the occt-wasm
// facade semantics, not against brepjs internals, so the kernel can be swapped later
// (memory64 build, native addon) without touching its callers.
//
// Rules every implementation keeps:
// - Shapes are opaque integer handles. A handle lives until release(), releaseSince() or
//   the end of the kernel instance. Callers wrap each job in checkpoint()/releaseSince().
// - Booleans return a solid when the result is a single solid (the kernel returns a
//   compound), and keep the compound only when there are several solids.
// - Every boolean, fillet, chamfer, shell, extrude, revolve and loft runs isValid on its
//   result and throws KernelError("INVALID_RESULT") with the faulty faces when it fails.
// - Nothing the kernel prints reaches process.stdout (see init.ts).
import type { BBox, Transform, Vec3 } from "@open3dj/schemas";

declare const ShapeHandleBrand: unique symbol;
/** Opaque handle to a kernel shape. Only valid in the kernel instance that made it. */
export type ShapeHandle = number & { readonly [ShapeHandleBrand]: never };

export type SubShapeKind = "vertex" | "edge" | "wire" | "face" | "shell" | "solid";
export type ShapeKind = "compound" | "compsolid" | "solid" | "shell" | "face" | "wire" | "edge" | "vertex" | "shape";

/** A line in space: a point and a direction (need not be unit length). */
export interface Axis {
  origin: Vec3;
  dir: Vec3;
}

/** A plane: a point and a normal. */
export interface Plane {
  origin: Vec3;
  normal: Vec3;
}

export interface ShapeCounts {
  solids: number;
  shells: number;
  faces: number;
  edges: number;
  vertices: number;
}

/** Plain-data description of an edge, for edge queries. */
export interface EdgeInfo {
  /** 1-based index in subShapes(shape, "edge") order: the edge:<index> element address. */
  index: number;
  /** line, circle, ellipse, bspline, ... */
  curve: string;
  length: number;
  bbox: BBox;
  start: Vec3;
  end: Vec3;
  mid: Vec3;
  closed: boolean;
}

/** Plain-data description of a face, for face queries. */
export interface FaceInfo {
  /** 1-based index in subShapes(shape, "face") order: the face:<index> element address. */
  index: number;
  /** plane, cylinder, cone, sphere, torus, bspline, ... */
  surface: string;
  area: number;
  bbox: BBox;
  center: Vec3;
  /** Outward normal at the face's UV centre. */
  normal: Vec3;
}

export interface ShapeMeasure {
  valid: boolean;
  volume: number;
  area: number;
  bbox: BBox;
  centerOfMass: Vec3;
  counts: ShapeCounts;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface TessellateOptions {
  /** Chordal deviation in mm (default 0.1). */
  linearDeflection?: number;
  /** Angular deviation in radians (default 0.5). */
  angularDeflection?: number;
}

export type ViewName = "front" | "back" | "top" | "bottom" | "left" | "right" | "iso";

export interface MultiviewOptions {
  views?: ViewName[];
  columns?: number;
  width?: number;
  height?: number;
  showHidden?: boolean;
  showLabels?: boolean;
  showDimensions?: boolean;
}

/** Location of an XCAF component: translation in mm, rotations in radians (occt-wasm order). */
export interface XcafLocation {
  tx?: number;
  ty?: number;
  tz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

declare const LabelBrand: unique symbol;
/** Label in one XCAF document. */
export type Label = number & { readonly [LabelBrand]: never };

export interface XcafLabelInfo {
  name: string;
  isAssembly: boolean;
  isComponent: boolean;
  color: [number, number, number] | null;
}

/**
 * An XCAF document: the product structure written to STEP and glTF. Names go on both the
 * definition (referred) label and the instance label. Rotation order of XcafLocation is
 * measured as R = Rz*Rx for X and Z; the Y axis is unverified (ASSEMBLIES.md 2.3), so prefer
 * addChild with a shape already placed by KernelAdapter.place() and an identity location.
 */
export interface XcafDocument {
  addShape(shape: ShapeHandle, options?: { name?: string; color?: [number, number, number]; assembly?: boolean }): Label;
  addChild(parent: Label, shape: ShapeHandle, options?: { name?: string; color?: [number, number, number]; location?: XcafLocation }): Label;
  setName(label: Label, name: string): void;
  setColor(label: Label, color: [number, number, number]): void;
  getReferredLabel(label: Label): Label | null;
  getChildren(label: Label): Label[];
  getRoots(): Label[];
  getLabelInfo(label: Label): XcafLabelInfo;
  /** 3x4 row-major matrix of a component label. */
  getLocation(label: Label): number[];
  exportStep(): string;
  exportGlb(options?: TessellateOptions): Uint8Array;
  close(): void;
}

export interface KernelVersions {
  occtWasm: string;
}

export interface KernelStats {
  liveShapes: number;
  /** Size of the kernel's WebAssembly memory. It never shrinks: recycle the worker instead. */
  wasmHeapBytes: number;
  /** Lines the kernel printed (captured by the print hook, never written to stdout). */
  printedLines: number;
}

export interface KernelAdapter {
  readonly versions: KernelVersions;

  // ---- primitives (each at the origin, Z up) ------------------------------------------
  /** Box with one corner at the origin, spanning +X, +Y, +Z. */
  box(dx: number, dy: number, dz: number): ShapeHandle;
  /** Cylinder on the Z axis from z = 0 to z = height. */
  cylinder(radius: number, height: number): ShapeHandle;
  /** Cone (or frustum) on the Z axis from z = 0 to z = height. */
  cone(r1: number, r2: number, height: number): ShapeHandle;
  sphere(radius: number): ShapeHandle;
  torus(majorRadius: number, minorRadius: number): ShapeHandle;

  // ---- curves, wires, faces and swept solids -------------------------------------------
  lineEdge(start: Vec3, end: Vec3): ShapeHandle;
  arcEdge(start: Vec3, mid: Vec3, end: Vec3): ShapeHandle;
  circleEdge(center: Vec3, normal: Vec3, radius: number): ShapeHandle;
  wire(edges: ShapeHandle[]): ShapeHandle;
  /** Closed polygon wire through the points (the last point joins the first). */
  polygon(points: Vec3[]): ShapeHandle;
  /** Planar face bounded by a closed wire, with optional hole wires. */
  face(outer: ShapeHandle, holes?: ShapeHandle[]): ShapeHandle;
  /** Extrude a face (to a solid) or a wire (to a shell) along a vector. Checked. */
  extrude(profile: ShapeHandle, vector: Vec3): ShapeHandle;
  /** Revolve a face or wire about an axis by angleDeg (360 for a full turn). Checked. */
  revolve(profile: ShapeHandle, axis: Axis, angleDeg: number): ShapeHandle;
  /** Loft through closed wires in order. Checked when solid. */
  loft(wires: ShapeHandle[], options?: { solid?: boolean; ruled?: boolean }): ShapeHandle;

  // ---- transforms (return new handles; inputs are unchanged) ----------------------------
  translate(shape: ShapeHandle, offset: Vec3): ShapeHandle;
  rotate(shape: ShapeHandle, angleDeg: number, axis?: Axis): ShapeHandle;
  mirror(shape: ShapeHandle, plane: Plane): ShapeHandle;
  scale(shape: ShapeHandle, factor: number, center?: Vec3): ShapeHandle;
  /** Rigid placement by translation plus quaternion. Shares topology (O(1)). */
  place(shape: ShapeHandle, transform: Transform): ShapeHandle;
  copy(shape: ShapeHandle): ShapeHandle;

  // ---- booleans (checked, single solids unwrapped) ---------------------------------------
  fuse(a: ShapeHandle, b: ShapeHandle): ShapeHandle;
  cut(a: ShapeHandle, b: ShapeHandle): ShapeHandle;
  common(a: ShapeHandle, b: ShapeHandle): ShapeHandle;
  /** One batched union. Much faster than repeated fuse(). */
  fuseAll(shapes: ShapeHandle[]): ShapeHandle;
  /** One batched subtraction of every tool from base. */
  cutAll(base: ShapeHandle, tools: ShapeHandle[]): ShapeHandle;

  // ---- features (checked; the input is unwrapped to a solid first) ----------------------
  fillet(solid: ShapeHandle, edges: ShapeHandle[], radius: number): ShapeHandle;
  chamfer(solid: ShapeHandle, edges: ShapeHandle[], distance: number): ShapeHandle;
  /** Hollow a solid, removing the given faces. Negative thickness grows inward. */
  shell(solid: ShapeHandle, facesToRemove: ShapeHandle[], thickness: number, tolerance?: number): ShapeHandle;

  // ---- topology and queries --------------------------------------------------------------
  shapeType(shape: ShapeHandle): ShapeKind;
  /** Sub-shapes in a stable order. The 1-based position is the element index. */
  subShapes(shape: ShapeHandle, kind: SubShapeKind): ShapeHandle[];
  counts(shape: ShapeHandle): ShapeCounts;
  /** Plain data for every edge of shape. Creates no lasting handles. */
  edges(shape: ShapeHandle): EdgeInfo[];
  /** Plain data for every face of shape. Creates no lasting handles. */
  faces(shape: ShapeHandle): FaceInfo[];
  edgeInfo(edge: ShapeHandle, index?: number): EdgeInfo;
  faceInfo(face: ShapeHandle, index?: number): FaceInfo;
  /** A single solid: returns it, unwraps a one-solid compound, or throws NOT_A_SOLID. */
  asSolid(shape: ShapeHandle): ShapeHandle;
  isSame(a: ShapeHandle, b: ShapeHandle): boolean;

  // ---- measurement -------------------------------------------------------------------------
  isValid(shape: ShapeHandle): boolean;
  volume(shape: ShapeHandle): number;
  area(shape: ShapeHandle): number;
  bbox(shape: ShapeHandle): BBox;
  centerOfMass(shape: ShapeHandle): Vec3;
  /** Minimum distance between two shapes, 0 when they touch or overlap. */
  distance(a: ShapeHandle, b: ShapeHandle): number;
  measure(shape: ShapeHandle): ShapeMeasure;
  tessellate(shape: ShapeHandle, options?: TessellateOptions): MeshData;

  // ---- exchange ----------------------------------------------------------------------------
  exportStep(shape: ShapeHandle): string;
  /** Binary STL. */
  exportStl(shape: ShapeHandle, options?: { linearDeflection?: number }): Uint8Array;
  importStep(data: string): ShapeHandle;
  /** OCCT BREP text, for caching and moving shapes between kernel instances. */
  toBrep(shape: ShapeHandle): string;
  fromBrep(data: string): ShapeHandle;
  createDocument(): XcafDocument;

  // ---- renders (deterministic CPU hidden-line views) -------------------------------------
  multiviewSvg(shape: ShapeHandle, options?: MultiviewOptions): string;
  multiviewPng(shape: ShapeHandle, options?: MultiviewOptions): Promise<Uint8Array>;

  // ---- memory ------------------------------------------------------------------------------
  /** Mark the handle table. Pair with releaseSince() around every job. */
  checkpoint(): number;
  /** Release every handle created after the mark. */
  releaseSince(mark: number): void;
  release(shape: ShapeHandle): void;
  stats(): KernelStats;
}
