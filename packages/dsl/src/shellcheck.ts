// A geometric check for shell results. OCCT's thick-solid can return a shape that passes
// isValid but is wrong: measured here, box(20, 20, 10).shell(12) came back unchanged and a
// filleted box shelled thicker than its fillets lost only 1 % of its volume. In a correct
// shell every face lies on the kept skin (distance 0), on the inner wall (distance |t| from
// the kept skin) or in a removed face (the rim of the opening), and at least one face lies
// on the inner wall.
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";

interface RawKernel {
  uvBounds(face: number): { uMin: number; uMax: number; vMin: number; vMax: number };
  classifyPointOnFace(face: number, u: number, v: number): "in" | "on" | "out";
  pointOnSurface(face: number, u: number, v: number): { x: number; y: number; z: number };
  makeVertex(x: number, y: number, z: number): number;
  distanceBetween(a: number, b: number): number;
}

const SAMPLES: [number, number][] = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25], [0.5, 0.1], [0.1, 0.5]];

export interface WallCheck {
  /** Faces of the result that are neither on the skin nor at the wall thickness from it. */
  badFaces: string[];
  /** True when some face lies at the wall thickness from the skin. */
  cavity: boolean;
}

export function checkShellWalls(kernel: KernelAdapter, original: ShapeHandle, removed: ShapeHandle[], result: ShapeHandle, thickness: number, tol: number): WallCheck | undefined {
  const raw = (kernel as { raw?: RawKernel }).raw;
  if (!raw) return undefined; // fakes without the occt-wasm kernel skip the check
  const t = Math.abs(thickness);
  const near = (d: number, want: number) => Math.abs(d - want) <= Math.max(tol, 2e-3 * t);
  const mark = kernel.checkpoint();
  try {
    const kept = kernel.subShapes(original, "face").filter((f) => !removed.some((r) => kernel.isSame(f, r)));
    const skin = kernel.compound(kept);
    const opening = removed.length ? kernel.compound(removed) : undefined;
    const badFaces: string[] = [];
    let cavity = false;
    kernel.subShapes(result, "face").forEach((face, i) => {
      const uv = raw.uvBounds(face);
      for (const [fu, fv] of SAMPLES) {
        const u = uv.uMin + (uv.uMax - uv.uMin) * fu;
        const v = uv.vMin + (uv.vMax - uv.vMin) * fv;
        if (raw.classifyPointOnFace(face, u, v) !== "in") continue;
        const p = raw.pointOnSurface(face, u, v);
        const d = raw.distanceBetween(raw.makeVertex(p.x, p.y, p.z), skin);
        if (near(d, t)) cavity = true;
        else if (!near(d, 0) && !(opening && near(raw.distanceBetween(raw.makeVertex(p.x, p.y, p.z), opening), 0)) && badFaces.length < 20) badFaces.push(`face:${i + 1}`);
        return;
      }
    });
    return { badFaces, cavity };
  } finally {
    kernel.releaseSince(mark);
  }
}
