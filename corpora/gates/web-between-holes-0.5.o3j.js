// Gate corpus case web-between-holes-0.5 (cases.json has its expected verdicts).
// A 30 x 20 x 5 mm plate with two 6 mm holes straight through it, 6.5 mm apart: the web between
// them is 0.5 mm at its narrowest (curved faces on both sides).
// Original, MIT. Units are mm, Z is up.
return box(30, 20, 5).subtract(cylinder(7, 3).translate(-3.25, 0, -1), cylinder(7, 3).translate(3.25, 0, -1));
