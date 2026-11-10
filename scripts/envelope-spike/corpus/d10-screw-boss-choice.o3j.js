// Seeded envelope defect D10 (one choice fails with a small size): a plate with a boss and a
// heat-set pocket for the chosen screw. The large sizes leave a thin boss wall or a thin
// floor under the pocket. Original test part for the Open3DJ envelope spike, MIT. Units are mm,
// Z is up.
const screw = Param.choice("Screw", "M3", ["M2.5", "M3", "M4", "M5", "M6"]);
const Rb = Param.number("Boss radius", 5, { min: 4, max: 8, unit: "mm" });
const Hb = Param.number("Boss height", 12, { min: 8, max: 20, unit: "mm" });
const plate = box(30, 30, 3);
const boss = cylinder(Hb, Rb).translateZ(3);
const pocket = lib.heatSetPocket(screw).translate(0, 0, Hb + 3);
return plate.add(boss).subtract(pocket).name("Boss plate").color("#5b6b7a");
