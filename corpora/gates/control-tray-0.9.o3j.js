// Gate corpus case control-tray-0.9 (cases.json has its expected verdicts).
// Control: the tray with 0.9 mm walls, above the 0.8 mm limit and its 0.04 mm band.
// Original, MIT. Units are mm, Z is up.
// An open-top tray: walls and floor t thick.
const tray = (t) => box(30, 20, 15).subtract(box(30 - 2 * t, 20 - 2 * t, 15).translateZ(t));
return tray(0.9);
