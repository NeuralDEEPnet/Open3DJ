// Seeded envelope defect D07 (clearance sign flip): a pin that runs in a bushing bore. Two
// parts. A large pin in a small bore turns the running clearance into a press fit, then a
// clash. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const B = Param.number("Bore", 6.9, { min: 6.4, max: 7.4, unit: "mm" });
const P = Param.number("Pin", 6.4, { min: 5.6, max: 6.6, unit: "mm" });
const L = Param.number("Length", 20, { min: 12, max: 30, unit: "mm" });
const bushing = cylinder(L, 8).subtract(cylinder(L + 2, B / 2).translateZ(-1));
const pin = cylinder(L + 10, P / 2).translateZ(-5);
return [{ name: "Bushing", shape: bushing, color: "#5b6b7a" }, { name: "Pin", shape: pin, color: "#6c757d" }];
