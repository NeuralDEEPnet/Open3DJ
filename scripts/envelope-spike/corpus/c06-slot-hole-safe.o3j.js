// Seeded envelope control C06: a plate with a fixed M4 hole and an adjustment slot whose travel
// keeps it at least 20 mm from the hole. Original test part for the Open3DJ envelope spike,
// MIT. Units are mm, Z is up.
const X = Param.number("Slot X", -20, { min: -30, max: -10, unit: "mm" });
const Y = Param.number("Slot Y", 4, { min: -12, max: 12, unit: "mm" });
const plate = box(90, 40, 4);
const hole = lib.clearanceHole("M4", { length: 5 }).translate(20, 0, 4);
const slotCut = slot(10, 4).extrude(6).translate(X, Y, -1);
return plate.subtract(hole, slotCut).name("Plate").color("#5b6b7a");
