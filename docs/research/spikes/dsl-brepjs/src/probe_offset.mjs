import { createRuntime } from "./dsl.mjs";
const rt = await createRuntime(process.argv[2]); const B = rt.B;
for (const [label, d] of [["ngon6 r30", B.drawPolysides(30, 6)], ["pen hexagon", null]]) {
  let dr = d;
  if (!dr) { let p = B.draw([30*Math.cos(Math.PI/2), 30*Math.sin(Math.PI/2)]); for (let i=1;i<6;i++){const a=Math.PI/2+i*Math.PI/3; p=p.lineTo([30*Math.cos(a),30*Math.sin(a)]);} dr = p.close(); }
  for (const off of [-2, 2]) {
    const o = dr.clone().offset(off);
    const s = o.sketchOnPlane("XY").extrude(1);
    const verts = B.getVertices(s).map(v => B.vertexPosition(v)).filter(p => p[2] < 0.5).map(p => `(${p[0].toFixed(3)},${p[1].toFixed(3)})`);
    const types = B.getEdges(s).map(e => B.getCurveType(e));
    const cnt = types.reduce((m,t)=>(m[t]=(m[t]||0)+1,m),{});
    console.log(label, "offset", off, "vol", B.unwrap(B.measureVolume(s)).toFixed(4), "edges", JSON.stringify(cnt), "bottom verts", verts.join(" "));
  }
}
const ri = 30*Math.cos(Math.PI/6);
console.log("expected inward area", (2*Math.sqrt(3)*(ri-2)**2).toFixed(4), "outward sharp", (2*Math.sqrt(3)*(ri+2)**2).toFixed(4), "outward rounded", (2*Math.sqrt(3)*ri*ri + 6*30*2 + Math.PI*4).toFixed(4));
