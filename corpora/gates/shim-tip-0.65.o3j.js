// Gate corpus case shim-tip-0.65 (cases.json has its expected verdicts).
// A shim 100 mm long and 30 mm tall, tapering from 12 mm to 0.65 mm, standing on its outline.
// Original, MIT. Units are mm, Z is up.
return polygon([[0, 0], [100, 0], [100, 0.65], [0, 12]]).extrude(30);
