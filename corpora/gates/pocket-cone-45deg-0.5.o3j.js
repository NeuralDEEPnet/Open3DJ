// Gate corpus case pocket-cone-45deg-0.5 (cases.json has its expected verdicts).
// A wide conical pocket whose tip stops 0.5 mm above the bottom face. Rays from the bottom reach
// the pocket wall at 45 degrees, so the web is measured (a little over 0.5 mm, between rays).
// Original, MIT. Units are mm, Z is up.
const a = 45; // degrees from the axis
// A 20 x 20 x 5 mm block with a conical pocket from the top, its tip 0.5 mm above the bottom.
const r = 5 * Math.tan((a * Math.PI) / 180);
const cone = cylinder(5, r, 0).rotate([1, 0, 0], 180).translateZ(5.5);
return box(20, 20, 5).subtract(cone);
