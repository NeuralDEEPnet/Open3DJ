// Gate corpus case wall-tilted-tray-0.7 (cases.json has its expected verdicts).
// The tray with 0.7 mm walls, tilted 25 degrees about the axis [1, 2, 0], so no face lines up with
// X, Y or Z. cases.json builds it along the tray's own up axis, so it still stands on its floor.
// Original, MIT. Units are mm, Z is up.
// An open-top tray: walls and floor t thick.
const tray = (t) => box(30, 20, 15).subtract(box(30 - 2 * t, 20 - 2 * t, 15).translateZ(t));
return tray(0.7).rotate([1, 2, 0], 25);
