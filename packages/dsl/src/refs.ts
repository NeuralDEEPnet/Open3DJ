// Named faces and edges with geometric fingerprints (ARCHITECTURE.md section 10, S1).
//
// withReferences({ top: { face: {...} }, hole_edge: { edge: {...} } }) names one element of
// a shape by a query. The run stores the element's fingerprint (type, surface or curve, area
// or length, centroid, normal, axis or direction, adjacency count) with the part definition.
// The next run names the element again with the same query and compares it with the stored
// fingerprint, so a name that silently moved to another element is reported:
//
// - exact: the query picks one element, and nothing else matches the stored fingerprint
//   better. When it is the only element of its kind and orientation, it must still agree in
//   two of size, adjacency and position, or lie on the same plane, axis or line. When the
//   element had twins (same kind, orientation, size and adjacency) as the name was given, it
//   must be at the stored position or on the same plane, axis or line: a twin elsewhere never
//   takes the name.
// - ambiguous: the query matches several elements, or other elements match the stored
//   fingerprint as well as (or better than) the query's pick. The candidates are listed;
//   none is picked automatically.
// - broken: the query matches nothing, or nothing of the stored kind and orientation is left.
//
// Fingerprints are plain data in the part's frame; transforms move them with the shape, and a
// NamedRef's frame records the rigid moves since the name was given, so the next revision
// compares fingerprints in the naming frame and moving a whole part changes nothing.
import type { RefFingerprint, RefState, Transform, Vec3 } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import type { GuestValue } from "@open3dj/sandbox";
import { badArgument } from "./errors.ts";
import { cross, dot, length, normalize, sub } from "./math.ts";
import { matchEdges, parseEdgeQuery } from "./queries.ts";
import type { EdgeQuery } from "./queries.ts";
import { dir3, num, obj, str, vec3 } from "./state.ts";

/** A name given with withReferences to a face or an edge, as the run resolved it. */
export interface NamedRef {
  type: "face" | "edge";
  state: RefState;
  /** The fingerprint of the element the query picked, when it picked exactly one. */
  fingerprint?: RefFingerprint;
  /** 1-based element index in the shape the query ran on (exact only). */
  index?: number;
  candidates?: number[];
  reason?: string;
  /** The query, as text for reasons, for example {surface: "cylinder", near: [0, 0, 2.5]}. */
  query: string;
  /** Rigid moves of the shape since the name was given (naming frame to shape frame); absent means none. */
  frame?: Transform;
}

export interface FaceQuery {
  normal?: Vec3;
  surface?: string;
  atX?: number;
  atY?: number;
  atZ?: number;
  minArea?: number;
  maxArea?: number;
  near?: Vec3;
}

const FACE_KEYS = new Set(["normal", "surface", "atX", "atY", "atZ", "minArea", "maxArea", "near"]);

export function parseFaceQuery(x: GuestValue | undefined): FaceQuery {
  const o = obj(x, "face query");
  const q: FaceQuery = {};
  for (const [k, v] of Object.entries(o)) {
    if (!FACE_KEYS.has(k)) throw badArgument(`unknown face query field ${k}`, `Use ${[...FACE_KEYS].join(", ")}.`);
    if (v === undefined || v === null) continue;
    if (k === "normal") q.normal = normalize(dir3(v, "face query normal"));
    else if (k === "surface") q.surface = str(v, "face query surface", 40);
    else if (k === "near") q.near = vec3(v, "face query near");
    else q[k as "atX"] = num(v, `face query ${k}`);
  }
  return q;
}

/** An edge query plus curve and near. */
export interface EdgeRefQuery extends EdgeQuery {
  curve?: string;
  near?: Vec3;
}

export function parseEdgeRefQuery(x: GuestValue | undefined): EdgeRefQuery {
  const o = { ...obj(x, "edge query") };
  const extra: { curve?: string; near?: Vec3 } = {};
  if (o["curve"] !== undefined && o["curve"] !== null) extra.curve = str(o["curve"], "edge query curve", 40);
  if (o["near"] !== undefined && o["near"] !== null) extra.near = vec3(o["near"], "edge query near");
  delete o["curve"];
  delete o["near"];
  return { ...parseEdgeQuery(o), ...extra };
}

const PARALLEL = 1 - 1e-6;
/** Relative tolerance for "same area" and "same length". */
const SIZE_REL = 1e-6;

