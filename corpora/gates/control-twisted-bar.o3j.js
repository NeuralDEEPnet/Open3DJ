// Gate corpus case control-twisted-bar (cases.json has its expected verdicts).
// Control: a 20 x 4 mm bar twisted 90 degrees over 40 mm. Its faces are B-spline sweeps, and the
// wall square to the twisted faces is a little under 4 mm.
// Original, MIT. Units are mm, Z is up.
return rect(20, 4).extrude(40, { twist: 90 });
