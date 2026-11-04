// Gate corpus case neck-fused-rods-0.63 (cases.json has its expected verdicts).
// Two upright rods, 10 mm across and 20 mm tall, 9.98 mm apart: they overlap by 0.02 mm and the
// fused neck is 2 * sqrt(25 - 4.99^2) = 0.632 mm wide.
// Original, MIT. Units are mm, Z is up.
return cylinder(20, 5).add(cylinder(20, 5).translateX(9.98));
