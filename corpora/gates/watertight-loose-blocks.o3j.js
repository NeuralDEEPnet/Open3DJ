// Gate corpus case watertight-loose-blocks (cases.json has its expected verdicts).
// Two 10 mm cubes with a 10 mm gap, returned as one part (a union of pieces that do not touch).
// Original, MIT. Units are mm, Z is up.
return box(10, 10, 10).add(box(10, 10, 10).translateX(20));
