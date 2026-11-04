// Gate corpus case pockets-tip-to-tip-30deg-0.5 (cases.json has its expected verdicts).
// Two conical pockets 30 degrees from their axis, one from the top and one from the bottom of a
// 30 x 30 x 10 mm block, on one axis, with 0.5 mm between their tips. Each pocket's wall leans
// 30 degrees past vertical, so nothing overhangs. No face ray crosses the web between the tips
// (the face rays of one cone run along the other); before the gate cast rays from pocket tips
// this part passed all four gates with a thinnest wall of 6.87 mm.
// Original, MIT. Units are mm, Z is up.
const R = 6 * Math.tan((30 * Math.PI) / 180);
const fromTop = polygon([[0, 5.25], [R, 11.25], [0, 11.25]]).revolve();
const fromBottom = polygon([[0, 4.75], [0, -1.25], [R, -1.25]]).revolve();
return box(30, 30, 10).subtract(fromTop, fromBottom);
