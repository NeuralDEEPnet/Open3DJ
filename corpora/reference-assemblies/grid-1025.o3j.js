// Reference assembly: a generated assembly of 1,025 occurrences. A base plate carries a
// 32 x 32 grid of small parts that cycle through a few definitions (pin, block, hex post,
// cone), placed as clones, so the assembly is 1,025 occurrences of Kinds + 1 definitions.
// "Lift" raises the parts above the plate: at the default 1 mm every part is clear of the
// plate by more than the 0.5 mm watch distance, so the fit check runs only its AABB filter
// (the broad phase). Set Lift to 0 to seat every part on the plate and get 1,024 contacts
// for the exact tier. Timing corpus for S3, S4 (H1) and S7a (H2). Original, MIT. Units are mm,
// Z is up.
const n = Param.number("Grid", 32, { min: 4, max: 40, integer: true });
const kinds = Param.number("Kinds", 4, { min: 1, max: 50, integer: true });
const lift = Param.number("Lift", 1, { min: 0, max: 10, unit: "mm" });
const pitch = 6, T = 3;
const size = n * pitch;

// Kinds cycle through four shapes; kinds above 4 vary the height, so each is its own definition.
const shapes = [];
for (let k = 0; k < kinds; k++) {
  const h = 4 + Math.floor(k / 4) * 0.5;
  const s = k % 4;
  shapes.push(s === 0 ? cylinder(h, 1.5) : s === 1 ? box(3, 3, h) : s === 2 ? ngon(6, 1.8).extrude(h) : cylinder(h, 2, 0.5));
}

const parts = [{ name: "Plate", shape: box(size, size, T), color: "#8a8f98" }];
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    const k = (i * n + j) % kinds;
    const x = (i - (n - 1) / 2) * pitch, y = (j - (n - 1) / 2) * pitch;
    parts.push({ name: `Kind ${k + 1}`, shape: shapes[k].clone().translate(x, y, T + lift) });
  }
}
return parts;
