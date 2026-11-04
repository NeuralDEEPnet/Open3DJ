// Gate corpus case wall-tray-0.8-marginal (cases.json has its expected verdicts).
// The tray with 0.8 mm walls, exactly the limit: inside the guard band the gate fails it as marginal.
// Original, MIT. Units are mm, Z is up.
// An open-top tray: walls and floor t thick.
const tray = (t) => box(30, 20, 15).subtract(box(30 - 2 * t, 20 - 2 * t, 15).translateZ(t));
return tray(0.8);
