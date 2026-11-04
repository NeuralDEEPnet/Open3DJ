// Clash, contact and clearance between part occurrences (ASSEMBLIES.md section 6).
// Tier 0: world AABBs grown by the watch distance drop far pairs. Tier 2: exact OCCT
// common() volume and minimum distance on the remaining pairs, labelled "measured".
import type { BBox, FitReport, Vec3 } from "@open3dj/schemas";
import { faceFingerprint, roundFaceConvex } from "@open3dj/dsl";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import { KernelError } from "@open3dj/kernel";
import type { Assembly, FitOptions } from "./types.ts";
import { bboxesOverlap } from "./math.ts";

export const DEFAULT_FIT_OPTIONS: Readonly<Required<FitOptions>> = Object.freeze({
  watchDistance: 0.5,
  volumeTolerance: 1e-6,
  contactTolerance: 1e-6,
});

/** Occurrence-path pairs joined by a mate, as "a\u0000b" with a < b. */
function matedPairs(asm: Assembly): Set<string> {
  const pairs = new Set<string>();
  const owner = (end: string) => end.slice(0, Math.max(0, end.lastIndexOf(".")));
  for (const m of asm.file.mates ?? []) pairs.add(pairKey(owner(m.a), owner(m.b)));
  return pairs;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Every pair of part occurrences that clash, touch or sit within the watch distance. */
export function computeFits(kernel: KernelAdapter, asm: Assembly, options: FitOptions = {}): FitReport[] {
  const o = { ...DEFAULT_FIT_OPTIONS, ...options };
  const mated = matedPairs(asm);
  const fits: FitReport[] = [];
  const mark = kernel.checkpoint();
  try {
    const placed: ShapeHandle[] = asm.instances.map((i) => kernel.place(asm.shapes.get(i.def)!, i.world));
    const boxes = placed.map((s) => kernel.bbox(s));
    const solid = placed.map((s) => kernel.counts(s).solids > 0);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (!bboxesOverlap(boxes[i]!, boxes[j]!, o.watchDistance)) continue;
        const a = asm.instances[i]!.path;
        const b = asm.instances[j]!.path;
        const inner = kernel.checkpoint();
        try {
          const fit = classify(kernel, placed[i]!, placed[j]!, solid[i]! && solid[j]! && bboxesOverlap(boxes[i]!, boxes[j]!, 0), o);
          if (!fit) continue;
          // Contact between mated parts is expected and not listed (ASSEMBLIES.md section 6).
          if (!(fit.kind === "contact" && mated.has(pairKey(a, b)))) fits.push({ a, b, ...fit });
          // A pair that touches or nearly touches can hold other gaps: a lid seated on a rim
          // with its lip 0.25 mm from the wall. Clashing pairs are not searched: a face inside
          // the other part would measure its distance to that part's skin, not a gap.
          if (fit.kind !== "clash") {
            for (const gap of clearanceFeatures(kernel, placed[i]!, placed[j]!, boxes[i]!, boxes[j]!, o)) {
              if (fit.distance_mm !== undefined && sameGap(gap, fit.distance_mm)) continue;
              fits.push({ a, b, kind: "clearance", distance_mm: gap, confidence: "measured", extra: true });
            }
          }
        } catch (e) {
          // A failed exact check must not hide a possible clash: report it, labelled inferred.
          const why = e instanceof KernelError ? e.code : "ERROR";
          asm.warnings.push(`fit check ${a} / ${b} failed in the kernel (${why}); reported as a possible clash.`);
          fits.push({ a, b, kind: "clash", confidence: "inferred" });
        } finally {
          kernel.releaseSince(inner);
        }
      }
    }
  } finally {
    kernel.releaseSince(mark);
  }
  return fits;
}

type Fit = Omit<FitReport, "a" | "b">;

/** Most extra clearance lines per pair: the smallest distinct gaps are the ones that matter. */
const MAX_FEATURES_PER_PAIR = 3;
/** Two gaps closer than this are one feature (the exact distance of each face differs in the last digits). */
const GAP_TOLERANCE = 1e-5;

function sameGap(a: number, b: number): boolean {
  return Math.abs(a - b) <= GAP_TOLERANCE;
}

/** A face near the other part, with what is needed to pair it: surface, plane normal or axis. */
interface NearFace {
  handle: ShapeHandle;
  box: BBox;
  surface: string;
  centroid: Vec3;
  /** Outward plane normal, or cylinder and cone axis. */
  dir?: Vec3;
  /** Cylinders and cones: bulges out of its part (a pin) rather than into it (a hole). */
  convex?: boolean;
}

const PARALLEL = 1 - 1e-6;

function nearFaces(kernel: KernelAdapter, shape: ShapeHandle, otherBox: BBox, watch: number): NearFace[] {
  const handles = kernel.subShapes(shape, "face");
  const out: NearFace[] = [];
  handles.forEach((handle, i) => {
    const box = kernel.bbox(handle);
    if (!bboxesOverlap(box, otherBox, watch)) return;
    const fp = faceFingerprint(kernel, handles, i + 1);
    if (fp.type !== "face") return;
    const face: NearFace = { handle, box, surface: fp.surface, centroid: fp.centroid };
    const dir = fp.normal ?? fp.axis;
    if (dir) face.dir = dir;
    if (fp.surface === "cylinder" || fp.surface === "cone") {
      const convex = roundFaceConvex(kernel, handle);
      if (convex !== undefined) face.convex = convex;
    }
    out.push(face);
  });
  return out;
}

