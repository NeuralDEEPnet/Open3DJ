// Seeded envelope control C03: a block with its four vertical edges rounded; the block is at
// least 20 mm wide and the radius at most 8, so the fillets never meet. Original test part
// for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const W = Param.number("Width", 28, { min: 20, max: 40, unit: "mm" });
const R = Param.number("Corner radius", 3, { min: 1, max: 8, unit: "mm" });
const H = Param.number("Height", 10, { min: 5, max: 20, unit: "mm" });
return fillet(box(W, 30, H), R, { parallel: [0, 0, 1] }).name("Block").color("#5b6b7a");
