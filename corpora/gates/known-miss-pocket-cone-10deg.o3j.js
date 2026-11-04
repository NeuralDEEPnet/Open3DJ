// Gate corpus case known-miss-pocket-cone-10deg (cases.json has its expected verdicts).
// The documented known miss: a narrow conical pocket, 10 degrees from its axis, whose tip stops
// 0.5 mm above the bottom face. The web under the tip is one point, and no ray that counts
// reaches it, so min_wall passes. The truth is a fail.
// Original, MIT. Units are mm, Z is up.
const a = 10; // degrees from the axis
// A 20 x 20 x 5 mm block with a conical pocket from the top, its tip 0.5 mm above the bottom.
const r = 5 * Math.tan((a * Math.PI) / 180);
const cone = cylinder(5, r, 0).rotate([1, 0, 0], 180).translateZ(5.5);
return box(20, 20, 5).subtract(cone);
