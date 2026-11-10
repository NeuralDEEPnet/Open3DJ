// Seeded envelope control C09: the rotor and stop pin of D09 with arms at most 28 mm long, so
// no arm reaches the pin at 30 mm. Two parts. Original test part for the Open3DJ envelope
// spike, MIT. Units are mm, Z is up.
const n = Param.number("Arms", 6, { min: 3, max: 12, integer: true });
const phi = Param.number("Pin angle", 100, { min: 66, max: 114, unit: "deg" });
const len = Param.number("Arm length", 24, { min: 20, max: 28, unit: "mm" });
const arm = box(len, 3, 4).translate(len / 2, 0, 0);
const rotor = cylinder(4, 8).add(circularPattern(arm, n));
const a = (phi * Math.PI) / 180;
const pin = cylinder(4, 1).translate(30 * Math.cos(a), 30 * Math.sin(a), 0);
return [{ name: "Rotor", shape: rotor, color: "#5b6b7a" }, { name: "Stop", shape: pin, color: "#e07a5f" }];
