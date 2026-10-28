// Call-heavy agent script: plate with a 10x10 grid of holes cut in one batch (~200 host calls).
const n = Param.number("n", 10);
const plate = box(120, 120, 6);
const holes = [];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) holes.push(cylinder(10, 2).translate(-54 + i * 12, -54 + j * 12, -2));
return plate.subtract(holes);
