// Seeded envelope defect D06 (slots that merge, inside the range): a plate with a fixed M4
// hole and an adjustment slot placed by two parameters. The slot leaves a thin web, then
// merges, only when it comes near the hole. Original test part for the Open3DJ envelope
// spike, MIT. Units are mm, Z is up.
const X = Param.number("Slot X", -20, { min: -30, max: 30, unit: "mm" });
const Y = Param.number("Slot Y", 8, { min: -12, max: 12, unit: "mm" });
const plate = box(90, 40, 4);
const hole = lib.clearanceHole("M4", { length: 5 }).translate(10, 0, 4);
const slotCut = slot(10, 4).extrude(6).translate(X, Y, -1);
return plate.subtract(hole, slotCut).name("Plate").color("#5b6b7a");
