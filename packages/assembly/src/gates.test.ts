// fdm.v1 print checks (PLAN.md S3): watertight, 0.8 mm wall, 45 degree overhang and bed size,
// on small parts built here. Each check has a part that must pass and one that must fail.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { initKernel } from "@open3dj/kernel";
import type { Kernel, ShapeHandle } from "@open3dj/kernel";
import { validate } from "@open3dj/schemas";
import type { GateFailure, Vec3 } from "@open3dj/schemas";
import { FDM_V1, MAX_RAYS, WALL_BAND_MM, WALL_SPACING_MM, buildAssembly, partGates, printGates, wallSampling } from "./index.ts";

let k: Kernel;
before(async () => {
  k = await initKernel();
});

/** An open-top box (a tray) with walls and floor `wall` thick. */
const tray = (wall: number) => k.cut(k.box(30, 20, 15), k.translate(k.box(30 - 2 * wall, 20 - 2 * wall, 15), [wall, wall, wall]));
const check = (shape: ShapeHandle, options: { build?: Vec3; bed?: Vec3 } = {}) => partGates(k, shape, { ...FDM_V1, ...options });
const failed = (r: { fail: GateFailure[] }, gate: string) => r.fail.find((f) => f.gate === gate);
const unit3 = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
/** A prism: the polygon (in the XZ plane unless given in 3D) extruded by v. */
const prism = (points: Vec3[], v: Vec3) => k.extrude(k.face(k.polygon(points)), v);
/** A thin part must fail min_wall outright: below the limit minus the guard band. */
const thinFail = (r: ReturnType<typeof check>, label: string) => {
  const f = failed(r, "min_wall");
  assert.ok(f && f.value! < FDM_V1.minWallMm - WALL_BAND_MM, `${label}: ${JSON.stringify(r)}`);
  return f.value!;
};
const near = (x: number, want: number, tol: number, label: string) => assert.ok(Math.abs(x - want) <= tol, `${label}: ${x}, expected ${want}`);
/** The solid inside the planes through each base edge and the apex: a pyramid from three half-space cuts. */
const pyramid = (base: Vec3[], apex: Vec3) => {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let s = prism(base, [0, 0, apex[2]]);
  const mid: Vec3 = [0, 1, 2].map((x) => base.reduce((sum, p) => sum + p[x]!, 0) / base.length) as Vec3;
  for (let i = 0; i < base.length; i++) {
    const a = base[i]!;
    let n = unit3(cross(sub(base[(i + 1) % base.length]!, a), sub(apex, a)));
    if (n[0] * (mid[0] - a[0]) + n[1] * (mid[1] - a[1]) + n[2] * (mid[2] - a[2]) > 0) n = [-n[0], -n[1], -n[2]];
    // A large box above z = 0, turned so its bottom is the plane through a with outward normal n.
    const axis = cross([0, 0, 1], n);
    const half = k.rotate(k.translate(k.box(1000, 1000, 1000), [-500, -500, 0]), (Math.acos(n[2]) * 180) / Math.PI, { origin: [0, 0, 0], dir: axis });
    s = k.cut(s, k.translate(half, a));
  }
  return s;
};

test("a solid block passes every fdm.v1 check", () => {
  const r = check(k.box(20, 20, 10));
  assert.deepEqual(r.fail, []);
  assert.deepEqual(r.pass, ["watertight", "min_wall", "overhang", "bed"]);
  assert.ok(Math.abs(r.wall.min_mm! - 10) < 1e-3, `thinnest wall ${r.wall.min_mm}`);
  assert.ok(r.wall.rays > 100, `${r.wall.rays} rays`);
});

