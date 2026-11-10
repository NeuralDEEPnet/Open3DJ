// Seeded envelope control C07: a pin in a bushing whose bore is always at least 0.2 mm larger
// than the pin, so the running clearance never drops below 0.1 mm. Two parts. Original test
// part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const B = Param.number("Bore", 7, { min: 6.8, max: 7.4, unit: "mm" });
const P = Param.number("Pin", 6.4, { min: 5.6, max: 6.6, unit: "mm" });
const L = Param.number("Length", 20, { min: 12, max: 30, unit: "mm" });
const bushing = cylinder(L, 8).subtract(cylinder(L + 2, B / 2).translateZ(-1));
const pin = cylinder(L + 10, P / 2).translateZ(-5);
return [{ name: "Bushing", shape: bushing, color: "#5b6b7a" }, { name: "Pin", shape: pin, color: "#6c757d" }];