interface RawKernel {
  uvBounds(face: number): { uMin: number; uMax: number; vMin: number; vMax: number };
  surfaceNormal(face: number, u: number, v: number): { x: number; y: number; z: number };
  pointOnSurface?(face: number, u: number, v: number): { x: number; y: number; z: number };
  curveParameters(e: number): { first: number; last: number };
  curvePointAtParam(e: number, t: number): { x: number; y: number; z: number };
}

const rawOf = (kernel: KernelAdapter) => (kernel as unknown as { raw?: RawKernel }).raw;
const t3 = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];

/**
 * Axis of a face of revolution (cylinder, cone, torus), or undefined. The normals at three
 * points of one v line differ only across the axis: for a cone or a torus each normal also
 * has a part along the axis, but that part is the same at every u of one v. So the cross
 * product of two normal differences is the axis. (The cross product of two normals is the
 * axis only for a cylinder.)
 */
function surfaceAxis(kernel: KernelAdapter, face: ShapeHandle): Vec3 | undefined {
  const raw = rawOf(kernel);
  if (!raw) return undefined;
  const uv = raw.uvBounds(face as unknown as number);
  const v = (uv.vMin + uv.vMax) / 2;
  const n = [0, 1 / 3, 2 / 3].map((f) => t3(raw.surfaceNormal(face as unknown as number, uv.uMin + (uv.uMax - uv.uMin) * f, v)));
  const c = cross(sub(n[0]!, n[1]!), sub(n[0]!, n[2]!));
  return length(c) < 1e-12 ? undefined : canonical(normalize(c));
}

/**
 * Whether a cylinder or cone face bulges out of its solid (a pin: true) or into it (a hole:
 * false), from two points of one v line and their outward normals: on a convex face the
 * normals spread apart as the points do. Undefined when the kernel cannot tell.
 */
export function roundFaceConvex(kernel: KernelAdapter, face: ShapeHandle): boolean | undefined {
  const raw = rawOf(kernel);
  if (!raw?.pointOnSurface) return undefined;
  const id = face as unknown as number;
  const uv = raw.uvBounds(id);
  const v = (uv.vMin + uv.vMax) / 2;
  const [u1, u2] = [uv.uMin + (uv.uMax - uv.uMin) / 4, uv.uMin + ((uv.uMax - uv.uMin) * 3) / 4];
  const p = sub(t3(raw.pointOnSurface(id, u1, v)), t3(raw.pointOnSurface(id, u2, v)));
  const n = sub(t3(raw.surfaceNormal(id, u1, v)), t3(raw.surfaceNormal(id, u2, v)));
  const d = dot(p, n);
  return Math.abs(d) < 1e-12 ? undefined : d > 0;
}

/** Axis of a circle or ellipse from three of its points, or undefined. */
function curveAxis(kernel: KernelAdapter, edge: ShapeHandle): Vec3 | undefined {
  const raw = rawOf(kernel);
  if (!raw) return undefined;
  const { first, last } = raw.curveParameters(edge as unknown as number);
  const p = [0, 1 / 3, 2 / 3].map((f) => t3(raw.curvePointAtParam(edge as unknown as number, first + (last - first) * f)));
  const c = cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!));
  return length(c) < 1e-12 ? undefined : canonical(normalize(c));
}

/** One sense for a line or axis: the first non-zero component is positive. */
function canonical(v: Vec3): Vec3 {
  const first = v.find((x) => Math.abs(x) > 1e-12) ?? 1;
  return first < 0 ? [-v[0] + 0, -v[1] + 0, -v[2] + 0] : v;
}

const REVOLVED = new Set(["cylinder", "cone", "torus"]);
const AXIAL_CURVES = new Set(["circle", "ellipse"]);

export function faceFingerprint(kernel: KernelAdapter, faces: ShapeHandle[], index: number): RefFingerprint {
  const face = faces[index - 1]!;
  const info = kernel.faceInfo(face, index);
  const fp: Extract<RefFingerprint, { type: "face" }> = { type: "face", surface: info.surface, area: info.area, centroid: info.center, edges: kernel.subShapes(face, "edge").length };
  if (info.surface === "plane") fp.normal = normalize(info.normal);
  else if (REVOLVED.has(info.surface)) {
    const axis = surfaceAxis(kernel, face);
    if (axis) fp.axis = axis;
  }
  return fp;
}

