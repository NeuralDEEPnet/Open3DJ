// FDM print checks per part definition (PLAN.md S3, profile fdm.v1 in ARCHITECTURE.md section
// 10): watertight, 0.8 mm minimum wall, 45 degree overhang and the printer bed. These are rule
// checks on the kernel's geometry, never a print simulation: no slicing, supports, bridging,
// warping or strength. Each runs in a worker on the CPU (COMPUTE.md section 2): the B-rep
// validity and solid count from the kernel, then one tessellation at CHORD_MM for the rest.
import type { GateFailure, GateProfile, GateRun, PartGateRun, Vec3 } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import type { Assembly } from "./types.ts";
import { AssemblyError } from "./errors.ts";
import { openEdgeCount, weld } from "./export/mesh.ts";

/** The fdm.v1 profile. The plan's numbers; the bed is the plan's 220 x 220 x 250 mm. */
export const FDM_V1 = Object.freeze({ profile: "fdm.v1" as GateProfile, minWallMm: 0.8, overhangDeg: 45, bed: [220, 220, 250] as Vec3, build: [0, 0, 1] as Vec3 });
/** Tessellation chord for the checks, in mm. Mesh points lie on the surface; a facet is at most this far from it. */
export const CHORD_MM = 0.02;
/** Wall guard band: the start and the end of a ray can each sit one chord off the surface. */
export const WALL_BAND_MM = 2 * CHORD_MM;
/** Overhang guard band in degrees (COMPUTE.md section 6, rule 3). */
export const ANGLE_BAND_DEG = 1;
/** Wall rays at most WALL_SPACING_MM apart on every face, coarser when a part would need more than MAX_RAYS (see wallSampling). */
export const WALL_SPACING_MM = 0.5;
export const MAX_RAYS = 100_000;
/**
 * Inside edges whose faces open less than 120 degrees (unit normals n1.n2 below 0.5) also cast
 * rays: along such an edge the web or neck it bounds is out of reach of rays along the normals.
 */
export const INSIDE_EDGE_DOT = 0.5;

export interface GateOptions {
  profile?: GateProfile;
  /** Build direction in each definition's frame. Default +Z. */
  build?: Vec3;
  /** Bed size in mm: the two bed axes, then the height. Default the profile's. */
  bed?: Vec3;
  /** Only these definitions. Default every placed part definition. */
  defs?: string[];
}

type Resolved = { minWallMm: number; overhangDeg: number; bed: Vec3; build: Vec3 };

const r3 = (x: number) => Number(x.toFixed(3)) + 0;

/** Run the profile on every placed part definition (or options.defs), each in its own frame. */
export function printGates(kernel: KernelAdapter, asm: Assembly, options: GateOptions = {}): GateRun {
  const build = unit(options.build ?? FDM_V1.build);
  const opts: Resolved = { ...FDM_V1, build, bed: options.bed ?? FDM_V1.bed };
  const placed = new Set(asm.instances.map((i) => i.def));
  const want = options.defs ? new Set(options.defs) : undefined;
  const parts: PartGateRun[] = [];
  for (const [def, shape] of asm.shapes) {
    if (!placed.has(def) || (want && !want.has(def))) continue;
    const mark = kernel.checkpoint();
    try {
      parts.push({ def, ...partGates(kernel, shape, opts) });
    } finally {
      kernel.releaseSince(mark);
    }
  }
  const dir = build.map((x) => r3(x)) as Vec3;
  return {
    profile: options.profile ?? FDM_V1.profile, build: dir, bed_mm: opts.bed, parts,
    notes: [
      "Rule checks on the CPU kernel's geometry, not a print simulation: no slicing, supports, bridging, warping or strength. Each part is checked in its own frame, as designed; use targets to leave out parts that are not printed.",
      `min_wall is estimated from rays cast into the solid on a ${CHORD_MM} mm tessellation. Rays start on every face at most ${WALL_SPACING_MM} mm apart and follow the inward surface normal; a part that would need more than ${MAX_RAYS} rays is sampled more coarsely, but never with fewer than one ray per mesh triangle. wall.spacing_mm is the largest gap between neighbouring rays on a face. A face ray counts its exit only through a face within 60 degrees of its direction, so edges of 60 degrees or sharper read as thin. Rays also start along inside edges whose faces open less than 120 degrees and cross the web or neck those edges bound (a V-groove, a notch, two fused bars); they count any exit. A part where no ray finds an exit (no two faces come close to facing each other, as on a tetrahedron) fails unmeasured, with no value. A value within ${WALL_BAND_MM} mm of the limit is marginal and fails. Thin spots smaller than the spacing can be missed, and so can the tip of a narrow pointed (conical) pocket close to an opposite face.`,
      `overhang uses the surface normals at the mesh points, ${ANGLE_BAND_DEG} degree band; faces at the lowest level that face down rest on the bed and are excluded. watertight and bed need a person to waive; min_wall and overhang an agent with a reason.`,
    ],
  };
}

