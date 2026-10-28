// Tapered cup: a loft from a 60 mm circle at the base to a 76 mm circle at the rim. The
// cavity is a second loft whose radius is one wall smaller at every height, so the side
// wall is 2.5 mm wide measured across. The base edge is rounded. Units are mm, Z is up.
const H = Param.number("Height", 70, { min: 30, max: 120, unit: "mm" });
const wall = Param.number("Wall", 2.5, { min: 1.2, max: 5, unit: "mm" });
const r0 = 30, r1 = 38;
const radiusAt = (z) => r0 + ((r1 - r0) * z) / H;

const outer = circle2d(r0).loftTo(circle2d(r1), H);
// The cavity starts one wall above the base and runs 1 mm past the rim to cut it open.
const cavity = circle2d(radiusAt(wall) - wall).loftTo(circle2d(radiusAt(wall) - wall), H + 1 - wall).translateZ(wall); // MUTANT: a straight cavity, so the wall thickens towards the rim
const cup = fillet(outer, 3, { atZ: 0 }).subtract(cavity);
return cup.name("Cup").color("#e07a5f");