/**
 * How many faces use each edge of shape (1-based edge index to count). Face edges are matched
 * to the shape's edges by midpoint and length first, then confirmed with isSame, so the cost
 * stays near one edgeInfo per face edge instead of faces x edges isSame calls.
 */
export function edgeFaceCounts(kernel: KernelAdapter, shape: ShapeHandle, edges: ShapeHandle[]): Map<number, number> {
  const key = (mid: Vec3, len: number) => [...mid, len].map((x) => Math.round(x * 1e4)).join(",");
  const byKey = new Map<string, number[]>();
  kernel.edges(shape).forEach((e) => {
    const k = key(e.mid, e.length);
    const list = byKey.get(k);
    if (list) list.push(e.index);
    else byKey.set(k, [e.index]);
  });
  const counts = new Map<number, number>();
  for (const face of kernel.subShapes(shape, "face")) {
    const seen = new Set<number>();
    for (const fe of kernel.subShapes(face, "edge")) {
      const info = kernel.edgeInfo(fe);
      const hit = (byKey.get(key(info.mid, info.length)) ?? []).find((i) => kernel.isSame(edges[i - 1]!, fe));
      // A seam edge appears twice in its face; the face still counts once.
      if (hit === undefined || seen.has(hit)) continue;
      seen.add(hit);
      counts.set(hit, (counts.get(hit) ?? 0) + 1);
    }
  }
  return counts;
}

export function edgeFingerprint(kernel: KernelAdapter, shape: ShapeHandle, edges: ShapeHandle[], index: number, counts?: Map<number, number>): RefFingerprint {
  const edge = edges[index - 1]!;
  const info = kernel.edgeInfo(edge, index);
  const faces = (counts ?? edgeFaceCounts(kernel, shape, edges)).get(index) ?? 0;
  const fp: Extract<RefFingerprint, { type: "edge" }> = { type: "edge", curve: info.curve, length: info.length, centroid: info.mid, faces };
  if (info.curve === "line") {
    const d = sub(info.end, info.start);
    if (length(d) > 0) fp.direction = canonical(normalize(d));
  } else if (AXIAL_CURVES.has(info.curve)) {
    const axis = curveAxis(kernel, edge);
    if (axis) fp.axis = axis;
  }
  return fp;
}

/** Kind and orientation agree: the part of a fingerprint that a parameter change keeps. */
export function sameSignature(a: RefFingerprint, b: RefFingerprint): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "face" && b.type === "face") {
    if (a.surface !== b.surface) return false;
    if (a.normal || b.normal) return !!a.normal && !!b.normal && dot(a.normal, b.normal) >= PARALLEL;
    if (a.axis || b.axis) return !!a.axis && !!b.axis && Math.abs(dot(a.axis, b.axis)) >= PARALLEL;
    return true;
  }
  if (a.type === "edge" && b.type === "edge") {
    if (a.curve !== b.curve) return false;
    const [x, y] = [a.direction ?? a.axis, b.direction ?? b.axis];
    if (x || y) return !!x && !!y && Math.abs(dot(x, y)) >= PARALLEL;
    return true;
  }
  return false;
}

/** Size and adjacency agree: the element looks the same wherever it is. */
function sameLook(a: RefFingerprint, b: RefFingerprint, tol: number): boolean {
  const sizeA = a.type === "face" ? a.area : a.length;
  const sizeB = b.type === "face" ? b.area : b.length;
  const adjA = a.type === "face" ? a.edges : a.faces;
  const adjB = b.type === "face" ? b.edges : b.faces;
  return adjA === adjB && Math.abs(sizeA - sizeB) <= SIZE_REL * Math.max(1, Math.abs(sizeA)) + tol * tol;
}

/**
 * How many other elements in the list are twins of fp: the same kind, orientation, size and
 * adjacency, at another position (a pattern of identical holes).
 */
export function countTwins(fp: RefFingerprint, others: RefFingerprint[], tol: number): number {
  return others.filter((o) => sameSignature(fp, o) && sameLook(fp, o, tol) && length(sub(fp.centroid, o.centroid)) > tol).length;
}

/** fp with its twin count set (dropped when zero). */
export function withTwins(fp: RefFingerprint, twins: number): RefFingerprint {
  const out = { ...fp };
  if (twins > 0) out.twins = twins;
  else delete out.twins;
  return out;
}