test("min_wall: a 0.6 mm tray fails, a 2 mm tray passes, a 0.8 mm tray is marginal", () => {
  const thin = check(tray(0.6));
  const f = failed(thin, "min_wall");
  assert.ok(f, JSON.stringify(thin));
  assert.ok(Math.abs(f.value! - 0.6) < 1e-3, `value ${f.value}`);
  assert.equal(f.limit, 0.8);
  assert.equal(f.waivable, "agent");
  assert.equal(f.confidence, "measured");
  assert.match(f.at ?? "", /^face:\d+$/);
  assert.equal(f.marginal, undefined);
  assert.ok(thin.pass.includes("watertight") && thin.pass.includes("overhang"), "the tray stands on its floor");

  const thick = check(tray(2));
  assert.ok(thick.pass.includes("min_wall"), JSON.stringify(thick));
  assert.ok(Math.abs(thick.wall.min_mm! - 2) < 1e-3);

  // Inside the guard band the value cannot decide either way: marginal, and it fails until waived.
  const edge = failed(check(tray(0.8)), "min_wall");
  assert.equal(edge?.marginal, true, JSON.stringify(edge));
});

// Regression (review, findings 1, 4, 10, 16): a cap of 16 x 16 samples per triangle left large
// faces sampled millimetres apart while wall.spacing_mm said 0.5, so these parts passed.
test("min_wall: thin regions next to large faces fail, and spacing_mm is the spacing achieved", () => {
  // A 120 x 40 mm doorstop lying flat, 25 mm tall at the back and 0.5 mm at the tip.
  const door = check(prism([[0, 0, 0], [120, 0, 0], [120, 0, 25], [0, 0, 0.5]], [0, 40, 0]));
  thinFail(door, "doorstop");
  assert.ok(door.wall.spacing_mm <= WALL_SPACING_MM, `spacing ${door.wall.spacing_mm}`);
  // A 100 mm knife edge (22.6 degrees), standing on its back along -x.
  thinFail(check(prism([[0, 0, 0], [100, 0, -20], [100, 0, 20]], [0, 100, 0]), { build: [-1, 0, 0] }), "knife edge");
  // Two blocks joined only by a bridge 0.5 mm thick, 1 mm long and 10 mm wide.
  const bridge = k.cut(k.cut(k.box(200, 10, 20), k.translate(k.box(100, 12, 11), [-0.5, -1, 10.5])), k.translate(k.box(101.5, 12, 11), [98.5, -1, -1]));
  assert.ok(Math.abs(thinFail(check(bridge), "bridge") - 0.5) < 0.01);
  // A 100 x 30 mm shim tapering from 12 mm to 0.65 mm.
  thinFail(check(prism([[0, 0, 0], [100, 0, 0], [100, 0.65, 0], [0, 12, 0]], [0, 0, 30])), "shim");
});

// Regression (second review, finding 2): the n x n grid made cells as long as a sliver triangle,
// so the 60 x 3 mm back face was sampled 1 to 2 mm apart along the arrow's tip.
test("min_wall: a thin spot beside a long, narrow face is sampled at the stated spacing", () => {
  const arrow = k.cut(k.box(60, 60, 3), prism([[30, 59.6, -1], [45, 44.6, -1], [15, 44.6, -1]], [0, 0, 5]));
  const r = check(arrow);
  near(thinFail(r, "90 degree arrow 0.4 mm from the back"), 0.4, 0.05, "arrow");
  assert.ok(r.wall.spacing_mm <= WALL_SPACING_MM, `spacing ${r.wall.spacing_mm}`);
});

// Regression (second review, findings 1 and 3): rays leave along the surface normals, so no ray
// crossed the web under a groove narrower than 60 degrees or a neck between two inside edges.
test("min_wall: webs under sharp grooves and necks between inside edges are measured by rays from those edges", () => {
  const groove = (half: number, web: number) => k.cut(k.box(40, 20, 2), prism([[20 - half, -1, -1], [20 + half, -1, -1], [20, -1, 2 - web]], [0, 22, 0]));
  const deg = (d: number, depth: number) => depth * Math.tan((d * Math.PI) / 360);
  near(thinFail(check(groove(deg(50, 2.7), 0.3)), "50 degree groove"), 0.3, 0.01, "50 degree groove");
  near(thinFail(check(groove(deg(25, 2.7), 0.3)), "25 degree scoring line"), 0.3, 0.01, "25 degree scoring line");
  assert.ok(check(groove(deg(50, 2), 1)).pass.includes("min_wall"), "the same groove over a 1 mm web");
  const notches = k.cut(k.cut(k.box(20, 10, 10), prism([[4.25, -1, 11], [15.75, -1, 11], [10, -1, 5.25]], [0, 12, 0])), prism([[4.25, -1, -1], [15.75, -1, -1], [10, -1, 4.75]], [0, 12, 0]));
  near(thinFail(check(notches), "double V-notch"), 0.5, 0.01, "double V-notch");
  const rods = k.fuse(k.cylinder(5, 20), k.translate(k.cylinder(5, 20), [9.98, 0, 0]));
  near(thinFail(check(rods), "R5 rods 9.98 apart"), 2 * Math.sqrt(25 - 4.99 ** 2), 0.02, "rods");
  // The rays from inside edges must not read a filleted drafted rim as thin.
  const cone = k.cone(2, 0.5, 4);
  const rims = k.subShapes(cone, "edge").filter((_, i) => k.edges(cone)[i]!.curve === "circle");
  assert.ok(check(k.fillet(cone, rims, 0.1)).pass.includes("min_wall"), "a filleted frustum");
});

