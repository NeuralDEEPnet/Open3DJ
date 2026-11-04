// Gate corpus case watertight-corner-on-face (cases.json has its expected verdicts).
// One solid: a 60 x 40 x 2 mm plate, an 8 mm cube balanced on one corner (its body diagonal
// vertical) whose lowest corner touches the middle of the plate's top face at (0, 0, 2), and a
// 6 mm post on the plate that holds the cube. The cube's lower faces lean 35.3 degrees past
// vertical, so nothing overhangs. The solid pinches to the point where the corner meets the
// face, and the corner is not a vertex of the face's mesh. Until the watertight check looked
// for mesh points that lie on a face they are not part of, this part passed all four gates.
// Original, MIT. Units are mm, Z is up.
const tilt = (Math.atan(1 / Math.SQRT2) * 180) / Math.PI; // turns a body diagonal onto Z
const cube = box(8, 8, 8).translate(0, 0, -4).rotate([1, 0, 0], 45).rotate([0, 1, 0], tilt);
const plate = box(60, 40, 2);
const post = box(6, 6, 12).translate(8, 0, 1);
return plate.add(cube.translateZ(2 + 4 * Math.sqrt(3)), post);