/** How many of size, adjacency and position agree (0 to 3). */
function score(prev: RefFingerprint, cur: RefFingerprint, tol: number): number {
  const sizeA = prev.type === "face" ? prev.area : prev.length;
  const sizeB = cur.type === "face" ? cur.area : cur.length;
  const adjA = prev.type === "face" ? prev.edges : prev.faces;
  const adjB = cur.type === "face" ? cur.edges : cur.faces;
  let s = 0;
  if (Math.abs(sizeA - sizeB) <= SIZE_REL * Math.max(1, Math.abs(sizeA)) + tol * tol) s++;
  if (adjA === adjB) s++;
  if (length(sub(prev.centroid, cur.centroid)) <= tol) s++;
  return s;
}

/** Which of size, adjacency and position differ, in words. */
function differences(prev: RefFingerprint, cur: RefFingerprint, tol: number): string[] {
  const out: string[] = [];
  const sizeA = prev.type === "face" ? prev.area : prev.length;
  const sizeB = cur.type === "face" ? cur.area : cur.length;
  if (Math.abs(sizeA - sizeB) > SIZE_REL * Math.max(1, Math.abs(sizeA)) + tol * tol) out.push(prev.type === "face" ? "area" : "length");
  if ((prev.type === "face" ? prev.edges : prev.faces) !== (cur.type === "face" ? cur.edges : cur.faces)) out.push(prev.type === "face" ? "edge count" : "face count");
  if (length(sub(prev.centroid, cur.centroid)) > tol) out.push("position");
  return out;
}

/** Distance from point p to the line through o along unit d. */
const lineDistance = (p: Vec3, o: Vec3, d: Vec3) => {
  const w = sub(p, o);
  const along = dot(w, d);
  return Math.sqrt(Math.max(0, dot(w, w) - along * along));
};

/**
 * The element lies on the same carrier as the stored one: the same plane (a plane face), the
 * same axis line (a face of revolution or a circle, through both centroids) or the same line
 * (a line edge). Orientation is already equal (sameSignature).
 */
function sameCarrier(prev: RefFingerprint, cur: RefFingerprint, tol: number): boolean {
  if (prev.type === "face") {
    if (prev.normal) return Math.abs(dot(prev.normal, sub(cur.centroid, prev.centroid))) <= tol;
    if (prev.axis && REVOLVED.has(prev.surface)) return lineDistance(cur.centroid, prev.centroid, prev.axis) <= tol;
    return false;
  }
  if (prev.direction) return lineDistance(cur.centroid, prev.centroid, prev.direction) <= tol;
  return false;
}

const carrierName = (fp: RefFingerprint) => (fp.type === "face" ? (fp.normal ? "plane" : "axis") : fp.direction ? "line" : "curve");

/** "plane facing +Z", "cylinder along Z", "line along X". */
export function describeKind(fp: RefFingerprint): string {
  const axisName = (v: Vec3, signed: boolean) => {
    const names = ["X", "Y", "Z"];
    const i = v.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (i >= 0) return `${signed ? (v[i]! > 0 ? "+" : "-") : ""}${names[i]}`;
    return `[${v.map((x) => Number(x.toFixed(3))).join(", ")}]`;
  };
  if (fp.type === "face") {
    if (fp.normal) return `${fp.surface} facing ${axisName(fp.normal, true)}`;
    if (fp.axis) return `${fp.surface} along ${axisName(fp.axis, false)}`;
    return `${fp.surface} face`;
  }
  const d = fp.direction ?? fp.axis;
  return d ? `${fp.curve} ${fp.direction ? "along" : "about"} ${axisName(d, false)}` : `${fp.curve} edge`;
}

export interface Judgement {
  state: RefState;
  /** Indices into the current list. */
  candidates?: number[];
  reason?: string;
  /** The matched index, when exact. */
  match?: number;
}

/**
 * Judge whether the element that current[pick] stands for is still the element prev
 * described. Without a pick (the query is not known), the best unique match wins only when
 * it agrees in at least two of size, adjacency and position. The only element of its kind and
 * orientation is exact on the same terms, or when it lies on the same plane, axis or line;
 * otherwise it is ambiguous, with itself as the one candidate. Never picks among equals.
 */
