// Gate corpus case known-miss-leaning-pocket-tip-0.7 (cases.json has its expected verdicts).
// The documented known miss: a narrow conical pocket, 5 degrees from its axis, whose axis leans
// 35 degrees from vertical and whose tip stops 0.7 mm above the bottom face. The ray from the tip
// runs along the pocket's axis, so it reads the web as 0.7 / cos(35 degrees) = 0.85 mm, and
// min_wall passes. The truth is a fail. The pocket's wall leans at most 40 degrees past
// vertical, so nothing overhangs.
// Original, MIT. Units are mm, Z is up.
const cone = cylinder(20, 20 * Math.tan((5 * Math.PI) / 180), 0)
  .rotate([1, 0, 0], 180)
  .translateZ(20) // tip at the origin, opening up
  .rotate([1, 0, 0], 35)
  .translateZ(0.7);
return box(30, 30, 10).subtract(cone);
