import { createRuntime } from "./dsl.mjs";
const rt = await createRuntime(process.argv[2]); const B = rt.B;
const sk = B.drawPolysides(30, 6).sketchOnPlane("XY");
const w = sk.wire;
for (const join of [undefined, "arc", "intersection", "tangent"]) {
  try {
    const r = B.offsetWire2D(w, -2, join);
    const ow = B.unwrap(r);
    const f = B.unwrap(B.face(ow));
    const s = B.unwrap(B.extrude(f, [0,0,1]));
    const verts = B.getVertices(s).map(v => B.vertexPosition(v)).filter(p => p[2] < 0.5).map(p => `(${p[0].toFixed(3)},${p[1].toFixed(3)})`);
    console.log("join", join, "vol", B.unwrap(B.measureVolume(s)).toFixed(4), "valid", B.isValid(s), verts.join(" "));
  } catch (e) { console.log("join", join, "ERR", e.message); }
}
const bad = B.drawPolysides(30, 6).offset(-2).sketchOnPlane("XY").extrude(1);
console.log("brepjs Drawing.offset(-2) solid valid:", B.isValid(bad));
