// The occt-wasm implementation of KernelAdapter, and initKernel().
//
// stdout rule: OCCT's STEP writer prints "Statistics on Transfer" through Emscripten's
// out(), which defaults to console.log, which would corrupt an MCP stdio stream. occt-wasm
// has no print option, but OcctKernel.init accepts a createModule factory: wrapping the
// shipped factory lets us inject Module.print and Module.printErr. Every printed line goes
// to the sink, never to process.stdout. Workers add a second fence (stdout: true).
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OcctKernel } from "occt-wasm";
import type { BoundingBox, OcctModuleFactory, Vec3 as OcctVec3, XCAFDocument } from "occt-wasm";
import type { BBox, Transform, Vec3 } from "@open3dj/schemas";
import type {
  Axis, ContinuityTable, ContinuityTolerances, CurvatureTable, CurvePoint, EdgeContinuity, EdgeInfo, FaceCurvature, FaceInfo, KernelAdapter, KernelStats, KernelVersions, Label, MeshData, MultiviewOptions,
  NurbsCurve, Plane, ShapeCounts, ShapeHandle, ShapeKind, ShapeMeasure, SplineOptions, SubShapeKind, SweepOptions,
  TessellateOptions, XcafDocument, XcafLabelInfo, XcafLocation,
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
  /**
   * A new, empty kernel instance with the same options, so its output goes to the same sink.
   * It reuses this thread's compiled WebAssembly module, so it costs an instantiation, not a
   * compile. Record requests run on one (ARCHITECTURE.md section 8). Dispose it when done.
   */
  fresh(): Promise<Kernel>;
  /** Release every shape and the instance itself. The kernel must not be used afterwards. */
  dispose(): void;
}

const RING = 200;

