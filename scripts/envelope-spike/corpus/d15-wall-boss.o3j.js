// Seeded envelope defect D15 (a boss pocket through the wall): a wall plate with a boss on its
// outside face and a pocket drilled into the boss towards the wall. A deep pocket in a short
// boss on a thin wall leaves a thin skin, then breaks through. Original test part for the
// Open3DJ envelope spike, MIT. Units are mm, Z is up.
const t = Param.number("Wall", 3, { min: 2, max: 6, unit: "mm" });
const hb = Param.number("Boss length", 8, { min: 4, max: 12, unit: "mm" });
const depth = Param.number("Pocket depth", 6, { min: 4, max: 10, unit: "mm" });
const wall = box(40, t, 40).translate(0, t / 2, 0);
const boss = cylinder(hb, 5).pointAlong([0, -1, 0]).translate(0, 0, 20);
const pocket = cylinder(depth + 1, 2).pointAlong([0, 1, 0]).translate(0, -hb - 1, 20);
return wall.add(boss).subtract(pocket).name("Wall").color("#5b6b7a");
