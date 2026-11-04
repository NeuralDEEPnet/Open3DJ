// Gate corpus case watertight-point-contact (cases.json has its expected verdicts).
// A plate carrying a block and a square post turned 45 degrees. The block's front leans back
// 25 degrees below its top edge, and the post's vertical edge touches that edge at one point, so
// the solid pinches to a point there. Every other check passes. Until the watertight check
// counted non-manifold vertices, this part passed all four gates.
// Original, MIT. Units are mm, Z is up.
// A prism from an outline in the XZ plane ([x, z] points), extruded along Y over depth, centred on Y.
const xz = (points, depth) => polygon(points).extrude(depth).rotate([1, 0, 0], 90).translateY(depth / 2);
const lean = Math.tan((25 * Math.PI) / 180);
const plate = box(40, 30, 2).translate(-2, 0, 0);
const block = xz([[-15, 1], [-11 * lean, 1], [0, 12], [-15, 12]], 20);
const post = box(10, 10, 20).rotate([0, 0, 1], 45).translate(5 * Math.SQRT2, 0, 1);
return plate.add(block, post);
