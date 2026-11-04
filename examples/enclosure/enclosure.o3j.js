// Electronics enclosure: a base with corner bosses, M3 heat-set pockets and a cable hole;
// a lid with counterbored holes, seated on the rim by connectors; and four M3 x 6 socket
// head screws from lib, as clones of one screw. The screws end inside the pockets, so the
// fit check finds contacts and clearances but no clash. Units are mm, Z is up.
const W = Param.number("Width", 100, { min: 60, max: 180, unit: "mm" });
const D = Param.number("Depth", 70, { min: 50, max: 140, unit: "mm" });
const H = Param.number("Height", 32, { min: 20, max: 80, unit: "mm" });
const wall = 2.4, floor = 2.4, lidT = 4, inset = 6.5;
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * (W / 2 - inset), sy * (D / 2 - inset)]);

const shellBody = roundedRect(W, D, 5).extrude(H)
  .subtract(roundedRect(W - 2 * wall, D - 2 * wall, 2.6).extrude(H).translateZ(floor));
const bosses = corners.map(([x, y]) => cylinder(H - floor, 4.5).translate(x, y, floor));
const pockets = corners.map(([x, y]) => lib.heatSetPocket("M3").translate(x, y, H));
const cableHole = cylinder(10, 4).pointAlong([1, 0, 0]).translate(-W / 2 - 1, 0, 14);
const base = shellBody.add(bosses).subtract(pockets, cableHole)
  .withConnectors({ rim: connector.female("lid", { origin: [0, 0, H], axis: [0, 0, 1], up: [1, 0, 0] }) });

// Counterbores sink the screw heads 3 mm into the 4 mm lid.
const bores = corners.map(([x, y]) => lib.screwCutter("M3", { head: "socket", length: lidT + 1 }).translate(x, y, lidT));
const lid = roundedRect(W, D, 5).extrude(lidT).subtract(bores)
  .withConnectors({ seat: connector.male("lid", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(base, "seat", "rim");

// lib.bolt puts the head above Z = 0, so Z = 0 goes on the counterbore floor.
const screw = lib.bolt("M3", 6);
const headSeatZ = H + lidT - lib.fastener("M3").socketHead.k;
const screws = corners.map(([x, y]) => ({ name: "Screw", shape: screw.clone().translate(x, y, headSeatZ), color: "#202020" }));

return [{ name: "Base", shape: base, color: "#5b6b7a" }, { name: "Lid", shape: lid, color: "#a8dadc" }, ...screws];
