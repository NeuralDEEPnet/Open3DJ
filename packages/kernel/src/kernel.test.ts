import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { KernelError, applyTransform, initKernel, isUnitQuaternion, matrixFromTransform, quaternionFromAxisAngle } from "./index.ts";
import type { Kernel, ShapeHandle } from "./index.ts";

const close = (actual: number, expected: number, rel = 1e-6, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), msg ?? `${actual} != ${expected} (rel ${rel})`);

let k: Kernel;
before(async () => {
  k = await initKernel();
});

describe("primitives and measures", () => {
  test("box volume, area, bbox, counts and validity", () => {
    const b = k.box(10, 20, 30);
    const m = k.measure(b);
    assert.equal(m.valid, true);
    close(m.volume, 6000);
    close(m.area, 2 * (10 * 20 + 10 * 30 + 20 * 30));
    assert.deepEqual(m.bbox, { min: [0, 0, 0], max: [10, 20, 30] });
    close(m.centerOfMass[2], 15);
    assert.deepEqual({ solids: m.counts.solids, faces: m.counts.faces, edges: m.counts.edges }, { solids: 1, faces: 6, edges: 12 });
    assert.equal(k.versions.occtWasm, "5.8.1");
  });

  test("bad sizes are rejected before reaching the kernel", () => {
    assert.throws(() => k.box(0, 1, 1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
    assert.throws(() => k.cylinder(Number.NaN, 1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
  });
});

describe("booleans", () => {
  test("fuse of overlapping boxes is one valid solid of the union volume", () => {
    const a = k.box(10, 10, 10);
    const b = k.translate(k.box(10, 10, 10), [5, 0, 0]);
    const u = k.fuse(a, b);
    assert.equal(k.shapeType(u), "solid");
    close(k.volume(u), 1500);
  });

  test("cutAll returns a solid (single-solid compound unwrapped)", () => {
    const plate = k.translate(k.box(60, 40, 8), [-30, -20, 0]);
    const holes = [[-20, -10], [20, 10]].map(([x, y]) => k.translate(k.cylinder(3, 20), [x!, y!, -5]));
    const r = k.cutAll(plate, holes);
    assert.equal(k.shapeType(r), "solid");
    close(k.volume(r), 60 * 40 * 8 - 2 * Math.PI * 9 * 8, 1e-6);
  });

  test("fuseAll of disjoint bodies keeps a compound, and asSolid refuses it", () => {
    const r = k.fuseAll([k.box(1, 1, 1), k.translate(k.box(1, 1, 1), [5, 0, 0])]);
    assert.equal(k.counts(r).solids, 2);
    close(k.volume(r), 2);
    assert.throws(() => k.asSolid(r), (e: unknown) => e instanceof KernelError && e.code === "NOT_A_SOLID");
  });

  test("common of disjoint shapes is empty, not an error", () => {
    const r = k.common(k.box(1, 1, 1), k.translate(k.box(1, 1, 1), [5, 0, 0]));
    close(k.volume(r), 0);
  });
});

describe("features", () => {
  test("fillet of every cube edge matches the analytic rounded-cube volume", () => {
    const a = 10, r = 1;
    const cube = k.box(a, a, a);
    const out = k.fillet(cube, k.subShapes(cube, "edge"), r);
    const s = a - 2 * r;
    const expected = s ** 3 + 6 * s * s * r + 3 * Math.PI * r * r * s + (4 / 3) * Math.PI * r ** 3;
    close(k.volume(out), expected, 1e-5);
    assert.equal(k.isValid(out), true);
  });

  test("fillet accepts a single-solid compound (from a boolean) as input", () => {
    const body = k.cutAll(k.box(20, 20, 10), [k.translate(k.cylinder(2, 20), [10, 10, -5])]);
    const top = k.edges(body).filter((e) => e.bbox.min[2] > 9.999 && e.curve === "line");
    assert.equal(top.length, 4);
    const all = k.subShapes(body, "edge");
    const out = k.fillet(body, top.map((e) => all[e.index - 1]!), 1);
    assert.ok(k.volume(out) < k.volume(body));
  });

  test("an oversized fillet fails with a structured error", () => {
    const cube = k.box(10, 10, 10);
    assert.throws(
      () => k.fillet(cube, k.subShapes(cube, "edge"), 6),
      (e: unknown) => e instanceof KernelError && (e.code === "FILLET_FAILED" || e.code === "INVALID_RESULT") && e.op === "fillet",
    );
  });

  test("a failed fillet names the faulty edges as element addresses", () => {
    const cube = k.box(10, 10, 10);
    const edges = k.subShapes(cube, "edge").slice(0, 2);
    assert.throws(
      () => k.fillet(cube, edges, 20),
      (e: unknown) => e instanceof KernelError && e.code === "FILLET_FAILED" && e.elements.join(",") === "edge:1,edge:2" && !!e.hint && !/fillet: fillet/.test(e.message),
    );
  });

  test("fillet with an empty edge query is a BAD_ARGUMENT with a hint", () => {
    assert.throws(() => k.fillet(k.box(1, 1, 1), [], 0.1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && !!e.hint);
  });

  test("shell of a plain box: positive thickness walls inward, negative outward", () => {
    const b = k.box(40, 30, 20);
    const top = topFace(b, 20);
    const inward = k.shell(b, [top], 2);
    close(k.volume(inward), 40 * 30 * 20 - 36 * 26 * 18, 1e-6);
    assert.deepEqual(k.bbox(inward), { min: [0, 0, 0], max: [40, 30, 20] });
    const outward = k.shell(b, [top], -2);
    assert.deepEqual(k.bbox(outward).min.map(Math.round), [-2, -2, -2]);
  });

  test("shell that silently yields an invalid solid is reported as INVALID_RESULT", () => {
    // Endurance spike: a box with all 12 edges filleted, shelled with the top removed,
    // comes back from OCCT with no error but fails isValid.
    const W = 60, D = 50, H = 30;
    const b = k.translate(k.box(W, D, H), [-W / 2, -D / 2, 0]);
    const rounded = k.fillet(b, k.subShapes(b, "edge"), 3);
    const top = topFace(rounded, H);
    assert.throws(
      () => k.shell(rounded, [top], 2),
      (e: unknown) => e instanceof KernelError && e.code === "INVALID_RESULT" && e.op === "shell" && /invalid/.test(e.message),
    );
  });
});

describe("queries, transforms and sketches", () => {
  test("edge and face queries return plain data with element indices", () => {
    const b = k.box(10, 20, 30);
    const edges = k.edges(b);
    assert.equal(edges.length, 12);
    assert.deepEqual(edges.map((e) => e.index), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(edges.every((e) => e.curve === "line"));
    assert.deepEqual(edges.map((e) => Math.round(e.length)).sort((x, y) => x - y), [10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
    const faces = k.faces(b);
    assert.equal(faces.length, 6);
    const top = faces.find((f) => f.bbox.min[2] > 29.999)!;
    assert.equal(top.surface, "plane");
    assert.deepEqual(top.normal.map((x) => Math.round(x)), [0, 0, 1]);
    close(top.area, 200);
  });

  test("place applies translation plus quaternion and rejects non-unit quaternions", () => {
    const b = k.box(10, 20, 5);
    const p = k.place(b, { t: [100, 0, 0], q: quaternionFromAxisAngle([0, 0, 1], 90) });
    const bb = k.bbox(p);
    close(bb.min[0], 80, 1e-6);
    close(bb.max[0], 100, 1e-6);
    close(bb.max[1], 10, 1e-6);
    assert.throws(() => k.place(b, { t: [0, 0, 0], q: [0, 0, 0, 2] }), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
  });

  test("polygon, face and extrude make a prism; revolve makes a cylinder", () => {
    const tri = k.face(k.polygon([[0, 0, 0], [10, 0, 0], [0, 10, 0]]));
    close(k.volume(k.extrude(tri, [0, 0, 5])), 250);
    const rect = k.face(k.polygon([[0, 0, 0], [5, 0, 0], [5, 0, 10], [0, 0, 10]]));
    close(k.volume(k.revolve(rect, { origin: [0, 0, 0], dir: [0, 0, 1] }, 360)), Math.PI * 25 * 10, 1e-6);
  });

  test("loft between two squares makes a frustum", () => {
    const sq = (s: number, z: number) => k.polygon([[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]]);
    const v = k.volume(k.loft([sq(5, 0), sq(2.5, 10)], { solid: true, ruled: true }));
    const a1 = 100, a2 = 25;
    close(v, (10 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), 1e-6);
  });

  test("loft to a point makes a cone; a solid loft refuses an open section", () => {
    const circle = k.wire([k.circleEdge([0, 0, 0], [0, 0, 1], 5)]);
    close(k.volume(k.loft([circle], { end: [0, 0, 30] })), (Math.PI * 25 * 30) / 3, 1e-9);
    close(k.volume(k.loft([circle], { start: [0, 0, -30], end: [0, 0, 30], ruled: true })), (2 * Math.PI * 25 * 30) / 3, 1e-9);
    assert.throws(() => k.loft([circle]), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && /a wire and a start or end point/.test(e.message));
    const open = k.wire([k.lineEdge([0, 0, 10], [9, 0, 10])]);
    assert.throws(() => k.loft([circle, open]), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && /section 2 is not closed/.test(e.message));
  });
});

describe("curves", () => {
  type V = [number, number, number];
  const unit = (a: V): V => {
    const n = Math.hypot(...a);
    return [a[0] / n, a[1] / n, a[2] / n];
  };
  // The angle between two directions, accurate for tiny angles (atan2 of |a x b| and a . b).
  const angle = (a: V, b: V): number => {
    const [p, q] = [unit(a), unit(b)];
    const c = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    return Math.atan2(Math.hypot(c[0]!, c[1]!, c[2]!), p[0] * q[0] + p[1] * q[1] + p[2] * q[2]);
  };
  const near = (a: V, b: V, tol: number, msg: string) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol, `${msg}: [${a.join(", ")}] is not within ${tol} of [${b.join(", ")}]`);
  const badArgument = (pattern: RegExp) => (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && pattern.test(e.message);
  const POINTS: V[] = [[0, 0, 0], [10, 5, 0], [20, 0, 3], [30, -5, 0], [40, 0, -2]];

  test("splineEdge passes through every point and starts and ends on the first and last", () => {
    const e = k.splineEdge(POINTS);
    assert.equal(k.edgeInfo(e).curve, "bspline");
    for (const [i, p] of POINTS.entries()) assert.ok(k.distance(k.vertex(p), e) <= 1e-7, `point ${i + 1} is ${k.distance(k.vertex(p), e)} mm from the curve`);
    near(k.curveAt(e, 0).point, POINTS[0]!, 1e-9, "start");
    near(k.curveAt(e, 1).point, POINTS.at(-1)!, 1e-9, "end");
    close(Math.hypot(...k.curveAt(e, 0.5).tangent), 1, 1e-12, "tangents are unit vectors");
  });

  test("splineEdge with end tangents leaves and arrives along them, whatever their length", () => {
    const start: V = [0, 1, 1];
    const end: V = [1, -1, 0];
    const e = k.splineEdge(POINTS, { startTangent: start, endTangent: end });
    assert.ok(angle(k.curveAt(e, 0).tangent, start) <= 1e-6, `start tangent off by ${angle(k.curveAt(e, 0).tangent, start)} rad`);
    assert.ok(angle(k.curveAt(e, 1).tangent, end) <= 1e-6, `end tangent off by ${angle(k.curveAt(e, 1).tangent, end)} rad`);
    for (const p of POINTS) assert.ok(k.distance(k.vertex(p), e) <= 1e-7);
    const longer = k.splineEdge(POINTS, { startTangent: [0, 100, 100], endTangent: end });
    close(k.length(longer), k.length(e), 1e-12, "only the direction of a tangent counts");
  });

  test("a periodic splineEdge is closed and smooth at the join", () => {
    const e = k.splineEdge(POINTS, { periodic: true });
    assert.equal(k.edgeInfo(e).closed, true);
    near(k.curveAt(e, 0).point, k.curveAt(e, 1).point, 1e-9, "the ends meet");
    assert.ok(angle(k.curveAt(e, 0).tangent, k.curveAt(e, 1).tangent) <= 1e-6, "the tangent is continuous at the join");
    for (const p of POINTS) assert.ok(k.distance(k.vertex(p), e) <= 1e-7);
  });

  test("splineEdge refuses input that OCCT would fail on with an empty message", () => {
    assert.throws(() => k.splineEdge([[0, 0, 0]]), badArgument(/at least 2 points/));
    assert.throws(() => k.splineEdge([[0, 0, 0], [1, 0, 0]], { periodic: true }), badArgument(/periodic.*at least 3 points/));
    assert.throws(() => k.splineEdge([[0, 0, 0], [5, 0, 0], [5, 1e-7, 0], [9, 9, 0]]), badArgument(/points 2 and 3 coincide/));
    assert.throws(() => k.splineEdge([...POINTS, POINTS[0]!], { periodic: true }), badArgument(/do not repeat the first point/));
    assert.throws(() => k.splineEdge(POINTS, { startTangent: [0, 0, 0], endTangent: [1, 0, 0] }), badArgument(/startTangent.*not be zero/));
    assert.throws(() => k.splineEdge(POINTS, { startTangent: [1, 0, 0] }), badArgument(/both startTangent and endTangent, or neither/));
    assert.throws(() => k.splineEdge(POINTS, { periodic: true, startTangent: [1, 0, 0], endTangent: [1, 0, 0] }), badArgument(/periodic spline has no ends/));
    assert.throws(() => k.splineEdge([[0, 0, 0], [Number.NaN, 1, 0]]), badArgument(/finite/));
  });

  test("approximateEdge stays within its tolerance of every point, with fewer poles than points", () => {
    const wave: V[] = Array.from({ length: 50 }, (_, i) => [i * 2, 10 * Math.sin(i / 5), 0]);
    const e = k.approximateEdge(wave, 0.01);
    let worst = 0;
    for (const p of wave) worst = Math.max(worst, k.distance(k.vertex(p), e));
    assert.ok(worst <= 0.01, `the farthest point is ${worst} mm away, over the 0.01 mm tolerance`);
    assert.ok(k.nurbs(e).poles.length < wave.length, `${k.nurbs(e).poles.length} poles for ${wave.length} points`);
    assert.throws(() => k.approximateEdge(wave, 0), badArgument(/tolerance/));
  });

  test("bezierEdge and nurbsEdge: a rational quadratic is an exact quarter circle", () => {
    const b = k.bezierEdge([[0, 0, 0], [5, 10, 0], [10, 0, 0]]);
    near(k.curveAt(b, 0.5).point, [5, 5, 0], 1e-12, "a quadratic Bezier's midpoint is P0/4 + P1/2 + P2/4");
    const many: V[] = Array.from({ length: 27 }, (_, i) => [i, Math.sin(i), 0]);
    assert.throws(() => k.bezierEdge(many), badArgument(/at most 26 poles/));
    const quarter = k.nurbsEdge({ degree: 2, poles: [[10, 0, 0], [10, 10, 0], [0, 10, 0]], weights: [1, Math.SQRT1_2, 1], knots: [0, 1], multiplicities: [3, 3] });
    for (let i = 0; i <= 8; i++) close(Math.hypot(...k.curveAt(quarter, i / 8).point), 10, 1e-12, `sample ${i} lies on the circle`);
    close(k.length(quarter), 5 * Math.PI, 1e-6);
    assert.equal(k.nurbs(quarter).weights?.length, 3);
    assert.throws(() => k.nurbsEdge({ degree: 3, poles: [[0, 0, 0], [1, 0, 0]], knots: [0, 1], multiplicities: [1, 1] }), badArgument(/poles \+ degree \+ 1/));
    assert.throws(() => k.nurbsEdge({ degree: 1, poles: [[0, 0, 0], [1, 0, 0]], weights: [1, 0], knots: [0, 1], multiplicities: [2, 2] }), badArgument(/weights/));
  });

  test("nurbs() gives a definition that nurbsEdge rebuilds into the same curve", () => {
    const e = k.splineEdge(POINTS);
    const def = k.nurbs(e);
    assert.equal(def.degree, 3);
    assert.equal(def.weights, undefined, "a non-rational curve has no weights");
    const again = k.nurbsEdge(def);
    for (const t of [0, 0.2, 0.5, 0.9, 1]) near(k.curveAt(again, t).point, k.curveAt(e, t).point, 1e-9, `t = ${t}`);
    assert.throws(() => k.nurbs(k.lineEdge([0, 0, 0], [1, 0, 0])), badArgument(/line.*bspline or bezier/));
  });

  test("tangentArc leaves along its tangent and ends on its end point", () => {
    const a = k.tangentArc([0, 0, 0], [1, 0, 0], [10, 10, 0]);
    assert.equal(k.edgeInfo(a).curve, "circle");
    close(k.length(a), 5 * Math.PI, 1e-12);
    assert.ok(angle(k.curveAt(a, 0).tangent, [1, 0, 0]) <= 1e-9);
    near(k.curveAt(a, 1).point, [10, 10, 0], 1e-9, "end");
    assert.throws(() => k.tangentArc([0, 0, 0], [1, 0, 0], [5, 0, 0]), badArgument(/on the tangent line/));
  });

  test("helix length is turns x sqrt((2 pi r)^2 + pitch^2), and the hand sets the winding", () => {
    const axis = { origin: [0, 0, 0] as V, dir: [0, 0, 1] as V };
    const h = k.helix(axis, 10, 5, 20);
    assert.equal(k.shapeType(h), "wire");
    close(k.length(h), 4 * Math.hypot(2 * Math.PI * 10, 5), 1e-6);
    const [edge] = k.subShapes(h, "edge");
    near(k.curveAt(edge!, 1).point, [10, 0, 20], 1e-6, "four whole turns end above the start");
    assert.ok(k.curveAt(edge!, 0.01).point[1] > 0, "right-handed winds counter-clockwise about the axis");
    const [left] = k.subShapes(k.helix(axis, 10, 5, 20, { leftHanded: true }), "edge");
    assert.ok(k.curveAt(left!, 0.01).point[1] < 0, "left-handed winds clockwise");
    assert.throws(() => k.helix(axis, 10, 0, 20), badArgument(/greater than 0/));
  });

  test("a wire of 3D edges is valid and as long as its edges together", () => {
    const s = k.splineEdge([[0, 0, 0], [10, 0, 5], [20, 0, 0]]);
    const w = k.wire([s, k.lineEdge([20, 0, 0], [20, 10, 0])]);
    assert.equal(k.isValid(w), true);
    close(k.length(w), k.length(s) + 10, 1e-12);
  });

  test("sweep gives the analytic volume in every orientation: line, Pappus arc, Weyl tube on a helix", () => {
    const circle = (c: V, n: V, r: number) => k.wire([k.circleEdge(c, n, r)]);
    const line = k.wire([k.lineEdge([0, 0, 0], [0, 0, 50])]);
    const arc = k.wire([k.arcEdge([20, 0, 0], [20 * Math.SQRT1_2, 20 * Math.SQRT1_2, 0], [0, 20, 0])]);
    const h = k.helix({ origin: [0, 0, 0], dir: [0, 0, 1] }, 10, 5, 10);
    const [he] = k.subShapes(h, "edge");
    const start = k.curveAt(he!, 0);
    for (const orient of ["fixed", "frenet", "up"] as const) {
      const solid = k.sweep(circle([0, 0, 0], [0, 0, 1], 2), line, { orient });
      assert.equal(k.shapeType(solid), "solid");
      close(k.volume(solid), Math.PI * 4 * 50, 1e-12, `${orient} along a line`);
      // Pappus: a disc of radius 2 swept a quarter turn round a circle of radius 20.
      close(k.volume(k.sweep(circle([20, 0, 0], [0, 1, 0], 2), arc, { orient })), Math.PI * 4 * 10 * Math.PI, 1e-9, `${orient} along an arc`);
      // A tube whose section stays normal to its centreline holds pi r^2 L (Weyl's tube formula).
      close(k.volume(k.sweep(circle(start.point, start.tangent, 1), h, { orient })), Math.PI * k.length(h), 1e-6, `${orient} along a helix`);
    }
  });

  test("a guide sweep turns the profile with the guide and keeps the exact volume", () => {
    // A 4 x 4 square twisted a quarter turn over 20 by a helical guide: the area stays 16.
    const square = k.polygon([[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]]);
    const spine = k.wire([k.lineEdge([0, 0, 0], [0, 0, 20])]);
    const guide = k.helix({ origin: [0, 0, 0], dir: [0, 0, 1] }, 5, 80, 20);
    const twisted = k.sweep(square, spine, { orient: "guide", guide });
    close(k.volume(twisted), 320, 1e-6);
    const top = k.faces(twisted).find((f) => Math.abs(f.center[2] - 20) < 1e-6 && f.surface === "plane");
    assert.ok(top, "the end cap is a plane at z = 20");
    // The cap's corners turned 90 degrees: the corner at (2, 2) is now at (-2, 2).
    assert.ok(k.distance(k.vertex([-2, 2, 20]), twisted) < 1e-6 && k.distance(k.vertex([2, 2, 20]), twisted) < 1e-6);
  });

  // OCCT #1681: GeomFill_GuideTrihedronAC has a wrong second derivative in OCCT 8.0.1, and
  // occt-wasm uses it for guide sweeps with curvilinearEquivalence. sweep() never takes that
  // path. This pins the defect on the raw kernel: when an occt-wasm upgrade fixes it, this test
  // fails, and the curvilinear guide law can then be offered (and this test turned around).
  test("OCCT #1681 is still present: the curvilinear guide law misses the exact volume", () => {
    const square = k.polygon([[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]]);
    const spine = k.wire([k.lineEdge([0, 0, 0], [0, 0, 20])]);
    const guide = k.helix({ origin: [0, 0, 0], dir: [0, 0, 1] }, 5, 80, 20);
    const raw = k.raw.sweepAdvanced(square, spine, { mode: 3, auxSpine: guide, curvilinearEquivalence: true }) as ShapeHandle;
    const error = Math.abs(k.volume(raw) - 320) / 320;
    assert.ok(error > 1e-4, `the curvilinear guide law is now within ${error} of the exact volume: OCCT #1681 looks fixed`);
  });

  test("sweep turns a sharp corner with a mitre or a round, each with its exact volume", () => {
    const square = k.polygon([[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]]);
    const ell = k.wire([k.lineEdge([0, 0, 0], [0, 0, 30]), k.lineEdge([0, 0, 30], [40, 0, 30])]);
    // A mitre adds and removes the same wedge on each side of a symmetric profile: A x L.
    close(k.volume(k.sweep(square, ell)), 16 * 70, 1e-9, "right corners are the default");
    // A round corner turns the profile about the corner: the outer 2 x 2 corner of the mitre
    // becomes a quarter disc of radius 2, through the 4 mm depth.
    close(k.volume(k.sweep(square, ell, { corners: "round" })), 16 * 70 - 4 * (4 - Math.PI), 1e-9);
    assert.throws(() => k.sweep(square, ell, { corners: "transformed" as never }), badArgument(/corners must be right or round/));
  });

  // OCCT's validity check passes a sweep that overlaps itself, and its volume then counts the
  // overlap twice: a coil whose wire is thicker than its pitch reported pi r^2 L as if the turns
  // were apart. sweep() measures the profile's reach against the path's bends and returns.
  test("sweep refuses a profile that would make the solid overlap itself", () => {
    const helix = k.helix({ origin: [0, 0, 0], dir: [0, 0, 1] }, 10, 5, 20);
    const [edge] = k.subShapes(helix, "edge");
    const start = k.curveAt(edge!, 0);
    const coil = (r: number) => k.sweep(k.wire([k.circleEdge(start.point, start.tangent, r)]), helix);
    const overlaps = (pattern: RegExp) => (e: unknown) => e instanceof KernelError && e.code === "INVALID_RESULT" && pattern.test(e.message);
    // Wire 6 mm thick on a 5 mm pitch: the turns overlap. Adjacent turns come closest (4.98 mm)
    // a little before a full turn, where the coil descends towards the turn below.
    assert.throws(() => coil(3), overlaps(/comes back within 4\.9\d mm of itself.*reaches 3\.00 mm/));
    // Wider than the helix's bend radius (10.06 mm): the inside of the tube folds over.
    assert.throws(() => coil(10.5), overlaps(/bends to a radius of 10\.06 mm.*reaches 10\.5/));
    // 4.8 mm wire on a 5 mm pitch clears, as it should.
    close(k.volume(coil(2.4)), Math.PI * 2.4 * 2.4 * k.length(helix), 1e-6);
  });

  test("sweep refuses what it cannot make, before OCCT does", () => {
    const circle = k.wire([k.circleEdge([0, 0, 0], [0, 0, 1], 2)]);
    const line = k.wire([k.lineEdge([0, 0, 0], [0, 0, 50])]);
    assert.throws(() => k.sweep(circle, line, { orient: "guide" }), badArgument(/needs a guide/));
    assert.throws(() => k.sweep(circle, line, { orient: "sideways" as never }), badArgument(/orient must be/));
    assert.throws(() => k.sweep(circle, line, { orient: "up", up: [0, 0, 0] }), badArgument(/up must not be zero/));
    assert.throws(() => k.sweep(k.box(1, 1, 1), line), badArgument(/profile.*wire/));
    assert.throws(() => k.sweep(k.wire([k.lineEdge([0, 0, 0], [5, 0, 0])]), line), (e: unknown) => e instanceof KernelError && e.code === "NOT_A_SOLID" && /closed/.test(e.message));
  });

  test("curveAt refuses a t outside 0 to 1 and a shape that is not an edge", () => {
    const e = k.splineEdge(POINTS);
    assert.throws(() => k.curveAt(e, 1.5), badArgument(/between 0 and 1/));
    assert.throws(() => k.curveAt(k.box(1, 1, 1), 0.5), badArgument(/needs an edge, got a solid/));
    assert.throws(() => k.length(k.box(1, 1, 1)), badArgument(/needs an edge or a wire, got a solid/));
  });
});

describe("surfaces", () => {
  type V = [number, number, number];
  const badArgument = (pattern: RegExp) => (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && pattern.test(e.message);
  /** A 3 x 3 grid over 100 x 100 with the centre point at height h. */
  const raised = (h: number): V[][] => [0, 1, 2].map((i) => [0, 1, 2].map((j): V => [i * 50, j * 50, i === 1 && j === 1 ? h : 0]));

  test("surfaceGrid passes through its points: a raised 3 x 3 grid is the biquadratic graph", () => {
    const top = k.surfaceGrid(raised(20));
    assert.equal(k.shapeType(top), "face");
    assert.ok(k.distance(k.vertex([50, 50, 20]), top) < 1e-9, "through the raised centre");
    close(k.area(k.surfaceGrid(raised(0))), 10000, 1e-12);
    // With 3 points a side the interpolant is z = 20 x 4u(1-u) x 4v(1-v): its volume over the square is 20 x 10000 x 4/9.
    close(k.volume(k.sew([top, k.surfaceGrid(raised(0))])), 20 * 10000 * (4 / 9), 1e-9);
  });

  test("sew closes faces into a solid the right way out, and refuses faces that leave a gap", () => {
    const square = (pts: V[]) => k.fill(k.polygon(pts));
    const cube = [
      square([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]), square([[0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]]),
      square([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]]), square([[0, 10, 0], [10, 10, 0], [10, 10, 10], [0, 10, 10]]),
      square([[0, 0, 0], [0, 10, 0], [0, 10, 10], [0, 0, 10]]), square([[10, 0, 0], [10, 10, 0], [10, 10, 10], [10, 0, 10]]),
    ];
    // OCCT made this cube inside out (volume -1000) and called it valid.
    const solid = k.sew(cube);
    assert.equal(k.shapeType(solid), "solid");
    close(k.volume(solid), 1000, 1e-12);
    // Five faces leave the top open; OCCT made a "solid" of -800 from them.
    assert.throws(() => k.sew(cube.slice(0, 5)), badArgument(/4 open edges.*do not close a volume/));
    // A cylinder's side face has a seam edge that it uses twice: that edge is not open.
    close(k.volume(k.sew(k.subShapes(k.cylinder(5, 10), "face"))), Math.PI * 25 * 10, 1e-9);
  });

  test("fill spans a closed wire; thicken grows a face along its normal (or against it)", () => {
    // A flat boundary gets an exact planar face; a saddle gets the plate fill.
    const disc = k.fill(k.wire([k.circleEdge([0, 0, 0], [0, 0, 1], 10)]));
    assert.equal(k.faceInfo(disc).surface, "plane");
    close(k.area(disc), Math.PI * 100, 1e-12);
    close(k.volume(k.thicken(disc, 3)), Math.PI * 300, 1e-12);
    const saddle = k.fill(k.polygon([[0, 0, 0], [100, 0, 20], [100, 100, 0], [0, 100, 20]]));
    assert.equal(k.faceInfo(saddle).surface, "bspline");
    assert.ok(k.isValid(saddle) && k.area(saddle) > 10000, "the saddle spans more than its flat projection");
    for (const corner of [[0, 0, 0], [100, 0, 20], [100, 100, 0], [0, 100, 20]] as V[]) assert.ok(k.distance(k.vertex(corner), saddle) < 1e-6, `the fill meets its boundary at ${corner}`);
    const flat = k.surfaceGrid(raised(0));
    const up = k.thicken(flat, 2);
    close(k.volume(up), 20000, 1e-12);
    assert.ok(Math.abs(k.bbox(up).max[2] - 2) < 1e-6);
    assert.ok(Math.abs(k.bbox(k.thicken(flat, -2)).min[2] + 2) < 1e-6);
    assert.throws(() => k.thicken(flat, 0), badArgument(/must not be 0/));
    assert.throws(() => k.fill(k.wire([k.lineEdge([0, 0, 0], [5, 0, 0])])), badArgument(/not closed/));
    assert.throws(() => k.surfaceGrid([[[0, 0, 0], [1, 0, 0]], [[0, 1, 0]]]), badArgument(/every row the same length/));
  });
});

describe("continuity", () => {
  type V = [number, number, number];
  const byClass = (t: ReturnType<typeof k.continuity>, c: string) => t.edges.filter((e) => e.class === c);
  /** A large planar face through a point, for splitting a solid into faces. */
  const plane = (o: V, n: V) => {
    const d = 1000;
    const u: V = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [1, 0, 0];
    const w: V = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const c = (a: number, b: number): V => [o[0] + a * u[0] + b * w[0], o[1] + a * u[1] + b * w[1], o[2] + a * u[2] + b * w[2]];
    return k.face(k.polygon([c(-d, -d), c(d, -d), c(d, d), c(-d, d)]));
  };

  test("a box: twelve G0 edges at 90 degrees, no curvature compared", () => {
    const t = k.continuity(k.box(10, 20, 30));
    assert.equal(t.edges.length, 12);
    for (const e of t.edges) {
      assert.equal(e.class, "G0");
      close(e.angle, 90, 1e-9);
      assert.ok(e.gap < 1e-6, `edge:${e.edge} gap ${e.gap}`);
      assert.equal(e.curvatureJump, null);
    }
    assert.deepEqual(t.tolerances, { gap: 1e-3, angle: 0.1, curvature: 1e-5, relative: 0.01 });
  });

  test("a filleted edge is G1, not G2: plane to cylinder jumps by 1/r", () => {
    const box = k.box(10, 10, 10);
    const edge = k.edges(box).find((e) => e.start[2] === 10 && e.end[2] === 10 && e.start[1] === e.end[1] && e.start[1] === 0)!;
    const t = k.continuity(k.fillet(box, [k.subShapes(box, "edge")[edge.index - 1]!], 2));
    const g1 = byClass(t, "G1");
    assert.equal(g1.length, 2, JSON.stringify(t.edges.map((e) => [e.edge, e.class, e.angle])));
    for (const e of g1) {
      assert.ok(e.angle < 1e-6, `fillet edge:${e.edge} angle ${e.angle}`);
      close(e.curvatureJump!, 0.5, 1e-6);
      close(e.relativeJump!, 1, 1e-6);
    }
    assert.equal(byClass(t, "G2").length, 0, "no false G2");
  });

  test("a face split in two is G2 across the split: cylinder, sphere and coplanar caps", () => {
    // Split the shell, not the solid: splitting a solid cuts it into two solids with new faces.
    const shellOf = (s: ShapeHandle) => k.subShapes(s, "shell")[0]!;
    const cyl = k.continuity(k.raw.split(shellOf(k.cylinder(5, 10)), [plane([0, 0, 0], [0, 1, 0])]) as ShapeHandle);
    // The side splits into two half cylinders (2 G2 edges), each cap into two half discs (2 G2 edges).
    const g2 = byClass(cyl, "G2");
    assert.equal(g2.length, 4, JSON.stringify(cyl.edges.map((e) => [e.edge, e.class, e.angle, e.curvatureJump])));
    for (const e of g2) assert.ok(e.angle < 1e-6 && e.curvatureJump! < 1e-6, JSON.stringify(e));
    const sphere = k.continuity(k.raw.split(shellOf(k.sphere(5)), [plane([0, 0, 0], [0, 0, 1])]) as ShapeHandle);
    const equator = byClass(sphere, "G2");
    assert.ok(equator.length >= 1 && sphere.edges.every((e) => e.class === "G2"), JSON.stringify(sphere.edges));
    for (const e of equator) assert.ok(e.curvatureJump! < 1e-6, JSON.stringify(e));
  });

  test("a stadium slot is G1 where its flat sides meet its round ends; a 1 degree crease is G0", () => {
    const slot = k.continuity(k.extrude(k.face(k.wire([
      k.lineEdge([-10, -3, 0], [10, -3, 0]), k.arcEdge([10, -3, 0], [13, 0, 0], [10, 3, 0]),
      k.lineEdge([10, 3, 0], [-10, 3, 0]), k.arcEdge([-10, 3, 0], [-13, 0, 0], [-10, -3, 0]),
    ])), [0, 0, 5]));
    const g1 = byClass(slot, "G1");
    assert.equal(g1.length, 4);
    for (const e of g1) close(e.curvatureJump!, 1 / 3, 1e-6);
    // A plate whose top bends by 1 degree along a line.
    const a = Math.tan(Math.PI / 180) * 10;
    const crease = k.continuity(k.extrude(k.face(k.polygon([[0, 0, 0], [20, 0, 0], [20, 0, 2 + a], [10, 0, 2], [0, 0, 2]])), [0, 10, 0]));
    const bend = crease.edges.filter((e) => Math.abs(e.angle - 1) < 1e-6);
    assert.equal(bend.length, 1, JSON.stringify(crease.edges.map((e) => [e.edge, e.class, e.angle])));
    assert.equal(bend[0]!.class, "G0");
  });
});

describe("transform math", () => {
  test("quaternion to matrix and point transforms", () => {
    const q = quaternionFromAxisAngle([0, 0, 1], 90);
    assert.ok(isUnitQuaternion(q));
    const p = applyTransform({ t: [1, 2, 3], q }, [1, 0, 0]);
    [1, 3, 3].forEach((x, i) => close(p[i]!, x, 1e-12));
    assert.deepEqual(matrixFromTransform({ t: [4, 5, 6], q: [0, 0, 0, 1] }), [1, 0, 0, 4, 0, 1, 0, 5, 0, 0, 1, 6]);
    const qx = quaternionFromAxisAngle([1, 0, 0], 90);
    const py = applyTransform({ t: [0, 0, 0], q: qx }, [0, 1, 0]);
    [0, 0, 1].forEach((x, i) => close(py[i]!, x, 1e-12));
    assert.equal(isUnitQuaternion([0, 0, 0, 1.01]), false);
  });
});

describe("exchange, documents and renders", () => {
  test("STEP and STL export; STEP import round trip keeps the volume", () => {
    const b = k.box(10, 20, 30);
    const step = k.exportStep(b);
    assert.match(step, /^ISO-10303-21;/);
    close(k.volume(k.importStep(step)), 6000, 1e-6);
    const stl = k.exportStl(b);
    const tris = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
    assert.equal(stl.byteLength, 84 + 50 * tris);
    assert.ok(tris >= 12);
  });

  test("BREP round trip", () => {
    const c = k.cylinder(2, 5);
    close(k.volume(k.fromBrep(k.toBrep(c))), Math.PI * 4 * 5, 1e-6);
  });

  test("XCAF document keeps shared definitions and names at both levels", () => {
    const doc = k.createDocument();
    try {
      const root = doc.addShape(k.compound([]), { name: "root", assembly: true });
      const screw = k.cylinder(1, 5);
      const a = doc.addChild(root, screw, { name: "screw#1", location: { tx: 0 } });
      const b = doc.addChild(root, screw, { name: "screw#2", location: { tx: 10 } });
      const refA = doc.getReferredLabel(a);
      assert.ok(refA !== null);
      assert.equal(refA, doc.getReferredLabel(b), "two instances of one shape share a definition label");
      doc.setName(refA!, "screw");
      assert.equal(doc.getLabelInfo(a).name, "screw#1");
      assert.equal(doc.getLabelInfo(refA!).name, "screw");
      const step = doc.exportStep();
      assert.match(step, /screw#1/);
      assert.match(step, /screw#2/);
      const glb = doc.exportGlb();
      assert.equal(new TextDecoder().decode(glb.subarray(0, 4)), "glTF");
    } finally {
      doc.close();
    }
  });

  test("multiview SVG and PNG renders", async () => {
    const b = k.box(10, 20, 30);
    assert.match(k.multiviewSvg(b), /<svg[\s>]/);
    const png = await k.multiviewPng(b, { width: 400, height: 300 });
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("memory and output hygiene", () => {
  test("checkpoint and releaseSince keep the live handle count flat", () => {
    const base = k.stats().liveShapes;
    for (let i = 0; i < 30; i++) {
      const mark = k.checkpoint();
      const b = k.box(10 + i, 10, 10);
      k.fillet(b, k.subShapes(b, "edge"), 1);
      k.releaseSince(mark);
    }
    assert.equal(k.stats().liveShapes, base);
    assert.ok(k.stats().wasmHeapBytes > 0);
  });

  test("the print hook captures what OCCT prints during STEP export", () => {
    const before = k.stats().printedLines;
    k.exportStep(k.box(1, 2, 3));
    assert.ok(k.stats().printedLines > before, "OCCT prints transfer statistics; the hook must capture them");
    assert.ok(k.printed().some((l) => l.length > 0));
  });

  test("fresh() gives an empty instance whose output goes to the same sink; dispose() ends it", async () => {
    const lines: string[] = [];
    const parent = await initKernel({ sink: (stream, line) => lines.push(`${stream}:${line}`) });
    const kept = parent.box(1, 1, 1);
    const fresh = await parent.fresh();
    assert.notEqual(fresh.raw, parent.raw);
    assert.equal(fresh.stats().liveShapes, 0);
    const before = lines.length;
    fresh.exportStep(fresh.box(1, 2, 3));
    assert.ok(lines.length > before, "the fresh instance prints through the parent's sink");
    assert.equal(fresh.printed().length > 0, true);
    fresh.dispose();
    assert.throws(() => fresh.box(1, 1, 1));
    // The parent is untouched.
    close(parent.volume(kept), 1);
    parent.dispose();
  });

  test("a STEP export in a fresh process writes zero bytes to stdout", () => {
    const probe = fileURLToPath(new URL("./fixtures/print-probe.ts", import.meta.url));
    const r = spawnSync(process.execPath, [probe], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "kernel output leaked to stdout");
    const report = JSON.parse(r.stderr.trim().split("\n").at(-1)!) as { stepBytes: number; step2Bytes: number; captured: number };
    assert.ok(report.stepBytes > 0 && report.step2Bytes > 0);
    assert.ok(report.captured > 0, "the sink received the kernel's printed lines");
  });
});

function topFace(shape: ShapeHandle, z: number): ShapeHandle {
  const faces = k.subShapes(shape, "face");
  const info = k.faces(shape);
  const i = info.findIndex((f) => Math.abs(f.bbox.min[2] - z) < 1e-6 && Math.abs(f.bbox.max[2] - z) < 1e-6);
  assert.ok(i >= 0, "top face not found");
  return faces[i]!;
}
