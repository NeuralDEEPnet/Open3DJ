// Gate corpus case web-under-drill-point-0.5 (cases.json has its expected verdicts).
// A 6 mm blind hole drilled from the top of a 20 x 20 x 6 mm block, with a 118 degree drill
// point whose tip stops 0.5 mm above the bottom face. Face rays from the point reach the bottom
// at an angle and read about 0.6 mm; the ray from the tip reads the web itself.
// Original, MIT. Units are mm, Z is up.
const r = 3;
const h = r / Math.tan((59 * Math.PI) / 180); // the drill point's length
const point = cylinder(h, r, 0).rotate([1, 0, 0], 180).translateZ(0.5 + h); // tip at z = 0.5
const bore = cylinder(7 - 0.5 - h, r).translateZ(0.5 + h); // out through the top
return box(20, 20, 6).subtract(point, bore);
