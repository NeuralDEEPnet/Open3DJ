// Reference solution for cap-light-pipe-box: a 60 x 40 x 25 mm box with a 50 x 30 x 1.6 mm
// board on four bosses, three 3 x 3 x 1.5 mm LEDs 10 mm apart, and three 3 mm light pipes
// through 3.3 mm holes in the lid, flush with its top and 0.3 mm above the LEDs.
// Original, MIT. Units are mm, Z is up.
const W = 60, D = 40, H = 22, lidT = 3, wall = 2, floor = 2, bossH = 6;
const boardZ = floor + bossH, bt = 1.6, ledH = 1.5, pipeR = 1.5, holeR = 1.65, gap = 0.3;
const xs = [-10, 0, 10];

const bosses = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => cylinder(bossH, 3).translate(sx * 21, sy * 11, floor));
const base = roundedRect(W, D, 3).extrude(H).shell(wall).add(bosses);
const lid = roundedRect(W, D, 3).extrude(lidT).subtract(xs.map((x) => cylinder(lidT + 2, holeR).translate(x, 0, -1))).translateZ(H);
const board = box(50, 30, bt).translateZ(boardZ);
const led = box(3, 3, ledH);
const pipeZ = boardZ + bt + ledH + gap;
const pipe = cylinder(H + lidT - pipeZ, pipeR);
return [
  { name: "Base", shape: base, color: "#343a40" },
  { name: "Lid", shape: lid, color: "#6c757d" },
  { name: "Board", shape: board, color: "#1b4332" },
  ...xs.map((x) => ({ name: "LED", shape: led.clone().translate(x, 0, boardZ + bt), color: "#ffbe0b" })),
  ...xs.map((x) => ({ name: "Pipe", shape: pipe.clone().translate(x, 0, pipeZ), color: "#e0fbfc" })),
];
