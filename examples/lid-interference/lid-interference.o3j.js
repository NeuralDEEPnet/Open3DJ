// NEGATIVE TEST: the box-with-lid design with a lip 0.3 mm wider than the cavity on each
// side. The fit check must report the lid and base as a clash, and the run must end with
// status "warning". Units are mm, Z is up.
const W = Param.number("Width", 70, { min: 40, max: 150, unit: "mm" });
const D = Param.number("Depth", 50, { min: 30, max: 120, unit: "mm" });
const H = Param.number("Height", 30, { min: 15, max: 80, unit: "mm" });
const gap = Param.number("Clearance", -0.3, { min: -1, max: 1, unit: "mm" });
const wall = 2, lidT = 3, lipH = 4, lipT = 1.6;

const base = roundedRect(W, D, 4).extrude(H).shell(wall)
  .withConnectors({ rim: connector.female("lid", { origin: [0, 0, H], axis: [0, 0, 1], up: [1, 0, 0] }) });

// The lid is built upside down from its seat: plate above Z = 0, lip below it.
const lipW = W - 2 * wall - 2 * gap, lipD = D - 2 * wall - 2 * gap, lipR = 2 - gap;
const lip = roundedRect(lipW, lipD, lipR).subtract(roundedRect(lipW - 2 * lipT, lipD - 2 * lipT, Math.max(lipR - lipT, 0.4)))
  .extrude(lipH).translateZ(-lipH);
const lid = roundedRect(W, D, 4).extrude(lidT).add(lip)
  .withConnectors({ seat: connector.male("lid", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(base, "seat", "rim");

return [{ name: "Base", shape: base, color: "#5b6b7a" }, { name: "Lid", shape: lid, color: "#00a6d6" }];
