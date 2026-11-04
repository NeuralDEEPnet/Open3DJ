// Gate corpus case wedge-knife-edge (cases.json has its expected verdicts).
// A knife edge: a wedge 100 mm long and 40 mm deep at the back, meeting in a 22.6 degree edge.
// cases.json builds it along -X, standing on its back with the edge up.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
return xz([[0, 0], [100, -20], [100, 20]], 100);
