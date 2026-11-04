// Gate corpus case wall-arrow-tip-0.4 (cases.json has its expected verdicts).
// A 60 x 60 x 3 mm plate with a triangular pocket through it whose 90 degree tip stops 0.4 mm
// from the back face. The thin spot sits beside a long, narrow face.
// Original, MIT. Units are mm, Z is up.
return box(60, 60, 3).translate(30, 30, 0).subtract(polygon([[30, 59.6], [45, 44.6], [15, 44.6]]).extrude(5).translateZ(-1));
