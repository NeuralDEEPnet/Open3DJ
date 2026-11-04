// Bolt flange: a disc with a raised hub, a centre bore, a circular pattern of M6 clearance
// holes and chamfered hub edges. One part. Units are mm, Z is up.
const D = Param.number("Diameter", 80, { min: 50, max: 160, unit: "mm" });
const T = Param.number("Thickness", 8, { min: 4, max: 20, unit: "mm" });
const count = Param.number("Bolt holes", 6, { min: 3, max: 12, integer: true });
const hubH = 12, hubR = 16, boreR = 10;

const disc = cylinder(T, D / 2);
const hub = cylinder(T + hubH, hubR);
const bore = cylinder(T + hubH + 2, boreR).translateZ(-1);
const hole = lib.clearanceHole("M6", { length: T + 2 }).translate((D / 2 + hubR) / 2 + 2, 0, T + 1);
const body = disc.add(hub).subtract(bore, circularPattern(hole, count));

// Break the two circular edges on top of the hub: its outer rim and the bore.
return chamfer(body, 1, { atZ: T + hubH }).name("Flange").color("#8a8f98");
