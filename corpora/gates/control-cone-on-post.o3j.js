// Gate corpus case control-cone-on-post (cases.json has its expected verdicts).
// Control: a post 16 mm across and 10 mm tall with a cone on top whose tip is 80 degrees, blunter
// than the 60 degrees that read as thin.
// Original, MIT. Units are mm, Z is up.
return cylinder(10, 8).add(cylinder(8 / Math.tan((40 * Math.PI) / 180), 8, 0).translateZ(10));
