// Gate corpus case watertight-edge-contact (cases.json has its expected verdicts).
// Two 10 mm cubes that touch along one vertical edge only, returned as one part.
// Original, MIT. Units are mm, Z is up.
return box(10, 10, 10).add(box(10, 10, 10).translate(10, 10, 0));
