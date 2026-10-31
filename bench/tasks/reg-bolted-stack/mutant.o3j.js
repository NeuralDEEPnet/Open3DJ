// Bolted stack: two 40 x 40 mm plates clamped by an M5 x 20 socket head screw, an ISO 7089
// washer under the head and an ISO 4032 nut below. Every part touches the next one, and the
// screw clears the plate holes. Original part for o3dj-bench, MIT. Units are mm, Z is up.
const t1 = 5, t2 = 6, size = 40;
const f = lib.fastener("M5");

// Plate B sits on Z = 0, plate A on top of it; both have an M5 clearance hole on the axis.
const plateB = box(size, size, t2).subtract(cylinder(t2 + 2, 2.25).translateZ(-1)); // MUTANT: a 4.5 mm hole, smaller than the M5 shank
const plateA = box(size, size, t1).subtract(lib.clearanceHole("M5", { length: t1 + 1 }).translateZ(t1)).translateZ(t2);
const top = t1 + t2;

// lib.washer and lib.nut are centred on the origin; move them so they rest on their faces.
const washer = lib.washer("M5");
const wh = washer.bounds().size[2];
const washerAt = washer.translateZ(top + wh / 2);
const nut = lib.nut("M5");
const nh = nut.bounds().size[2];
const nutAt = nut.translateZ(-nh / 2);
// lib.bolt puts the head above Z = 0, so Z = 0 goes on the washer.
const bolt = lib.bolt("M5", 20).translateZ(top + wh);

return [
  { name: "Plate A", shape: plateA, color: "#8a8f98" },
  { name: "Plate B", shape: plateB, color: "#6c757d" },
  { name: "Washer", shape: washerAt, color: "#c0c0c0" },
  { name: "Nut", shape: nutAt, color: "#202020" },
  { name: "Bolt", shape: bolt, color: "#303030" },
];
