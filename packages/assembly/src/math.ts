// Rigid transform algebra on { t, q } (translation in mm plus unit quaternion [x, y, z, w]),
// bounding-box helpers, and the conversion to the Euler angles the XCAF boundary takes.
import type { BBox, Quaternion, Transform, Vec3 } from "@open3dj/schemas";
import type { XcafLocation } from "@open3dj/kernel";
import { applyTransform, matrixFromTransform } from "@open3dj/kernel";

/** Snap float noise so JSON output is stable and never shows -0. */
export function clean(x: number, eps = 1e-12): number {
  return Math.abs(x) < eps ? 0 : x;
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n === 0) throw new RangeError("zero quaternion");
  // One canonical sign (w >= 0): q and -q are the same rotation.
  const s = q[3] < 0 ? -1 / n : 1 / n;
  return [clean(q[0] * s), clean(q[1] * s), clean(q[2] * s), clean(q[3] * s)];
}

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector(q: Quaternion, v: Vec3): Vec3 {
  return applyTransform({ t: [0, 0, 0], q }, v);
}

/** a after b: the point x maps to a(b(x)). */
export function compose(a: Transform, b: Transform): Transform {
  const t = rotateVector(a.q, b.t);
  return tidy({ t: [a.t[0] + t[0], a.t[1] + t[1], a.t[2] + t[2]], q: multiplyQuaternions(a.q, b.q) });
}

export function invert(a: Transform): Transform {
  const qi: Quaternion = [-a.q[0], -a.q[1], -a.q[2], a.q[3]];
  const t = rotateVector(qi, a.t);
  return tidy({ t: [-t[0], -t[1], -t[2]], q: qi });
}

export function translation(t: Vec3): Transform {
  return tidy({ t, q: [0, 0, 0, 1] });
}

/** Normalised quaternion, canonical sign, float noise removed. */
export function tidy(tr: Transform): Transform {
  return { t: [clean(tr.t[0], 1e-9), clean(tr.t[1], 1e-9), clean(tr.t[2], 1e-9)], q: normalizeQuaternion(tr.q) };
}

export function isIdentity(tr: Transform, tol = 1e-12): boolean {
  return Math.hypot(...tr.t) <= tol && Math.abs(Math.abs(tr.q[3]) - 1) <= tol;
}

/** Largest absolute difference between the 3x4 matrices of two transforms. */
export function matrixDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < 12; i++) d = Math.max(d, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return d;
}

/**
 * Euler angles for occt-wasm's XCAF addChild. Measured on occt-wasm 5.8.1: the location
 * matrix is R = Rz(rz) * Ry(ry) * Rx(rx) for all three axes (the STEP tests check random
 * rotations). The extraction follows Mike Day's stable method: rz comes from rx and the full
 * matrix, so it stays exact near ry = +-90 degrees, where asin-based formulas lose half their
 * digits. Callers still compare getLocation() with the intended matrix.
 */
export function xcafLocation(tr: Transform): XcafLocation {
  const m = matrixFromTransform(tr);
  const r = (i: number, j: number): number => m[i * 4 + j]!;
  const rx = Math.atan2(r(2, 1), r(2, 2));
  const ry = Math.atan2(-r(2, 0), Math.hypot(r(0, 0), r(1, 0)));
  const s1 = Math.sin(rx);
  const c1 = Math.cos(rx);
  const rz = Math.atan2(s1 * r(0, 2) - c1 * r(0, 1), c1 * r(1, 1) - s1 * r(1, 2));
  return { tx: tr.t[0], ty: tr.t[1], tz: tr.t[2], rx, ry, rz };
}

// ---- bounding boxes ----------------------------------------------------------------------

export function bboxSize(b: BBox): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function bboxCenter(b: BBox): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function bboxDiagonal(b: BBox): number {
  return Math.hypot(...bboxSize(b));
}

export function bboxUnion(boxes: BBox[]): BBox | undefined {
  if (boxes.length === 0) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  }
  return { min, max };
}

/** True when the boxes, each grown by margin, touch or overlap. */
export function bboxesOverlap(a: BBox, b: BBox, margin = 0): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.min[i]! > b.max[i]! + margin || b.min[i]! > a.max[i]! + margin) return false;
  }
  return true;
}
