// Gate corpus case control-flare-40deg (cases.json has its expected verdicts).
// Control: a 20 mm cylinder that flares out at 40 degrees past vertical into a wider cap. The
// flare's surface curves, and every normal on it leans 40 degrees.
// Original, MIT. Units are mm, Z is up.
const R = 10 + 10 * Math.tan((40 * Math.PI) / 180);
return cylinder(5, 10).add(cylinder(10, 10, R).translateZ(5), cylinder(3, R).translateZ(15));