test("min_wall: the tip of a narrow pointed pocket close to the opposite face is still missed (a known limit)", () => {
  // A cone 10 degrees from its axis, its tip 0.5 mm above the bottom. The web is a single point
  // under the tip, and no face ray reaches it at 60 degrees or less. Sharper pockets (29 degrees
  // and more) are caught at about 0.62 mm.
  const pocket = k.cut(k.box(20, 20, 5), k.translate(k.cone(0, 5 * Math.tan((10 * Math.PI) / 180), 5), [10, 10, 0.5]));
  const r = check(pocket);
  assert.ok(r.pass.includes("min_wall") && r.wall.min_mm! > 0.84, `if this now fails min_wall, the limit is fixed: update the notes and docs. ${JSON.stringify(r)}`);
});

// Regression (second review, finding 4): with no two faces close to facing each other, every exit
// is more than 60 degrees from its ray. The part is not passed unmeasured; the note says why.
test("min_wall: a regular tetrahedron fails unmeasured, without a value; with its apex cut off it passes", () => {
  const a = 30;
  const tetra = () => pyramid([[0, 0, 0], [a, 0, 0], [a / 2, (a * Math.sqrt(3)) / 2, 0]], [a / 2, (a * Math.sqrt(3)) / 6, a * Math.sqrt(2 / 3)]);
  const f = failed(check(tetra()), "min_wall");
  assert.ok(f, "a tetrahedron has no measured wall");
  assert.equal(f.value, undefined);
  assert.match(f.note ?? "", /no wall was measured \(no two faces come close to facing each other/);
  const flat = check(k.cut(tetra(), k.translate(k.box(100, 100, 10), [-30, -30, a * Math.sqrt(2 / 3) - 2])));
  assert.ok(flat.pass.includes("min_wall"), JSON.stringify(flat));
});

// Regression (second review, finding 5): an exit at exactly 60 degrees counted or not by float
// rounding. With a small band it always counts, so an edge of exactly 60 degrees reads as thin.
test("min_wall: an edge of exactly 60 degrees reads as thin, 60.1 degrees does not", () => {
  const trapezoid = (deg: number) => {
    const run = 10 / Math.tan((deg * Math.PI) / 180);
    return prism([[0, 0, 0], [40, 0, 0], [40 - run, 0, 10], [run, 0, 10]], [0, 20, 0]);
  };
  assert.ok(failed(check(trapezoid(60)), "min_wall"), "60.0 degree base edges");
  assert.ok(check(trapezoid(60.1)).pass.includes("min_wall"), "60.1 degree base edges");
});

// Regression (review, finding 17): any exit, however grazing, counted, so a ray from the
// bottom face next to a drafted rim read the distance to the rim as a wall.
test("min_wall: a drafted puck and a frustum are solid: a grazing exit beside an edge of more than 60 to 90 degrees is not a wall", () => {
  assert.ok(check(k.cone(10, 9, 20)).pass.includes("min_wall"), "a 20 mm puck with a 2.9 degree draft");
  assert.ok(check(k.cone(2, 0.5, 4)).pass.includes("min_wall"), "a frustum with a 69 degree base edge");
});

// Regression (review, finding 2): the coarsening loop stopped after 4 rounds whatever the count,
// and kept growing the spacing once every triangle was down to one ray.
test("wallSampling: at most MAX_RAYS, but never fewer than one ray per triangle and per inside edge", () => {
  // Right isosceles triangles: area 1.8 mm2, longest edge 2.683 mm.
  const many = wallSampling(new Float64Array(150_000).fill(1.8), new Float64Array(150_000).fill(Math.sqrt(4 * 1.8)), new Float64Array(1_000).fill(0.1));
  assert.equal(many.rays, 151_000);
  assert.ok(many.spacing <= many.target, `spacing ${many.spacing}, target ${many.target}`);
  const big = wallSampling(new Float64Array(10).fill(50_000), new Float64Array(10).fill(Math.sqrt(4 * 50_000)), new Float64Array([300]));
  assert.ok(big.rays <= MAX_RAYS && big.rays > MAX_RAYS / 2, `${big.rays} rays`);
  // The largest gap between neighbouring rays: never more than the target, and close to it.
  assert.ok(big.spacing <= big.target && big.spacing > 0.9 * big.target, `spacing ${big.spacing}, target ${big.target}`);
});

// Regression (review, finding 3): the checks meshed the caller's shape, so a finer earlier mesh
// changed the result and the 0.02 mm mesh stayed on the shape for later exports.
test("the checks neither read nor leave a mesh on the shape", () => {
  const tube = () => k.cut(k.cylinder(10, 20), k.cylinder(9.5, 20));
  const fresh = JSON.stringify(check(tube()));
  const meshed = tube();
  k.tessellate(meshed, { linearDeflection: 0.005 });
  assert.equal(JSON.stringify(check(meshed)), fresh);
  const shape = tube();
  const stl = k.exportStl(shape, { linearDeflection: 0.1 });
  check(shape);
  assert.deepEqual(k.exportStl(shape, { linearDeflection: 0.1 }), stl);
});

test("overhang: a shelf over thin air fails, printed upside down it passes, and the bed face never counts", () => {
  // A 10 x 10 x 30 column with a 30 x 10 x 3 shelf on top: 200 mm2 of shelf face down at z = 27.
  const tee = k.fuse(k.box(10, 10, 30), k.translate(k.box(30, 10, 3), [-10, 0, 27]));
  const r = check(tee);
  const f = failed(r, "overhang");
  assert.ok(f, JSON.stringify(r));
  assert.ok(Math.abs(f.value! - 90) < 1e-6, `value ${f.value}`);
  assert.equal(f.limit, 45);
  assert.equal(f.waivable, "agent");
  assert.match(f.at ?? "", /^face:\d+$/);
  assert.match(f.note ?? "", /\b200 mm2\b/);
  assert.match(f.note ?? "", /on 2 faces; the largest is face:\d+ \(100 mm2\)/);
  assert.ok(r.pass.includes("min_wall") && r.pass.includes("watertight"));
  // Built along -Z the shelf top rests on the bed and nothing overhangs.
  assert.ok(check(tee, { build: [0, 0, -1] }).pass.includes("overhang"));
  // A 40 degree chamfer under a ledge is printable; 50 degrees is not.
  const ledge = (deg: number) => {
    const run = 5 / Math.tan((deg * Math.PI) / 180);
    const wedge = k.extrude(k.face(k.polygon([[10, 0, 20], [10 + run, 0, 25], [10, 0, 25]])), [0, 10, 0]);
    return k.fuse(k.box(10, 10, 25), wedge);
  };
  assert.ok(check(ledge(50)).pass.includes("overhang"), "50 degrees from the bed is 40 past vertical");
  assert.ok(failed(check(ledge(40)), "overhang"), "40 degrees from the bed is 50 past vertical");
  // Within the 1 degree band the failure is marginal, and it still names the face.
  const band = failed(check(ledge(45)), "overhang");
  assert.equal(band?.marginal, true, JSON.stringify(band));
  assert.match(band?.at ?? "", /^face:\d+$/);
});

test("bed: a part longer than the 220 mm bed fails, a bigger bed or a 90 degree turn fits", () => {
  const long = check(k.box(300, 20, 10));
  const f = failed(long, "bed");
  assert.ok(f, JSON.stringify(long));
  assert.equal(f.value, 300);
  assert.equal(f.limit, 220);
  assert.equal(f.waivable, "human");
  assert.ok(check(k.box(300, 20, 10), { bed: [400, 400, 400] }).pass.includes("bed"));
  // 200 x 230 fits a 220 x 250 bed only turned; the height is checked along the build direction.
  assert.ok(check(k.box(240, 200, 10), { bed: [220, 250, 250] }).pass.includes("bed"));
  assert.ok(failed(check(k.box(20, 20, 260)), "bed"), "taller than 250 mm");
  assert.ok(failed(check(k.box(230, 20, 20)), "bed"), "230 mm does not fit 220 mm");
  assert.ok(check(k.box(230, 20, 20), { build: [1, 0, 0] }).pass.includes("bed"), "stood on its end, 230 mm is the height");
  // Tilted 45 degrees, a 300 mm bar spans 219.2 mm (plus two chords) both across and up.
  assert.ok(check(k.box(300, 10, 10), { build: unit3([1, 0, 1]) }).pass.includes("bed"));
});

test("watertight: an open face and two loose solids fail, and only a person may waive it", () => {
  const sheet = check(k.face(k.polygon([[0, 0, 0], [10, 0, 0], [10, 10, 0]])));
  const f = failed(sheet, "watertight");
  assert.ok(f, JSON.stringify(sheet));
  assert.equal(f.value, 3, "three open mesh edges");
  assert.equal(f.waivable, "human");
  assert.match(f.note ?? "", /no solid/);
  const two = failed(check(k.compound([k.box(5, 5, 5), k.translate(k.box(5, 5, 5), [10, 0, 0])])), "watertight");
  assert.match(two?.note ?? "", /2 solids/);
  // Closed meshes: no open-edge count to compare, so no "0 against 0".
  assert.equal(two?.value, undefined);
  assert.equal(two?.limit, undefined);
});

test("printGates checks each definition once, in its own frame, and labels the run as rule checks", () => {
  const pin = k.cylinder(3, 10);
  const at = (x: number) => ({ t: [x, 0, 0] as Vec3, q: [0, 0, 0, 1] as [number, number, number, number] });
  const asm = buildAssembly(k, {
    parts: [
      { name: "tray", shape: tray(0.6) },
      ...[40, 60].map((x) => ({ name: "pin", shape: k.place(pin, at(x)), cloneOf: "pin", cloneTransform: at(x) })),
    ],
    mates: [], params: {}, warnings: [],
  });
  const run = printGates(k, asm, { profile: "fdm.v1" });
  assert.deepEqual(run.parts.map((p) => p.def), ["tray", "pin"]);
  assert.deepEqual(run.parts.map((p) => p.fail.map((f) => f.gate)), [["min_wall"], []]);
  assert.deepEqual([run.profile, run.build, run.bed_mm], ["fdm.v1", [0, 0, 1], [220, 220, 250]]);
  assert.ok(run.notes.some((n) => /not a print simulation/.test(n)), run.notes.join("\n"));
  const out = { status: "ok", gates: run, compute: { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" } };
  const v = validate("tool-inspect-output", out);
  assert.ok(v.valid, JSON.stringify(v.errors));
  assert.deepEqual(printGates(k, asm, { profile: "fdm.v1", defs: ["pin"] }).parts.map((p) => p.def), ["pin"]);
  // Regression (review, finding 7): a huge finite direction overflowed to [0, 0, 0] and ran as +Z.
  const huge = printGates(k, asm, { build: [1.7e308, 1.7e308, 1.7e308], defs: ["tray"] });
  assert.deepEqual(huge.build, [0.577, 0.577, 0.577]);
  assert.deepEqual(huge.parts[0]!.fail, printGates(k, asm, { build: [1, 1, 1], defs: ["tray"] }).parts[0]!.fail);
  assert.throws(() => check(k.box(5, 5, 5), { build: [0, 0, 0] }), /finite, non-zero/);
});
