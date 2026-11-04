// Gate corpus case control-filleted-boss (cases.json has its expected verdicts).
// Control: a boss 16 mm across at the base, drafted to 12 mm at the top over 12 mm, with a 1 mm
// fillet round the top edge.
// Original, MIT. Units are mm, Z is up.
return fillet(cylinder(12, 8, 6), 1, { atZ: 12 });
