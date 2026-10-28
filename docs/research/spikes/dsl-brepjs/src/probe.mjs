const DEPS = process.argv[2];
const B = await import(`file://${DEPS}/node_modules/brepjs/dist/brepjs.js`);
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const kernel = await OcctKernel.init();
B.registerKernel('occt-wasm', B.OcctWasmAdapter.fromKernel(kernel));
const J = (x) => JSON.stringify(x);
const vol = (s) => B.unwrap(B.measureVolume(s)).toFixed(3);
const tryit = (label, f) => { try { console.log(label, f()); } catch (e) { console.log(label, "THROW", e?.message ?? e); } };
const b = B.box(10, 10, 10, { at: [5, 0, 0] });
tryit("mirror default", () => J(B.getBounds(B.mirror(b))));
tryit("mirror normal y", () => J(B.getBounds(B.mirror(b, { normal: [1, 0, 0] }))));
tryit("mirror normal x at 0", () => J(B.getBounds(B.mirror(b, { normal: [1, 0, 0], at: [0, 0, 0] }))));
tryit("rotate default", () => J(B.getBounds(B.rotate(b, 90))));
tryit("rotate axis x", () => J(B.getBounds(B.rotate(b, 90, { axis: [1, 0, 0] }))));
const bb = B.box(20, 20, 10);
const top = B.faceFinder().inDirection('Z').findAll(bb).filter(f => B.faceCenter(f)[2] > 5);
tryit("top faces", () => top.length);
tryit("shell +2", () => { const r = B.shell(bb, top, 2); return r.ok ? vol(r.value) + " " + J(B.getBounds(r.value)) : J(r.error); });
tryit("shell -2", () => { const r = B.shell(bb, top, -2); return r.ok ? vol(r.value) + " " + J(B.getBounds(r.value)) : J(r.error); });
// sketch planes
for (const p of ["XY", "XZ", "YZ"]) tryit("rect on " + p, () => J(B.getBounds(B.drawRectangle(4, 2).translate(10, 5).sketchOnPlane(p).extrude(1))));
// revolve default
tryit("revolve XZ default", () => { const s = B.drawRectangle(4, 2).translate(10, 5).sketchOnPlane("XZ").revolve(); return vol(s) + " " + J(B.getBounds(s)); });
tryit("revolve XZ axis z", () => { const s = B.drawRectangle(4, 2).translate(10, 5).sketchOnPlane("XZ").revolve([0, 0, 1], { origin: [0, 0, 0] }); return vol(s) + " " + J(B.getBounds(s)); });
// pen polygon
tryit("pen polygon", () => { const d = B.draw([0, 0]).lineTo([10, 0]).lineTo([10, 5]).lineTo([0, 5]).close(); return J(d.boundingBox.repr); });
tryit("pen dup pt", () => { const d = B.draw([0, 0]).lineTo([10, 0]).lineTo([10, 0]).lineTo([0, 5]).close(); return J(d.boundingBox.repr); });
tryit("polysides", () => { const d = B.drawPolysides(30, 6); return J(d.boundingBox.repr) + " " + vol(d.sketchOnPlane("XY").extrude(1)); });
tryit("polysides offset", () => { const d = B.drawPolysides(30, 6).offset(-2); return J(d.boundingBox.repr) + " " + vol(d.sketchOnPlane("XY").extrude(1)); });
tryit("circle", () => vol(B.drawCircle(5).sketchOnPlane("XY").extrude(1)));
tryit("twist+scale", () => { const s = B.drawPolysides(30, 6).sketchOnPlane("XY").extrude(120, { twistAngle: 120, extrusionProfile: { profile: "linear", endFactor: 0.7 } }); return vol(s) + " " + J(B.getBounds(s)) + " valid " + B.isValid(s); });
tryit("edge len", () => { const e = B.getEdges(B.cylinder(45, 8)); return e.map(x => B.curveLength(x).toFixed(2) + ":" + B.getCurveType(x)).join(","); });
tryit("solids", () => B.getSolids(B.compound([B.box(1,1,1), B.box(1,1,1,{at:[5,0,0]})])).length);
tryit("linearPattern", () => { const r = B.linearPattern(B.box(1,1,1), [1,0,0], 4, 3); return r.ok ? vol(r.value) + " " + B.getSolids(r.value).length : J(r.error); });
tryit("circularPattern", () => { const r = B.circularPattern(B.cylinder(1,1,{at:[10,0,0]}), [0,0,1], 6); return r.ok ? vol(r.value) + " " + J(B.getBounds(r.value)) : J(r.error); });