/** The four checks on one shape. The returned addresses (face:n) are the shape's own. */
export function partGates(kernel: KernelAdapter, shape: ShapeHandle, opts: Resolved): Omit<PartGateRun, "def"> {
  const m = kernel.measure(shape);
  // Mesh a copy: the kernel keeps a finer earlier mesh on a shape and stores its own, so meshing
  // the shape itself would make the result depend on earlier calls and change later exports.
  const mark = kernel.checkpoint();
  let mesh: ReturnType<KernelAdapter["tessellate"]>;
  try {
    mesh = kernel.tessellate(kernel.copy(shape), { linearDeflection: CHORD_MM });
  } finally {
    kernel.releaseSince(mark);
  }
  const P = Float64Array.from(mesh.positions);
  const N = mesh.normals;
  const I = mesh.indices;
  const tris = I.length / 3;
  const faceOf = triangleFaces(I, P.length / 3, m.counts.faces);
  const at = (t: number) => (faceOf && t >= 0 ? { at: `face:${faceOf[t]}` } : {});
  const pass: string[] = [];
  const fail: GateFailure[] = [];

  // watertight: the kernel's validity check, one solid, and a closed, edge-manifold mesh.
  const welded = weld({ positions: mesh.positions, normals: mesh.normals, indices: mesh.indices });
  const open = openEdgeCount(welded);
  const why = [
    !m.valid && "the kernel's validity check fails",
    m.counts.solids === 0 && "it holds no solid",
    m.counts.solids > 1 && `it holds ${m.counts.solids} solids (fuse them, or return them as separate parts)`,
    open > 0 && `the mesh has ${open} open or non-manifold edges`,
    m.counts.solids > 0 && m.volume <= 0 && "its volume is not positive",
  ].filter((x): x is string => typeof x === "string");
  if (why.length === 0) pass.push("watertight");
  // value and limit only when open edges are a cause: otherwise "0 against 0" would read as a pass.
  else fail.push({ gate: "watertight", ...(open > 0 ? { value: open, limit: 0 } : {}), waivable: "human", confidence: "measured", note: `Not a closed solid: ${why.join("; ")}.` });

  // min_wall: rays into the solid; the first exit is the local wall thickness. Face rays start on
  // every triangle and follow the inward surface normal. Edge rays start along sharp inside edges
  // and cross the web or neck the edge bounds, which no surface normal points across.
  const b = unit(opts.build);
  const area = new Float64Array(tris);
  const longest = new Float64Array(tris);
  // The longest edge of triangle t runs from its corner side[t] to the next corner.
  const side = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) {
    area[t] = triArea(P, I, t);
    for (let e = 0; e < 3; e++) {
      const l = dist(P, I[t * 3 + e]!, I[t * 3 + ((e + 1) % 3)]!);
      if (l > longest[t]!) [longest[t], side[t]] = [l, e];
    }
  }
  const edges = insideEdges(P, I, welded.remap);
  const sampling = wallSampling(area, longest, Float64Array.from(edges, (e) => e.length));
  const s = sampling.target;
  const spacing = sampling.spacing;
  const bvh = buildBvh(P, I);
  let rays = 0;
  let thin = Infinity;
  let thinAt = -1;
  const o = new Float64Array(3);
  const dir = new Float64Array(3);
  const cast = (t: number, anyExit: boolean) => {
    rays++;
    const hit = castRay(bvh, P, I, o, dir, t, anyExit);
    if (hit < thin) [thin, thinAt] = [hit, t];
  };
  for (let t = 0; t < tris; t++) {
    // Rows parallel to the longest edge AB, spaced across the altitude towards the far corner C,
    // so even a long, narrow triangle is sampled at most s apart in both directions.
    const A = I[t * 3 + side[t]!]! * 3;
    const B = I[t * 3 + ((side[t]! + 1) % 3)]! * 3;
    const C = I[t * 3 + ((side[t]! + 2) % 3)]! * 3;
    const m = sampling.rows[t]!;
    for (let r = 0; r < m; r++) {
      const f = (r + 0.5) / m;
      const q = rowPoints(longest[t]!, f, s);
      for (let i = 0; i < q; i++) {
        const g = (i + 0.5) / q;
        const [wA, wB, wC] = [(1 - f) * (1 - g), (1 - f) * g, f];
        for (let x = 0; x < 3; x++) {
          o[x] = wA * P[A + x]! + wB * P[B + x]! + wC * P[C + x]!;
          dir[x] = -(wA * N[A + x]! + wB * N[B + x]! + wC * N[C + x]!);
        }
        const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
        for (let x = 0; x < 3; x++) dir[x] = dir[x]! / l;
        cast(t, false);
      }
    }
  }
  for (const e of edges) {
    const n = Math.max(1, Math.ceil(e.length / s));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      for (let x = 0; x < 3; x++) {
        o[x] = (1 - f) * P[e.a * 3 + x]! + f * P[e.c * 3 + x]!;
        dir[x] = e.dir[x]!;
      }
      cast(e.t, true);
    }
  }
  const wall: PartGateRun["wall"] = { rays, spacing_mm: r3(spacing) };
  if (Number.isFinite(thin)) wall.min_mm = r3(thin);
  if (thin > opts.minWallMm + WALL_BAND_MM && Number.isFinite(thin)) pass.push("min_wall");
  else if (!Number.isFinite(thin)) {
    fail.push({
      gate: "min_wall", limit: opts.minWallMm, waivable: "agent",
      note: `None of ${rays} rays left through a face within 60 degrees of its direction, so no wall was measured (no two faces come close to facing each other, as on a tetrahedron). Check the wall by eye and waive with a reason if it is thick.`,
    });
  } else {
    const marginal = thin >= opts.minWallMm - WALL_BAND_MM;
    fail.push({
      gate: "min_wall", value: r3(thin), limit: opts.minWallMm, ...at(thinAt), waivable: "agent", confidence: "measured", ...(marginal ? { marginal: true as const } : {}),
      note: `${marginal ? "Within" : "Thinner than"} the ${opts.minWallMm} mm limit${marginal ? ` plus or minus ${WALL_BAND_MM} mm` : ""}: thinnest wall ${r3(thin)} mm from ${rays} rays.`,
    });
  }

  // overhang: the steepest point normal of each triangle, past vertical towards facing down.
  const h = (v: number) => P[v * 3]! * b[0] + P[v * 3 + 1]! * b[1] + P[v * 3 + 2]! * b[2];
  let low = Infinity;
  for (let v = 0; v < P.length / 3; v++) low = Math.min(low, h(v));
  const down = (v: number) => (Math.asin(Math.max(-1, Math.min(1, -(N[v * 3]! * b[0] + N[v * 3 + 1]! * b[1] + N[v * 3 + 2]! * b[2]) / (Math.hypot(N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!) || 1)))) * 180) / Math.PI;
  let steepest = -90;
  let over = 0;
  let marginalArea = 0;
  // Overhanging area per face, past the band and inside it.
  const byFace = new Map<number, number>();
  const marginByFace = new Map<number, number>();
  const add = (faces: Map<number, number>, t: number) => faceOf && faces.set(faceOf[t]!, (faces.get(faceOf[t]!) ?? 0) + area[t]!);
  for (let t = 0; t < tris; t++) {
    const vs = [I[t * 3]!, I[t * 3 + 1]!, I[t * 3 + 2]!];
    const angles = vs.map(down);
    if (vs.every((v) => h(v) - low <= 1e-3) && Math.min(...angles) >= 90 - ANGLE_BAND_DEG) continue; // rests on the bed
    const a = Math.max(...angles);
    if (a <= opts.overhangDeg - ANGLE_BAND_DEG || area[t] === 0) continue;
    steepest = Math.max(steepest, a);
    if (a <= opts.overhangDeg + ANGLE_BAND_DEG) {
      marginalArea += area[t]!;
      add(marginByFace, t);
    } else {
      over += area[t]!;
      add(byFace, t);
    }
  }
  if (steepest <= opts.overhangDeg - ANGLE_BAND_DEG) pass.push("overhang");
  else {
    const marginal = over === 0;
    const faces = marginal ? marginByFace : byFace;
    const top = [...faces].sort((x, y) => y[1] - x[1])[0];
    const where = top ? ` on ${faces.size} face${faces.size === 1 ? "" : "s"}; the largest is face:${top[0]} (${Math.round(top[1])} mm2)` : "";
    fail.push({
      gate: "overhang", value: Number(steepest.toFixed(1)), limit: opts.overhangDeg, ...(top ? { at: `face:${top[0]}` } : {}), waivable: "agent", confidence: "measured", ...(marginal ? { marginal: true as const } : {}),
      note: marginal
        ? `${Math.round(marginalArea)} mm2 leans within ${ANGLE_BAND_DEG} degree of the ${opts.overhangDeg} degree limit${where}.`
        : `${Math.round(over)} mm2 leans more than ${opts.overhangDeg} degrees past vertical${where}. Support it, bridge it if the span is short, or turn the part.`,
    });
  }

  // bed: the extent along the build direction against the height, the footprint either way round.
  const size = extents(m.bbox, P, b);
  const [bx, by, bz] = opts.bed;
  const eps = 1e-6;
  // Long side against the long bed side, short against short: that covers both turns.
  const [s1, s2, b1, b2] = [Math.max(size[0], size[1]), Math.min(size[0], size[1]), Math.max(bx, by), Math.min(bx, by)];
  const excess = size[2] > bz + eps ? [size[2], bz] : s1 > b1 + eps ? [s1, b1] : s2 > b2 + eps ? [s2, b2] : undefined;
  if (!excess) pass.push("bed");
  else {
    const [value, limit] = excess as [number, number];
    fail.push({
      gate: "bed", value: r3(value), limit, waivable: "human", confidence: "measured",
      note: `The part is ${size.map(r3).join(" x ")} mm (footprint, then height along the build direction); the bed is ${bx} x ${by} x ${bz} mm, also tried turned 90 degrees.`,
    });
  }
  return { pass, fail, wall };
}

