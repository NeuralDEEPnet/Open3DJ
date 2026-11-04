// Gate corpus case wall-rib-0.3 (cases.json has its expected verdicts).
// A 40 x 20 x 3 mm plate with a 0.3 mm rib, 30 mm long, standing 8 mm above it (flat faces).
// Original, MIT. Units are mm, Z is up.
return box(40, 20, 3).add(box(30, 0.3, 10).translateZ(1));
