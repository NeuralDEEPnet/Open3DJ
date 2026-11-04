// Gate corpus case wall-tube-0.5 (cases.json has its expected verdicts).
// A tube, 20 mm outside diameter and 15 mm tall, with a 0.5 mm wall (curved faces).
// Original, MIT. Units are mm, Z is up.
return cylinder(15, 10).subtract(cylinder(17, 9.5).translateZ(-1));