/** Rows of face rays on a triangle with this area and longest edge, at most s apart across it. */
const triangleRows = (area: number, longest: number, s: number) => (longest > 0 ? Math.max(1, Math.ceil((2 * area) / longest / s)) : 1);
/** Rays in the row at fraction f of the way from the longest edge to the far corner, at most s apart. */
const rowPoints = (longest: number, f: number, s: number) => Math.max(1, Math.ceil((longest * (1 - f)) / s));

/**
 * The wall-ray plan. Each triangle gets rows[t] rows of rays parallel to its longest edge, rays
 * at most target apart within and across the rows; each inside edge of the given lengths gets
 * rays at most target apart along it. The target starts at WALL_SPACING_MM and grows only while
 * the plan holds more than maxRays, but every triangle and edge keeps at least one ray, so a mesh
 * with more of them than maxRays gets one ray each. spacing is the largest gap between
 * neighbouring rays in the plan, never more than target.
 */
export function wallSampling(area: Float64Array, longest: Float64Array, edges: Float64Array = new Float64Array(0), maxRays = MAX_RAYS): { rows: Int32Array; target: number; rays: number; spacing: number } {
  let total = 0;
  for (const a of area) total += a;
  let target = Math.max(WALL_SPACING_MM, Math.sqrt(total / maxRays));
  const rows = new Int32Array(area.length);
  const least = area.length + edges.length;
  let rays = 0;
  let spacing = 0;
  for (let round = 0; round < 16; round++) {
    rays = 0;
    spacing = 0;
    for (let t = 0; t < area.length; t++) {
      const L = longest[t]!;
      const m = (rows[t] = triangleRows(area[t]!, L, target));
      if (L > 0) spacing = Math.max(spacing, (2 * area[t]!) / L / m);
      for (let r = 0; r < m; r++) {
        const q = rowPoints(L, (r + 0.5) / m, target);
        rays += q;
        spacing = Math.max(spacing, (L * (1 - (r + 0.5) / m)) / q);
      }
    }
    for (const len of edges) {
      const n = Math.max(1, Math.ceil(len / target));
      rays += n;
      spacing = Math.max(spacing, len / n);
    }
    if (rays <= maxRays || rays === least) break;
    // At least 2% coarser each round: rounding up can keep the count just over the budget.
    target *= Math.max(1.02, Math.sqrt(rays / maxRays));
  }
  return { rows, target, rays, spacing: spacing > 0 ? spacing : target };
}

