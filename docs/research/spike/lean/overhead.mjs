import { performance } from "node:perf_hooks";
const DEPS = process.argv[2];
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const { getQuickJS } = await import(`file://${DEPS}/node_modules/quickjs-emscripten/dist/index.mjs`);
const k = await OcctKernel.init(); const QuickJS = await getQuickJS();
const b = k.makeBox(1,2,3);
let t = performance.now(); for (let i=0;i<10000;i++) k.getVolume(b); const direct = performance.now()-t;
const vm = QuickJS.newContext();
const f = vm.newFunction("vol", (h) => vm.newNumber(k.getVolume(vm.getNumber(h)))); vm.setProp(vm.global, "vol", f); f.dispose();
t = performance.now(); const r = vm.evalCode(`let s=0; for(let i=0;i<10000;i++) s+=vol(${b}); s`); const viaQjs = performance.now()-t;
r.value?.dispose(); vm.dispose();
// sequential cuts direct in Node, to separate kernel cost from membrane cost
t = performance.now(); let p = k.makeBox(200,200,10);
for (let i=0;i<10;i++) for (let j=0;j<10;j++) p = k.cut(p, k.translate(k.makeCylinder(3,20), 10+20*i, 10+20*j, -5));
const seq = performance.now()-t;
console.log(JSON.stringify({ direct_10k_ms: +direct.toFixed(1), quickjs_10k_ms: +viaQjs.toFixed(1), per_call_overhead_us: +(((viaQjs-direct)/10000)*1000).toFixed(1), sequential_100_cuts_direct_ms: +seq.toFixed(0) }));
