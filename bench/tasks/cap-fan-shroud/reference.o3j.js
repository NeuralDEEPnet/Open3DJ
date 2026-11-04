// Reference solution for cap-fan-shroud: a 40 mm fan (40 x 40 x 10 mm) under a shroud with an
// 8 mm flange and a duct lofted from a 37 mm circle to a 20 x 20 mm outlet 30 mm above the
// flange, and four M3 heat-set inserts (3.8 x 5.7 mm) in 4 mm pockets on the fan's 32 mm
// hole square. Original, MIT. Units are mm, Z is up.
const fanS = 40, fanT = 10, holeSq = 32, flangeT = 8, ductH = 30;
const holes = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * holeSq / 2, sy * holeSq / 2]);

const fan = box(fanS, fanS, fanT).subtract(cylinder(fanT + 2, 18.5).translateZ(-1), holes.map(([x, y]) => cylinder(fanT + 2, 1.7).translate(x, y, -1)));
const z0 = fanT + flangeT;
const outer = rect(fanS, fanS).loftTo(rect(24, 24), ductH).translateZ(z0);
const inner = circle2d(18.5).loftTo(rect(20, 20), ductH + 2).translateZ(z0 - 1);
const flange = box(fanS, fanS, flangeT).translateZ(fanT).subtract(cylinder(flangeT + 2, 18.5).translateZ(fanT - 1));
// Pockets open on the flange underside, where the fan screws come in.
const pockets = holes.map(([x, y]) => cylinder(6, 2).translate(x, y, fanT));
const shroud = flange.add(outer).subtract(inner, pockets);

const insert = cylinder(5.7, 1.9);
const inserts = holes.map(([x, y]) => ({ name: "Insert", shape: insert.clone().translate(x, y, fanT), color: "#d4a373" }));
return [{ name: "Shroud", shape: shroud, color: "#495057" }, { name: "Fan", shape: fan, color: "#212529" }, ...inserts];
