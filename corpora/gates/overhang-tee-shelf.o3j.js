// Gate corpus case overhang-tee-shelf (cases.json has its expected verdicts).
// A 10 x 10 x 30 mm column with a 30 x 10 x 3 mm shelf on top: the shelf's underside faces
// straight down on both sides.
// Original, MIT. Units are mm, Z is up.
return box(10, 10, 30).add(box(30, 10, 3).translateZ(27));
