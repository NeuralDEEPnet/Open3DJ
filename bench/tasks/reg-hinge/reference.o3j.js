// Butt hinge: two leaves with alternating knuckles and a pin along X. Knuckles clear each
// other by 0.4 mm and the pin clears its hole by 0.2 mm, so the fit check reports
// clearances only. Each leaf has two countersunk M3 holes. Units are mm, Z is up.
const L = Param.number("Length", 60, { min: 30, max: 120, unit: "mm" });
const knuckles = Param.number("Knuckles", 5, { min: 3, max: 9, integer: true });
const leafW = 20, t = 2.5, rK = 4, rPin = 1.5, rHole = 1.7, gap = 0.4;
const seg = L / knuckles;

// A cylinder along X from x0 to x1, centred on the hinge axis (Y = 0, Z = 0).
const rodX = (r, x0, x1) => cylinder(x1 - x0, r).pointAlong([1, 0, 0]).translateX(x0);

function leaf(side) {
  const plate = box(L, leafW - rK - gap, t).translate(0, side * (rK + gap + (leafW - rK - gap) / 2), -t / 2);
  const parts = [];
  for (let i = side < 0 ? 0 : 1; i < knuckles; i += 2) {
    const x0 = -L / 2 + i * seg + gap / 2, x1 = -L / 2 + (i + 1) * seg - gap / 2;
    parts.push(rodX(rK, x0, x1), box(x1 - x0, rK + gap, t).translate((x0 + x1) / 2, side * (rK + gap) / 2, -t / 2));
  }
  const holes = [-1, 1].map((s) => lib.screwCutter("M3", { head: "countersunk", length: t + 1 }).translate(s * L * 0.3, side * 13, t / 2));
  return plate.add(parts).subtract(rodX(rHole, -L / 2 - 1, L / 2 + 1), holes);
}

const pin = rodX(rPin, -L / 2, L / 2);
return [
  { name: "Leaf A", shape: leaf(-1), color: "#b08d57" },
  { name: "Leaf B", shape: leaf(1), color: "#c9a66b" },
  { name: "Pin", shape: pin, color: "#6c757d" },
];