/**
 * Sharp inside edges: mesh edges shared by exactly two triangles (matched on welded vertices)
 * whose faces open less than 120 degrees (unit normals n1.n2 < INSIDE_EDGE_DOT) and fold inward
 * (the far corner of the second triangle lies outside the first one's plane). Each comes with
 * the direction into the solid between its two faces, -(n1 + n2) normalised.
 */
function insideEdges(P: Float64Array, I: Uint32Array, remap: Uint32Array): Array<{ t: number; a: number; c: number; dir: Vec3; length: number }> {
  const normal = (t: number): Vec3 => {
    const [a, b, c] = [I[t * 3]! * 3, I[t * 3 + 1]! * 3, I[t * 3 + 2]! * 3];
    const n = cross([P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!], [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!]);
    const l = Math.hypot(n[0], n[1], n[2]);
    return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
  };
  const welded = remap.reduce((m, v) => Math.max(m, v), 0) + 1;
  const sides = new Map<number, number[]>();
  for (let t = 0; t < I.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const [u, v] = [remap[I[t * 3 + e]!]!, remap[I[t * 3 + ((e + 1) % 3)]!]!];
      if (u === v) continue;
      const key = Math.min(u, v) * welded + Math.max(u, v);
      const list = sides.get(key);
      if (list) list.push(t, e);
      else sides.set(key, [t, e]);
    }
  }
  const out: Array<{ t: number; a: number; c: number; dir: Vec3; length: number }> = [];
  for (const list of sides.values()) {
    if (list.length !== 4) continue;
    const [t1, e1, t2, e2] = list as [number, number, number, number];
    const [n1, n2] = [normal(t1), normal(t2)];
    if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] >= INSIDE_EDGE_DOT) continue;
    const a = I[t1 * 3 + e1]!;
    const c = I[t1 * 3 + ((e1 + 1) % 3)]!;
    const far = I[t2 * 3 + ((e2 + 2) % 3)]! * 3;
    if ((P[far]! - P[a * 3]!) * n1[0] + (P[far + 1]! - P[a * 3 + 1]!) * n1[1] + (P[far + 2]! - P[a * 3 + 2]!) * n1[2] <= 1e-9) continue;
    const d: Vec3 = [-(n1[0] + n2[0]), -(n1[1] + n2[1]), -(n1[2] + n2[2])];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l < 1e-9 || Math.hypot(...n1) === 0 || Math.hypot(...n2) === 0) continue;
    out.push({ t: t1, a, c, dir: [d[0] / l, d[1] / l, d[2] / l], length: dist(P, a, c) });
  }
  return out;
}

