// Gate corpus case overhang-ledge-45deg-marginal (cases.json has its expected verdicts).
// The ledge with a chamfer at exactly 45 degrees past vertical: inside the band, a marginal failure.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
const lean = 45; // degrees past vertical
// A 10 x 10 x 25 mm column with a ledge on +X: it sticks out 5 mm, ends in a 2 mm vertical lip,
// and is held up by a chamfer leaning `lean` past vertical. The outline starts inside the column.
const rise = 1 / Math.tan((lean * Math.PI) / 180);
const ledge = xz([[3, 23 - 7 * rise], [10, 23], [10, 25], [3, 25]], 10);
return box(10, 10, 25).add(ledge);