// The compiled occt-wasm module of this thread. Instantiating a compiled module skips
// reading and compiling the binary again, which is most of the cost of a new instance.
let compiled: Promise<WebAssembly.Module> | undefined;
function compiledModule(): Promise<WebAssembly.Module> {
  if (!compiled) {
    const url = import.meta.resolve("occt-wasm/dist/occt-wasm.wasm");
    compiled = readFile(fileURLToPath(url)).then((bytes) => WebAssembly.compile(bytes));
    // A failed compile is not cached: the next call tries again.
    compiled.catch(() => (compiled = undefined));
  }
  return compiled;
}

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
  // Without an explicit binary, instantiate this thread's compiled module through
  // Emscripten's instantiateWasm hook. An instantiation error rejects `failed`, because the
  // glue would otherwise wait for the instance forever.
  const wasmModule = options.wasm === undefined ? await compiledModule() : undefined;
  let fail: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  const instantiate = (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
    WebAssembly.instantiate(wasmModule!, imports).then((instance) => done(instance, wasmModule!), fail);
    return {};
  };
  const createModule: OcctModuleFactory = (moduleOptions) =>
    glue.default({
      ...moduleOptions,
      ...(wasmModule ? { instantiateWasm: instantiate } : {}),
      print: (s: unknown) => sink("out", String(s)),
      printErr: (s: unknown) => sink("err", String(s)),
    });
  const raw = await Promise.race([OcctKernel.init(options.wasm === undefined ? { createModule } : { createModule, wasm: options.wasm }), failed]);
  return new OcctAdapter(raw, () => ring.slice(), () => printedLines, () => initKernel(options));
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
/** Consecutive spline points must be at least this far apart (mm): OCCT fails, with an empty message, at 1e-7. */
const MIN_POINT_GAP = 1e-6;
/** The highest Bezier and B-spline degree OCCT accepts. */
const MAX_DEGREE = 25;
/** occt-wasm's SweepMode and TransitionMode values (Auxiliary is 3). */
const SWEEP_MODES: Readonly<Record<string, number>> = { fixed: 0, frenet: 1, up: 2, guide: 3 };
const SWEEP_CORNERS: Readonly<Record<string, number>> = { right: 1, round: 2 };
/** A name in occt-wasm's CurvatureData, whatever it holds (see #curvatureSlots). */
type CurvatureSlot = "min" | "max" | "gaussian" | "mean";
/** Default continuity tolerances: 1 um gap, 0.1 degree, and a curvature jump of 1e-5 /mm or 1%. */
const CONTINUITY_TOLERANCES: ContinuityTolerances = { gap: 1e-3, angle: 0.1, curvature: 1e-5, relative: 0.01 };
const normalized = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : a;
};
/** The angle between two directions in degrees, accurate for tiny angles. */
const angleBetween = (a: Vec3, b: Vec3): number => (Math.atan2(Math.hypot(...cross(a, b)), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI;
/** Samples for the sweep overlap check: along the whole path, and per profile edge. */
const PATH_SAMPLES = 512;
const PROFILE_SAMPLES = 64;

/** The radius of the circle through three points; Infinity when they lie on a line. */
function circumradius(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = gap(a, b), bc = gap(b, c), ca = gap(c, a);
  const area2 = Math.hypot(...cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
  return area2 < 1e-12 * ab * ca ? Infinity : (ab * bc * ca) / (2 * area2);
}

const withArticle = (word: string): string => `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function point(op: string, p: Vec3, i: number): void {
  if (!Array.isArray(p) || p.length !== 3) throw new KernelError("BAD_ARGUMENT", op, `${op}: point ${i + 1} must be [x, y, z]`);
  finite(op, ...p);
}
/** At least min points, each [x, y, z] and finite, with no two in a row closer than MIN_POINT_GAP. */
function pointList(op: string, points: Vec3[], min: number): void {
  if (!Array.isArray(points) || points.length < min) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs at least ${min} points, got ${Array.isArray(points) ? points.length : 0}`);
  points.forEach((p, i) => point(op, p, i));
  for (let i = 1; i < points.length; i++) {
    if (gap(points[i - 1]!, points[i]!) < MIN_POINT_GAP) throw new KernelError("BAD_ARGUMENT", op, `${op}: points ${i} and ${i + 1} coincide (closer than ${MIN_POINT_GAP} mm)`);
  }
}
function direction(op: string, name: string, d: Vec3): void {
  if (!Array.isArray(d) || d.length !== 3) throw new KernelError("BAD_ARGUMENT", op, `${op}: ${name} must be [x, y, z]`);
  finite(op, ...d);
  if (Math.hypot(...d) === 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: ${name} must not be zero`);
}
function positive(op: string, ...xs: number[]): void {
  finite(op, ...xs);
  for (const x of xs) if (x <= 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: sizes must be greater than 0, got ${x}`);
}

class OcctAdapter implements Kernel {
  readonly raw: OcctKernel;
  readonly #printed: () => string[];
  readonly #printedCount: () => number;
  readonly #fresh: () => Promise<Kernel>;

  constructor(raw: OcctKernel, printed: () => string[], printedCount: () => number, fresh: () => Promise<Kernel>) {
    this.raw = raw;
    this.#printed = printed;
    this.#printedCount = printedCount;
    this.#fresh = fresh;
  }

  fresh(): Promise<Kernel> {
    return this.#fresh();
  }

  dispose(): void {
    this.raw[Symbol.dispose]();
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
  vertex(point: Vec3): ShapeHandle {
    return this.#call("vertex", () => this.raw.makeVertex(point[0], point[1], point[2]) as ShapeHandle);
  }
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
  loft(wires: ShapeHandle[], options: { solid?: boolean; ruled?: boolean; start?: Vec3; end?: Vec3 } = {}): ShapeHandle {
    const { start, end } = options;
    const tips = start !== undefined || end !== undefined;
    if (wires.length < (tips ? 1 : 2)) throw new KernelError("BAD_ARGUMENT", "loft", "loft: needs at least 2 wires, or a wire and a start or end point");
    if (start !== undefined) point("loft", start, 0);
    if (end !== undefined) point("loft", end, 1);
    const solid = options.solid ?? true;
    const ruled = options.ruled ?? false;
    if (solid) {
      wires.forEach((w, i) => {
        if (!this.#isClosedWire(w)) throw new KernelError("BAD_ARGUMENT", "loft", `loft: section ${i + 1} is not closed; a solid loft needs closed outlines`, { hint: "Close each section, for example spline3d(points, { closed: true }) or a placed sketch." });
      });
    }
    const make = tips
      ? () => this.raw.loftWithVertices(wires, solid, ruled, (start ? this.vertex(start) : 0) as ShapeHandle, (end ? this.vertex(end) : 0) as ShapeHandle) as ShapeHandle
      : () => this.raw.loft(wires, solid, ruled) as ShapeHandle;
    return solid ? this.#checked("loft", make) : this.#call("loft", make);
  }

  // A wire is closed when every end of every edge meets an end of another edge (or the one
  // edge closes on itself).
  #isClosedWire(wire: ShapeHandle): boolean {
    const mark = this.raw.checkpoint();
    try {
      const edges = this.raw.getSubShapes(wire, "edge") as ShapeHandle[];
      if (edges.length === 1) return this.raw.curveIsClosed(edges[0]!);
      const ends = edges.flatMap((e, i) => [0, 1].map((t) => ({ i, p: this.curveAt(e, t).point })));
      return ends.every((a) => ends.some((b) => b.i !== a.i && gap(a.p, b.p) < 1e-6));
    } finally {
      this.raw.releaseSince(mark);
    }
  }

  // ---- free-form curves ------------------------------------------------------------------
  // OCCT fails on several of these inputs with an empty message, so they are refused here
  // with one that says what to change.
  splineEdge(points: Vec3[], options: SplineOptions = {}): ShapeHandle {
    const op = "splineEdge";
    const periodic = options.periodic ?? false;
    pointList(op, points, 2);
    if (periodic && points.length < 3) throw new KernelError("BAD_ARGUMENT", op, `${op}: a periodic spline needs at least 3 points, got ${points.length}`);
    if (periodic && gap(points[0]!, points.at(-1)!) < MIN_POINT_GAP) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: a periodic spline closes itself; do not repeat the first point at the end`);
    }
    const { startTangent: start, endTangent: end } = options;
    if ((start === undefined) !== (end === undefined)) throw new KernelError("BAD_ARGUMENT", op, `${op}: give both startTangent and endTangent, or neither`);
    if (start && end) {
      if (periodic) throw new KernelError("BAD_ARGUMENT", op, `${op}: startTangent and endTangent cannot be used here, because a periodic spline has no ends`);
      direction(op, "startTangent", start);
      direction(op, "endTangent", end);
      return this.#call(op, () => this.raw.interpolatePointsWithTangents(points.map(v), v(start), v(end)) as ShapeHandle);
    }
    return this.#call(op, () => this.raw.interpolatePoints(points.map(v), periodic) as ShapeHandle);
  }
  approximateEdge(points: Vec3[], tolerance = 1e-3): ShapeHandle {
    const op = "approximateEdge";
    pointList(op, points, 2);
    if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance <= 0) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: tolerance must be a finite number greater than 0, got ${tolerance}`);
    }
    return this.#call(op, () => this.raw.approximatePoints(points.map(v), tolerance) as ShapeHandle);
  }
  bezierEdge(poles: Vec3[]): ShapeHandle {
    const op = "bezierEdge";
    pointList(op, poles, 2);
    if (poles.length > MAX_DEGREE + 1) throw new KernelError("BAD_ARGUMENT", op, `${op}: at most ${MAX_DEGREE + 1} poles (degree ${MAX_DEGREE}), got ${poles.length}`);
    return this.#call(op, () => this.raw.makeBezierEdge(poles.map(v)) as ShapeHandle);
  }
  nurbsEdge(curve: NurbsCurve): ShapeHandle {
    const op = "nurbsEdge";
    const { degree, poles, weights, knots, multiplicities } = curve;
    const periodic = curve.periodic ?? false;
    if (!Number.isInteger(degree) || degree < 1 || degree > MAX_DEGREE) throw new KernelError("BAD_ARGUMENT", op, `${op}: degree must be a whole number from 1 to ${MAX_DEGREE}, got ${degree}`);
    if (!Array.isArray(poles) || poles.length < 2) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs at least 2 poles`);
    poles.forEach((p, i) => point(op, p, i));
    if (!Array.isArray(knots) || knots.length < 2) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs at least 2 knots`);
    finite(op, ...knots);
    for (let i = 1; i < knots.length; i++) {
      if (!(knots[i]! > knots[i - 1]!)) throw new KernelError("BAD_ARGUMENT", op, `${op}: knots must increase strictly; knot ${i + 1} (${knots[i]}) follows ${knots[i - 1]}`);
    }
    if (!Array.isArray(multiplicities) || multiplicities.length !== knots.length || !multiplicities.every((m) => Number.isInteger(m) && m >= 1)) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: give one whole multiplicity of at least 1 per knot`);
    }
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== poles.length || !weights.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0))) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: weights must be one positive number per pole (${poles.length}), or left out`);
    }
    const sum = multiplicities.reduce((a, b) => a + b, 0);
    if (!periodic && sum !== poles.length + degree + 1) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: the multiplicities add up to ${sum}, but degree ${degree} on ${poles.length} poles needs poles + degree + 1 = ${poles.length + degree + 1}`);
    }
    return this.#call(op, () => this.raw.makeBSplineEdge(poles.flat(), weights ?? [], knots, multiplicities, degree, periodic) as ShapeHandle);
  }
  tangentArc(start: Vec3, tangent: Vec3, end: Vec3): ShapeHandle {
    const op = "tangentArc";
    point(op, start, 0);
    point(op, end, 1);
    direction(op, "tangent", tangent);
    const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    if (Math.hypot(...d) < MIN_POINT_GAP) throw new KernelError("BAD_ARGUMENT", op, `${op}: end must differ from start`);
    const c = cross(tangent, d);
    if (Math.hypot(...c) <= 1e-12 * Math.hypot(...tangent) * Math.hypot(...d)) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: end lies on the tangent line through start, so no arc fits; use a line edge`);
    }
    return this.#call(op, () => this.raw.makeTangentArc(v(start), v(tangent), v(end)) as ShapeHandle);
  }
  helix(axis: Axis, radius: number, pitch: number, height: number, options: { leftHanded?: boolean } = {}): ShapeHandle {
    const op = "helix";
    positive(op, radius, pitch, height);
    finite(op, ...axis.origin);
    direction(op, "the axis direction", axis.dir);
    return this.#call(op, () => this.raw.makeHelixWireHanded(v(axis.origin), v(axis.dir), pitch, height, radius, options.leftHanded ?? false) as ShapeHandle);
  }
  curveAt(edge: ShapeHandle, t: number): CurvePoint {
    const op = "curveAt";
    finite(op, t);
    if (t < 0 || t > 1) throw new KernelError("BAD_ARGUMENT", op, `${op}: t must be between 0 and 1, got ${t}`);
    this.#mustBe(op, edge, "edge");
    return this.#call(op, () => {
      const { first, last } = this.raw.curveParameters(edge);
      const param = first + t * (last - first);
      const tangent = t3(this.raw.curveTangent(edge, param));
      const n = Math.hypot(...tangent);
      return { point: t3(this.raw.curvePointAtParam(edge, param)), tangent: n > 0 ? [tangent[0] / n, tangent[1] / n, tangent[2] / n] : tangent };
    });
  }
  length(shape: ShapeHandle): number {
    this.#mustBe("length", shape, "edge", "wire");
    return this.#call("length", () => this.raw.getLength(shape));
  }
  nurbs(edge: ShapeHandle): NurbsCurve {
    const op = "nurbs";
    this.#mustBe(op, edge, "edge");
    const kind = this.#call(op, () => this.raw.curveType(edge));
    if (kind !== "bspline" && kind !== "bezier") throw new KernelError("BAD_ARGUMENT", op, `${op}: the edge is a ${kind}; nurbs() needs a bspline or bezier edge`);
    return this.#call(op, () => {
      const d = this.raw.getNurbsCurveData(edge);
      const poles: Vec3[] = [];
      for (let i = 0; i < d.poles.length; i += 3) poles.push([d.poles[i]!, d.poles[i + 1]!, d.poles[i + 2]!]);
      const curve: NurbsCurve = { degree: d.degree, poles, knots: [...d.knots], multiplicities: [...d.multiplicities], periodic: d.periodic };
      if (d.rational) curve.weights = [...d.weights];
      return curve;
    });
  }

  sweep(profile: ShapeHandle, path: ShapeHandle, options: SweepOptions = {}): ShapeHandle {
    const op = "sweep";
    const orient = options.orient ?? "fixed";
    const mode = SWEEP_MODES[orient];
    if (mode === undefined) throw new KernelError("BAD_ARGUMENT", op, `${op}: orient must be fixed, frenet, up or guide, got ${String(orient)}`);
    const transitionMode = SWEEP_CORNERS[options.corners ?? "right"];
    if (transitionMode === undefined) throw new KernelError("BAD_ARGUMENT", op, `${op}: corners must be right or round, got ${String(options.corners)}`);
    const up = options.up ?? [0, 0, 1];
    if (orient === "up") direction(op, "up", up);
    if (orient === "guide" && options.guide === undefined) throw new KernelError("BAD_ARGUMENT", op, `${op}: orient "guide" needs a guide wire`);
    const section = this.#asWire(op, "the profile", profile);
    const spine = this.#asWire(op, "the path", path);
    const guide = orient === "guide" ? this.#asWire(op, "the guide", options.guide!) : undefined;
    this.#sweepClearance(section, spine);
    const result = this.#checked(op, () => this.raw.sweepAdvanced(section, spine, {
      mode,
      up: v(up),
      ...(guide !== undefined ? { auxSpine: guide, curvilinearEquivalence: false } : {}),
      transitionMode,
    }) as ShapeHandle);
    if (this.raw.getShapeType(result) !== "solid") {
      throw new KernelError("NOT_A_SOLID", op, `${op}: the result is a ${this.raw.getShapeType(result)}, not a solid; the profile must be a closed outline`, { hint: "Close the profile, or sweep a face's outline." });
    }
    return result;
  }

  // OCCT's validity check passes a sweep that overlaps itself, and its volume then counts the
  // overlap twice. A tube is free of overlap when its profile's reach from the path stays under
  // the path's tightest bend radius, and where the path comes back near itself it keeps more
  // than twice the reach away. Both are measured on samples, and either failure is refused.
  #sweepClearance(section: ShapeHandle, spine: ShapeHandle): void {
    const op = "sweep";
    const mark = this.raw.checkpoint();
    try {
      const runs = this.#pathRuns(spine);
      const start = runs[0]![0]!;
      let reach = 0;
      for (const e of this.raw.getSubShapes(section, "edge") as ShapeHandle[]) {
        for (let i = 0; i <= PROFILE_SAMPLES; i++) reach = Math.max(reach, gap(this.curveAt(e, i / PROFILE_SAMPLES).point, start));
      }
      // Local: the circle through three samples in a row on one edge (a sharp corner between
      // edges is mitred or rounded, not bent).
      let bend = { radius: Infinity, at: start };
      for (const run of runs) {
        for (let i = 1; i + 1 < run.length; i++) {
          const radius = circumradius(run[i - 1]!, run[i]!, run[i + 1]!);
          if (radius < bend.radius) bend = { radius, at: run[i]! };
        }
      }
      const where = (p: Vec3) => `(${p.map((x) => x.toFixed(1)).join(", ")})`;
      if (reach >= bend.radius) {
        throw new KernelError("INVALID_RESULT", op, `${op}: the path bends to a radius of ${bend.radius.toFixed(2)} mm at ${where(bend.at)}, but the profile reaches ${reach.toFixed(2)} mm from it: the solid would fold over on itself`);
      }
      // Global: samples farther apart along the path than a half turn at the reach must stay
      // more than twice the reach apart.
      const points = runs.flatMap((run, r) => (r === 0 ? run : run.slice(1)));
      const along = [0];
      for (let i = 1; i < points.length; i++) along.push(along[i - 1]! + gap(points[i - 1]!, points[i]!));
      const total = along.at(-1)!;
      const closed = gap(points[0]!, points.at(-1)!) < 1e-6 * Math.max(1, total);
      let near = { distance: Infinity, at: start };
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const apart = along[j]! - along[i]!;
          if ((closed ? Math.min(apart, total - apart) : apart) <= Math.PI * reach) continue;
          const d = gap(points[i]!, points[j]!);
          if (d < near.distance) near = { distance: d, at: points[i]! };
        }
      }
      if (near.distance <= 2 * reach * (1 + 1e-9)) {
        throw new KernelError("INVALID_RESULT", op, `${op}: the path comes back within ${near.distance.toFixed(2)} mm of itself near ${where(near.at)}, but the profile reaches ${reach.toFixed(2)} mm on each side: the solid would overlap itself`);
      }
    } finally {
      this.raw.releaseSince(mark);
    }
  }

  // Samples along a path wire, one run per edge, each run turned to continue the one before.
  #pathRuns(spine: ShapeHandle): Vec3[][] {
    const edges = this.raw.getSubShapes(spine, "edge") as ShapeHandle[];
    const lengths = edges.map((e) => this.raw.curveLength(e));
    const total = lengths.reduce((a, b) => a + b, 0);
    const runs = edges.map((e, k) => {
      const n = Math.max(16, Math.ceil((PATH_SAMPLES * lengths[k]!) / total));
      return Array.from({ length: n + 1 }, (_, i) => this.curveAt(e, i / n).point);
    });
    for (let k = 0; k < runs.length; k++) {
      const run = runs[k]!;
      if (k === 0) {
        const next = runs[1];
        if (next && Math.min(gap(run[0]!, next[0]!), gap(run[0]!, next.at(-1)!)) < Math.min(gap(run.at(-1)!, next[0]!), gap(run.at(-1)!, next.at(-1)!))) run.reverse();
      } else if (gap(run.at(-1)!, runs[k - 1]!.at(-1)!) < gap(run[0]!, runs[k - 1]!.at(-1)!)) {
        run.reverse();
      }
    }
    return runs;
  }

  // ---- free-form surfaces ------------------------------------------------------------------
  surfaceGrid(rows: Vec3[][]): ShapeHandle {
    const op = "surfaceGrid";
    if (!Array.isArray(rows) || rows.length < 2) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs at least 2 rows of points`);
    const cols = Array.isArray(rows[0]) ? rows[0].length : 0;
    if (cols < 2 || !rows.every((r) => Array.isArray(r) && r.length === cols)) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: needs every row the same length, with at least 2 points`);
    }
    rows.forEach((r, i) => r.forEach((p, j) => point(op, p, i * cols + j)));
    return this.#call(op, () => this.raw.bsplineSurface(rows.flat().map(v), rows.length, cols) as ShapeHandle);
  }
  fill(wire: ShapeHandle): ShapeHandle {
    const op = "fill";
    const w = this.#asWire(op, "the boundary", wire);
    if (!this.#isClosedWire(w)) throw new KernelError("BAD_ARGUMENT", op, `${op}: the boundary is not closed`, { hint: "Fill a closed curve, for example spline3d(points, { closed: true })." });
    // A flat boundary gets an exact planar face; OCCT's plate filling takes about 0.4 s even for a square.
    if (this.#isPlanarWire(w)) return this.#call(op, () => this.raw.makeFace(w) as ShapeHandle);
    return this.#call(op, () => this.raw.makeNonPlanarFace(w) as ShapeHandle);
  }

  // Samples of the wire lie on one plane (Newell's normal), within 1e-7 of the wire's size.
  #isPlanarWire(wire: ShapeHandle): boolean {
    const mark = this.raw.checkpoint();
    try {
      const pts = (this.raw.getSubShapes(wire, "edge") as ShapeHandle[]).flatMap((e) => Array.from({ length: 16 }, (_, i) => this.curveAt(e, i / 16).point));
      const n: Vec3 = [0, 0, 0];
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        n[0] += (p[1] - q[1]) * (p[2] + q[2]);
        n[1] += (p[2] - q[2]) * (p[0] + q[0]);
        n[2] += (p[0] - q[0]) * (p[1] + q[1]);
      });
      const len = Math.hypot(...n);
      if (len === 0) return false;
      const c = pts.reduce<Vec3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
      const size = Math.max(...pts.map((p) => gap(p, c)));
      return pts.every((p) => Math.abs(((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]) / len) <= 1e-7 * Math.max(1, size));
    } finally {
      this.raw.releaseSince(mark);
    }
  }
  sew(faces: ShapeHandle[], tolerance = 1e-6): ShapeHandle {
    const op = "sew";
    if (!Array.isArray(faces) || faces.length === 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs at least one face`);
    positive(op, tolerance);
    const shell = this.#call(op, () => this.raw.sew(faces, tolerance) as ShapeHandle);
    const type = this.raw.getShapeType(shell);
    if (type !== "shell") throw new KernelError("BAD_ARGUMENT", op, `${op}: the faces do not join into one piece (sewing gave ${withArticle(type)})`, { hint: "Make neighbouring faces share their edges exactly." });
    const open = this.#openEdges(shell);
    if (open.length) {
      const at = this.curveAt(open[0]!, 0.5).point.map((x) => x.toFixed(1)).join(", ");
      throw new KernelError("BAD_ARGUMENT", op, `${op}: the faces leave ${open.length} open edges (one near (${at})), so they do not close a volume`, { hint: "Add the missing faces, or make neighbouring faces meet edge to edge." });
    }
    return this.#checked(op, () => {
      const solid = this.raw.makeSolid(shell) as ShapeHandle;
      // OCCT can build the solid inside out (negative volume) and still call it valid.
      return this.raw.getVolume(solid) < 0 ? (this.raw.reverseShape(solid) as ShapeHandle) : solid;
    });
  }
  thicken(surface: ShapeHandle, thickness: number): ShapeHandle {
    const op = "thicken";
    finite(op, thickness);
    if (thickness === 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: the thickness must not be 0`);
    this.#mustBe(op, surface, "face", "shell");
    return this.#checked(op, () => this.raw.thicken(surface, thickness, 1e-6) as ShapeHandle);
  }

  // ---- surface quality ---------------------------------------------------------------------
  continuity(shape: ShapeHandle, options: { samples?: number; tolerances?: Partial<ContinuityTolerances> } = {}): ContinuityTable {
    const op = "continuity";
    const samples = options.samples ?? 16;
    if (!Number.isInteger(samples) || samples < 1 || samples > 256) throw new KernelError("BAD_ARGUMENT", op, `${op}: samples must be a whole number from 1 to 256, got ${samples}`);
    const tolerances: ContinuityTolerances = { ...CONTINUITY_TOLERANCES, ...options.tolerances };
    const mark = this.raw.checkpoint();
    try {
      const edges = this.raw.getSubShapes(shape, "edge") as ShapeHandle[];
      const faces = this.raw.getSubShapes(shape, "face") as ShapeHandle[];
      // Which faces use each edge, through hash buckets (isSame decides within a bucket).
      const index = new Map<number, number[]>();
      edges.forEach((e, i) => {
        const key = this.raw.hashCode(e, 1 << 30);
        index.set(key, [...(index.get(key) ?? []), i]);
      });
      const users = edges.map(() => [] as number[]);
      faces.forEach((f, fi) => {
        for (const e of this.raw.getSubShapes(f, "edge") as ShapeHandle[]) {
          const i = (index.get(this.raw.hashCode(e, 1 << 30)) ?? []).find((j) => this.raw.isSame(edges[j]!, e));
          if (i !== undefined && !users[i]!.includes(fi)) users[i]!.push(fi);
        }
      });
      const box = this.raw.getBoundingBox(shape);
      const size = Math.hypot(box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin);
      const step = Math.min(0.01, Math.max(1e-4, 1e-3 * size));
      const out: EdgeContinuity[] = [];
      edges.forEach((edge, i) => {
        const pair = users[i]!;
        if (pair.length !== 2 || this.raw.curveLength(edge) < 1e-9) return;
        const [a, b] = [faces[pair[0]!]!, faces[pair[1]!]!];
        let gapMax = 0;
        let angleMax = 0;
        let jumpMax: number | null = 0;
        let relMax = 0;
        let g2 = true;
        for (let s = 0; s < samples; s++) {
          const { point: p, tangent: t } = this.curveAt(edge, (s + 0.5) / samples);
          const sa = this.#surfaceAt(a, p);
          const sb = this.#surfaceAt(b, p);
          gapMax = Math.max(gapMax, gap(sa.point, p), gap(sb.point, p), gap(sa.point, sb.point));
          const angle = angleBetween(sa.normal, sb.normal);
          angleMax = Math.max(angleMax, angle);
          if (angle > tolerances.angle || jumpMax === null) {
            jumpMax = null;
            continue;
          }
          // The second fundamental form of each face in the frame (t, d), d pointing into the face.
          const fa = this.#curvatureForm(a, p, sa.normal, t, step);
          const fb = this.#curvatureForm(b, p, sb.normal, t, step);
          // d on b runs opposite to d on a, which flips the sign of the twist term.
          const jump = Math.max(Math.abs(fa.tt - fb.tt), Math.abs(fa.dd - fb.dd), Math.abs(fa.td + fb.td));
          const scale = Math.max(Math.abs(fa.tt), Math.abs(fa.dd), Math.abs(fb.tt), Math.abs(fb.dd));
          const rel = scale > 0 ? jump / scale : 0;
          jumpMax = Math.max(jumpMax, jump);
          relMax = Math.max(relMax, rel);
          if (jump > tolerances.curvature && rel > tolerances.relative) g2 = false;
        }
        const tangent = angleMax <= tolerances.angle && jumpMax !== null;
        const cls = gapMax > tolerances.gap ? "gap" : !tangent ? "G0" : g2 ? "G2" : "G1";
        out.push({ edge: i + 1, faces: [pair[0]! + 1, pair[1]! + 1], gap: gapMax, angle: angleMax, curvatureJump: tangent ? jumpMax : null, relativeJump: tangent ? relMax : null, class: cls });
      });
      return { edges: out, samples, tolerances };
    } catch (e) {
      throw toKernelError(op, e);
    } finally {
      this.raw.releaseSince(mark);
    }
  }

  curvature(shape: ShapeHandle, options: { grid?: number; tolerance?: number } = {}): CurvatureTable {
    const op = "curvature";
    const grid = options.grid ?? 8;
    if (!Number.isInteger(grid) || grid < 1 || grid > 64) throw new KernelError("BAD_ARGUMENT", op, `${op}: grid must be a whole number from 1 to 64, got ${grid}`);
    const tolerance = options.tolerance ?? 1e-5;
    if (!Number.isFinite(tolerance) || tolerance <= 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: tolerance must be a positive number (1/mm), got ${tolerance}`);
    const mark = this.raw.checkpoint();
    try {
      const slots = this.#curvatureSlots();
      const faces = (this.raw.getSubShapes(shape, "face") as ShapeHandle[]).map((face, i) => this.#faceCurvature(face, i + 1, grid, tolerance, slots));
      return { faces, grid, tolerance };
    } catch (e) {
      throw toKernelError(op, e);
    } finally {
      this.raw.releaseSince(mark);
    }
  }

  // occt-wasm 5.8.1 returns surfaceCurvature's four numbers under the wrong names (min holds the
  // mean, max the Gaussian, gaussian and mean the two principal curvatures), measured against the
  // surface's own normal (Su x Sv) whichever way the face points. Learn which names hold the
  // principal curvatures from a torus point whose curvatures are known, so a corrected binding
  // keeps working, and refuse to guess when no reading fits.
  #slots: [CurvatureSlot, CurvatureSlot] | undefined;
  #curvatureSlots(): [CurvatureSlot, CurvatureSlot] {
    if (this.#slots) return this.#slots;
    const mark = this.raw.checkpoint();
    try {
      const face = (this.raw.getSubShapes(this.torus(20, 5), "face") as ShapeHandle[])[0]!;
      const b = this.raw.uvBounds(face);
      const [u, w] = [b.uMin + 0.7 * (b.uMax - b.uMin), b.vMin + 0.8 * (b.vMax - b.vMin)];
      const p = t3(this.raw.pointOnSurface(face, u, w));
      const rho = Math.hypot(p[0], p[1]);
      // Outward: 1/5 around the tube, (rho - 20) / (5 rho) around the axis. Against Su x Sv,
      // which points outward on a forward face, the principal and mean curvatures change sign.
      const sigma = this.raw.shapeOrientation(face) === "reversed" ? -1 : 1;
      const [k1, k2] = [-sigma / 5, (-sigma * (rho - 20)) / (5 * rho)];
      const want: Record<"k1" | "k2" | "gaussian" | "mean", number> = { k1, k2, gaussian: k1 * k2, mean: (k1 + k2) / 2 };
      const read = this.raw.surfaceCurvature(face, u, w);
      const flipped = this.raw.surfaceCurvature(this.raw.reverseShape(face) as ShapeHandle, u, w);
      const names = ["min", "max", "gaussian", "mean"] as const;
      const holding = (x: number) => names.filter((n) => Math.abs(read[n] - x) <= 1e-9 && Math.abs(flipped[n] - x) <= 1e-9);
      const [a, c] = [holding(want.k1), holding(want.k2)];
      if (a.length !== 1 || c.length !== 1 || holding(want.gaussian).length !== 1 || holding(want.mean).length !== 1) {
        throw new KernelError("UNKNOWN", "curvature", "curvature: this occt-wasm build's surfaceCurvature does not match a torus's known curvatures, so face curvature is not measured", { hint: "Report the occt-wasm version; the kernel adapter learns the binding's layout from a torus." });
      }
      this.#slots = [a[0]!, c[0]!];
      return this.#slots;
    } finally {
      this.raw.releaseSince(mark);
    }
  }

  // Principal curvatures at the centres of a grid x grid lattice over the face's parameter box,
  // where they land inside the face, turned to point outward (positive = convex).
  #faceCurvature(face: ShapeHandle, index: number, grid: number, tol: number, slots: [CurvatureSlot, CurvatureSlot]): FaceCurvature {
    const sigma = this.raw.shapeOrientation(face) === "reversed" ? -1 : 1;
    const b = this.raw.uvBounds(face);
    const span = (x: [number, number], y: number): [number, number] => [Math.min(x[0], y), Math.max(x[1], y)];
    let kMin: [number, number] = [Infinity, -Infinity];
    let kMax = kMin, gaussian = kMin, mean = kMin;
    let samples = 0, largest = 0, convex = 0, concave = 0, saddle = 0, up = false, down = false;
    const take = (u: number, w: number) => {
      const c = this.raw.surfaceCurvature(face, u, w);
      const [x, y] = [-sigma * c[slots[0]], -sigma * c[slots[1]]];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // + 0 turns -0 into 0.
      const [lo, hi] = [Math.min(x, y) + 0, Math.max(x, y) + 0];
      const h = (lo + hi) / 2;
      samples++;
      kMin = span(kMin, lo);
      kMax = span(kMax, hi);
      gaussian = span(gaussian, lo * hi + 0);
      mean = span(mean, h);
      largest = Math.max(largest, -lo, hi);
      if (hi > tol && lo < -tol) saddle++;
      else if (hi > tol) convex++;
      else if (lo < -tol) concave++;
      if (h > tol) up = true;
      if (h < -tol) down = true;
    };
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const u = b.uMin + ((i + 0.5) / grid) * (b.uMax - b.uMin);
        const w = b.vMin + ((j + 0.5) / grid) * (b.vMax - b.vMin);
        if (this.raw.classifyPointOnFace(face, u, w) === "in") take(u, w);
      }
    }
    // A sliver can miss every lattice point: measure once at the foot of its centre of mass.
    if (samples === 0) {
      const { u, v: w } = this.raw.uvFromPoint(face, this.raw.getSurfaceCenterOfMass(face));
      take(u, w);
    }
    if (samples === 0) throw new KernelError("INVALID_RESULT", "curvature", `curvature: no point on face:${index} has a finite curvature`, { elements: [`face:${index}`] });
    const ways = [convex, concave, saddle].filter((n) => n > 0).length;
    const kind = ways === 0 ? "flat" : ways > 1 ? "mixed" : convex ? "convex" : concave ? "concave" : "saddle";
    return { face: index, surface: String(this.raw.surfaceType(face)), samples, kMin, kMax, gaussian, mean, minRadius: largest > tol ? 1 / largest : null, kind, inflection: up && down };
  }

  // The surface point nearest p and the outward normal there.
  #surfaceAt(face: ShapeHandle, p: Vec3): { point: Vec3; normal: Vec3; u: number; v: number } {
    const { u, v: w } = this.raw.uvFromPoint(face, v(p));
    return { point: t3(this.raw.pointOnSurface(face, u, w)), normal: t3(this.raw.surfaceNormal(face, u, w)), u, v: w };
  }

  // Normal curvatures along t, across into the face (d) and the twist term, each from the normal
  // offset of a short step projected onto the surface (kappa = 2 n . (q - p) / s^2), with one
  // Richardson step. d is the unit direction in the face's tangent plane, across t, that enters it.
  #curvatureForm(face: ShapeHandle, p: Vec3, n: Vec3, t: Vec3, s: number): { tt: number; dd: number; td: number } {
    // Try both ways across. A step off a B-spline face's natural boundary projects back onto the
    // boundary ("on", not "out"), so take the way that lands inside, or else the way whose foot
    // point moves: stepping off a natural boundary leaves the foot on the edge.
    const across = normalized(cross(n, t));
    const land = (sign: number) => {
      const uv = this.raw.uvFromPoint(face, v([p[0] + sign * 10 * s * across[0], p[1] + sign * 10 * s * across[1], p[2] + sign * 10 * s * across[2]]));
      return { inside: this.raw.classifyPointOnFace(face, uv.u, uv.v) === "in", moved: gap(t3(this.raw.pointOnSurface(face, uv.u, uv.v)), p) };
    };
    const [fwd, back] = [land(1), land(-1)];
    const d: Vec3 = !fwd.inside && (back.inside || back.moved > fwd.moved) ? [-across[0], -across[1], -across[2]] : across;
    const kappa = (e: Vec3): number => {
      const at = (h: number): number => {
        const q = this.#surfaceAt(face, [p[0] + h * e[0], p[1] + h * e[1], p[2] + h * e[2]]).point;
        return (2 * ((q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] + (q[2] - p[2]) * n[2])) / (h * h);
      };
      return (4 * at(s / 2) - at(s)) / 3;
    };
    const tt = kappa(t);
    const dd = kappa(d);
    const diag = kappa(normalized([t[0] + d[0], t[1] + d[1], t[2] + d[2]]));
    return { tt, dd, td: diag - (tt + dd) / 2 };
  }

  // Edges used by only one face of a shell, other than seams (where a periodic face, such as a
  // cylinder's side, meets itself: the kernel lists such an edge once for its face).
  #openEdges(shell: ShapeHandle): ShapeHandle[] {
    const buckets = new Map<number, Array<{ edge: ShapeHandle; face: ShapeHandle; uses: number }>>();
    for (const face of this.raw.getSubShapes(shell, "face") as ShapeHandle[]) {
      for (const edge of this.raw.getSubShapes(face, "edge") as ShapeHandle[]) {
        const key = this.raw.hashCode(edge, 1 << 30);
        const list = buckets.get(key) ?? [];
        const seen = list.find((x) => this.raw.isSame(x.edge, edge));
        if (seen) seen.uses++;
        else list.push({ edge, face, uses: 1 });
        buckets.set(key, list);
      }
    }
    return [...buckets.values()].flat().filter((x) => x.uses < 2 && !this.#isSeam(x.face, x.edge)).map((x) => x.edge);
  }

  // A seam lies on the face's parameter boundary in a direction where the surface closes on itself.
  #isSeam(face: ShapeHandle, edge: ShapeHandle): boolean {
    const mid = this.curveAt(edge, 0.5).point;
    const { u, v: w } = this.raw.uvFromPoint(face, v(mid));
    const b = this.raw.uvBounds(face);
    const eps = 1e-7 * Math.max(1, Math.abs(b.uMax - b.uMin), Math.abs(b.vMax - b.vMin));
    const at = (s: number, t: number) => t3(this.raw.pointOnSurface(face, s, t));
    if ((Math.abs(u - b.uMin) < eps || Math.abs(u - b.uMax) < eps) && gap(at(b.uMin, w), at(b.uMax, w)) < 1e-7) return true;
    return (Math.abs(w - b.vMin) < eps || Math.abs(w - b.vMax) < eps) && gap(at(u, b.vMin), at(u, b.vMax)) < 1e-7;
  }

  // An edge becomes a one-edge wire; a wire stays; anything else is refused.
  #asWire(op: string, what: string, shape: ShapeHandle): ShapeHandle {
    const type = this.#call(op, () => this.raw.getShapeType(shape)) as ShapeKind;
    if (type === "wire") return shape;
    if (type === "edge") return this.wire([shape]);
    throw new KernelError("BAD_ARGUMENT", op, `${op}: ${what} must be a wire or an edge, got ${withArticle(type)}`);
  }

  // Refuse a shape of the wrong type before the kernel sees it.
  #mustBe(op: string, shape: ShapeHandle, ...kinds: ShapeKind[]): void {
    const type = this.#call(op, () => this.raw.getShapeType(shape)) as ShapeKind;
    if (!kinds.includes(type)) throw new KernelError("BAD_ARGUMENT", op, `${op}: needs ${kinds.map(withArticle).join(" or ")}, got ${withArticle(type)}`);
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
    return this.#onEdges("fillet", s, edges, () => this.raw.fillet(s, edges, radius) as ShapeHandle);
  }
  chamfer(solid: ShapeHandle, edges: ShapeHandle[], distance: number): ShapeHandle {
    positive("chamfer", distance);
    if (edges.length === 0) throw new KernelError("BAD_ARGUMENT", "chamfer", "chamfer: the edge query matched no edges", { hint: "Check the edge selector; inspect the part's edges first." });
    const s = this.asSolid(solid);
    return this.#onEdges("chamfer", s, edges, () => this.raw.chamfer(s, edges, distance) as ShapeHandle);
  }

  // A fillet or chamfer. OCCT names the faulty edges for some failures and none for others;
  // when it names none, the error lists the edges the call asked for, so it is never empty.
  #onEdges(op: string, solid: ShapeHandle, edges: ShapeHandle[], fn: () => ShapeHandle): ShapeHandle {
    const address = this.#edgeAddresser(solid);
    try {
      return this.#checked(op, fn, address);
    } catch (e) {
      if (!(e instanceof KernelError) || e.elements.length > 0 || e.fatal || e.code === "INVALID_RESULT") throw e;
      const elements = edges.slice(0, 20).map((h) => address(h as number)).filter((x): x is string => x !== undefined);
      const detail: ConstructorParameters<typeof KernelError>[3] = { elements, cause: e.cause };
      if (e.hint !== undefined) detail.hint = e.hint;
      throw new KernelError(e.code, e.op, `${e.message} (the kernel named no edge; elements lists the ${edges.length} edges asked for)`, detail);
    }
  }
  draft(shape: ShapeHandle, angleDeg: number, options: { pull: Vec3; neutral?: Vec3 }): ShapeHandle {
    const op = "draft";
    finite(op, angleDeg);
    if (angleDeg === 0 || Math.abs(angleDeg) > 45) throw new KernelError("BAD_ARGUMENT", op, `${op}: the angle must be between -45 and 45 degrees and not 0, got ${angleDeg}`);
    const vec = (what: string, x: Vec3 | undefined) => {
      if (!Array.isArray(x) || x.length !== 3) throw new KernelError("BAD_ARGUMENT", op, `${op}: the ${what} must be [x, y, z]`);
      finite(op, ...x);
    };
    vec("pull", options.pull);
    const len = Math.hypot(...options.pull);
    if (len === 0) throw new KernelError("BAD_ARGUMENT", op, `${op}: the pull must not be the zero vector`);
    const pull: Vec3 = [options.pull[0] / len, options.pull[1] / len, options.pull[2] / len];
    const neutral = options.neutral ?? [0, 0, 0];
    vec("neutral point", neutral);
    const solid = this.asSolid(shape);
    // occt-wasm drafts about the XY plane through the origin and only with a pull along Z (any
    // other pull fails), so move the neutral point to the origin and turn the pull onto +Z, draft
    // there, then turn and move back. The turn is about pull x Z by the angle between them.
    const angleToZ = Math.acos(Math.max(-1, Math.min(1, pull[2])));
    const axisToZ: Vec3 = Math.abs(pull[2]) > 1 - 1e-12 ? [1, 0, 0] : normalized([pull[1], -pull[0], 0]);
    const there = (h: ShapeHandle) => this.raw.rotate(this.raw.translate(h, -neutral[0], -neutral[1], -neutral[2]) as ShapeHandle, { point: v([0, 0, 0]), direction: v(axisToZ) }, angleToZ) as ShapeHandle;
    const back = (h: ShapeHandle) => this.raw.translate(this.raw.rotate(h, { point: v([0, 0, 0]), direction: v(axisToZ) }, -angleToZ) as ShapeHandle, neutral[0], neutral[1], neutral[2]) as ShapeHandle;
    // A wall runs along the pull: its normal is square to it (to +Z, once turned) at points spread over it.
    const isWall = (f: ShapeHandle): boolean => {
      const b = this.raw.uvBounds(f);
      return [[0.3, 0.3], [0.7, 0.6], [0.5, 0.9]].every(([a, c]) => Math.abs(t3(this.raw.surfaceNormal(f, b.uMin + a! * (b.uMax - b.uMin), b.vMin + c! * (b.vMax - b.vMin)))[2]) < 1e-9);
    };
    let s = this.#call(op, () => there(solid));
    const walls = this.#call(op, () => (this.raw.getSubShapes(s, "face") as ShapeHandle[]).filter(isWall).length);
    if (walls === 0) {
      throw new KernelError("BAD_ARGUMENT", op, `${op}: no wall runs along the pull [${pull.map((x) => +x.toFixed(6)).join(", ")}], so there is nothing to draft`, { hint: "Draft tapers the walls an extrusion leaves along its direction; pull along that direction." });
    }
    return this.#checked(op, () => {
      // A drafted wall no longer runs along the pull, so each pass finds the next one.
      for (let i = 0; i < walls; i++) {
        const wall = (this.raw.getSubShapes(s, "face") as ShapeHandle[]).find(isWall);
        if (!wall) break;
        const kind = String(this.raw.surfaceType(wall));
        try {
          s = this.raw.draft(s, wall, (angleDeg * Math.PI) / 180, v([0, 0, 1])) as ShapeHandle;
        } catch (e) {
          throw new KernelError("CONSTRUCTION_FAILED", op, `${op}: the kernel could not draft ${withArticle(kind)} wall (${toKernelError(op, e).message})`, {
            hint: "Draft works on planar, cylindrical and conical walls, before fillets that meet them. Build the taper into a freeform wall instead, for example a loft to a smaller top section.",
            cause: e,
          });
        }
      }
      return back(s);
    });
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
