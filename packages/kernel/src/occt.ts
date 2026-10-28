// The occt-wasm implementation of KernelAdapter, and initKernel().
//
// stdout rule: OCCT's STEP writer prints "Statistics on Transfer" through Emscripten's
// out(), which defaults to console.log, which would corrupt an MCP stdio stream. occt-wasm
// has no print option, but OcctKernel.init accepts a createModule factory: wrapping the
// shipped factory lets us inject Module.print and Module.printErr. Every printed line goes
// to the sink, never to process.stdout. Workers add a second fence (stdout: true).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OcctKernel } from "occt-wasm";
import type { BoundingBox, OcctModuleFactory, Vec3 as OcctVec3, XCAFDocument } from "occt-wasm";
import type { BBox, Transform, Vec3 } from "@open3dj/schemas";
import type {
  Axis, EdgeInfo, FaceInfo, KernelAdapter, KernelStats, KernelVersions, Label, MeshData, MultiviewOptions,
  Plane, ShapeCounts, ShapeHandle, ShapeKind, ShapeMeasure, SubShapeKind, TessellateOptions, XcafDocument,
  XcafLabelInfo, XcafLocation,
} from "./adapter.ts";
import { KernelError, toKernelError } from "./errors.ts";
import { isUnitQuaternion, matrixFromTransform } from "./transform.ts";

export type PrintStream = "out" | "err";
/** Receives every line the kernel prints. Must not write to process.stdout. */
export type PrintSink = (stream: PrintStream, line: string) => void;

export interface InitKernelOptions {
  /** Where kernel output goes. Default: kept in a ring buffer (see Kernel.printed()). */
  sink?: PrintSink;
  /** The occt-wasm.wasm bytes or path, when not loading it from next to the glue. */
  wasm?: string | URL | ArrayBuffer | Uint8Array;
}

/** A KernelAdapter backed by one occt-wasm instance. */
export interface Kernel extends KernelAdapter {
  /** The underlying OcctKernel, for brepjs (OcctWasmAdapter.fromKernel). Bypasses checks. */
  readonly raw: OcctKernel;
  /** The last lines the kernel printed (at most 200). */
  printed(): string[];
}

const RING = 200;

export async function initKernel(options: InitKernelOptions = {}): Promise<Kernel> {
  const ring: string[] = [];
  let printedLines = 0;
  const sink: PrintSink = (stream, line) => {
    printedLines++;
    ring.push(`${stream}: ${line}`);
    if (ring.length > RING) ring.shift();
    options.sink?.(stream, line);
  };
  // The glue has no type declarations; a variable specifier keeps tsc from asking for them.
  const gluePath = "occt-wasm/dist/occt-wasm.js";
  const glue = (await import(gluePath)) as { default: OcctModuleFactory };
  const createModule: OcctModuleFactory = (moduleOptions) =>
    glue.default({
      ...moduleOptions,
      print: (s: unknown) => sink("out", String(s)),
      printErr: (s: unknown) => sink("err", String(s)),
    });
  const raw = await OcctKernel.init(options.wasm === undefined ? { createModule } : { createModule, wasm: options.wasm });
  return new OcctAdapter(raw, () => ring.slice(), () => printedLines);
}

let cachedVersions: KernelVersions | undefined;
function readVersions(): KernelVersions {
  if (!cachedVersions) {
    const pkgUrl = new URL("../package.json", import.meta.resolve("occt-wasm"));
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version: string };
    cachedVersions = { occtWasm: pkg.version };
  }
  return cachedVersions;
}

const v = (p: Vec3): OcctVec3 => ({ x: p[0], y: p[1], z: p[2] });
const t3 = (p: OcctVec3): Vec3 => [p.x, p.y, p.z];
const box3 = (b: BoundingBox): BBox => ({ min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] });
const DEG = Math.PI / 180;

