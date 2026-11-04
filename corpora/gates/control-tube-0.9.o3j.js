// Gate corpus case control-tube-0.9 (cases.json has its expected verdicts).
// Control: the 20 mm tube with a 0.9 mm wall.
// Original, MIT. Units are mm, Z is up.
return cylinder(15, 10).subtract(cylinder(17, 9.1).translateZ(-1));
