// Seeded envelope defect D11 (a diagonal band inside the range): a slider plate whose hole sits
// at the sum of two offsets, next to a fixed slot. The web fails only where the two offsets
// add up to a band in the middle. Original test part for the Open3DJ envelope spike, MIT.
// Units are mm, Z is up.
const A = Param.number("Offset A", 12, { min: 0, max: 40, unit: "mm" });
const B = Param.number("Offset B", 12, { min: 0, max: 40, unit: "mm" });
const plate = box(120, 30, 4).translate(60, 0, 0);
const hole = cylinder(6, 1.5).translate(10 + A + B, 0, -1);
const fixedSlot = box(2, 12, 6).translate(62, 0, -1);
return plate.subtract(hole, fixedSlot).name("Slider").color("#5b6b7a");
