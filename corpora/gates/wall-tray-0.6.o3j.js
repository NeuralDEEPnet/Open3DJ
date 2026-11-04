// Gate corpus case wall-tray-0.6 (cases.json has its expected verdicts).
// A 30 x 20 x 15 mm open tray with 0.6 mm walls and floor (flat faces).
// Original, MIT. Units are mm, Z is up.
// An open-top tray: walls and floor t thick.
const tray = (t) => box(30, 20, 15).subtract(box(30 - 2 * t, 20 - 2 * t, 15).translateZ(t));
return tray(0.6);
