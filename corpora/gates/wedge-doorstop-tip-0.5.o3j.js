// Gate corpus case wedge-doorstop-tip-0.5 (cases.json has its expected verdicts).
// A doorstop lying flat, 120 x 40 mm, 25 mm tall at the back and 0.5 mm at the tip.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
return xz([[0, 0], [120, 0], [120, 25], [0, 0.5]], 40);
