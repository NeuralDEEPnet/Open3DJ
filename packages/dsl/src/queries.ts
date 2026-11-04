// Edge queries ({ atZ, atX, atY, parallel, perpendicular, minLength, maxLength }) evaluated on
// the host in one call. 3dj publishes no semantics beyond the field names, so ours are:
// - atX/atY/atZ: the whole edge lies at that coordinate (its bounding box min and max are
//   both within the tolerance of the value).
// - parallel: a straight edge along the direction (either sense).
// - perpendicular: every sampled point of the edge has the same coordinate along the
//   direction, so the edge lies in a plane normal to it (lines across it, circles around it).
// - minLength/maxLength: curve length, not bounding-box extent (as in the DSL spike).
import type { Vec3 } from "@open3dj/schemas";
import type { EdgeInfo, KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import type { GuestValue } from "@open3dj/sandbox";
import { badArgument } from "./errors.ts";
import { cross, dot, length, normalize, sub } from "./math.ts";
import { dir3, num, obj } from "./state.ts";

export interface EdgeQuery {
  atX?: number;
  atY?: number;
  atZ?: number;
  parallel?: Vec3;
  perpendicular?: Vec3;
  minLength?: number;
  maxLength?: number;
}

const KEYS = new Set(["atX", "atY", "atZ", "parallel", "perpendicular", "minLength", "maxLength"]);

export function parseEdgeQuery(x: GuestValue | undefined): EdgeQuery {
  const o = obj(x, "edge query");
  const q: EdgeQuery = {};
  for (const [k, v] of Object.entries(o)) {
    if (!KEYS.has(k)) throw badArgument(`unknown edge query field ${k}`, `Use ${[...KEYS].join(", ")}.`);
    if (v === undefined || v === null) continue;
    if (k === "parallel" || k === "perpendicular") q[k] = normalize(dir3(v, `edge query ${k}`));
    else q[k as "atX"] = num(v, `edge query ${k}`);
  }
  return q;
}

/** Sample points along an edge: start, end, and three interior points when the raw kernel is there. */
function samples(kernel: KernelAdapter, edge: ShapeHandle, info: EdgeInfo): Vec3[] {
  const raw = (kernel as { raw?: { curveParameters(e: number): { first: number; last: number }; curvePointAtParam(e: number, t: number): { x: number; y: number; z: number } } }).raw;
  if (!raw) return [info.start, info.mid, info.end];
  const { first, last } = raw.curveParameters(edge);
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const p = raw.curvePointAtParam(edge, first + (last - first) * f);
    return [p.x, p.y, p.z] as Vec3;
  });
}

/** 1-based indices (subShapes order) of the edges of shape that match the query. */
export function matchEdges(kernel: KernelAdapter, shape: ShapeHandle, q: EdgeQuery, tol: number): { infos: EdgeInfo[]; matched: EdgeInfo[]; handles: ShapeHandle[] } {
  const handles = kernel.subShapes(shape, "edge");
  const infos = handles.map((h, i) => kernel.edgeInfo(h, i + 1));
  const at = (lo: number, hi: number, v: number) => Math.abs(lo - v) <= tol && Math.abs(hi - v) <= tol;
  const matched = infos.filter((e, i) => {
    const b = e.bbox;
    if (q.atX !== undefined && !at(b.min[0], b.max[0], q.atX)) return false;
    if (q.atY !== undefined && !at(b.min[1], b.max[1], q.atY)) return false;
    if (q.atZ !== undefined && !at(b.min[2], b.max[2], q.atZ)) return false;
    if (q.minLength !== undefined && e.length < q.minLength - tol) return false;
    if (q.maxLength !== undefined && e.length > q.maxLength + tol) return false;
    if (q.parallel) {
      if (e.curve !== "line") return false;
      const d = sub(e.end, e.start);
      const n = length(d);
      if (n === 0 || length(cross(d, q.parallel)) / n > 1e-6) return false;
    }
    if (q.perpendicular) {
      const pts = samples(kernel, handles[i]!, e);
      const h0 = dot(pts[0]!, q.perpendicular);
      if (!pts.every((p) => Math.abs(dot(p, q.perpendicular!) - h0) <= tol)) return false;
    }
    return true;
  });
  return { infos, matched, handles: matched.map((e) => handles[e.index - 1]!) };
}