/** Footprint (two axes across the build direction) and height. Exact for axis builds; otherwise from mesh points plus two chords. */
function extents(bbox: { min: Vec3; max: Vec3 }, P: Float64Array, b: Vec3): Vec3 {
  const axis = b.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-12);
  if (axis >= 0) {
    const s = [0, 1, 2].map((i) => bbox.max[i]! - bbox.min[i]!);
    const across = [0, 1, 2].filter((i) => i !== axis);
    return [s[across[0]!]!, s[across[1]!]!, s[axis]!];
  }
  const u = unit(cross(b, Math.abs(b[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const frame = [u, cross(b, u), b];
  return frame.map((e) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i]! * e[0] + P[i + 1]! * e[1] + P[i + 2]! * e[2];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return hi - lo + 2 * CHORD_MM;
  }) as Vec3;
}

/**
 * The kernel's 1-based face number of each triangle. The tessellator writes the faces in
 * order, each with its own vertices, so a face is a connected group of vertex indices (as in
 * the viewer's faces.js). Undefined when the groups do not match the kernel's face count.
 */
function triangleFaces(I: Uint32Array, vertices: number, faces: number): Int32Array | undefined {
  const parent = Int32Array.from({ length: vertices }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };
  for (let i = 0; i < I.length; i += 3) {
    const a = find(I[i]!);
    parent[find(I[i + 1]!)] = a;
    parent[find(I[i + 2]!)] = a;
  }
  const ids = new Map<number, number>();
  const out = new Int32Array(I.length / 3);
  for (let t = 0; t < out.length; t++) {
    const root = find(I[t * 3]!);
    if (!ids.has(root)) ids.set(root, ids.size + 1);
    out[t] = ids.get(root)!;
  }
  return ids.size === faces ? out : undefined;
}

// ---- ray casting: a median-split bounding volume hierarchy over the triangles -------------

interface Bvh {
  /** min xyz, max xyz per node. */
  box: Float64Array;
  /** Internal node: index of the first child (the second follows). Leaf: -1. */
  child: Int32Array;
  /** Split axis of an internal node: the first child holds the lower centroids. */
  axis: Int8Array;
  start: Int32Array;
  count: Int32Array;
  order: Int32Array;
}

function buildBvh(P: Float64Array, I: Uint32Array): Bvh {
  const tris = I.length / 3;
  const c = new Float64Array(tris * 3);
  for (let t = 0; t < tris; t++) for (let x = 0; x < 3; x++) c[t * 3 + x] = (P[I[t * 3]! * 3 + x]! + P[I[t * 3 + 1]! * 3 + x]! + P[I[t * 3 + 2]! * 3 + x]!) / 3;
  const size = Math.max(1, 2 * tris);
  const bvh: Bvh = { box: new Float64Array(size * 6), child: new Int32Array(size), axis: new Int8Array(size), start: new Int32Array(size), count: new Int32Array(size), order: Int32Array.from({ length: tris }, (_, i) => i) };
  let nodes = 1;
  const stack: Array<[number, number, number]> = [[0, 0, tris]];
  while (stack.length > 0) {
    const [node, s, e] = stack.pop()!;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = s; k < e; k++) {
      for (let v = 0; v < 3; v++) {
        const p = I[bvh.order[k]! * 3 + v]! * 3;
        for (let x = 0; x < 3; x++) {
          box[x] = Math.min(box[x]!, P[p + x]!);
          box[x + 3] = Math.max(box[x + 3]!, P[p + x]!);
        }
      }
    }
    bvh.box.set(box, node * 6);
    bvh.start[node] = s;
    bvh.count[node] = e - s;
    bvh.child[node] = -1;
    if (e - s <= 4) continue;
    const axis = [0, 1, 2].reduce((best, x) => (box[x + 3]! - box[x]! > box[best + 3]! - box[best]! ? x : best), 0);
    bvh.order.subarray(s, e).sort((a, b) => c[a * 3 + axis]! - c[b * 3 + axis]!);
    const mid = (s + e) >> 1;
    bvh.child[node] = nodes;
    bvh.axis[node] = axis;
    stack.push([nodes, s, mid], [nodes + 1, mid, e]);
    nodes += 2;
  }
  return bvh;
}

