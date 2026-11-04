// Kernel core shared by every backend (in-process, worker_threads, child_process).
// It owns one OcctKernel, evaluates "scripts" (a JSON op list or a JS string run against a
// tiny 3dj-style facade), keeps a small LRU of result shapes by modelId, and answers
// run / render / exportStep / stats requests with plain structured-cloneable data.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const ms = (t) => +(performance.now() - t).toFixed(2);

export async function createKernelCore({ deps, printHook = true }) {
  const base = pathToFileURL(join(deps, "node_modules/occt-wasm/dist/")).href;
  const t0 = performance.now();
  const { OcctKernel } = await import(base + "index.js");
  const printed = { outLines: 0, errLines: 0, outBytes: 0, tail: [] };
  let createModule;
  if (printHook) {
    // The clean fix: occt-wasm's InitOptions has no print option, but it accepts a custom
    // Emscripten factory. Wrapping the shipped factory lets us inject Module.print/printErr,
    // which the glue uses instead of console.log/console.error for fd 1 and fd 2.
    const { default: factory } = await import(base + "occt-wasm.js");
    const sink = (kind) => (s) => {
      if (kind === "out") { printed.outLines++; printed.outBytes += s.length + 1; } else printed.errLines++;
      printed.tail.push(`${kind}: ${s}`);
      if (printed.tail.length > 40) printed.tail.shift();
    };
    createModule = (opts) => factory({ ...opts, print: sink("out"), printErr: sink("err") });
  }
  const k = await OcctKernel.init(createModule ? { createModule } : undefined);
  const initMs = ms(t0);

  const models = new Map(); // modelId -> { handle, created }
  const MAX_MODELS = 16;

  // ---- evaluation with per-call handle tracking ---------------------------------------
  function evaluate(script, params = {}) {
    const created = [];
    const T = (h) => { if (Array.isArray(h)) created.push(...h); else created.push(h); return h; };
    let logs = [];
    let result;
    try {
      if (Array.isArray(script?.ops)) result = evalOps(script, T);
      else if (typeof script?.js === "string") ({ result, logs } = evalJs(script.js, params, T));
      else throw new Error("script must be {ops:[...], result} or {js: string}");
      if (result == null) throw new Error("script returned nothing");
    } catch (e) {
      for (const h of created) { try { k.release(h); } catch {} }
      throw e;
    }
    // release every intermediate handle; keep only the result
    for (const h of created) if (h !== result) { try { k.release(h); } catch {} }
    return { handle: result, logs };
  }

  // Booleans return a compound even when the result is one solid; fillet/chamfer need a
  // TopoDS_Solid ("fillet: TopoDS::Solid" otherwise). A real DSL must normalise this.
  function asSolid(h, T) {
    if (k.getShapeType(h) === "solid") return h;
    const solids = T(k.getSubShapes(h, "solid"));
    if (solids.length === 1) return solids[0];
    throw new Error(`expected one solid, got ${k.getShapeType(h)} with ${solids.length} solids`);
  }

  function edgesAtZ(shape, z, T, tol = 1e-4) {
    const edges = T(k.getSubShapes(shape, "edge"));
    if (z === undefined) return edges;
    return edges.filter((e) => { const b = k.getBoundingBox(e); return Math.abs(b.zmin - z) < tol && Math.abs(b.zmax - z) < tol; });
  }

  // JSON op list: [{id, op, ...args}], result: id
  function evalOps({ ops, result }, T) {
    const env = new Map();
    const get = (id) => { if (!env.has(id)) throw new Error(`unknown id "${id}"`); return env.get(id); };
    for (const o of ops) {
      let h;
      switch (o.op) {
        case "box": h = T(k.translate(T(k.makeBox(o.w, o.d, o.h)), -o.w / 2, -o.d / 2, 0)); break;
        case "cylinder": h = T(o.rTop !== undefined ? k.makeCone(o.r, o.rTop, o.h) : k.makeCylinder(o.r, o.h)); break;
        case "sphere": h = T(k.makeSphere(o.r)); break;
        case "torus": h = T(k.makeTorus(o.R, o.r)); break;
        case "translate": h = T(k.translate(get(o.of), o.x ?? 0, o.y ?? 0, o.z ?? 0)); break;
        case "rotate": h = T(k.rotate(get(o.of), { point: { x: 0, y: 0, z: 0 }, direction: axisVec(o.axis) }, (o.deg * Math.PI) / 180)); break;
        case "union": h = T(k.fuseAll(o.of.map(get))); break;
        case "subtract": h = T(k.cutAll(get(o.of), o.tools.map(get))); break;
        case "intersect": h = T(k.intersect(get(o.of), get(o.with))); break;
        case "fillet": { const s = asSolid(get(o.of), T); h = T(k.fillet(s, edgesAtZ(s, o.atZ, T), o.r)); break; }
        case "chamfer": { const s = asSolid(get(o.of), T); h = T(k.chamfer(s, edgesAtZ(s, o.atZ, T), o.d)); break; }
        case "linearPattern": { const s = get(o.of); const copies = []; for (let i = 0; i < o.n; i++) copies.push(T(k.translate(s, i * (o.dx ?? 0), i * (o.dy ?? 0), i * (o.dz ?? 0)))); h = T(k.fuseAll(copies)); break; }
        default: throw new Error(`unknown op "${o.op}"`);
      }
      if (!o.id) throw new Error(`op ${o.op} needs an id`);
      env.set(o.id, h);
    }
    return get(result ?? ops[ops.length - 1].id);
  }

  function axisVec(a = "z") { return { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } }[a]; }

  // A ~20-entry slice of the 3dj DSL facade, enough to run realistic agent scripts.
  // NOTE: node:vm is NOT a security boundary. Isolation here comes from the worker/child
  // (kill on timeout); real Step 1 sandboxing needs QuickJS/SES or an OS sandbox.
  function evalJs(src, params, T) {
    const logs = [];
    class Shape {
      constructor(h) { this.h = h; }
      add(...o) { return new Shape(T(k.fuseAll([this.h, ...o.flat().map(un)]))); }
      subtract(...o) { return new Shape(T(k.cutAll(this.h, o.flat().map(un)))); }
      intersect(o) { return new Shape(T(k.intersect(this.h, un(o)))); }
      translate(x = 0, y = 0, z = 0) { return new Shape(T(k.translate(this.h, x, y, z))); }
      rotate(deg, axis = "z") { return new Shape(T(k.rotate(this.h, { point: { x: 0, y: 0, z: 0 }, direction: axisVec(axis) }, (deg * Math.PI) / 180))); }
    }
    const un = (s) => (s instanceof Shape ? s.h : s);
    const unionAll = (arr) => new Shape(T(k.fuseAll(arr.flat().map(un))));
    const facade = {
      Param: {
        number: (name, def) => (typeof params[name] === "number" ? params[name] : def),
        bool: (name, def) => (typeof params[name] === "boolean" ? params[name] : def),
        choice: (name, def) => params[name] ?? def,
        string: (name, def) => params[name] ?? def,
      },
      box: (w, d, h) => new Shape(T(k.translate(T(k.makeBox(w, d, h)), -w / 2, -d / 2, 0))),
      cylinder: (h, r, rTop) => new Shape(T(rTop !== undefined ? k.makeCone(r, rTop, h) : k.makeCylinder(r, h))),
      sphere: (r) => new Shape(T(k.makeSphere(r))),
      torus: (R, r) => new Shape(T(k.makeTorus(R, r))),
      translate: (s, x, y, z) => s.translate(x, y, z),
      rotate: (s, deg, axis) => s.rotate(deg, axis),
      union: (...a) => unionAll(a),
      difference: (a, ...b) => a.subtract(...b),
      intersection: (a, b) => a.intersect(b),
      fillet: (s, r, q = {}) => { const h = asSolid(s.h, T); return new Shape(T(k.fillet(h, edgesAtZ(h, q.atZ, T), r))); },
      chamfer: (s, d, q = {}) => { const h = asSolid(s.h, T); return new Shape(T(k.chamfer(h, edgesAtZ(h, q.atZ, T), d))); },
      linearPattern: (s, n, dx = 0, dy = 0, dz = 0) => Array.from({ length: n }, (_, i) => s.translate(i * dx, i * dy, i * dz)),
      circularPattern: (s, n, axis = "z") => Array.from({ length: n }, (_, i) => s.rotate((360 / n) * i, axis)),
      volume: (s) => k.getVolume(s.h),
      bounds: (s) => k.getBoundingBox(s.h),
      console: { log: (...a) => logs.push(a.map(String).join(" ")) },
      Math,
    };
    const ctx = vm.createContext(facade, { codeGeneration: { strings: false, wasm: false } });
    const out = vm.runInContext(`(function(){ "use strict"; ${src}\n})()`, ctx, { filename: "model.js" });
    let res = out;
    if (Array.isArray(res)) res = unionAll(res.map((x) => (x && x.shape ? x.shape : x)));
    else if (res && res.shape) res = res.shape;
    if (!(res instanceof Shape)) throw new Error("script must return a shape, an array, or {shape}");
    return { result: res.h, logs };
  }

  function remember(handle, script, params) {
    const id = createHash("sha256").update(JSON.stringify([script, params])).digest("hex").slice(0, 16);
    const prev = models.get(id);
    if (prev && prev.handle !== handle) { try { k.release(prev.handle); } catch {} }
    models.delete(id);
    models.set(id, { handle });
    while (models.size > MAX_MODELS) {
      const [oldId, old] = models.entries().next().value;
      try { k.release(old.handle); } catch {}
      models.delete(oldId);
    }
    return id;
  }

  function resolve(p) {
    if (p.modelId) {
      const m = models.get(p.modelId);
      if (!m) throw new Error(`unknown modelId ${p.modelId} (evicted or never built); send the script again`);
      return { handle: m.handle, modelId: p.modelId, buildMs: 0 };
    }
    const t = performance.now();
    const { handle } = evaluate(p.script, p.params);
    return { handle, modelId: remember(handle, p.script, p.params), buildMs: ms(t) };
  }

  const methods = {
    async run(p) {
      const t = performance.now();
      const { handle, logs } = evaluate(p.script, p.params);
      const buildMs = ms(t);
      let t2 = performance.now();
      const volume = k.getVolume(handle);
      const area = k.getSurfaceArea(handle);
      const bb = k.getBoundingBox(handle);
      const valid = k.isValid(handle);
      const checksMs = ms(t2);
      t2 = performance.now();
      const mesh = k.tessellate(handle, { linearDeflection: p.deflection ?? 0.1 });
      const tessMs = ms(t2);
      const modelId = remember(handle, p.script, p.params);
      return {
        modelId, valid, volume: +volume.toFixed(6), area: +area.toFixed(6),
        bbox: { min: [bb.xmin, bb.ymin, bb.zmin].map((v) => +v.toFixed(6)), max: [bb.xmax, bb.ymax, bb.zmax].map((v) => +v.toFixed(6)) },
        triangles: mesh.triangleCount, vertices: mesh.vertexCount,
        logs,
        timingsMs: { build: buildMs, checks: checksMs, tessellate: tessMs, total: ms(t) },
        liveShapes: k.shapeCount,
      };
    },
    async render(p) {
      const t = performance.now();
      const { handle, modelId, buildMs } = resolve(p);
      let t2 = performance.now();
      const svg = k.toMultiviewSVG(handle);
      const svgMs = ms(t2);
      t2 = performance.now();
      const png = await k.toMultiviewPNG(handle);
      const pngMs = ms(t2);
      return { modelId, svg, png, timingsMs: { build: buildMs, svg: svgMs, png: pngMs, total: ms(t) } };
    },
    async exportStep(p) {
      const t = performance.now();
      const { handle, modelId, buildMs } = resolve(p);
      const t2 = performance.now();
      const step = k.exportStep(handle);
      return { modelId, step, timingsMs: { build: buildMs, step: ms(t2), total: ms(t) } };
    },
    async stats() {
      return { initMs, printHook, printed: { ...printed, tail: printed.tail.slice(-12) }, liveShapes: k.shapeCount, models: models.size, rssMb: Math.round(process.memoryUsage().rss / 1e6), heapMb: Math.round(process.memoryUsage().heapUsed / 1e6) };
    },
    async ping() { return { ok: true }; },
  };

  return {
    initMs,
    async handle(method, params) {
      const f = methods[method];
      if (!f) throw new Error(`unknown method ${method}`);
      return f(params ?? {});
    },
  };
}
