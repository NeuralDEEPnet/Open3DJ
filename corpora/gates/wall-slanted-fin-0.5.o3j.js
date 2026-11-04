// Gate corpus case wall-slanted-fin-0.5 (cases.json has its expected verdicts).
// A 40 x 30 x 4 mm plate with a fin 0.5 mm thick, 30 mm long and 16 mm tall, leaning 30 degrees
// from vertical (slanted faces). Its foot is buried in the plate.
// Original, MIT. Units are mm, Z is up.
return box(40, 30, 4).add(box(30, 0.5, 16).rotate([1, 0, 0], 30).translateZ(2));
