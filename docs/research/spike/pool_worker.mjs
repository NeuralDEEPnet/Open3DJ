import { parentPort, workerData } from "node:worker_threads";
const { OcctKernel } = await import(`file://${workerData.deps}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init({ print: () => {}, printErr: () => {} }).catch(() => OcctKernel.init());
parentPort.on("message", ({ n, seed }) => {
  const t = performance.now(); let vol = 0;
  for (let i = 0; i < n; i++) {
    const mark = k.checkpoint ? k.checkpoint() : null;
    const w = 60 + ((seed + i) % 20);
    const box = k.makeBox(w, 50, 30);
    let p = k.fillet(box, k.getSubShapes(box, "edge"), 2);
    p = k.cutAll(p, [[6, 6], [w - 6, 6], [6, 44], [w - 6, 44]].map(([x, y]) => k.translate(k.makeCylinder(1.7, 40), x, y, -4)));
    p = k.fuse(p, k.translate(k.makeCylinder(8, 8), w / 2, 25, 30));
    vol += k.getVolume(p);
    if (mark !== null && k.releaseSince) k.releaseSince(mark); else k.releaseAll?.();
  }
  parentPort.postMessage({ ms: performance.now() - t, vol });
});
parentPort.postMessage({ ready: true });
