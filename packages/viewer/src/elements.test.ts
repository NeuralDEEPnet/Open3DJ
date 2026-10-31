// The viewer names a picked face face:<n> from the order of the tessellation (web/faces.js).
// This test holds that order against the kernel itself: for each shape, the n-th run of
// triangles must have the area and centre of the kernel's face n (subShapes order, the
// element address), and the seams between runs must be the kernel's edges minus the seam
// edges of periodic faces. If an occt-wasm upgrade changes the tessellation order, this fails
// before the viewer copies a wrong address for an agent.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { initKernel } from "@open3dj/kernel";
import type { Kernel, ShapeHandle } from "@open3dj/kernel";

const faces = (await import(new URL("../web/faces.js", import.meta.url).href)) as {
  faceRanges(index: ArrayLike<number>, vertexCount: number): { starts: Uint32Array; contiguous: boolean };
  faceAddressing(r: { starts: Uint32Array; contiguous: boolean }, kernelFaces?: number): { faces: number; addressed: boolean; reason: string };
  faceEdges(positions: ArrayLike<number>, index: ArrayLike<number>, starts: Uint32Array): { edges: Array<{ faces: number[]; length: number }>; faceEdges: number[][] };
};

let k: Kernel;
before(async () => {
  k = await initKernel();
});

const DEFLECTION = 0.1;

/** Area and area-weighted centre of triangles [t0, t1). */
function patch(p: Float32Array, idx: Uint32Array, t0: number, t1: number) {
  let area = 0;
  const c = [0, 0, 0];
  for (let t = t0; t < t1; t++) {
    const [a, b, d] = [idx[t * 3]! * 3, idx[t * 3 + 1]! * 3, idx[t * 3 + 2]! * 3];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[d]! - p[a]!, p[d + 1]! - p[a + 1]!, p[d + 2]! - p[a + 2]!];
    const s = 0.5 * Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!);
    area += s;
    for (let i = 0; i < 3; i++) c[i]! += (s * (p[a + i]! + p[b + i]! + p[d + i]!)) / 3;
  }
  return { area, center: c.map((x) => x / (area || 1)) };
}

/** seams: how many kernel edges are seams of a periodic face, as [fewest, most]. */
function check(name: string, shape: ShapeHandle, seams: [number, number]) {
  const mesh = k.tessellate(shape, { linearDeflection: DEFLECTION });
  const positions = Float32Array.from(mesh.positions);
  const index = Uint32Array.from(mesh.indices);
  const kernelFaces = k.faces(shape);
  const counts = k.counts(shape);
  const ranges = faces.faceRanges(index, positions.length / 3);
  const addressing = faces.faceAddressing(ranges, counts.faces);
  assert.equal(addressing.addressed, true, `${name}: ${addressing.reason}`);
  kernelFaces.forEach((f, i) => {
    const m = patch(positions, index, ranges.starts[i]!, ranges.starts[i + 1]!);
    // The mesh area is within the chord error of the surface: a few percent on small curved faces.
    assert.ok(Math.abs(m.area - f.area) <= 0.03 * f.area + 0.5, `${name} face:${f.index} (${f.surface}): mesh area ${m.area} vs kernel ${f.area}`);
    const off = Math.hypot(m.center[0]! - f.center[0], m.center[1]! - f.center[1], m.center[2]! - f.center[2]);
    assert.ok(off <= 0.5, `${name} face:${f.index} (${f.surface}): mesh centre is ${off} mm from the kernel's`);
  });
  const { edges } = faces.faceEdges(positions, index, ranges.starts);
  const [fewest, most] = seams;
  assert.ok(edges.length >= counts.edges - most && edges.length <= counts.edges - fewest, `${name}: ${edges.length} seams between faces, kernel edges ${counts.edges} minus ${fewest} to ${most} periodic seams`);
  const kernelLength = k.edges(shape).reduce((s, e) => s + e.length, 0);
  const meshLength = edges.reduce((s, e) => s + e.length, 0);
  assert.ok(meshLength <= kernelLength + 1e-6, `${name}: drawn edges ${meshLength} mm are not longer than the kernel's ${kernelLength} mm`);
}

test("a box: six faces in kernel order and its twelve edges", () => {
  check("box", k.box(40, 30, 20), [0, 0]);
});

test("a cylinder: the seam of the side face is not an edge", () => {
  check("cylinder", k.cylinder(5, 12), [1, 1]);
});

test("a filleted block with a bore and a spherical pocket keeps kernel face order", () => {
  let s = k.box(40, 30, 20);
  s = k.cut(s, k.translate(k.cylinder(5, 40), [20, 15, -5]));
  s = k.fillet(s, k.subShapes(s, "edge").slice(0, 4), 2);
  s = k.cut(s, k.translate(k.sphere(6), [0, 0, 20]));
  // The full bore has a seam; the quarter-round fillets have none; the pocket may cross the sphere's seam.
  check("block", s, [1, 2]);
});
