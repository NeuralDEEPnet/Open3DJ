// Seeded envelope control C01: a mounting plate with one centred M5 clearance hole. Every wall
// stays at least 12 mm thick across the declared box. Original test part for the Open3DJ
// envelope spike, MIT. Units are mm, Z is up.
const W = Param.number("Width", 50, { min: 30, max: 80, unit: "mm" });
const T = Param.number("Thickness", 4, { min: 3, max: 8, unit: "mm" });
const plate = box(W, 30, T);
return plate.subtract(lib.clearanceHole("M5", { length: T + 1 }).translateZ(T)).name("Plate").color("#5b6b7a");
