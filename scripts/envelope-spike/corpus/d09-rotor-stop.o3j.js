// Seeded envelope defect D09 (integer values inside the range): a hub with N radial arms and
// a fixed stop pin at an angle. Two parts. An arm hits the pin only for some arm counts at
// some pin angles. Original test part for the Open3DJ envelope spike, MIT. Units are mm, Z is up.
const n = Param.number("Arms", 6, { min: 3, max: 12, integer: true });
const phi = Param.number("Pin angle", 100, { min: 66, max: 114, unit: "deg" });
const len = Param.number("Arm length", 36, { min: 32, max: 40, unit: "mm" });
const arm = box(len, 3, 4).translate(len / 2, 0, 0);
const rotor = cylinder(4, 8).add(circularPattern(arm, n));
const a = (phi * Math.PI) / 180;
const pin = cylinder(4, 1).translate(30 * Math.cos(a), 30 * Math.sin(a), 0);
return [{ name: "Rotor", shape: rotor, color: "#5b6b7a" }, { name: "Stop", shape: pin, color: "#e07a5f" }];