/**
 * Distance to the nearest triangle the ray leaves the solid through, past 1e-4 mm: one whose
 * normal is within 60 degrees of d, or any exit with anyExit (edge rays). Infinity on a miss.
 */
function castRay(bvh: Bvh, P: Float64Array, I: Uint32Array, o: Float64Array, d: Float64Array, skip: number, anyExit = false): number {
  // A zero component would give 0 * Infinity = NaN in the slab test.
  const inv = [0, 1, 2].map((x) => 1 / (Math.abs(d[x]!) < 1e-12 ? (d[x]! < 0 ? -1e-12 : 1e-12) : d[x]!));
  let best = Infinity;
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    let t0 = 0;
    let t1 = best;
    for (let x = 0; x < 3 && t0 <= t1; x++) {
      const a = (bvh.box[node * 6 + x]! - o[x]!) * inv[x]!;
      const b = (bvh.box[node * 6 + x + 3]! - o[x]!) * inv[x]!;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (!(t0 <= t1)) continue;
    const first = bvh.child[node]!;
    if (first >= 0) {
      // Near child last, so it is visited first and a close exit prunes the far one.
      if (d[bvh.axis[node]!]! > 0) stack.push(first + 1, first);
      else stack.push(first, first + 1);
      continue;
    }
    for (let k = bvh.start[node]!; k < bvh.start[node]! + bvh.count[node]!; k++) {
      const t = bvh.order[k]!;
      if (t === skip) continue;
      const hit = intersect(P, I, t, o, d, anyExit);
      if (hit > 1e-4 && hit < best) best = hit;
    }
  }
  return best;
}

