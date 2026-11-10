// Seeded envelope defect D02 (pocket through the floor): a sensor block with a blind pocket
// from the top. A deep pocket in a short block leaves a thin floor, then breaks through.
// Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const H = Param.number("Height", 20, { min: 10, max: 30, unit: "mm" });
const Dp = Param.number("Pocket depth", 8, { min: 3, max: 12, unit: "mm" });
const Rp = Param.number("Pocket radius", 4, { min: 2.5, max: 6, unit: "mm" });
const block = box(24, 24, H);
const pocket = cylinder(Dp + 1, Rp).translateZ(H - Dp);
return block.subtract(pocket).name("Block").color("#5b6b7a");
