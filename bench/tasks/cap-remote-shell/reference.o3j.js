// Reference solution for cap-remote-shell: a 150 x 45 x 20 mm remote shell in two halves
// split at Z = 12, a battery door recessed into the floor with a 0.3 mm gap all round, and
// two AAA cells (10.5 x 44.5 mm) resting on the floor ledges 0.5 mm above the door.
// Original, MIT. Units are mm, Z is up.
const L = 150, W = 45, r = 8, wall = 2, split = 12, H = 20;
const doorL = 40, doorW = 26, doorT = 1.5, gap = 0.3, bayX = 35;

// Bottom half: an open tray with a door opening in the floor under the battery bay.
const bottom = roundedRect(L, W, r).extrude(split).shell(wall)
  .subtract(roundedRect(doorL + 2 * gap, doorW + 2 * gap, 2 + gap).extrude(wall + 2).translate(bayX, 0, -1));
// Top half: the same tray turned over, with six button holes.
const buttons = [-50, -35, -20].flatMap((x) => [-8, 8].map((y) => cylinder(wall + 2, 3.5).translate(x, y, H - wall - 1)));
const top = roundedRect(L, W, r).extrude(H - split).shell(wall).rotateX(180).translateZ(H).subtract(buttons);

// The door fills the opening, 1.5 mm thick, flush with the underside.
const door = roundedRect(doorL, doorW, 2).extrude(doorT);
// Cells lie along X on the floor ledges at both ends of the opening.
const cellR = 5.25, cellL = 44.5;
const cell = cylinder(cellL, cellR).pointAlong([1, 0, 0]).translate(bayX - cellL / 2, 0, wall + cellR);
return [
  { name: "Bottom", shape: bottom, color: "#2b2d42" },
  { name: "Top", shape: top, color: "#8d99ae" },
  { name: "Door", shape: door.translate(bayX, 0, 0), color: "#2b2d42" },
  { name: "Cell", shape: cell.clone().translateY(-5.5), color: "#d90429" },
  { name: "Cell", shape: cell.clone().translateY(5.5), color: "#d90429" },
];
