// Reference solution for cap-sensor-pod: a round pod 50 mm across and 25 mm tall with a
// groove inside the rim, a snap lid whose skirt bead sits in the groove with 0.2 mm or more
// clearance, and a 40 mm sensor board on three ribs. Original, MIT. Units are mm, Z is up.
const R = 25, H = 25, wall = 2, floor = 2, lidT = 2, skirtH = 5, gap = 0.2;
const innerR = R - wall;

const cup = cylinder(H, R).subtract(cylinder(H, innerR).translateZ(floor));
const groove = torus(innerR, 0.8).translateZ(H - 3);
const ribs = circularPattern(box(4.5, 3, 8).translate(innerR - 2, 0, floor), 3, { startDeg: 90 });
const base = cup.add(ribs).subtract(groove);

// The lid: a disc resting on the rim and a skirt inside the wall with a bead on its outside.
const skirtR = innerR - gap;
const skirt = cylinder(skirtH, skirtR).subtract(cylinder(skirtH + 2, skirtR - 1.4).translateZ(-1)).translateZ(H - skirtH);
const bead = torus(skirtR, 1.2) /* MUTANT: the bead is larger than the groove */.translateZ(H - 3);
const lid = cylinder(lidT, R).translateZ(H).add(skirt, bead);

const board = cylinder(1.6, 20).translateZ(floor + 8);
return [
  { name: "Base", shape: base, color: "#f4a261" },
  { name: "Lid", shape: lid, color: "#e9c46a" },
  { name: "Board", shape: board, color: "#1b4332" },
];
