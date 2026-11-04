// Reference solution for cap-pi5-case: a base tray and a vented lid around a Raspberry Pi 5
// board (85 x 56 x 1.6 mm, 2.7 mm holes on a 58 x 49 mm rectangle 3.5 mm in from the edges),
// held on four M2.5 hex standoffs 6 mm tall whose pins pass through the board holes.
// Original, MIT. Units are mm, Z is up.
const bw = 85, bd = 56, bt = 1.6, margin = 3, wall = 2, floor = 2, above = 20, lidT = 2;
const W = bw + 2 * (margin + wall), D = bd + 2 * (margin + wall);
const standoffH = 6, boardZ = floor + standoffH, H = Math.ceil(boardZ + bt + above);

// Hole centres relative to the board centre: 3.5 mm in from the left and the long edges.
const holes = [[0, 0], [58, 0], [0, 49], [58, 49]].map(([x, y]) => [-bw / 2 + 3.5 + x, -bd / 2 + 3.5 + y]);

const base = roundedRect(W, D, 4).extrude(H).shell(wall);
const slots = [-30, -18, -6, 6, 18, 30].map((x) => slot(36, 4).rotate(90).extrude(lidT + 2).translate(x, 0, -1));
const lid = roundedRect(W, D, 4).extrude(lidT).subtract(slots).translateZ(H);

const board = box(bw, bd, bt).subtract(holes.map(([x, y]) => cylinder(bt + 2, 1.35).translate(x, y, -1))).translateZ(boardZ);
// Hex standoff with an M2.5 pin on top that passes through the board hole (0.1 mm clear).
const standoff = ngon(6, 2.5 / Math.cos(Math.PI / 6)).extrude(standoffH).add(cylinder(bt, 1.25).translateZ(standoffH));
const standoffs = holes.slice(0, 3).map( /* MUTANT: one standoff is missing */ ([x, y]) => ({ name: "Standoff", shape: standoff.clone().translate(x, y, floor), color: "#c9a227" }));

return [
  { name: "Base", shape: base, color: "#264653" },
  { name: "Lid", shape: lid, color: "#2a9d8f" },
  { name: "PCB", shape: board, color: "#1b4332" },
  ...standoffs,
];
