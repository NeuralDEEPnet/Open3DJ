// Gate corpus case control-bed-turned-90 (cases.json has its expected verdicts).
// Control: a 240 x 200 x 10 mm plate. cases.json gives a 220 x 250 x 250 mm bed, so the plate fits
// only turned 90 degrees, which the gate tries.
// Original, MIT. Units are mm, Z is up.
return box(240, 200, 10);
