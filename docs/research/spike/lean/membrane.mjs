// Spike: agent script runs in QuickJS-WASM; only handle-based kernel calls cross the membrane.
import { performance } from "node:perf_hooks";
const DEPS = process.argv[2];
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const { getQuickJS, shouldInterruptAfterDeadline } = await import(`file://${DEPS}/node_modules/quickjs-emscripten/dist/index.mjs`);
const k = await OcctKernel.init();
const QuickJS = await getQuickJS();

function runScript(code, { memBytes = 64 << 20, ms = 2000 } = {}) {
  const rt = QuickJS.newRuntime();
  rt.setMemoryLimit(memBytes);
  rt.setMaxStackSize(1 << 20);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
  const vm = rt.newContext();
  let calls = 0;
  const api = vm.newObject();
  const fn = (name, impl) => {
    const h = vm.newFunction(name, (...args) => { calls++; const a = args.map(vm.dump); return vm.newNumber(impl(...a)); });
    vm.setProp(api, name, h); h.dispose();
  };
  fn("box", (x, y, z) => k.makeBox(x, y, z));
  fn("cylinder", (r, h) => k.makeCylinder(r, h));
  fn("translate", (s, x, y, z) => k.translate(s, x, y, z));
  fn("fuse", (a, b) => k.fuse(a, b));
  fn("cut", (a, b) => k.cut(a, b));
  fn("volume", (s) => k.getVolume(s));
  vm.setProp(vm.global, "cad", api); api.dispose();
  const t = performance.now();
  const r = vm.evalCode(code);
  const ms_ = performance.now() - t;
  let out;
  if (r.error) { out = { error: vm.dump(r.error) }; r.error.dispose(); } else { out = { value: vm.dump(r.value) }; r.value.dispose(); }
  vm.dispose(); rt.dispose();
  return { ...out, calls, ms: +ms_.toFixed(2) };
}
const plate = `let p = cad.box(200,200,10);
for (let i=0;i<10;i++) for (let j=0;j<10;j++) p = cad.cut(p, cad.translate(cad.cylinder(3,20), 10+20*i, 10+20*j, -5));
cad.volume(p);`;
const res = {};
res.sequential_100_cuts = runScript(plate, { ms: 60000 });
res.escape_process = runScript(`typeof process + "/" + typeof require + "/" + typeof fetch + "/" + (function(){try{return globalThis.constructor.constructor("return typeof process")()}catch(e){return "blocked:"+e}})()`);
res.infinite_loop = runScript(`while(true){}`, { ms: 500 });
res.alloc_bomb = runScript(`const a=[]; for(;;) a.push(new Array(1e6).fill(1));`, { memBytes: 32 << 20, ms: 5000 });
// call overhead: 10k trivial kernel-free calls through the membrane
const rt2 = { };
res.after_attacks_kernel_ok = k.getVolume(k.makeBox(1,2,3));
console.log(JSON.stringify(res, null, 1));
