// Seeded envelope defect D08 (a switch that only fails with a small size): a shelled cover
// with optional vent slots in the long walls. With vents on, a low cover leaves a thin web
// above the slots, then opens the rim. The range starts at 24 mm, where the opened rim still
// meets the slot at a knife edge. Original test part for the Open3DJ envelope spike, MIT.
// Units are mm, Z is up.
const H = Param.number("Height", 40, { min: 24, max: 60, unit: "mm" });
const W = Param.number("Width", 70, { min: 50, max: 100, unit: "mm" });
const vents = Param.bool("Vents", false);
let cover = box(W, 50, H).shell(2);
if (vents) {
  // One stadium slot 16 x 5 through both long walls, centred 22 mm above the floor.
  cover = cover.subtract(slot(16, 5).extrude(60).rotateX(90).translate(0, 30, 22));
}
return cover.name("Cover").color("#3d405b");
