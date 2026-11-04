// Gate corpus case wall-ellipse-tube-0.7 (cases.json has its expected verdicts).
// An elliptical tube, 30 x 16 mm and 15 mm tall, with a 0.7 mm wall from the exact 2D offset.
// Original, MIT. Units are mm, Z is up.
return ellipse(15, 8).extrude(15).subtract(ellipse(15, 8).offset(-0.7).extrude(17).translateZ(-1));