/**
 * Faces that can hold a gap between them: planes with opposite outward normals, or
 * cylinders and cones on parallel axes where one bulges out (a pin) and the other in (a hole).
 * Two faces turned the same way have one part's material between them, not a gap.
 */
function pairable(f: NearFace, g: NearFace): boolean {
  if (!f.dir || !g.dir) return false;
  const d = f.dir[0] * g.dir[0] + f.dir[1] * g.dir[1] + f.dir[2] * g.dir[2];
  if (f.surface === "plane" && g.surface === "plane") return d <= -PARALLEL;
  const round = (x: string) => x === "cylinder" || x === "cone";
  return round(f.surface) && round(g.surface) && Math.abs(d) >= PARALLEL && f.convex !== undefined && g.convex !== undefined && f.convex !== g.convex;
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The range of a box's corners along a unit direction. */
function spanAlong(box: BBox, dir: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const t = dot3([x, y, z], dir);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}

/**
 * The two faces face each other across the gap d, rather than meeting diagonally at an
 * edge: opposite planes, each in front of the other, whose offset is d, or round faces whose
 * spans along the axis overlap.
 */
function facing(f: NearFace, g: NearFace, d: number): boolean {
  const dir = f.dir!;
  if (f.surface === "plane") {
    // f's outward normal points at g, and g's at f: the space between them is outside both parts.
    const offset = dot3(dir, [g.centroid[0] - f.centroid[0], g.centroid[1] - f.centroid[1], g.centroid[2] - f.centroid[2]]);
    const back = dot3(g.dir!, [f.centroid[0] - g.centroid[0], f.centroid[1] - g.centroid[1], f.centroid[2] - g.centroid[2]]);
    return offset > 0 && back > 0 && Math.abs(offset - d) <= GAP_TOLERANCE * 10;
  }
  const [a0, a1] = spanAlong(f.box, dir);
  const [b0, b1] = spanAlong(g.box, dir);
  return Math.min(a1, b1) - Math.max(a0, b0) > GAP_TOLERANCE;
}

/**
 * The space between two facing planes is empty: the slab swept by the smaller face across
 * the gap shares no volume with either part. Normals that face each other do not prove it: a
 * thin fin of one part can stand between the faces. (A single sample segment is not enough:
 * the middle of a face's box can fall in its opening, where a plunger passes.) Round faces
 * need no check: their gap is the annulus between them.
 */
function emptyBetween(kernel: KernelAdapter, f: NearFace, g: NearFace, d: number, a: ShapeHandle, b: ShapeHandle): boolean {
  if (f.surface !== "plane") return true;
  const [face, dir] = kernel.area(f.handle) <= kernel.area(g.handle) ? [f.handle, f.dir!] : [g.handle, g.dir!];
  const slab = kernel.extrude(face, [dir[0] * d, dir[1] * d, dir[2] * d]);
  // Touching both faces is expected; a real obstacle takes a share of the slab.
  const limit = Math.max(1e-9, kernel.volume(slab) * 1e-4);
  return kernel.volume(kernel.common(slab, a)) <= limit && kernel.volume(kernel.common(slab, b)) <= limit;
}

/**
 * The distinct gaps between two parts that do not overlap. A gap is a pair of faces, one on
 * each part, that face each other across empty space: planes turned toward each other (a
 * lid's lip and a wall), or a convex and a concave cylinder or cone on parallel axes (a pin
 * in a hole). Distances between faces that only
 * meet at a corner or an edge are not features and are left out. Faces whose boxes are
 * farther apart than the watch distance are skipped without a distance query. Smallest gaps
 * first, at most MAX_FEATURES_PER_PAIR.
 */
function clearanceFeatures(kernel: KernelAdapter, a: ShapeHandle, b: ShapeHandle, boxA: BBox, boxB: BBox, o: Required<FitOptions>): number[] {
  const facesA = nearFaces(kernel, a, boxB, o.watchDistance);
  if (facesA.length === 0) return [];
  const facesB = nearFaces(kernel, b, boxA, o.watchDistance);
  const gaps: number[] = [];
  for (const f of facesA) {
    for (const g of facesB) {
      if (!pairable(f, g) || !bboxesOverlap(f.box, g.box, o.watchDistance)) continue;
      const d = kernel.distance(f.handle, g.handle);
      if (d > o.contactTolerance && d <= o.watchDistance && facing(f, g, d) && emptyBetween(kernel, f, g, d, a, b)) gaps.push(d);
    }
  }
  gaps.sort((x, y) => x - y);
  const distinct: number[] = [];
  for (const g of gaps) if (!distinct.some((d) => sameGap(d, g))) distinct.push(g);
  return distinct.slice(0, MAX_FEATURES_PER_PAIR);
}

function classify(kernel: KernelAdapter, a: ShapeHandle, b: ShapeHandle, mayOverlap: boolean, o: Required<FitOptions>): Fit | undefined {
  // Volume first: the minimum distance of nested solids is not reliably 0.
  if (mayOverlap) {
    const volume = kernel.volume(kernel.common(a, b));
    if (volume > o.volumeTolerance) return { kind: "clash", volume_mm3: volume, confidence: "measured" };
  }
  const distance = Math.max(0, kernel.distance(a, b));
  if (distance <= o.contactTolerance) return { kind: "contact", distance_mm: distance, confidence: "measured" };
  if (distance <= o.watchDistance) return { kind: "clearance", distance_mm: distance, confidence: "measured" };
  return undefined;
}
