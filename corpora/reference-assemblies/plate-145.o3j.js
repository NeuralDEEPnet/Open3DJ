// Reference assembly: the 145-occurrence plate. A 120 x 120 x 6 mm plate with a 12 x 12 grid
// of M3 clearance holes on a 10 mm pitch, and 144 M3 x 10 socket head screws from lib.bolt, as
// clones of one screw: 145 occurrences of 2 definitions. By default the first two screws are
// sunk 0.5 mm too deep, so their heads cut into the plate (the seeded fits of ASSEMBLIES.md
// section 15): the fit check must report exactly those two as clashes and every other screw
// as a contact, head on the plate. Set "Sunk screws" to 0 for a clean plate. Timing corpus for
// S2 (viewer frame time), S3 and S7a. Original, MIT. Units are mm, Z is up.
const n = Param.number("Grid", 12, { min: 2, max: 12, integer: true });
const pitch = Param.number("Pitch", 10, { min: 8, max: 20, unit: "mm" });
const sunk = Param.number("Sunk screws", 2, { min: 0, max: 4, integer: true });
const T = 6, margin = 5;
const size = (n - 1) * pitch + 2 * margin;

const at = [];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) at.push([(i - (n - 1) / 2) * pitch, (j - (n - 1) / 2) * pitch]);

const holes = at.map(([x, y]) => lib.clearanceHole("M3", { length: T + 1 }).translate(x, y, T));
const plate = box(size, size, T).subtract(holes);

// lib.bolt puts the head above Z = 0, so each screw head rests on the plate top at Z = T.
// The sunk screws are the first ones in the grid (screw#1, screw#2), so they are easy to find.
const screw = lib.bolt("M3", 10);
const screws = at.map(([x, y], k) => ({ name: "Screw", shape: screw.clone().translate(x, y, T - (k < sunk ? 0.5 : 0)), color: "#202020" }));

return [{ name: "Plate", shape: plate, color: "#8a8f98" }, ...screws];
