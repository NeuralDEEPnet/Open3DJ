// Gate corpus case watertight-tip-on-face (cases.json has its expected verdicts).
// One solid: a 60 x 40 x 2 mm plate, a cone pointing down whose tip touches the middle of the
// plate's top face at (0, 0, 2), a short cylinder on the cone, and a 6 mm post that holds both.
// The cone is 40 degrees from its axis (an 80 degree tip), so its side leans 40 degrees past
// vertical and does not overhang. The solid pinches to the point where the tip meets the face.
// Original, MIT. Units are mm, Z is up.
const r = 6 * Math.tan((40 * Math.PI) / 180);
const cone = cylinder(6, r, 0).rotate([1, 0, 0], 180).translateZ(8); // tip at z = 2, radius r at z = 8
const cap = cylinder(4, r).translateZ(8);
const post = box(6, 6, 11).translate(6, 0, 1);
return box(60, 40, 2).add(cone, cap, post);
