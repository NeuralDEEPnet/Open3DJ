// Seeded envelope defect D01 (hole breakout): a mounting plate with two M5 clearance holes on
// a pitch. A wide pitch on a narrow plate leaves a thin wall to the plate's end, then breaks
// out. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const W = Param.number("Width", 60, { min: 40, max: 90, unit: "mm" });
const P = Param.number("Pitch", 36, { min: 20, max: 50, unit: "mm" });
const T = Param.number("Thickness", 4, { min: 3, max: 8, unit: "mm" });
const plate = box(W, 30, T);
const holes = [-1, 1].map((s) => lib.clearanceHole("M5", { length: T + 1 }).translate((s * P) / 2, 0, T));
return plate.subtract(holes).name("Plate").color("#5b6b7a");
