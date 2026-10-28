import { readFileSync, writeFileSync } from "node:fs";
const [DEPS, OUT] = process.argv.slice(2);
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init();
const back = k.importXCAFFromSTEP(readFileSync(`${OUT}/enclosure-assembly.step`, "utf8"));
const root = back.getRoots()[0];
const rows = back.getChildren(root).map(c => { const li = back.getLabelInfo(c); const ref = back.getReferredLabel(c); const ri = back.getLabelInfo(ref); return { component: li.name, prototype: ri.name, prototypeLabel: ref, colorOnComponent: li.hasColor, colorOnPrototype: ri.hasColor, rgb: ri.hasColor ? ri.color.map(v => +v.toFixed(2)) : li.hasColor ? li.color.map(v=>+v.toFixed(2)) : null }; });
console.log(JSON.stringify(rows));
// render whole assembly: compound of placed shapes
const shapes = back.getChildren(root).map(c => { const li = back.getLabelInfo(c); return li.shapeHandle ?? null; }).filter(Boolean);
const comp = k.makeCompound(shapes);
writeFileSync(`${OUT}/enclosure-assembly.png`, await k.toMultiviewPNG(comp));
console.log("rendered", shapes.length, "shapes");
