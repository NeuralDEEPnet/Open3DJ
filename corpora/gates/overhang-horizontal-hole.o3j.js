// Gate corpus case overhang-horizontal-hole (cases.json has its expected verdicts).
// A 20 mm cube with an 8 mm hole straight through it along X: the top of the hole faces down.
// Original, MIT. Units are mm, Z is up.
return box(20, 20, 20).subtract(cylinder(22, 4).pointAlong([1, 0, 0]).translate(-11, 0, 10));
