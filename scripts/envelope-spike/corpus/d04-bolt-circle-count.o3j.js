// Seeded envelope defect D04 (pattern overlap at the maximum count): a ring with a circular
// pattern of M6 clearance holes. Many holes on a small bolt circle leave thin webs between
// them, then merge. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const R = Param.number("Bolt circle radius", 26, { min: 15, max: 40, unit: "mm" });
const n = Param.number("Holes", 6, { min: 3, max: 16, integer: true });
const T = Param.number("Thickness", 6, { min: 4, max: 12, unit: "mm" });
const ring = cylinder(T, R + 10).subtract(cylinder(T + 2, 6).translateZ(-1));
const hole = lib.clearanceHole("M6", { length: T + 2 }).translate(R, 0, T + 1);
return ring.subtract(circularPattern(hole, n)).name("Ring").color("#5b6b7a");