/** Moller-Trumbore. Only triangles the ray leaves through count: winding normal within 60 degrees of d, or facing along d at all with anyExit. */
function intersect(P: Float64Array, I: Uint32Array, t: number, o: Float64Array, d: Float64Array, anyExit: boolean): number {
  const a = I[t * 3]! * 3;
  const b = I[t * 3 + 1]! * 3;
  const c = I[t * 3 + 2]! * 3;
  const ax = P[a]!, ay = P[a + 1]!, az = P[a + 2]!, dx = d[0]!, dy = d[1]!, dz = d[2]!;
  const e1x = P[b]! - ax, e1y = P[b + 1]! - ay, e1z = P[b + 2]! - az;
  const e2x = P[c]! - ax, e2y = P[c + 1]! - ay, e2z = P[c + 2]! - az;
  // Winding normal n = e1 x e2 against d. Entering faces are skipped, and so are grazing exits of
  // face rays (n more than 60 degrees from d, so n.d < |n| / 2): beside an edge of more than 60
  // and up to 90 degrees such an exit is the edge, not a wall, and would read a drafted solid as
  // thin. The 1e-4 band counts an exit of exactly 60 degrees every time, whatever the rounding.
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const nd = nx * dx + ny * dy + nz * dz;
  if (nd <= 0 || (!anyExit && 4 * nd * nd < (1 - 1e-4) * (nx * nx + ny * ny + nz * nz))) return Infinity;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-18) return Infinity;
  const sx = o[0]! - ax, sy = o[1]! - ay, sz = o[2]! - az;
  const u = (sx * px + sy * py + sz * pz) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < -1e-9 || u + v > 1 + 1e-9) return Infinity;
  return (e2x * qx + e2y * qy + e2z * qz) / det;
}

function dist(P: Float64Array, a: number, c: number): number {
  return Math.hypot(P[c * 3]! - P[a * 3]!, P[c * 3 + 1]! - P[a * 3 + 1]!, P[c * 3 + 2]! - P[a * 3 + 2]!);
}

function triArea(P: Float64Array, I: Uint32Array, t: number): number {
  const [a, b, c] = [I[t * 3]! * 3, I[t * 3 + 1]! * 3, I[t * 3 + 2]! * 3];
  const n = cross([P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!], [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!]);
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A unit vector. Scaled by its largest component first, so huge finite vectors do not overflow. */
function unit(v: Vec3): Vec3 {
  const s = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
  if (!(s > 0 && Number.isFinite(s))) throw new AssemblyError("BAD_INPUT", `the build direction must be a finite, non-zero vector, got [${v.join(", ")}]`, "Pass a direction such as [0, 0, 1], or leave it out for +Z.");
  const w: Vec3 = [v[0] / s, v[1] / s, v[2] / s];
  const l = Math.hypot(w[0], w[1], w[2]);
  return [w[0] / l, w[1] / l, w[2] / l];
}
