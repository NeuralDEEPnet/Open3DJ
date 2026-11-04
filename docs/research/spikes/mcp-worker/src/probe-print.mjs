// Probe: which kernel calls print, and through which Emscripten channel (print / printErr).
// Usage: node probe-print.mjs <deps-dir>
// Everything this script itself reports goes to stderr, so stdout holds only what the kernel prints.
const DEPS = process.argv[2];
const base = `file://${DEPS}/node_modules/occt-wasm/dist`;
const { OcctKernel } = await import(`${base}/index.js`);
const { default: factory } = await import(`${base}/occt-wasm.js`);

const captured = [];
const mode = process.argv[3] ?? "capture"; // "capture" = override print/printErr, "default" = leave console.log
const createModule = mode === "capture"
  ? (opts) => factory({ ...opts, print: (s) => captured.push(["out", s]), printErr: (s) => captured.push(["err", s]) })
  : undefined;
const k = await OcctKernel.init(createModule ? { createModule } : undefined);
const mark = (label) => captured.push(["--", label]);

mark("makeBox+fillet");
const box = k.makeBox(20, 20, 20);
const f = k.fillet(box, k.getSubShapes(box, "edge"), 2);
mark("exportStep #1");
const step = k.exportStep(f);
mark("exportStep #2");
k.exportStep(f);
mark("importStep");
k.importStep(step);
mark("exportStl");
try { k.exportStl(f); } catch (e) { captured.push(["throw", String(e.message)]); }
mark("bad fillet (r too large)");
try { k.fillet(box, k.getSubShapes(box, "edge"), 50); } catch (e) { captured.push(["throw", String(e.message).slice(0, 200)]); }
mark("toMultiviewSVG");
k.toMultiviewSVG(f);
mark("toMultiviewPNG");
await k.toMultiviewPNG(f);
mark("done");
process.stderr.write(JSON.stringify({ mode, step_bytes: step.length, captured }, null, 1) + "\n");
