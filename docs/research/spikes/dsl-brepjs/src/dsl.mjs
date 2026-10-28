// 3dj-compatible DSL facade prototype on brepjs 20.11.1 + occt-wasm 5.8.1.
// Spike code: plain ESM JavaScript, no sandbox. Every 3dj entry point that is
// not implemented throws DslNotImplemented so starter runs report exact gaps.
import { performance } from "node:perf_hooks";

export class DslNotImplemented extends Error {
  constructor(name) { super(`3dj DSL entry not implemented in spike facade: ${name}`); this.name = "DslNotImplemented"; this.entry = name; }
}
export class DslError extends Error {
  constructor(op, detail) { super(`${op} failed: ${detail}`); this.name = "DslError"; this.op = op; }
}

const TOL = 1e-3; // edge-query positional tolerance (mm); 3dj does not publish one

export async function createRuntime(depsPath, { edgeLengthMode = "curve", withLib = false } = {}) {
  const t0 = performance.now();
  const B = await import(`file://${depsPath}/node_modules/brepjs/dist/brepjs.js`);
  const { OcctKernel } = await import(`file://${depsPath}/node_modules/occt-wasm/dist/index.js`);
  const kernel = await OcctKernel.init();
  B.registerKernel("occt-wasm", B.OcctWasmAdapter.fromKernel(kernel));
  const initMs = performance.now() - t0;

  // ---- helpers -----------------------------------------------------------
  const opStats = {};
  const U = (op, r) => {
    if (r && typeof r === "object" && "ok" in r) {
      if (r.ok) return r.value;
      const e = r.error || {};
      throw new DslError(op, `${e.code ?? ""} ${e.message ?? JSON.stringify(e)}`.trim());
    }
    return r;
  };
  const timed = (op, f) => {
    const s = performance.now();
    try { return f(); } finally {
      const d = performance.now() - s; const st = (opStats[op] ??= { n: 0, ms: 0 }); st.n++; st.ms += d;
    }
  };
  const flat = (args) => args.flat(Infinity).filter(Boolean).map((a) => (a instanceof Shape3 ? a : a?.shape instanceof Shape3 ? a.shape : a));
  const vecLen = (v) => Math.hypot(v[0], v[1], v[2]);
  const norm = (v) => { const l = vecLen(v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // Rotation of a point (used to carry persistent references / connector frames).
  const rotPt = (p, axis, deg, pivot = [0, 0, 0]) => {
    const k = norm(axis), th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const v = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    const kxv = cross(k, v), kdv = dot(k, v);
    return [0, 1, 2].map((i) => pivot[i] + v[i] * c + kxv[i] * s + k[i] * kdv * (1 - c));
  };
  const rotDir = (d, axis, deg) => rotPt(d, axis, deg, [0, 0, 0]);
  const mirPt = (p, n, at = [0, 0, 0]) => { const u = norm(n); const d = dot([p[0] - at[0], p[1] - at[1], p[2] - at[2]], u); return [p[0] - 2 * d * u[0], p[1] - 2 * d * u[1], p[2] - 2 * d * u[2]]; };
  const mirDir = (v, n) => mirPt(v, n);

  // ---- 3D shape wrapper --------------------------------------------------
  class Shape3 {
    constructor(v, meta = {}) {
      this.v = v;
      this.refs = meta.refs ?? {};          // name -> [x,y,z]  (persistent references)
      this.connectors = meta.connectors ?? {}; // name -> {kind, type, origin, axis, up}
      this._name = meta.name; this._color = meta.color;
    }
    _derive(v, ptFn, dirFn) {
      const refs = Object.fromEntries(Object.entries(this.refs).map(([k, p]) => [k, ptFn ? ptFn(p) : p]));
      const connectors = Object.fromEntries(Object.entries(this.connectors).map(([k, c]) => [k, ptFn ? { ...c, origin: ptFn(c.origin), axis: dirFn(c.axis), up: dirFn(c.up) } : c]));
      return new Shape3(v, { refs, connectors, name: this._name, color: this._color });
    }
    // transforms (immutable)
    translate(x = 0, y = 0, z = 0) {
      if (Array.isArray(x)) [x, y, z] = [x[0], x[1] ?? 0, x[2] ?? 0];
      const d = [x, y, z];
      return this._derive(timed("translate", () => B.translate(this.v, d)), (p) => [p[0] + x, p[1] + y, p[2] + z], (a) => a);
    }
    translateX(d) { return this.translate(d, 0, 0); }
    translateY(d) { return this.translate(0, d, 0); }
    translateZ(d) { return this.translate(0, 0, d); }
    translatePolar(r, deg, z = 0) { const a = (deg * Math.PI) / 180; return this.translate(r * Math.cos(a), r * Math.sin(a), z); }
    rotate(axis, deg, pivotOrOpts) {
      if (typeof axis === "number") { [axis, deg] = [[0, 0, 1], axis]; }
      const pivot = Array.isArray(pivotOrOpts) ? pivotOrOpts : (pivotOrOpts?.pivot ?? [0, 0, 0]);
      return this._derive(timed("rotate", () => B.rotate(this.v, deg, { axis, at: pivot })), (p) => rotPt(p, axis, deg, pivot), (d) => rotDir(d, axis, deg));
    }
    rotateX(deg) { return this.rotate([1, 0, 0], deg); }
    rotateY(deg) { return this.rotate([0, 1, 0], deg); }
    rotateZ(deg) { return this.rotate([0, 0, 1], deg); }
    rotateAroundAxis(axis, deg, pivot) { return this.rotate(axis, deg, pivot); }
    mirror(n = [1, 0, 0]) { return this._derive(timed("mirror", () => B.mirror(this.v, { normal: n, at: [0, 0, 0] })), (p) => mirPt(p, n), (d) => mirDir(d, n)); }
    mirrorThrough(point, n) { return this._derive(timed("mirror", () => B.mirror(this.v, { normal: n, at: point })), (p) => mirPt(p, n, point), (d) => mirDir(d, n)); }
    scale(f) { return this._derive(timed("scale", () => B.scale(this.v, f, { center: [0, 0, 0] })), (p) => p.map((c) => c * f), (d) => d); }
    clone() { return this._derive(this.v); }
    duplicate() { return this.clone(); }
    moveTo(x, y, z) { const b = this.bounds(); return this.translate(x - b.min[0], y - b.min[1], z - b.min[2]); }
    pointAlong(dir) {
      // Lay the local +Z axis along dir (rotation about the axis perpendicular to both).
      const d = norm(dir), z = [0, 0, 1], c = dot(z, d);
      if (c > 1 - 1e-12) return this.clone();
      if (c < -1 + 1e-12) return this.rotate([1, 0, 0], 180);
      return this.rotate(cross(z, d), (Math.acos(c) * 180) / Math.PI);
    }
    // booleans (variadic, batched)
    add(...others) {
      const tools = flat(others); if (!tools.length) return this;
      return this._derive(timed("fuseAll", () => U("add", B.fuseAll([this.v, ...tools.map((t) => t.v)]))));
    }
    subtract(...others) {
      const tools = flat(others); if (!tools.length) return this;
      return this._derive(timed("cutAll", () => U("subtract", B.cutAll(this.v, tools.map((t) => t.v)))));
    }
    intersect(...others) {
      let v = this.v;
      for (const t of flat(others)) v = timed("intersect", () => U("intersect", B.intersect(v, t.v)));
      return this._derive(v);
    }
    cutPlane(plane = "XY", offset = 0, keep = "positive") {
      if (plane !== "XY") throw new DslNotImplemented(`cutPlane(${plane})`);
      const b = this.bounds(), m = 10 + Math.max(...b.size);
      const zLo = keep === "positive" ? offset : b.min[2] - m, zHi = keep === "positive" ? b.max[2] + m : offset;
      const big = B.box(2 * m + b.size[0], 2 * m + b.size[1], zHi - zLo, { at: [b.center[0], b.center[1], (zLo + zHi) / 2] });
      return this._derive(timed("intersect", () => U("cutPlane", B.intersect(this.v, big))));
    }
    // features
    shell(t, { openTop = true, openBottom = false } = {}) {
      const b = this.bounds();
      const faces = B.getFaces(this.v).filter((f) => {
        const fb = B.getBounds(f);
        if (Math.abs(fb.zMax - fb.zMin) > TOL) return false;
        return (openTop && Math.abs(fb.zMax - b.max[2]) < TOL) || (openBottom && Math.abs(fb.zMin - b.min[2]) < TOL);
      });
      if (!faces.length) {
        // closed hollow: cut an inward offset
        const inner = timed("offset", () => U("shell(closed).offset", B.offset(this.v, -t)));
        return this._derive(timed("cutAll", () => U("shell(closed).cut", B.cut(this.v, inner))));
      }
      return this._derive(timed("shell", () => U("shell", B.shell(this.v, faces, t))));
    }
    // metadata
    color(c) { const s = this.clone(); s._color = c; return s; }
    name(n) { const s = this.clone(); s._name = n; return s; }
    // measure
    volume() { return timed("volume", () => U("volume", B.measureVolume(this.v))); }
    area() { return timed("area", () => U("area", B.measureArea(this.v))); }
    bounds() {
      const b = timed("bounds", () => B.getBounds(this.v));
      const min = [b.xMin, b.yMin, b.zMin], max = [b.xMax, b.yMax, b.zMax];
      return { min, max, size: max.map((m, i) => m - min[i]), center: max.map((m, i) => (m + min[i]) / 2) };
    }
    geometryInfo() {
      return {
        solids: B.getSolids(this.v).length, shells: B.getShells(this.v).length, faces: B.getFaces(this.v).length,
        edges: B.getEdges(this.v).length, vertices: B.getVertices(this.v).length, valid: B.isValid(this.v),
      };
    }
    // persistent references (carried through transforms as points; booleans/fillets keep them)
    withReferences(map) { const s = this.clone(); s.refs = { ...s.refs, ...map }; return s; }
    referenceNames() { return Object.keys(this.refs); }
    referencePoint(name) { const p = this.anchor(name); return [...p]; }
    anchor(name) {
      if (this.refs[name]) return this.refs[name];
      const b = this.bounds(), c = b.center;
      const A = { center: c, top: [c[0], c[1], b.max[2]], bottom: [c[0], c[1], b.min[2]], left: [b.min[0], c[1], c[2]], right: [b.max[0], c[1], c[2]], front: [c[0], b.min[1], c[2]], back: [c[0], b.max[1], c[2]] };
      if (!A[name]) throw new DslError("anchor", `unknown anchor/reference '${name}'`);
      return A[name];
    }
    placeReference(name, at) { const p = this.anchor(name); return this.translate(at[0] - p[0], at[1] - p[1], at[2] - p[2]); }
    attachTo(parent, parentAnchor, myAnchor, offset = [0, 0, 0]) {
      const target = parent.anchor(parentAnchor), mine = this.anchor(myAnchor);
      return this.translate(target[0] - mine[0] + offset[0], target[1] - mine[1] + offset[1], target[2] - mine[2] + offset[2]);
    }
    onFace() { throw new DslNotImplemented("onFace"); }
    hole() { throw new DslNotImplemented("hole"); }
    cutout() { throw new DslNotImplemented("cutout"); }
    // connectors
    withConnectors(map) { const s = this.clone(); s.connectors = { ...s.connectors, ...map }; return s; }
    matchTo(target, movingName, targetName) {
      const m = this.connectors[movingName], f = target.connectors[targetName];
      if (!m || !f) throw new DslError("matchTo", `missing connector ${!m ? movingName : targetName}`);
      // Rotate so m.axis -> -f.axis, then m.up -> f.up, then translate origin onto origin.
      let s = this;
      const alignVec = (shape, from, to) => {
        const a = norm(from), b = norm(to), c = dot(a, b);
        if (c > 1 - 1e-12) return shape;
        let ax = cross(a, b);
        if (vecLen(ax) < 1e-12) ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
        return shape.rotate(ax, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
      };
      s = alignVec(s, m.axis, f.axis.map((x) => -x));
      const m2 = s.connectors[movingName];
      s = alignVec(s, m2.up, f.up);
      const m3 = s.connectors[movingName];
      return s.translate(f.origin[0] - m3.origin[0], f.origin[1] - m3.origin[1], f.origin[2] - m3.origin[2]);
    }
  }

  // ---- 2D sketch wrapper --------------------------------------------------
  class Sketch2 {
    // d: brepjs Drawing (pure-TS 2D engine). w: closed planar OCCT wire in XY (set after offset()).
    constructor(d, w) { this.d = d; this.w = w; }
    _wire() { return this.w ?? this.d.clone().sketchOnPlane("XY").wire; }
    offset(dist) {
      // brepjs Drawing.offset(-d) produced an INVALID, asymmetric hexagon inset in this spike;
      // OCCT BRepOffsetAPI_MakeOffset via offsetWire2D is exact, so offset goes through the kernel.
      return new Sketch2(null, timed("offset2d", () => U("offset2d", B.offsetWire2D(this._wire(), dist, "arc"))));
    }
    _needDrawing(op) { if (!this.d) throw new DslNotImplemented(`sketch.${op} after offset()`); return this.d; }
    translate(x, y) { return new Sketch2(this._needDrawing('translate').translate(x, y)); }
    rotate(deg) { return new Sketch2(this._needDrawing('rotate').rotate(deg, [0, 0])); }
    scale(f) { return new Sketch2(this._needDrawing('scale').scale(f, [0, 0])); }
    mirror(n) { return new Sketch2(this._needDrawing('mirror').mirror(n, [0, 0], "plane")); }
    add(...o) { let d = this._needDrawing('boolean'); for (const s of o.flat()) d = d.fuse(s.d); return new Sketch2(d); }
    subtract(...o) { let d = this._needDrawing('boolean'); for (const s of o.flat()) d = d.cut(s.d); return new Sketch2(d); }
    intersect(...o) { let d = this._needDrawing('boolean'); for (const s of o.flat()) d = d.intersect(s.d); return new Sketch2(d); }
    filletCorners(r) { return new Sketch2(this._needDrawing('fillet').fillet(r)); }
    chamferCorners(r) { return new Sketch2(this._needDrawing('chamfer').chamfer(r)); }
    bounds() { const bb = this._needDrawing('bounds').boundingBox; return { min: [bb.xMin, bb.yMin], max: [bb.xMax, bb.yMax] }; }
    area() { return U("area2d", B.measureArea(U("face", B.face(this._wire())))); }
    extrude(h, { twist = 0, scaleTop } = {}) {
      return timed("extrude", () => {
        const profile = scaleTop !== undefined && scaleTop !== 1 ? { profile: "linear", endFactor: scaleTop } : undefined;
        if (this.w) {
          if (twist) return new Shape3(U("extrude(twist)", B.twistExtrude(this.w, twist, [0, 0, 0], [0, 0, h], profile)));
          if (profile) return new Shape3(U("extrude(scaleTop)", B.complexExtrude(this.w, [0, 0, 0], [0, 0, h], profile)));
          return new Shape3(U("extrude", B.extrude(U("face", B.face(this.w)), [0, 0, h])));
        }
        const sk = this.d.clone().sketchOnPlane("XY");
        const cfg = {};
        if (twist) cfg.twistAngle = twist;
        if (profile) cfg.extrusionProfile = profile;
        return new Shape3(sk.extrude(h, cfg));
      });
    }
    revolve(deg = 360) {
      return timed("revolve", () => {
        // sketch X -> radius (world X), sketch Y -> world Z: rotate the XY face +90deg about X.
        const face = B.rotate(U("face", B.face(this._wire())), 90, { axis: [1, 0, 0], at: [0, 0, 0] });
        return new Shape3(U("revolve", B.revolve(face, { axis: [0, 0, 1], at: [0, 0, 0], angle: (deg * Math.PI) / 180 /* brepjs revolve takes RADIANS, rotate takes degrees */ })));
      });
    }
    loftTo(other, h) {
      return timed("loft", () => {
        const a = this._needDrawing("loftTo").clone().sketchOnPlane("XY", 0), b = other._needDrawing("loftTo").clone().sketchOnPlane("XY", h);
        return new Shape3(a.loftWith(b));
      });
    }
    onFace() { throw new DslNotImplemented("sketch.onFace"); }
  }

  // ---- edge queries ---------------------------------------------------------
  const edgeLength = (e) => {
    if (edgeLengthMode === "extent") { const b = B.getBounds(e); return Math.max(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin); }
    return B.curveLength(e);
  };
  const selectEdges = (shape, q = {}) => {
    let edges = B.getEdges(shape.v);
    const keepAt = (ax, val) => (e) => { const b = B.getBounds(e); const lo = ax === 0 ? b.xMin : ax === 1 ? b.yMin : b.zMin; const hi = ax === 0 ? b.xMax : ax === 1 ? b.yMax : b.zMax; return Math.abs(lo - val) < TOL && Math.abs(hi - val) < TOL; };
    if (q.atZ !== undefined) edges = edges.filter(keepAt(2, q.atZ));
    if (q.atX !== undefined) edges = edges.filter(keepAt(0, q.atX));
    if (q.atY !== undefined) edges = edges.filter(keepAt(1, q.atY));
    if (q.minLength !== undefined) edges = edges.filter((e) => edgeLength(e) >= q.minLength - TOL);
    if (q.maxLength !== undefined) edges = edges.filter((e) => edgeLength(e) <= q.maxLength + TOL);
    if (q.parallel) { const d = norm(q.parallel); edges = edges.filter((e) => B.getCurveType(e) === "LINE" && Math.abs(Math.abs(dot(norm(B.curveTangentAt(e, 0.5)), d)) - 1) < 1e-6); }
    if (q.perpendicular) { const d = norm(q.perpendicular); edges = edges.filter((e) => [0.1, 0.5, 0.9].every((t) => Math.abs(dot(norm(B.curveTangentAt(e, t)), d)) < 1e-6)); }
    return edges;
  };
  const fillet = (shape, r, q) => {
    const edges = selectEdges(shape, q);
    if (!edges.length) throw new DslError("fillet", `edge query ${JSON.stringify(q)} matched 0 edges`);
    return shape._derive(timed("fillet", () => U("fillet", B.fillet(shape.v, edges, r))));
  };
  const chamfer = (shape, d, q) => {
    const edges = selectEdges(shape, q);
    if (!edges.length) throw new DslError("chamfer", `edge query ${JSON.stringify(q)} matched 0 edges`);
    return shape._derive(timed("chamfer", () => U("chamfer", B.chamfer(shape.v, edges, d))));
  };

  // ---- primitives -------------------------------------------------------------
  const box = (w, d, h) => new Shape3(timed("box", () => B.box(w, d, h, { at: [0, 0, h / 2] })));
  const cylinder = (h, r, rTop) => new Shape3(timed("cylinder", () => (rTop === undefined || rTop === r ? B.cylinder(r, h) : B.cone(r, rTop, h))));
  const sphere = (r) => new Shape3(timed("sphere", () => B.sphere(r)));
  const torus = (R, r) => new Shape3(timed("torus", () => B.torus(R, r)));

  const polygon = (pts) => {
    // de-duplicate consecutive coincident points (lathe-profile emits one)
    const clean = [];
    for (const p of pts) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) clean.push(p); }
    if (clean.length > 1 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-9) clean.pop();
    let pen = B.draw(clean[0]);
    for (const p of clean.slice(1)) pen = pen.lineTo(p);
    return new Sketch2(pen.close());
  };
  const rect = (w, h) => new Sketch2(B.drawRectangle(w, h));
  const roundedRect = (w, h, r) => new Sketch2(B.drawRoundedRectangle(w, h, r));
  const circle2d = (r) => new Sketch2(B.drawCircle(r));
  const ellipse = (rx, ry) => new Sketch2(B.drawEllipse(rx, ry));
  const ngon = (sides, r) => new Sketch2(B.drawPolysides(r, sides));
  const star = (n, R, r) => polygon(Array.from({ length: 2 * n }, (_, i) => { const a = Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R; return [rr * Math.cos(a), rr * Math.sin(a)]; }));
  const slot = (len, w) => new Sketch2(B.drawRoundedRectangle(len, w, w / 2 - 1e-6));

  // ---- booleans, patterns ---------------------------------------------------
  const union = (...s) => { const a = flat(s); return a[0].add(...a.slice(1)); };
  const difference = (...s) => { const a = flat(s); return a[0].subtract(...a.slice(1)); };
  const intersection = (...s) => { const a = flat(s); return a[0].intersect(...a.slice(1)); };
  const linearPattern = (shape, count, dx, dy, dz = 0) => {
    const copies = Array.from({ length: count }, (_, i) => (i === 0 ? shape : shape.translate(i * dx, i * dy, i * dz)));
    return count === 1 ? shape : union(...copies);
  };
  const circularPattern = (shape, count, { centerX = 0, centerY = 0, startDeg = 0, angle = 360 } = {}) => {
    const step = Math.abs(angle - 360) < 1e-9 ? 360 / count : angle / Math.max(1, count - 1);
    const copies = Array.from({ length: count }, (_, i) => shape.rotate([0, 0, 1], startDeg + i * step, [centerX, centerY, 0]));
    return count === 1 ? copies[0] : union(...copies);
  };
  const mirrorCopy = (shape, n) => union(shape, shape.mirror(n));

  // ---- connectors ------------------------------------------------------------
  const connector = {
    male: (type, f) => ({ kind: "male", type, origin: f.origin, axis: f.axis, up: f.up }),
    female: (type, f) => ({ kind: "female", type, origin: f.origin, axis: f.axis, up: f.up }),
  };

  const NI = (name) => () => { throw new DslNotImplemented(name); };
  // Minimal lib.* (enabled with { withLib: true }). Dimensions are ISO-nominal GUESSES,
  // NOT 3dj's private tables, so geometry will differ from 3dj.app in detail.
  const FAST = {
    M2: { d: 2, clearance: { close: 2.2, medium: 2.4 }, nut: { s: 4, m: 1.6 }, socketHead: { dk: 3.8, k: 2 }, countersunk: { dk: 3.8, k: 1.2 }, heatSet: { hole: 3.2, length: 4 } },
    "M2.5": { d: 2.5, clearance: { close: 2.7, medium: 2.9 }, nut: { s: 5, m: 2 }, socketHead: { dk: 4.5, k: 2.5 }, countersunk: { dk: 4.7, k: 1.5 }, heatSet: { hole: 3.6, length: 4 } },
    M3: { d: 3, clearance: { close: 3.2, medium: 3.4 }, nut: { s: 5.5, m: 2.4 }, socketHead: { dk: 5.5, k: 3 }, countersunk: { dk: 6.72, k: 1.86 }, heatSet: { hole: 4.0, length: 5.7 } },
    M4: { d: 4, clearance: { close: 4.3, medium: 4.5 }, nut: { s: 7, m: 3.2 }, socketHead: { dk: 7, k: 4 }, countersunk: { dk: 8.96, k: 2.48 }, heatSet: { hole: 5.6, length: 8.1 } },
    M5: { d: 5, clearance: { close: 5.3, medium: 5.5 }, nut: { s: 8, m: 4.7 }, socketHead: { dk: 8.5, k: 5 }, countersunk: { dk: 11.2, k: 3.1 }, heatSet: { hole: 6.4, length: 9.5 } },
    M6: { d: 6, clearance: { close: 6.4, medium: 6.6 }, nut: { s: 10, m: 5.2 }, socketHead: { dk: 10, k: 6 }, countersunk: { dk: 13.44, k: 3.72 }, heatSet: { hole: 8.0, length: 12.7 } },
    M8: { d: 8, clearance: { close: 8.4, medium: 9 }, nut: { s: 13, m: 6.8 }, socketHead: { dk: 13, k: 8 }, countersunk: { dk: 17.92, k: 4.96 }, heatSet: { hole: 9.6, length: 12.7 } },
  };
  const spec = (size) => { const s = FAST[size]; if (!s) throw new DslError("lib", `unknown size ${size}`); return s; };
  const hexPrism = (s, h) => ngon(6, s / Math.sqrt(3)).extrude(h);
  const libImpl = {
    fastener: (size) => structuredClone(spec(size)),
    clearanceHole: (size, { length = 10, fit = "medium" } = {}) => cylinder(length + 1, spec(size).clearance[fit] / 2).translate(0, 0, -length),
    screwCutter: (size, { length = 10, head = "socket", clearance = 0 } = {}) => {
      const s = spec(size), rs = s.clearance.medium / 2 + clearance;
      let c = cylinder(length + 1, rs).translate(0, 0, -length);
      if (head === "countersunk") { const R = s.countersunk.dk / 2 + clearance, depth = R - rs; c = c.add(cylinder(depth, rs, R).translate(0, 0, -depth), cylinder(1, R).translate(0, 0, 0)); }
      else if (head === "socket" || head === "counterbore") { const R = s.socketHead.dk / 2 + 0.3 + clearance; c = c.add(cylinder(s.socketHead.k + 1, R).translate(0, 0, -s.socketHead.k)); }
      return c;
    },
    heatSetPocket: (size, { depth, clearance = 0 } = {}) => { const s = spec(size), d = depth ?? s.heatSet.length; return cylinder(d + 0.5, s.heatSet.hole / 2 + clearance).translate(0, 0, -d); },
    hexNutPocket: (size, { depth, clearance = 0.2 } = {}) => { const s = spec(size), d = depth ?? s.nut.m; return hexPrism(s.nut.s + 2 * clearance, d + 0.5).translate(0, 0, -d); },
    bolt: (size, length) => { const s = spec(size); return cylinder(length, s.d / 2).translate(0, 0, -length).add(cylinder(s.socketHead.k, s.socketHead.dk / 2)); },
    nut: (size) => { const s = spec(size); return hexPrism(s.nut.s, s.nut.m).subtract(cylinder(s.nut.m + 2, s.d / 2).translate(0, 0, -1)).translate(0, 0, -s.nut.m / 2); },
    washer: (size) => { const s = spec(size); return cylinder(1.1, s.d).subtract(cylinder(3.1, s.d / 2 + 0.2).translate(0, 0, -1)).translate(0, 0, -0.55); },
  };
  const lib = new Proxy({}, { get: (_, k) => (withLib && libImpl[k]) || NI(`lib.${String(k)}`) });

  // ---- script runner -----------------------------------------------------------
  function run(code, overrides = {}) {
    const params = [];
    const pick = (name, def) => (name in overrides ? overrides[name] : def);
    const Param = {
      number(name, def, o = {}) { let v = pick(name, def); if (o.integer) v = Math.round(v); if (o.min !== undefined) v = Math.max(o.min, v); if (o.max !== undefined) v = Math.min(o.max, v); params.push({ type: "number", name, default: def, value: v, ...o }); return v; },
      bool(name, def) { const v = !!pick(name, def); params.push({ type: "bool", name, default: def, value: v }); return v; },
      choice(name, def, options) { let v = pick(name, def); if (!options.includes(v)) v = def; params.push({ type: "choice", name, default: def, value: v, options }); return v; },
      string(name, def, o = {}) { let v = String(pick(name, def)); if (o.maxLength) v = v.slice(0, o.maxLength); params.push({ type: "string", name, default: def, value: v, ...o }); return v; },
    };
    const scope = {
      Param, box, cylinder, sphere, torus, rect, roundedRect, circle2d, ellipse, ngon, star, slot, polygon,
      path: NI("path"), text2d: NI("text2d"), spline2d: NI("spline2d"), loft: NI("loft"),
      union, difference, intersection, union2d: NI("union2d"), difference2d: NI("difference2d"), intersection2d: NI("intersection2d"),
      fillet, chamfer, linearPattern, circularPattern, mirrorCopy, connector, lib,
      group: NI("group"), tolerance: NI("tolerance"), chamferBottomEdges: NI("chamferBottomEdges"), minWall: NI("minWall"),
      point: NI("point"), Point2D: NI("Point2D"), Rectangle2D: NI("Rectangle2D"), Shape: { fromSlices: NI("Shape.fromSlices") },
    };
    const fn = new Function(...Object.keys(scope), `"use strict";\n${code}`);
    const ret = fn(...Object.values(scope));
    return { params, parts: normalize(ret) };
  }
  function normalize(ret) {
    const out = [];
    const push = (x, i, key) => {
      if (!x) return;
      if (x instanceof Shape3) out.push({ name: x._name ?? key ?? `Part ${i + 1}`, shape: x, color: x._color });
      else if (x.shape instanceof Shape3) out.push({ name: x.name ?? x.shape._name ?? `Part ${i + 1}`, shape: x.shape, color: x.color ?? x.shape._color });
      else throw new DslError("return", `unsupported return element ${typeof x}`);
    };
    if (ret instanceof Shape3) push(ret, 0);
    else if (Array.isArray(ret)) ret.forEach((x, i) => push(x, i));
    else if (ret && typeof ret === "object") Object.entries(ret).forEach(([k, x], i) => push(x, i, k));
    else throw new DslError("return", "script returned nothing");
    return out;
  }

  return { B, kernel, run, initMs, opStats, Shape3, Sketch2, selectEdges, api: { box, cylinder, sphere, torus, rect, roundedRect, circle2d, ellipse, ngon, star, slot, polygon, union, difference, intersection, fillet, chamfer, linearPattern, circularPattern, mirrorCopy } };
}
