import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
const [DEPS, OUT] = process.argv.slice(2);
const { OcctKernel } = await import(`file://${DEPS}/node_modules/occt-wasm/dist/index.js`);
const k = await OcctKernel.init();
const t0 = performance.now();
// Part definitions
const W = 80, Dp = 60, H = 30, wall = 2.4;
const outer = k.makeBox(W, Dp, H);
let base = k.cut(k.fillet(outer, k.getSubShapes(outer, "edge").slice(0, 4), 3), k.translate(k.makeBox(W - 2 * wall, Dp - 2 * wall, H), wall, wall, wall));
const lidBlank = k.makeBox(W, Dp, 3);
const holesXY = [[6, 6], [W - 6, 6], [6, Dp - 6], [W - 6, Dp - 6]];
let lid = k.cutAll(lidBlank, holesXY.map(([x, y]) => k.translate(k.makeCylinder(1.7, 10), x, y, -2)));
const screw = k.fuse(k.makeCylinder(1.5, 12), k.translate(k.makeCylinder(2.75, 2), 0, 0, 12)); // M3-ish placeholder, head up
// Assembly document: root assembly with base, lid, and 4 instances of one screw definition
const doc = k.createXCAFDocument();
const root = doc.addShape(base, { name: "Enclosure base", color: [0.36, 0.42, 0.48] });
doc.addChild(root, lid, { name: "Lid", color: [0, 0.83, 1], location: { tx: 0, ty: 0, tz: H } });
holesXY.forEach(([x, y], i) => doc.addChild(root, screw, { name: `M3 screw ${i + 1}`, color: [0.8, 0.8, 0.8], location: { tx: x, ty: y, tz: H - 10 } }));
const children = doc.getChildren(root);
const info = children.map(c => { const li = doc.getLabelInfo(c); const ref = doc.getReferredLabel(c); return { name: li.name, isComponent: li.isComponent, refersTo: ref, loc: doc.getLocation(c).slice(0, 12).map(v => +v.toFixed(3)) }; });
const step = doc.exportSTEP();
const glb = doc.exportGLTF({ linearDeflection: 0.1 });
writeFileSync(`${OUT}/enclosure-assembly.step`, step); writeFileSync(`${OUT}/enclosure-assembly.glb`, glb);
const buildMs = +(performance.now() - t0).toFixed(1);
// Round trip
const back = k.importXCAFFromSTEP(step);
const roots = back.getRoots();
const walk = (tag, depth = 0, acc = []) => { const li = back.getLabelInfo(tag); acc.push({ depth, name: li.name, isAssembly: li.isAssembly, isComponent: li.isComponent, hasColor: li.hasColor }); const ref = li.isComponent ? back.getReferredLabel(tag) : null; const kids = back.getChildren(ref ?? tag); if (!li.isComponent) kids.forEach(c => walk(c, depth + 1, acc)); return acc; };
const tree = roots.flatMap(r => walk(r));
const uniqueRefs = new Set(info.map(i => i.refersTo)).size;
// Interference probe: does any screw intersect the lid (it should pass through the holes with clearance)?
const placedScrew = k.translate(screw, 6, 6, H - 10);
const overlapVol = k.getVolume(k.common(placedScrew, k.translate(lid, 0, 0, H)));
const baseScrewOverlap = k.getVolume(k.common(placedScrew, base));
const productCount = (step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;
const productDefs = (step.match(/PRODUCT_DEFINITION\(/g) || []).length;
console.log(JSON.stringify({ buildMs, components: info, distinct_prototypes_referenced: uniqueRefs, step_bytes: step.length, step_NAUO_occurrences: productCount, step_product_definitions: productDefs, glb_bytes: glb.length, roundtrip_tree: tree, interference_mm3: { screw_vs_lid: +overlapVol.toFixed(4), screw_vs_base: +baseScrewOverlap.toFixed(4) } }, null, 1));