export function judgeReference(prev: RefFingerprint, current: RefFingerprint[], pick: number | undefined, tol: number): Judgement {
  const s = current.map((c, i) => ({ i, c })).filter((x) => sameSignature(prev, x.c));
  const what = describeKind(prev);
  if (s.length === 0) return { state: "broken", reason: `no ${what} is left` };
  const inS = pick !== undefined && s.some((x) => x.i === pick);
  if (pick !== undefined && !inS) {
    return { state: "ambiguous", candidates: s.map((x) => x.i), reason: `the query now picks a ${describeKind(current[pick]!)}, not a ${what}; ${s.length} element${s.length === 1 ? "" : "s"} of the old kind remain` };
  }
  if ((prev.twins ?? 0) > 0) return judgeWithTwins(prev, s, pick, tol);
  if (s.length === 1) {
    // The only element of its kind and orientation is the named one only when it agrees in two
    // of size, adjacency and position, or still lies on the same plane, axis or line. A face
    // that was removed must not hand its name to the one other face of its kind.
    const only = s[0]!;
    if (score(prev, only.c, tol) >= 2 || sameCarrier(prev, only.c, tol)) return { state: "exact", match: only.i };
    return { state: "ambiguous", candidates: [only.i], reason: `the only ${what} left differs in ${differences(prev, only.c, tol).join(", ")}, and is not on the same ${carrierName(prev)}` };
  }
  const scored = s.map((x) => ({ ...x, score: score(prev, x.c, tol) }));
  const full = scored.filter((x) => x.score === 3).map((x) => x.i);
  const near = (i: number) => length(sub(current[i]!.centroid, prev.centroid));
  if (pick === undefined) {
    if (full.length === 1) return { state: "exact", match: full[0]! };
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best).map((x) => x.i).sort((a, b) => near(a) - near(b));
    // A size and adjacency match elsewhere does not beat an element still on the same plane,
    // axis or line: the named element may have changed size where it is.
    const placed = scored.filter((x) => x.i !== top[0] && placedAt(prev, x.c, tol)).map((x) => x.i);
    if (top.length === 1 && best >= 2 && !placedAt(prev, current[top[0]!]!, tol) && placed.length > 0) {
      return { state: "ambiguous", candidates: [...placed, top[0]!], reason: `${placed.length === 1 ? "one element is" : `${placed.length} elements are`} still on the same ${carrierName(prev)}, but another ${what} elsewhere matches its size and ${prev.type === "face" ? "edges" : "faces"}` };
    }
    if (top.length === 1 && best >= 2) return { state: "exact", match: top[0]! };
    if (top.length > 1 && best >= 1) return { state: "ambiguous", candidates: top, reason: `${top.length} elements (${what}) match the fingerprint equally` };
    return { state: "broken", candidates: top.slice(0, 3), reason: `no ${what} matches the fingerprint (area or length, edges and position)` };
  }
  if (full.length > 0) {
    if (full.length === 1 && full[0] === pick) return { state: "exact", match: pick };
    if (!full.includes(pick)) return { state: "ambiguous", candidates: [pick, ...full], reason: `the query now picks the first candidate, but ${full.length === 1 ? "another element matches" : `${full.length} other elements match`} the previous fingerprint exactly` };
    return { state: "ambiguous", candidates: full, reason: `${full.length} elements (${what}) match the previous fingerprint exactly` };
  }
  const best = Math.max(...scored.map((x) => x.score));
  const top = scored.filter((x) => x.score === best).map((x) => x.i);
  if (top.length === 1 && top[0] === pick) return { state: "exact", match: pick };
  const others = top.filter((i) => i !== pick).sort((a, b) => near(a) - near(b));
  return {
    state: "ambiguous",
    candidates: [pick, ...others],
    reason: top.includes(pick)
      ? `${top.length} elements (${what}) match the previous fingerprint equally; the first candidate is the query's pick`
      : `${others.length === 1 ? "another element matches" : `${others.length} other elements match`} the previous fingerprint better than the query's pick (the first candidate)`,
  };
}

/** At the stored position, or on the same plane, axis or line. */
function placedAt(prev: RefFingerprint, cur: RefFingerprint, tol: number): boolean {
  return length(sub(prev.centroid, cur.centroid)) <= tol || sameCarrier(prev, cur, tol);
}

