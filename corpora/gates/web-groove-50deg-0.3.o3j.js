// Gate corpus case web-groove-50deg-0.3 (cases.json has its expected verdicts).
// A 40 x 20 x 2 mm plate with a 50 degree V-groove cut from below along Y, leaving a 0.3 mm web
// under the top face. No face ray crosses the web; rays from the groove's inside edge do.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
const half = 2.7 * Math.tan((25 * Math.PI) / 180);
return box(40, 20, 2).subtract(xz([[-half, -1], [half, -1], [0, 1.7]], 22));
