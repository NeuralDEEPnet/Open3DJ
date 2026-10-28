// Vector, rigid-transform and colour helpers for the DSL host side.
import type { Color3, Quaternion, Transform, Vec3 } from "@open3dj/schemas";
import { IDENTITY, applyTransform, quaternionFromAxisAngle } from "@open3dj/kernel";

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const n = length(a);
  if (n === 0) throw new RangeError("a direction must not be the zero vector");
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Rotate a point by angleDeg about an axis through pivot (right-hand rule). */
export function rotatePoint(p: Vec3, axis: Vec3, angleDeg: number, pivot: Vec3 = [0, 0, 0]): Vec3 {
  const k = normalize(axis);
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const v = sub(p, pivot);
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return [0, 1, 2].map((i) => pivot[i]! + v[i]! * c + kxv[i]! * s + k[i]! * kdv * (1 - c)) as Vec3;
}

/** Reflect a point through the plane with this normal through `at`. */
export function mirrorPoint(p: Vec3, normal: Vec3, at: Vec3 = [0, 0, 0]): Vec3 {
  const u = normalize(normal);
  const d = dot(sub(p, at), u);
  return sub(p, mul(u, 2 * d));
}

/** Reflect a direction (no translation part). */
export function mirrorDir(v: Vec3, normal: Vec3): Vec3 {
  return mirrorPoint(v, normal);
}

/** Hamilton product a*b: apply b first, then a. Quaternions are [x, y, z, w]. */
export function qmul(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function unit(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** The transform "first t, then translate by d". */
export function thenTranslate(t: Transform, d: Vec3): Transform {
  return { t: add(t.t, d), q: t.q };
}

/** The transform "first t, then rotate by angleDeg about axis through pivot". */
export function thenRotate(t: Transform, axis: Vec3, angleDeg: number, pivot: Vec3): Transform {
  const r = quaternionFromAxisAngle(axis, angleDeg);
  const rt = applyTransform({ t: [0, 0, 0], q: r }, sub(t.t, pivot));
  return { t: add(rt, pivot), q: unit(qmul(r, t.q)) };
}

export { IDENTITY };

const NAMED: Record<string, Color3> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1],
  yellow: [1, 1, 0], orange: [1, 0.647, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  silver: [0.753, 0.753, 0.753], cyan: [0, 1, 1], magenta: [1, 0, 1],
};

/**
 * Colour from "#rgb", "#rrggbb", a few CSS names, or [r, g, b] with channels 0 to 1 (or 0 to
 * 255 when any channel is above 1). Returns undefined for anything else.
 */
export function parseColor(c: unknown): Color3 | undefined {
  if (typeof c === "string") {
    const s = c.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s];
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (!m) return undefined;
    const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join("") : m[1]!;
    return [0, 2, 4].map((i) => round4(parseInt(h.slice(i, i + 2), 16) / 255)) as Color3;
  }
  if (Array.isArray(c) && c.length === 3 && c.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) {
    const nums = c as number[];
    const scale = nums.some((x) => x > 1) ? 255 : 1;
    if (nums.some((x) => x / scale > 1)) return undefined;
    return nums.map((x) => round4(x / scale)) as Color3;
  }
  return undefined;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
