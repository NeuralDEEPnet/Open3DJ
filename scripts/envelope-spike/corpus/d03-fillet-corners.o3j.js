// Seeded envelope defect D03 (a fillet that fails at a corner): a block with its four vertical
// edges rounded. A large radius on a narrow block makes the two fillets on the short side
// overlap. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const W = Param.number("Width", 24, { min: 10, max: 40, unit: "mm" });
const R = Param.number("Corner radius", 3, { min: 1, max: 8, unit: "mm" });
const H = Param.number("Height", 10, { min: 5, max: 20, unit: "mm" });
return fillet(box(W, 30, H), R, { parallel: [0, 0, 1] }).name("Block").color("#5b6b7a");
