// Spur gear blank: a 20-tooth gear with straight-sided teeth on a root disc, a raised hub, an
// 8 mm bore with a 3 mm keyway and four lightening holes. Not an involute gear: a blank for
// testing patterns and booleans. Original part for o3dj-bench, MIT. Units are mm, Z is up.
const teeth = Param.number("Teeth", 20, { min: 8, max: 60, integer: true });
const rootR = 24, toothH = 3, toothW = 3, T = 6, hubR = 9, hubH = 4, boreR = 4;

const disc = cylinder(T, rootR);
// One tooth overlaps the root disc by 0.5 mm, so the union is clean.
const tooth = box(toothH + 0.5, toothW, T).translate(rootR + toothH / 2 - 0.25, 0, 0);
const hub = cylinder(T + hubH, hubR);
const bore = cylinder(T + hubH + 2, boreR).translateZ(-1);
const keyway = box(3, 3, T + hubH + 2).translate(boreR, 0, -1);
const lightening = circularPattern(cylinder(T + 2, 3.5).translate(16, 0, -1), 4, { startDeg: 45 });
const gear = disc.add(circularPattern(tooth, teeth), hub).subtract(bore, keyway, lightening);
return gear.name("Gear").color("#457b9d");
