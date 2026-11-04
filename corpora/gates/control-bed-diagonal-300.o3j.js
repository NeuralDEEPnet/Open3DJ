// Gate corpus case control-bed-diagonal-300 (cases.json has its expected verdicts).
// Control: a 300 x 10 x 10 mm bar designed at 45 degrees about Z. Its bounding box is
// 219.2 x 219.2 mm, so it fits the 220 mm bed as designed.
// Original, MIT. Units are mm, Z is up.
return box(300, 10, 10).rotate([0, 0, 1], 45);
