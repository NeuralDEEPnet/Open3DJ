// Pegboard hook: a back plate with two pegs on a 25.4 mm pitch for 1/4 inch pegboard, and a
// straight arm with an upturned tip, all one part with rounded arm edges. Original part for
// o3dj-bench, MIT. Units are mm, Z is up; the board face is the plane Y = 0.
const reach = Param.number("Reach", 50, /* MUTANT: the arm is 10 mm short */ { min: 30, max: 120, unit: "mm" });
const plateW = 20, plateH = 50, plateT = 5, pegR = 2.9, pegL = 8, pitch = 25.4;

// Back plate in front of the board (Y from 0 to plateT), pegs going into the board (-Y).
const plate = box(plateW, plateT, plateH).translate(0, plateT / 2, 0);
const peg = cylinder(pegL, pegR).pointAlong([0, -1, 0]);
const pegs = [plateH - 8, plateH - 8 - pitch].map((z) => peg.clone().translate(0, 0, z));

// The arm leaves the plate 10 mm above its base and ends in a 15 mm tall tip.
const arm = box(8, reach, 6).translate(0, plateT + reach / 2, 10);
const tip = box(8, 6, 15).translate(0, plateT + reach - 3, 10);
const hook = plate.add(pegs, arm, tip);
return fillet(hook, 1, { parallel: [0, 1, 0], minLength: reach - 7 }).name("Hook").color("#e76f51");
