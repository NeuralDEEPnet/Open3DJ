// Gate corpus case unmeasured-tetrahedron (cases.json has its expected verdicts).
// A regular tetrahedron with 30 mm edges. No two faces come close to facing each other: a ray
// into the solid leaves it more than 60 degrees from square to the exit face, so no ray finds a
// wall, and the gate fails it unmeasured, without a value.
// Original, MIT. Units are mm, Z is up.
// A regular tetrahedron with 30 mm edges on its base: a triangular prism cut by the three
// planes through the base edges and the apex (each plane is the face of a large rotated box).
const a = 30;
const base = [[0, 0, 0], [a, 0, 0], [a / 2, (a * Math.sqrt(3)) / 2, 0]];
const apex = [a / 2, (a * Math.sqrt(3)) / 6, a * Math.sqrt(2 / 3)];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const mid = [apex[0], apex[1], 0]; // the centre of the base, inside the solid
let s = polygon(base.map((p) => [p[0], p[1]])).extrude(apex[2]);
for (let i = 0; i < 3; i++) {
  const p = base[i];
  // The outward normal of the face through this base edge and the apex.
  let n = unit(cross(sub(base[(i + 1) % 3], p), sub(apex, p)));
  if (n[0] * (mid[0] - p[0]) + n[1] * (mid[1] - p[1]) + n[2] * (mid[2] - p[2]) > 0) n = n.map((x) => -x);
  // A large box above Z = 0, turned so its bottom face lies in that plane.
  const half = box(1000, 1000, 1000).rotate(cross([0, 0, 1], n), (Math.acos(n[2]) * 180) / Math.PI).translate(p[0], p[1], p[2]);
  s = s.subtract(half);
}
return s;
