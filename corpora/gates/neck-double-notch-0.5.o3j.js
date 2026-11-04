// Gate corpus case neck-double-notch-0.5 (cases.json has its expected verdicts).
// A 20 x 10 x 10 mm block with 70 degree V-notches from the top and the bottom, along Y, leaving
// a 0.5 mm neck between their tips. Rays from the notch tips cross it.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
const w = 5.75 * Math.tan((35 * Math.PI) / 180);
const top = xz([[-w, 11], [w, 11], [0, 5.25]], 12);
const bottom = xz([[-w, -1], [w, -1], [0, 4.75]], 12);
return box(20, 10, 10).subtract(top, bottom);
