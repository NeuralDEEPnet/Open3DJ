// Gate corpus case control-corner-above-face-0.3 (cases.json has its expected verdicts).
// Control: the part of watertight-corner-on-face with the cube 0.3 mm higher, so its corner
// stops 0.3 mm above the plate. The solid is closed and a manifold everywhere.
// Original, MIT. Units are mm, Z is up.
const tilt = (Math.atan(1 / Math.SQRT2) * 180) / Math.PI; // turns a body diagonal onto Z
const cube = box(8, 8, 8).translate(0, 0, -4).rotate([1, 0, 0], 45).rotate([0, 1, 0], tilt);
const plate = box(60, 40, 2);
const post = box(6, 6, 12).translate(8, 0, 1);
return plate.add(cube.translateZ(2 + 4 * Math.sqrt(3) + 0.3), post);
