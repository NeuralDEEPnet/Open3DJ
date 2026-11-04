// Gate corpus case control-tee-upside-down (cases.json has its expected verdicts).
// Control: the tee of overhang-tee-shelf. cases.json builds it along -Z, so the shelf's top rests
// on the bed and nothing overhangs.
// Original, MIT. Units are mm, Z is up.
return box(10, 10, 30).add(box(30, 10, 3).translateZ(27));