/**
 * The rules for a name that had twins when it was given (prev.twins > 0). Size and adjacency
 * cannot tell twins apart, so only an element at the stored position or on the same plane,
 * axis or line can keep the name. Among those, the usual rules apply; anything else is
 * ambiguous, with the query's pick first.
 */
function judgeWithTwins(prev: RefFingerprint, s: Array<{ i: number; c: RefFingerprint }>, pick: number | undefined, tol: number): Judgement {
  const what = describeKind(prev);
  const n = prev.twins!;
  const had = `it had ${n === 1 ? "an identical twin" : `${n} identical twins`} (${what}, same ${prev.type === "face" ? "area and edges" : "length and faces"}) when it was named`;
  const near = (x: { c: RefFingerprint }) => length(sub(x.c.centroid, prev.centroid));
  const placed = s.filter((x) => placedAt(prev, x.c, tol)).map((x) => ({ ...x, score: score(prev, x.c, tol) }));
  const others = s.filter((x) => !placed.some((p) => p.i === x.i)).sort((a, b) => near(a) - near(b)).map((x) => x.i);
  if (placed.length === 0) {
    const list = pick === undefined ? others : [pick, ...others.filter((i) => i !== pick)];
    return { state: "ambiguous", candidates: list.slice(0, 3), reason: `${had}, and no ${what} is left at its position or on its ${carrierName(prev)}${pick === undefined ? "" : "; the first candidate is the query's pick"}` };
  }
  const best = Math.max(...placed.map((x) => x.score));
  const top = placed.filter((x) => x.score === best).sort((a, b) => near(a) - near(b)).map((x) => x.i);
  if (pick === undefined) {
    if (top.length === 1) return { state: "exact", match: top[0]! };
    return { state: "ambiguous", candidates: top, reason: `${had}, and ${top.length} elements on its ${carrierName(prev)} match the fingerprint equally` };
  }
  if (top.length === 1 && top[0] === pick) return { state: "exact", match: pick };
  return {
    state: "ambiguous",
    candidates: [pick, ...top.filter((i) => i !== pick)],
    reason: placed.some((x) => x.i === pick)
      ? `${had}, and ${top.length} elements on its ${carrierName(prev)} match the fingerprint equally; the first candidate is the query's pick`
      : `${had}, and the query's pick (the first candidate) is not at its position or on its ${carrierName(prev)}`,
  };
}

/** The fingerprints of the elements of shape with the same kind and orientation as fp, with their 1-based indices. */
export function signatureCandidates(kernel: KernelAdapter, shape: ShapeHandle, fp: RefFingerprint): Array<{ index: number; fp: RefFingerprint }> {
  const mark = kernel.checkpoint();
  try {
    if (fp.type === "face") {
      const faces = kernel.subShapes(shape, "face");
      const infos = kernel.faces(shape);
      return infos.filter((f) => f.surface === fp.surface).map((f) => ({ index: f.index, fp: faceFingerprint(kernel, faces, f.index) })).filter((x) => sameSignature(fp, x.fp));
    }
    const edges = kernel.subShapes(shape, "edge");
    const infos = kernel.edges(shape).filter((e) => e.curve === fp.curve);
    if (infos.length === 0) return [];
    const counts = edgeFaceCounts(kernel, shape, edges);
    return infos.map((e) => ({ index: e.index, fp: edgeFingerprint(kernel, shape, edges, e.index, counts) })).filter((x) => sameSignature(fp, x.fp));
  } finally {
    kernel.releaseSince(mark);
  }
}

