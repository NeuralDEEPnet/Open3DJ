import { readFileSync } from "node:fs";
import { createRuntime } from "./dsl.mjs";
const [DEPS, DIR] = process.argv.slice(2);
const PI = Math.PI;
// 1. bolt-flange: minLength semantics
for (const mode of ["curve", "extent"]) {
  const rt = await createRuntime(DEPS, { edgeLengthMode: mode });
  const { parts } = rt.run(readFileSync(`${DIR}/bolt-flange.js`, "utf8"));
  const sel = rt.selectEdges(rt.run(readFileSync(`${DIR}/bolt-flange.js`, "utf8").replace(/if \(chamferSize > 0\)[\s\S]*?\n}\n/, "")).parts[0].shape, { atZ: 8, minLength: 45 });
  console.log(`bolt-flange minLength mode=${mode}: V=${parts[0].shape.volume().toFixed(3)} chamfered edges=${sel.length} lens=${sel.map(e => rt.B.curveLength(e).toFixed(1)).join(",")}`);
  if (mode === "curve") {
    const disc = PI * 45 * 45 * 8, bore = PI * 225 * 8, holes = 6 * PI * 3.2 * 3.2 * 8;
    const rim = 0.5 * 1 * 1 * 2 * PI * (45 - 1 / 3), boreCh = 0.5 * 2 * PI * (15 + 1 / 3);
    console.log(`  analytic: no chamfer ${(disc - bore - holes).toFixed(3)}; rim only ${(disc - bore - holes - rim).toFixed(3)}; rim+bore ${(disc - bore - holes - rim - boreCh).toFixed(3)}`);
  }
  // 2. planetary carrier solids
  if (mode === "curve") {
    const res = rt.run(readFileSync(`${DIR}/planetary-reducer.js`, "utf8"));
    const carrier = res.parts.find(p => p.name === "Planet Carrier Hub").shape;
    const solids = rt.B.getSolids(carrier.v);
    for (const s of solids) { const b = rt.B.getBounds(s); console.log(`  carrier solid V=${rt.B.unwrap(rt.B.measureVolume(s)).toFixed(3)} z ${b.zMin.toFixed(2)}..${b.zMax.toFixed(2)} x ${b.xMin.toFixed(2)}..${b.xMax.toFixed(2)}`); }
  }
}
// 3. tapered cup analytic
const fr = (h, a, b) => PI * h / 3 * (a * a + a * b + b * b);
console.log(`tapered-cup analytic ${(fr(80, 25, 35) - fr(75, 22, 32)).toFixed(3)}`);
