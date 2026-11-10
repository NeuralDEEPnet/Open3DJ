// Seeded envelope control C08: the vented cover of D08 with a minimum height of 30 mm, so the
// web above the vent slots stays at least 5.5 mm. Original test part for the Open3DJ envelope
// spike, MIT. Units are mm, Z is up.
const H = Param.number("Height", 40, { min: 30, max: 60, unit: "mm" });
const W = Param.number("Width", 70, { min: 50, max: 100, unit: "mm" });
const vents = Param.bool("Vents", false);
let cover = box(W, 50, H).shell(2);
if (vents) {
  cover = cover.subtract(slot(16, 5).extrude(60).rotateX(90).translate(0, 30, 22));
}
return cover.name("Cover").color("#3d405b");
