// Gate corpus case web-scoring-25deg-0.3 (cases.json has its expected verdicts).
// The same plate with a narrow 25 degree scoring line from below, leaving a 0.3 mm web.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
const half = 2.7 * Math.tan((12.5 * Math.PI) / 180);
return box(40, 20, 2).subtract(xz([[-half, -1], [half, -1], [0, 1.7]], 22));
