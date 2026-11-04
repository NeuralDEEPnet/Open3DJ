// Gate corpus case watertight-self-crossing (cases.json has its expected verdicts).
// A bow-tie outline whose edges cross, extruded 5 mm. The kernel's validity check refuses it,
// so the run fails and no gate can pass it.
// Original, MIT. Units are mm, Z is up.
return polygon([[0, 0], [10, 0], [0, 10], [10, 10]]).extrude(5);
