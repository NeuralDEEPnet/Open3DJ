// Realistic agent script: rounded box, four bolt holes in one batch, a boss on top.
const w = Param.number("width", 80, { min: 20, max: 300 });
const d = Param.number("depth", 60, { min: 20, max: 300 });
const h = Param.number("height", 32, { min: 5, max: 200 });
let body = fillet(box(w, d, h), 3);
const holes = [[-32, -22], [32, -22], [-32, 22], [32, 22]].map(([x, y]) => cylinder(40, 1.7).translate(x, y, -4));
body = body.subtract(holes);
const boss = cylinder(10, 10).translate(0, 0, h);
return { name: "enclosure", shape: body.add(boss), color: "#8899aa" };