function finite(op: string, ...xs: number[]): void {
  for (const x of xs) {
    if (typeof x !== "number" || !Number.isFinite(x)) throw new KernelError("BAD_ARGUMENT", op, `${op}: arguments must be finite numbers`);
  }
}
function positive(op: string, ...xs: number[]): void {
  finite(op, ...xs);
  for (const x of xs) if (x <= 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: sizes must be greater than 0, got ${x}`);
}

class OcctAdapter implements Kernel {
  readonly raw: OcctKernel;
  readonly #printed: () => string[];
  readonly #printedCount: () => number;

  constructor(raw: OcctKernel, printed: () => string[], printedCount: () => number) {
    this.raw = raw;
    this.#printed = printed;
    this.#printedCount = printedCount;
  }

  get versions(): KernelVersions {
    return readVersions();
  }

  printed(): string[] {
    return this.#printed();
  }

  // Run one kernel call and convert any failure to a KernelError.
  #call<T>(op: string, fn: () => T, faultyEdge?: (h: number) => string | undefined): T {
    try {
      return fn();
    } catch (e) {
      throw toKernelError(op, e, faultyEdge);
    }
  }

  // Shape-changing ops: unwrap a single-solid compound, then insist on a valid result.
  #checked(op: string, fn: () => ShapeHandle, faultyEdge?: (h: number) => string | undefined): ShapeHandle {
    const result = this.#unwrapSingle(this.#call(op, fn, faultyEdge));
    this.#assertValid(op, result);
    return result;
  }

  #assertValid(op: string, shape: ShapeHandle): void {
    if (this.raw.isValid(shape)) return;
    const elements: string[] = [];
    const mark = this.raw.checkpoint();
    try {
      const faces = this.raw.getSubShapes(shape, "face");
      faces.forEach((f, i) => {
        if (elements.length < 20 && !this.raw.isValid(f)) elements.push(`face:${i + 1}`);
      });
    } catch {
      // The scan is best effort; the error below is what matters.
    } finally {
      this.raw.releaseSince(mark);
    }
    const c = this.counts(shape);
    throw new KernelError(
      "INVALID_RESULT",
      op,
      `${op} produced an invalid shape (${c.solids} solids, ${c.shells} shells, ${c.faces} faces); the kernel reported no error`,
      { elements, hint: op === "shell" ? "Shell before filleting, keep fillet radii larger than the wall, or remove fewer faces." : "Try smaller feature sizes or avoid coincident and tangent faces." },
    );
  }

  #unwrapSingle(shape: ShapeHandle): ShapeHandle {
    const type = this.raw.getShapeType(shape);
    if (type !== "compound" && type !== "compsolid") return shape;
    if (this.raw.subShapeCount(shape, "solid") !== 1) return shape;
    const [solid] = this.raw.getSubShapes(shape, "solid") as ShapeHandle[];
    return solid!;
  }

  // Map edge handles of `solid` to edge:<n> addresses (for faulty-edge reports).
  #edgeAddresser(solid: ShapeHandle): (h: number) => string | undefined {
    return (h) => {
      const mark = this.raw.checkpoint();
      try {
        const all = this.raw.getSubShapes(solid, "edge");
        const i = all.findIndex((e) => this.raw.isSame(e, h as ShapeHandle));
        return i >= 0 ? `edge:${i + 1}` : undefined;
      } catch {
        return undefined;
      } finally {
        this.raw.releaseSince(mark);
      }
    };
  }

  // ---- primitives ------------------------------------------------------------------------
  box(dx: number, dy: number, dz: number): ShapeHandle {
    positive("box", dx, dy, dz);
    return this.#call("box", () => this.raw.makeBox(dx, dy, dz) as ShapeHandle);
  }
  cylinder(radius: number, height: number): ShapeHandle {
    positive("cylinder", radius, height);
    return this.#call("cylinder", () => this.raw.makeCylinder(radius, height) as ShapeHandle);
  }
  cone(r1: number, r2: number, height: number): ShapeHandle {
    finite("cone", r1, r2);
    positive("cone", height);
    if (r1 < 0 || r2 < 0 || (r1 === 0 && r2 === 0)) throw new KernelError("BAD_ARGUMENT", "cone", "cone: radii must be >= 0 and not both 0");
    return this.#call("cone", () => this.raw.makeCone(r1, r2, height) as ShapeHandle);
  }
  sphere(radius: number): ShapeHandle {
    positive("sphere", radius);
    return this.#call("sphere", () => this.raw.makeSphere(radius) as ShapeHandle);
  }
  torus(majorRadius: number, minorRadius: number): ShapeHandle {
    positive("torus", majorRadius, minorRadius);
    return this.#call("torus", () => this.raw.makeTorus(majorRadius, minorRadius) as ShapeHandle);
  }

  // ---- curves, wires, faces, swept solids ------------------------------------------------
  lineEdge(start: Vec3, end: Vec3): ShapeHandle {
    return this.#call("lineEdge", () => this.raw.makeLineEdge(v(start), v(end)) as ShapeHandle);
  }
  arcEdge(start: Vec3, mid: Vec3, end: Vec3): ShapeHandle {
    return this.#call("arcEdge", () => this.raw.makeArcEdge(v(start), v(mid), v(end)) as ShapeHandle);
  }
  circleEdge(center: Vec3, normal: Vec3, radius: number): ShapeHandle {
    positive("circleEdge", radius);
    return this.#call("circleEdge", () => this.raw.makeCircleEdge(v(center), v(normal), radius) as ShapeHandle);
  }
  wire(edges: ShapeHandle[]): ShapeHandle {
    if (edges.length === 0) throw new KernelError("BAD_ARGUMENT", "wire", "wire: needs at least one edge");
    return this.#call("wire", () => this.raw.makeWire(edges) as ShapeHandle);
  }
  polygon(points: Vec3[]): ShapeHandle {
    if (points.length < 3) throw new KernelError("BAD_ARGUMENT", "polygon", "polygon: needs at least 3 points");
    const edges = points.map((p, i) => this.lineEdge(p, points[(i + 1) % points.length]!));
    return this.wire(edges);
  }
  face(outer: ShapeHandle, holes: ShapeHandle[] = []): ShapeHandle {
    return this.#call("face", () => {
      const f = this.raw.makeFace(outer) as ShapeHandle;
      return holes.length ? (this.raw.addHolesInFace(f, holes) as ShapeHandle) : f;
    });
  }
  extrude(profile: ShapeHandle, vector: Vec3): ShapeHandle {
    finite("extrude", ...vector);
    if (Math.hypot(...vector) === 0) throw new KernelError("BAD_ARGUMENT", "extrude", "extrude: the vector must not be zero");
    return this.#checked("extrude", () => this.raw.extrude(profile, vector[0], vector[1], vector[2]) as ShapeHandle);
  }
  revolve(profile: ShapeHandle, axis: Axis, angleDeg: number): ShapeHandle {
    finite("revolve", angleDeg);
    return this.#checked("revolve", () => this.raw.revolve(profile, { point: v(axis.origin), direction: v(axis.dir) }, angleDeg * DEG) as ShapeHandle);
  }
  loft(wires: ShapeHandle[], options: { solid?: boolean; ruled?: boolean } = {}): ShapeHandle {
    if (wires.length < 2) throw new KernelError("BAD_ARGUMENT", "loft", "loft: needs at least 2 wires");
    const solid = options.solid ?? true;
    const make = () => this.raw.loft(wires, solid, options.ruled ?? false) as ShapeHandle;
    return solid ? this.#checked("loft", make) : this.#call("loft", make);
  }

  // ---- transforms ------------------------------------------------------------------------
  translate(shape: ShapeHandle, offset: Vec3): ShapeHandle {
    finite("translate", ...offset);
    return this.#call("translate", () => this.raw.translate(shape, offset[0], offset[1], offset[2]) as ShapeHandle);
  }
  rotate(shape: ShapeHandle, angleDeg: number, axis: Axis = { origin: [0, 0, 0], dir: [0, 0, 1] }): ShapeHandle {
    finite("rotate", angleDeg, ...axis.dir, ...axis.origin);
    return this.#call("rotate", () => this.raw.rotate(shape, { point: v(axis.origin), direction: v(axis.dir) }, angleDeg * DEG) as ShapeHandle);
  }
  mirror(shape: ShapeHandle, plane: Plane): ShapeHandle {
    finite("mirror", ...plane.normal, ...plane.origin);
    return this.#call("mirror", () => this.raw.mirror(shape, v(plane.origin), v(plane.normal)) as ShapeHandle);
  }
  scale(shape: ShapeHandle, factor: number, center: Vec3 = [0, 0, 0]): ShapeHandle {
    positive("scale", factor);
    return this.#call("scale", () => this.raw.scale(shape, v(center), factor) as ShapeHandle);
  }
  place(shape: ShapeHandle, transform: Transform): ShapeHandle {
    finite("place", ...transform.t, ...transform.q);
    if (!isUnitQuaternion(transform.q)) {
      throw new KernelError("BAD_ARGUMENT", "place", `place: quaternion [${transform.q.join(", ")}] is not unit length`);
    }
    return this.#call("place", () => this.raw.located(shape, matrixFromTransform(transform)) as ShapeHandle);
  }
  copy(shape: ShapeHandle): ShapeHandle {
    return this.#call("copy", () => this.raw.copy(shape) as ShapeHandle);
  }
  compound(shapes: ShapeHandle[]): ShapeHandle {
    return this.#call("compound", () => this.raw.makeCompound(shapes) as ShapeHandle);
  }

  // ---- booleans --------------------------------------------------------------------------
  fuse(a: ShapeHandle, b: ShapeHandle): ShapeHandle {
    return this.#checked("fuse", () => this.raw.fuse(a, b) as ShapeHandle);
  }
  cut(a: ShapeHandle, b: ShapeHandle): ShapeHandle {
    return this.#checked("cut", () => this.raw.cut(a, b) as ShapeHandle);
  }
  common(a: ShapeHandle, b: ShapeHandle): ShapeHandle {
    return this.#checked("common", () => this.raw.common(a, b) as ShapeHandle);
  }
  fuseAll(shapes: ShapeHandle[]): ShapeHandle {
    if (shapes.length === 0) throw new KernelError("BAD_ARGUMENT", "fuseAll", "fuseAll: needs at least one shape");
    if (shapes.length === 1) return shapes[0]!;
    return this.#checked("fuseAll", () => this.raw.fuseAll(shapes) as ShapeHandle);
  }
  cutAll(base: ShapeHandle, tools: ShapeHandle[]): ShapeHandle {
    if (tools.length === 0) return base;
    return this.#checked("cutAll", () => this.raw.cutAll(base, tools) as ShapeHandle);
  }

  // ---- features --------------------------------------------------------------------------
  fillet(solid: ShapeHandle, edges: ShapeHandle[], radius: number): ShapeHandle {
    positive("fillet", radius);
    if (edges.length === 0) throw new KernelError("BAD_ARGUMENT", "fillet", "fillet: the edge query matched no edges", { hint: "Check the edge selector; inspect the part's edges first." });
    const s = this.asSolid(solid);
    return this.#checked("fillet", () => this.raw.fillet(s, edges, radius) as ShapeHandle, this.#edgeAddresser(s));
  }
  chamfer(solid: ShapeHandle, edges: ShapeHandle[], distance: number): ShapeHandle {
    positive("chamfer", distance);
    if (edges.length === 0) throw new KernelError("BAD_ARGUMENT", "chamfer", "chamfer: the edge query matched no edges", { hint: "Check the edge selector; inspect the part's edges first." });
    const s = this.asSolid(solid);
    return this.#checked("chamfer", () => this.raw.chamfer(s, edges, distance) as ShapeHandle, this.#edgeAddresser(s));
  }
  shell(solid: ShapeHandle, facesToRemove: ShapeHandle[], thickness: number, tolerance = 1e-6): ShapeHandle {
    finite("shell", thickness, tolerance);
    if (thickness === 0) throw new KernelError("BAD_ARGUMENT", "shell", "shell: thickness must not be 0");
    const s = this.asSolid(solid);
    return this.#checked("shell", () => this.raw.shell(s, facesToRemove, thickness, tolerance) as ShapeHandle);
  }

  // ---- topology and queries --------------------------------------------------------------
  shapeType(shape: ShapeHandle): ShapeKind {
    return this.#call("shapeType", () => this.raw.getShapeType(shape) as ShapeKind);
  }
  subShapes(shape: ShapeHandle, kind: SubShapeKind): ShapeHandle[] {
    return this.#call("subShapes", () => this.raw.getSubShapes(shape, kind) as ShapeHandle[]);
  }
  counts(shape: ShapeHandle): ShapeCounts {
    return this.#call("counts", () => ({
      solids: this.raw.subShapeCount(shape, "solid"),
      shells: this.raw.subShapeCount(shape, "shell"),
      faces: this.raw.subShapeCount(shape, "face"),
      edges: this.raw.subShapeCount(shape, "edge"),
      vertices: this.raw.subShapeCount(shape, "vertex"),
    }));
  }
  edges(shape: ShapeHandle): EdgeInfo[] {
    const mark = this.raw.checkpoint();
    try {
      return this.subShapes(shape, "edge").map((e, i) => this.edgeInfo(e, i + 1));
    } finally {
      this.raw.releaseSince(mark);
    }
  }
  faces(shape: ShapeHandle): FaceInfo[] {
    const mark = this.raw.checkpoint();
    try {
      return this.subShapes(shape, "face").map((f, i) => this.faceInfo(f, i + 1));
    } finally {
      this.raw.releaseSince(mark);
    }
  }
  edgeInfo(edge: ShapeHandle, index = 0): EdgeInfo {
    return this.#call("edgeInfo", () => {
      const k = this.raw;
      const { first, last } = k.curveParameters(edge);
      return {
        index,
        curve: k.curveType(edge),
        length: k.curveLength(edge),
        bbox: box3(k.getBoundingBox(edge)),
        start: t3(k.curvePointAtParam(edge, first)),
        end: t3(k.curvePointAtParam(edge, last)),
        mid: t3(k.curvePointAtParam(edge, (first + last) / 2)),
        closed: k.curveIsClosed(edge),
      };
    });
  }
  faceInfo(face: ShapeHandle, index = 0): FaceInfo {
    return this.#call("faceInfo", () => {
      const k = this.raw;
      const uv = k.uvBounds(face);
      const u = (uv.uMin + uv.uMax) / 2;
      const w = (uv.vMin + uv.vMax) / 2;
      return {
        index,
        surface: k.surfaceType(face),
        area: k.getSurfaceArea(face),
        bbox: box3(k.getBoundingBox(face)),
        center: t3(k.getSurfaceCenterOfMass(face)),
        normal: t3(k.surfaceNormal(face, u, w)),
      };
    });
  }
  asSolid(shape: ShapeHandle): ShapeHandle {
    const type = this.shapeType(shape);
    if (type === "solid") return shape;
    const n = type === "compound" || type === "compsolid" ? this.raw.subShapeCount(shape, "solid") : 0;
    if (n === 1) return this.#unwrapSingle(shape);
    throw new KernelError("NOT_A_SOLID", "asSolid", `expected one solid, got a ${type} with ${n} solids`, {
      hint: n > 1 ? "Fuse the bodies first, or apply the feature to each body." : "Build a closed solid (extrude a face, not a wire).",
    });
  }
  isSame(a: ShapeHandle, b: ShapeHandle): boolean {
    return this.#call("isSame", () => this.raw.isSame(a, b));
  }

  // ---- measurement ---------------------------------------------------------------------
  isValid(shape: ShapeHandle): boolean {
    return this.#call("isValid", () => this.raw.isValid(shape));
  }
  volume(shape: ShapeHandle): number {
    return this.#call("volume", () => this.raw.getVolume(shape));
  }
  area(shape: ShapeHandle): number {
    return this.#call("area", () => this.raw.getSurfaceArea(shape));
  }
  bbox(shape: ShapeHandle): BBox {
    return this.#call("bbox", () => box3(this.raw.getBoundingBox(shape, { precise: true })));
  }
  centerOfMass(shape: ShapeHandle): Vec3 {
    return this.#call("centerOfMass", () => t3(this.raw.getCenterOfMass(shape)));
  }
  distance(a: ShapeHandle, b: ShapeHandle): number {
    return this.#call("distance", () => this.raw.distanceBetween(a, b));
  }
  measure(shape: ShapeHandle): ShapeMeasure {
    return {
      valid: this.isValid(shape),
      volume: this.volume(shape),
      area: this.area(shape),
      bbox: this.bbox(shape),
      centerOfMass: this.centerOfMass(shape),
      counts: this.counts(shape),
    };
  }
  tessellate(shape: ShapeHandle, options: TessellateOptions = {}): MeshData {
    const linearDeflection = options.linearDeflection ?? 0.1;
    positive("tessellate", linearDeflection);
    return this.#call("tessellate", () => {
      const m = this.raw.tessellate(shape, { linearDeflection, angularDeflection: options.angularDeflection ?? 0.5 });
      return { positions: m.positions, normals: m.normals, indices: m.indices, vertexCount: m.vertexCount, triangleCount: m.triangleCount };
    });
  }

  // ---- exchange --------------------------------------------------------------------------
  exportStep(shape: ShapeHandle): string {
    return this.#call("exportStep", () => this.raw.exportStep(shape));
  }
  exportStl(shape: ShapeHandle, options: { linearDeflection?: number } = {}): Uint8Array {
    return this.#call("exportStl", () => this.raw.exportStl(shape, options.linearDeflection ?? 0.1, false));
  }
  importStep(data: string): ShapeHandle {
    return this.#call("importStep", () => this.raw.importStep(data) as ShapeHandle);
  }
  toBrep(shape: ShapeHandle): string {
    return this.#call("toBrep", () => this.raw.toBREP(shape));
  }
  fromBrep(data: string): ShapeHandle {
    return this.#call("fromBrep", () => this.raw.fromBREP(data) as ShapeHandle);
  }
  createDocument(): XcafDocument {
    return new OcctXcafDocument(this.#call("createDocument", () => this.raw.createXCAFDocument()));
  }

  // ---- renders ---------------------------------------------------------------------------
  multiviewSvg(shape: ShapeHandle, options: MultiviewOptions = {}): string {
    return this.#call("multiviewSvg", () => this.raw.toMultiviewSVG(shape, options));
  }
  async multiviewPng(shape: ShapeHandle, options: MultiviewOptions = {}): Promise<Uint8Array> {
    try {
      return await this.raw.toMultiviewPNG(shape, options);
    } catch (e) {
      throw toKernelError("multiviewPng", e);
    }
  }

  // ---- memory ----------------------------------------------------------------------------
  checkpoint(): number {
    return this.raw.checkpoint();
  }
  releaseSince(mark: number): void {
    this.raw.releaseSince(mark);
  }
  release(shape: ShapeHandle): void {
    this.raw.release(shape);
  }
  stats(): KernelStats {
    let wasmHeapBytes = 0;
    try {
      wasmHeapBytes = this.raw.getRawModule().HEAP32.buffer.byteLength;
    } catch {
      // Not available on every build; report 0 rather than fail.
    }
    return { liveShapes: this.raw.shapeCount, wasmHeapBytes, printedLines: this.#printedCount() };
  }
}

class OcctXcafDocument implements XcafDocument {
  readonly #doc: XCAFDocument;
  constructor(doc: XCAFDocument) {
    this.#doc = doc;
  }
  #call<T>(op: string, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw toKernelError(op, e);
    }
  }
  addShape(shape: ShapeHandle, options: { name?: string; color?: [number, number, number]; assembly?: boolean } = {}): Label {
    return this.#call("xcaf.addShape", () => this.#doc.addShape(shape, options) as number as Label);
  }
  addChild(parent: Label, shape: ShapeHandle, options: { name?: string; color?: [number, number, number]; location?: XcafLocation } = {}): Label {
    return this.#call("xcaf.addChild", () => this.#doc.addChild(parent as never, shape, options) as number as Label);
  }
  setName(label: Label, name: string): void {
    this.#call("xcaf.setName", () => this.#doc.setName(label as never, name));
  }
  setColor(label: Label, color: [number, number, number]): void {
    this.#call("xcaf.setColor", () => this.#doc.setColor(label as never, color));
  }
  getReferredLabel(label: Label): Label | null {
    return this.#call("xcaf.getReferredLabel", () => this.#doc.getReferredLabel(label as never) as number | null as Label | null);
  }
  getChildren(label: Label): Label[] {
    return this.#call("xcaf.getChildren", () => this.#doc.getChildren(label as never) as number[] as Label[]);
  }
  getRoots(): Label[] {
    return this.#call("xcaf.getRoots", () => this.#doc.getRoots() as number[] as Label[]);
  }
  getLabelInfo(label: Label): XcafLabelInfo {
    return this.#call("xcaf.getLabelInfo", () => {
      const i = this.#doc.getLabelInfo(label as never);
      return { name: i.name, isAssembly: i.isAssembly, isComponent: i.isComponent, color: i.hasColor ? [...i.color] as [number, number, number] : null };
    });
  }
  getLocation(label: Label): number[] {
    return this.#call("xcaf.getLocation", () => this.#doc.getLocation(label as never));
  }
  exportStep(): string {
    return this.#call("xcaf.exportStep", () => this.#doc.exportSTEP());
  }
  exportGlb(options: TessellateOptions = {}): Uint8Array {
    return this.#call("xcaf.exportGlb", () => this.#doc.exportGLTF({ linearDeflection: options.linearDeflection ?? 0.1, angularDeflection: options.angularDeflection ?? 0.5 }));
  }
  close(): void {
    this.#doc.close();
  }
}
