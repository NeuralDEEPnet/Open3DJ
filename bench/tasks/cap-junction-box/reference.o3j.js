// Reference solution for cap-junction-box: a 100 x 100 x 60 mm wall box with corner bosses
// and M4 heat-set pockets, a mounting flange with four 5 mm holes, a 4 mm lid and four
// M4 x 12 socket head screws resting on the lid. Original, MIT. Units are mm, Z is up; the
// wall is the plane Z = 0.
const S = 100, H = 60, wall = 2.5, floor = 3, lidT = 4, inset = 8, r = 6;
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * (S / 2 - inset), sy * (S / 2 - inset)]);

const shellBody = roundedRect(S, S, r).extrude(H)
  .subtract(roundedRect(S - 2 * wall, S - 2 * wall, r - wall).extrude(H).translateZ(floor));
const bosses = corners.map(([x, y]) => cylinder(H - floor, 5.5).translate(x, y, floor));
const pockets = corners.map(([x, y]) => lib.heatSetPocket("M4").translate(x, y, H));
const flange = roundedRect(S + 40, 60, 4).extrude(4)
  .subtract([-1, 1].flatMap((s) => [-15, 15].map((y) => cylinder(6, 2.5).translate(s * (S / 2 + 10), y, -1))));
const box_ = shellBody.add(bosses, flange).subtract(pockets);

const lid = roundedRect(S, S, r).extrude(lidT)
  .subtract(corners.map(([x, y]) => lib.clearanceHole("M4", { length: lidT + 1 }).translate(x, y, lidT)))
  .translateZ(H);
// lib.bolt puts the head above Z = 0, so Z = 0 goes on the lid top.
const screw = lib.bolt("M4", 12);
const screws = corners.map(([x, y]) => ({ name: "Screw", shape: screw.clone().translate(x, y, H + lidT), color: "#202020" }));

return [{ name: "Box", shape: box_, color: "#6c757d" }, { name: "Lid", shape: lid, color: "#adb5bd" }, ...screws];