/** Run a face or edge query and name the result: exact (one element), ambiguous (several) or broken (none). */
export function nameElement(kernel: KernelAdapter, shape: ShapeHandle, spec: GuestValue, name: string, tol: number): NamedRef {
  const o = obj(spec, `reference ${name}`);
  const isFace = o["face"] !== undefined;
  if (isFace === (o["edge"] !== undefined)) throw badArgument(`reference ${name} needs exactly one of face or edge`, "Write { face: { normal: [0, 0, 1], atZ: 10 } } or { edge: { parallel: [1, 0, 0], atZ: 10 } }, or a point [x, y, z].");
  const mark = kernel.checkpoint();
  try {
    if (isFace) {
      const q = parseFaceQuery(o["face"]);
      const faces = kernel.subShapes(shape, "face");
      const matched = kernel.faces(shape).filter((f) => faceMatches(f, q, tol));
      return pickOne(matched.map((f) => f.index), q.near, (i, p) => kernel.distance(kernel.vertex(p), faces[i - 1]!), tol, "face", textOf(o["face"]), (i) => twinCounted(kernel, shape, i, faceFingerprint(kernel, faces, i), tol));
    }
    const q = parseEdgeRefQuery(o["edge"]);
    const { matched } = matchEdges(kernel, shape, q, tol);
    const edges = kernel.subShapes(shape, "edge");
    const list = matched.filter((e) => q.curve === undefined || e.curve === q.curve).map((e) => e.index);
    return pickOne(list, q.near, (i, p) => kernel.distance(kernel.vertex(p), edges[i - 1]!), tol, "edge", textOf(o["edge"]), (i) => twinCounted(kernel, shape, i, edgeFingerprint(kernel, shape, edges, i), tol));
  } finally {
    kernel.releaseSince(mark);
  }
}

/** fp of element index, with the number of its twins on shape recorded. */
function twinCounted(kernel: KernelAdapter, shape: ShapeHandle, index: number, fp: RefFingerprint, tol: number): RefFingerprint {
  const others = signatureCandidates(kernel, shape, fp).filter((c) => c.index !== index).map((c) => c.fp);
  return withTwins(fp, countTwins(fp, others, tol));
}

function faceMatches(f: { surface: string; area: number; bbox: { min: Vec3; max: Vec3 }; normal: Vec3 }, q: FaceQuery, tol: number): boolean {
  const at = (i: number, v: number) => Math.abs(f.bbox.min[i]! - v) <= tol && Math.abs(f.bbox.max[i]! - v) <= tol;
  if (q.surface !== undefined && f.surface !== q.surface) return false;
  if (q.normal && (f.surface !== "plane" || dot(normalize(f.normal), q.normal) < PARALLEL)) return false;
  if (q.atX !== undefined && !at(0, q.atX)) return false;
  if (q.atY !== undefined && !at(1, q.atY)) return false;
  if (q.atZ !== undefined && !at(2, q.atZ)) return false;
  if (q.minArea !== undefined && f.area < q.minArea - tol) return false;
  if (q.maxArea !== undefined && f.area > q.maxArea + tol) return false;
  return true;
}

/**
 * One element from the matches. near keeps the elements closest to the point, measured from the
 * point to the element itself (not to its centroid, which lies on the axis of a revolved face).
 */
function pickOne(matched: number[], near: Vec3 | undefined, distance: (index: number, point: Vec3) => number, tol: number, type: "face" | "edge", query: string, fingerprint: (index: number) => RefFingerprint): NamedRef {
  if (matched.length === 0) return { type, state: "broken", reason: `no ${type} matches ${query}`, query };
  let list = matched;
  if (near && list.length > 1) {
    const d = new Map(list.map((i) => [i, distance(i, near)]));
    const best = Math.min(...d.values());
    list = list.filter((i) => d.get(i)! <= best + tol);
  }
  if (list.length > 1) {
    return { type, state: "ambiguous", candidates: list, reason: `${list.length} ${type}s match ${query}; narrow the query or add near: [x, y, z]`, query };
  }
  const index = list[0]!;
  return { type, state: "exact", index, fingerprint: fingerprint(index), query };
}

function textOf(v: GuestValue | undefined): string {
  const s = JSON.stringify(v) ?? "{}";
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/** A fingerprint moved by a transform of its shape: points by pt, directions by dir. */
export function moveFingerprint(fp: RefFingerprint, pt: (p: Vec3) => Vec3, dir: (d: Vec3) => Vec3): RefFingerprint {
  const out = { ...fp, centroid: pt(fp.centroid) } as RefFingerprint;
  if (out.type === "face") {
    if (out.normal) out.normal = normalize(dir(out.normal));
    if (out.axis) out.axis = canonical(normalize(dir(out.axis)));
  } else {
    if (out.direction) out.direction = canonical(normalize(dir(out.direction)));
    if (out.axis) out.axis = canonical(normalize(dir(out.axis)));
  }
  return out;
}

/** Address of an element: face:7 or edge:12. */
export const elementAddress = (type: "face" | "edge", index: number) => `${type}:${index}`;
