const DEPS = process.argv[2];
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init();
const tr=(s,x,y,z)=>k.translate(s,x,y,z);
let b = k.fuse(k.makeBox(100,60,8), tr(k.makeBox(100,8,50),0,0,8));
const holes=[]; for (const x of [15,85]) for (const y of [25,45]) holes.push(tr(k.makeCylinder(3,30),x,y,-5));
let s = k.getSubShapes(k.cutAll(b, holes),"solid")[0];
const edges = k.getSubShapes(s,"edge");
try { const f = k.fillet(s, edges, 1.0); console.log(JSON.stringify({ok:true, edges:edges.length, vol:k.getVolume(f)})); }
catch(e){ console.log(JSON.stringify({ok:false, edges:edges.length, code:e.code, msg:e.message, faulty:e.faultyEdges?.length})); }
console.log(JSON.stringify({aliveAfter: k.getVolume(k.makeBox(1,1,1))}));
