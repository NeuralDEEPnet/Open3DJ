// Reference solution for cap-powerbank-shell: a 75 x 26.6 x 27 mm shell in two halves split
// at Z = 22 around one 18650 cell and a 60 x 22 x 1.6 mm charging board resting on two rails,
// 1.5 mm above the cell, with a USB-C opening in the +X end. Original, MIT. Units are mm.
const L = 82, /* MUTANT: the shell is longer than the 80 mm limit */ W = 26.6, wall = 2, split = 22, H = 27, r = 3;
const cellR = 9.25, cellL = 65, cellZ = wall + cellR;
const bw = 60, bd = 22, bt = 1.6, boardZ = split;

const port = box(6, 9.5, 3.5).translate(L / 2, 0, boardZ + bt + 0.2);
const rails = [-1, 1].map((s) => box(bw, 2, 3).translate(0, s * (W / 2 - wall - 0.75), split - 3));
const bottom = roundedRect(L, W, r).extrude(split).shell(wall).add(rails).subtract(port);
const top = roundedRect(L, W, r).extrude(H - split).shell(wall).rotateX(180).translateZ(H).subtract(port);

const cell = cylinder(cellL, cellR).pointAlong([1, 0, 0]).translate(-cellL / 2, 0, cellZ);
const board = box(bw, bd, bt).translateZ(boardZ);
return [
  { name: "Bottom", shape: bottom, color: "#3a0ca3" },
  { name: "Top", shape: top, color: "#7209b7" },
  { name: "Cell", shape: cell, color: "#4cc9f0" },
  { name: "Board", shape: board, color: "#1b4332" },
];
