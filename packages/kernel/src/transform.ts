// Rigid transforms as used in the .o3j files: translation in mm plus a unit quaternion
// [x, y, z, w] (glTF order). Converted to the 3x4 row-major matrix occt-wasm takes.
import type { Quaternion, Transform, Vec3 } from "@open3dj/schemas";

/** Quaternions further than this from unit length are rejected (ASSEMBLIES.md 2.3, proposed). */
export const QUATERNION_TOLERANCE = 1e-6;

export const IDENTITY: Transform = { t: [0, 0, 0], q: [0, 0, 0, 1] };

export function isUnitQuaternion(q: Quaternion, tol = QUATERNION_TOLERANCE): boolean {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return Math.abs(n - 1) <= tol;
}

/** 3x4 row-major [r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]. */
export function matrixFromTransform(tr: Transform): number[] {
  const [x, y, z, w] = tr.q;
  const [tx, ty, tz] = tr.t;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), tx,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), ty,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), tz,
  ];
}

/** Quaternion for a rotation of angleDeg about an axis. */
export function quaternionFromAxisAngle(axis: Vec3, angleDeg: number): Quaternion {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n === 0) throw new RangeError("rotation axis must not be zero");
  const h = (angleDeg * Math.PI) / 360;
  const s = Math.sin(h) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Apply a transform to a point. */
export function applyTransform(tr: Transform, p: Vec3): Vec3 {
  const m = matrixFromTransform(tr);
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}
