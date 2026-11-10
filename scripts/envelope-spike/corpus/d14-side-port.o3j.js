// Seeded envelope defect D14 (every parameter at its extreme at once): a shelled tray with a
// round cable port in one end wall. Only a low tray with a high, wide port leaves a thin web
// to the rim. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const H = Param.number("Height", 30, { min: 20, max: 40, unit: "mm" });
const Z = Param.number("Port height", 10, { min: 8, max: 16, unit: "mm" });
const Dp = Param.number("Port diameter", 5, { min: 3, max: 8, unit: "mm" });
const W = Param.number("Width", 60, { min: 40, max: 80, unit: "mm" });
const tray = box(W, 40, H).shell(2);
const port = cylinder(10, Dp / 2).pointAlong([1, 0, 0]).translate(W / 2 - 5, 0, Z);
return tray.subtract(port).name("Tray").color("#3d405b");
