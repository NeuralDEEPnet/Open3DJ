// Seeded envelope control C04: a ring with at most 8 M6 clearance holes on a bolt circle of at
// least 25 mm radius, so the webs between holes stay above 12 mm. Original test part for the
// Open3DJ envelope spike, MIT. Units are mm, Z is up.
const R = Param.number("Bolt circle radius", 30, { min: 25, max: 40, unit: "mm" });
const n = Param.number("Holes", 6, { min: 3, max: 8, integer: true });
const T = Param.number("Thickness", 6, { min: 4, max: 12, unit: "mm" });
const ring = cylinder(T, R + 10).subtract(cylinder(T + 2, 6).translateZ(-1));
const hole = lib.clearanceHole("M6", { length: T + 2 }).translate(R, 0, T + 1);
return ring.subtract(circularPattern(hole, n)).name("Ring").color("#5b6b7a");
