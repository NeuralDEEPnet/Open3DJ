// Seeded envelope control C02: a sensor block with a blind pocket whose floor stays at least
// 4 mm thick across the declared box. Original test part for the Open3DJ envelope spike, MIT.
// Units are mm, Z is up.
const H = Param.number("Height", 20, { min: 14, max: 30, unit: "mm" });
const Dp = Param.number("Pocket depth", 6, { min: 3, max: 10, unit: "mm" });
const Rp = Param.number("Pocket radius", 4, { min: 2.5, max: 6, unit: "mm" });
const block = box(24, 24, H);
const pocket = cylinder(Dp + 1, Rp).translateZ(H - Dp);
return block.subtract(pocket).name("Block").color("#5b6b7a");
