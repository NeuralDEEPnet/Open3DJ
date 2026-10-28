// The guest half of the DSL: JavaScript evaluated inside QuickJS before the user script.
// It defines the 3dj-style surface (box(), Param, sketches, shape methods, lib, connectors)
// on top of the host functions in __host. Shapes and sketches are small wrapper objects that
// hold a host id; the host table is the security boundary, the classes here are only an API.
export const PRELUDE = String.raw`"use strict";(function (g) {
const H = g.__host;
const TOKEN = {};
const ids = new WeakMap();
const kinds = new WeakMap();
const isArray = Array.isArray;
const freeze = Object.freeze;
const defineProperty = Object.defineProperty;

function fail(code, message, hint) {
  const e = new Error(message);
  defineProperty(e, "code", { value: code, enumerable: true });
  if (hint) defineProperty(e, "hint", { value: hint, enumerable: true });
  return e;
}
const NI = (name) => function () { throw fail("DSL_NOT_IMPLEMENTED", name + " is not implemented in Open3DJ DSL v1 yet", "Build the same shape from the implemented entries, or ask for this entry in an issue."); };

function idOf(x, kind, what) {
  const id = ids.get(x);
  if (id === undefined || (kind && kinds.get(x) !== kind)) {
    if (kind === "shape" && kinds.get(x) === "sketch") throw fail("DSL_BAD_ARGUMENT", (what || "argument") + " must be a 3D shape, got a 2D sketch", "Extrude or revolve the sketch first.");
    if (kind === "sketch" && kinds.get(x) === "shape") throw fail("DSL_BAD_ARGUMENT", (what || "argument") + " must be a 2D sketch, got a 3D shape");
    throw fail("DSL_BAD_ARGUMENT", (what || "argument") + " must be a " + (kind === "sketch" ? "sketch" : "shape") + ", got " + (x === null ? "null" : isArray(x) ? "an array" : typeof x));
  }
  return id;
}
const sid = (x, what) => idOf(x, "shape", what);
const kid = (x, what) => idOf(x, "sketch", what);

// Flatten nested arrays, skip null/undefined/false, accept { shape } descriptors.
function flat(xs) {
  const out = [];
  const walk = (x) => {
    if (isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); return; }
    if (x === null || x === undefined || x === false) return;
    if (!ids.has(x) && typeof x === "object" && ids.has(x.shape)) { out.push(x.shape); return; }
    out.push(x);
  };
  walk(xs);
  return out;
}
const vec = (x, y, z) => (isArray(x) ? [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0] : [x ?? 0, y ?? 0, z ?? 0]);
const AXIS = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const axisOf = (a) => (typeof a === "string" ? AXIS[a] || a : a);
const pivotOf = (p) => (isArray(p) ? p : p && typeof p === "object" && isArray(p.pivot) ? p.pivot : [0, 0, 0]);

class Shape3 {
  constructor(token, id) {
    if (token !== TOKEN) throw new TypeError("shapes cannot be constructed directly; use box(), cylinder(), sketch.extrude(), ...");
    ids.set(this, id);
    kinds.set(this, "shape");
    freeze(this);
  }
  // transforms (immutable: each returns a new shape)
  translate(x, y, z) { return S(H.translate(sid(this), vec(x, y, z))); }
  translateX(d) { return this.translate(d, 0, 0); }
  translateY(d) { return this.translate(0, d, 0); }
  translateZ(d) { return this.translate(0, 0, d); }
  translatePolar(r, deg, z) { const a = (deg * Math.PI) / 180; return this.translate(r * Math.cos(a), r * Math.sin(a), z || 0); }
  rotate(axis, deg, pivot) {
    if (typeof axis === "number") { const a = axis; axis = typeof deg === "string" || isArray(deg) ? deg : [0, 0, 1]; deg = a; }
    return S(H.rotate(sid(this), axisOf(axis), deg, pivotOf(pivot)));
  }
  rotateX(deg) { return this.rotate([1, 0, 0], deg); }
  rotateY(deg) { return this.rotate([0, 1, 0], deg); }
  rotateZ(deg) { return this.rotate([0, 0, 1], deg); }
  rotateAroundAxis(axis, deg, pivot) { return this.rotate(axis, deg, pivot); }
  scale(f) { return S(H.scale(sid(this), f)); }
  mirror(normal) { return S(H.mirror(sid(this), normal === undefined ? [1, 0, 0] : axisOf(normal), [0, 0, 0])); }
  mirrorThrough(point, normal) { return S(H.mirror(sid(this), axisOf(normal), point)); }
  pointAlong(dir) { return S(H.pointAlong(sid(this), axisOf(dir))); }
  moveTo(x, y, z) { return S(H.moveTo(sid(this), vec(x, y, z))); }
  clone() { return S(H.clone(sid(this))); }
  duplicate() { return this.clone(); }
  // booleans (batched)
  add(...others) { return S(H.union(sid(this), flat(others).map((o) => sid(o, "add() argument")))); }
  subtract(...others) { return S(H.subtract(sid(this), flat(others).map((o) => sid(o, "subtract() argument")))); }
  intersect(...others) { return S(H.intersect(sid(this), flat(others).map((o) => sid(o, "intersect() argument")))); }
  cutPlane(plane, offset, keep) { return S(H.cutPlane(sid(this), plane === undefined ? "XY" : plane, offset || 0, keep || "positive")); }
  // features
  fillet(r, query) { return S(H.fillet(sid(this), r, query || {})); }
  chamfer(d, query) { return S(H.chamfer(sid(this), d, query || {})); }
  shell(t, opts) { return S(H.shell(sid(this), t, opts || {})); }
  edges(query) { return H.edges(sid(this), query || {}); }
  // metadata
  color(c) { return S(H.meta(sid(this), { color: c })); }
  name(n) { return S(H.meta(sid(this), { name: n })); }
  // measures
  volume() { return H.volume(sid(this)); }
  area() { return H.area(sid(this)); }
  bounds() { return H.bounds(sid(this)); }
  geometryInfo() { return H.geometryInfo(sid(this)); }
  // references and placement
  withReferences(map) { return S(H.withReferences(sid(this), map)); }
  referenceNames() { return H.referenceNames(sid(this)); }
  referencePoint(name) { return H.referencePoint(sid(this), name); }
  placeReference(name, at) { return S(H.placeReference(sid(this), name, at)); }
  attachTo(parent, parentAnchor, myAnchor, offset) { return S(H.attachTo(sid(this), sid(parent, "attachTo parent"), parentAnchor, myAnchor, offset || [0, 0, 0])); }
  // connectors
  withConnectors(map) { return S(H.withConnectors(sid(this), map)); }
  matchTo(target, movingName, targetName) { return S(H.matchTo(sid(this), sid(target, "matchTo target"), movingName, targetName)); }
  onFace() { return NI("onFace")(); }
  hole() { return NI("hole")(); }
  cutout() { return NI("cutout")(); }
  face() { return NI("shape.face")(); }
}
freeze(Shape3);
freeze(Shape3.prototype);
const S = (id) => new Shape3(TOKEN, id);

class Sketch2 {
  constructor(token, id) {
    if (token !== TOKEN) throw new TypeError("sketches cannot be constructed directly; use rect(), circle2d(), polygon(), ...");
    ids.set(this, id);
    kinds.set(this, "sketch");
    freeze(this);
  }
  offset(d) { return K(H.skOffset(kid(this), d)); }
  filletCorners(r) { return K(H.skFillet(kid(this), r)); }
  chamferCorners(s) { return K(H.skChamfer(kid(this), s)); }
  translate(x, y) { return K(H.skTranslate(kid(this), isArray(x) ? x[0] : x || 0, isArray(x) ? x[1] : y || 0)); }
  rotate(deg) { return K(H.skRotate(kid(this), deg)); }
  scale(f) { return K(H.skScale(kid(this), f)); }
  mirror(normal) { return K(H.skMirror(kid(this), normal === undefined ? [1, 0] : normal)); }
  add(...others) { return K(H.skBoolean("add", kid(this), flat(others).map((o) => kid(o, "add() argument")))); }
  subtract(...others) { return K(H.skBoolean("subtract", kid(this), flat(others).map((o) => kid(o, "subtract() argument")))); }
  intersect(...others) { return K(H.skBoolean("intersect", kid(this), flat(others).map((o) => kid(o, "intersect() argument")))); }
  area() { return H.skArea(kid(this)); }
  bounds() { return H.skBounds(kid(this)); }
  extrude(h, opts) { return S(H.skExtrude(kid(this), h, opts || {})); }
  revolve(deg) { return S(H.skRevolve(kid(this), deg === undefined ? 360 : deg)); }
  loftTo(other, h) { return S(H.loft([kid(this), kid(other, "loftTo profile")], [0, h])); }
  onFace() { return NI("sketch.onFace")(); }
}
freeze(Sketch2);
freeze(Sketch2.prototype);
const K = (id) => new Sketch2(TOKEN, id);

class PathBuilder {
  #cmds = [];
  moveTo(x, y) { this.#cmds.push(["moveTo", x, y]); return this; }
  lineTo(x, y) { this.#cmds.push(["lineTo", x, y]); return this; }
  lineH(dx) { this.#cmds.push(["lineH", dx]); return this; }
  lineV(dy) { this.#cmds.push(["lineV", dy]); return this; }
  lineAngled(len, deg) { this.#cmds.push(["lineAngled", len, deg]); return this; }
  arcTo(x, y, r) { this.#cmds.push(["arcTo", x, y, r]); return this; }
  close() { return K(H.path(this.#cmds)); }
}
freeze(PathBuilder);
freeze(PathBuilder.prototype);

const Param = freeze({
  number(name, def, opts) { return H.param("number", name, def, opts || {}); },
  bool(name, def) { return H.param("bool", name, def, {}); },
  choice(name, def, options) { return H.param("choice", name, def, { options: options }); },
  string(name, def, opts) { return H.param("string", name, def, opts || {}); },
});

const frame = (kind) => (type, f) => {
  f = f || {};
  return freeze({ kind: kind, type: type, origin: f.origin, axis: f.axis, up: f.up });
};
const connector = freeze({ male: frame("male"), female: frame("female") });

const libShape = (name) => (...args) => S(H.lib(name, args));
const lib = freeze({
  fastener: (size) => H.fastener(size),
  clearanceHole: libShape("clearanceHole"),
  screwCutter: libShape("screwCutter"),
  heatSetPocket: libShape("heatSetPocket"),
  hexNutPocket: libShape("hexNutPocket"),
  bolt: libShape("bolt"),
  nut: libShape("nut"),
  washer: libShape("washer"),
  snapFit: NI("lib.snapFit"),
  screwBoss: NI("lib.screwBoss"),
  mountingTab: NI("lib.mountingTab"),
  cableAnchor: NI("lib.cableAnchor"),
  remoteCradle: NI("lib.remoteCradle"),
  profile2020BSlot6: NI("lib.profile2020BSlot6"),
  profile2020BSlot6Profile: NI("lib.profile2020BSlot6Profile"),
  tSlotProfile: NI("lib.tSlotProfile"),
});

function union(...xs) { const a = flat(xs); if (a.length === 0) throw fail("DSL_BAD_ARGUMENT", "union() needs at least one shape"); return sh(a[0], "union() argument").add(...a.slice(1)); }
function difference(base, ...tools) { return sh(base, "difference() base").subtract(...tools); }
function intersection(...xs) { const a = flat(xs); if (a.length === 0) throw fail("DSL_BAD_ARGUMENT", "intersection() needs at least one shape"); return sh(a[0]).intersect(...a.slice(1)); }
function sh(x, what) { sid(x, what); return x; }
function sk(x, what) { kid(x, what); return x; }

const api = {
  Param: Param,
  box: (w, d, h) => S(H.box(w, d, h)),
  cylinder: (h, r, rTop) => S(H.cylinder(h, r, rTop === undefined ? null : rTop)),
  sphere: (r) => S(H.sphere(r)),
  torus: (R, r) => S(H.torus(R, r)),
  rect: (w, h) => K(H.rect(w, h)),
  roundedRect: (w, h, r) => K(H.roundedRect(w, h, r)),
  circle2d: (r) => K(H.circle2d(r)),
  ellipse: (rx, ry) => K(H.ellipse(rx, ry)),
  ngon: (sides, r) => K(H.ngon(sides, r)),
  star: (n, R, r) => K(H.star(n, R, r)),
  slot: (len, w) => K(H.slot(len, w)),
  polygon: (points) => K(H.polygon(points)),
  path: () => new PathBuilder(),
  text2d: NI("text2d"),
  spline2d: NI("spline2d"),
  loft: (profiles, heights) => S(H.loft(flat([profiles]).map((p) => kid(p, "loft profile")), heights)),
  union: union,
  difference: difference,
  intersection: intersection,
  union2d: (a, ...rest) => sk(a, "union2d() argument").add(...rest),
  difference2d: (a, ...rest) => sk(a, "difference2d() argument").subtract(...rest),
  intersection2d: (a, ...rest) => sk(a, "intersection2d() argument").intersect(...rest),
  fillet: (s, r, q) => sh(s, "fillet() shape").fillet(r, q),
  chamfer: (s, d, q) => sh(s, "chamfer() shape").chamfer(d, q),
  translate: (s, x, y, z) => sh(s).translate(x, y, z),
  rotate: (s, axis, deg, pivot) => sh(s).rotate(axis, deg, pivot),
  volume: (s) => sh(s).volume(),
  bounds: (s) => sh(s).bounds(),
  linearPattern: (s, count, dx, dy, dz) => S(H.linearPattern(sid(s, "linearPattern() shape"), count, [dx || 0, dy || 0, dz || 0])),
  circularPattern: (s, count, opts) => S(H.circularPattern(sid(s, "circularPattern() shape"), count, opts || {})),
  mirrorCopy: (s, normal) => S(H.mirrorCopy(sid(s, "mirrorCopy() shape"), normal === undefined ? [1, 0, 0] : axisOf(normal))),
  connector: connector,
  lib: lib,
  group: NI("group"),
  tolerance: NI("tolerance"),
  chamferBottomEdges: NI("chamferBottomEdges"),
  minWall: NI("minWall"),
  point: NI("point"),
  Point2D: NI("Point2D"),
  Rectangle2D: freeze({ fromDimensions: NI("Rectangle2D.fromDimensions"), fromCenterAndDimensions: NI("Rectangle2D.fromCenterAndDimensions"), from2Corners: NI("Rectangle2D.from2Corners") }),
  Shape: freeze({ fromSlices: NI("Shape.fromSlices") }),
};
for (const k of Object.keys(api)) defineProperty(g, k, { value: api[k], writable: false, enumerable: false, configurable: false });

// The script's return value as plain data: { parts: [{ id, name, color, key }], extra }.
function part(x, key, where) {
  if (ids.has(x)) {
    if (kinds.get(x) !== "shape") throw fail("DSL_BAD_RETURN", where + " is a 2D sketch", "Return 3D shapes: extrude or revolve sketches first.");
    return { id: ids.get(x), name: null, color: null, key: key };
  }
  if (x && typeof x === "object" && ids.has(x.shape)) {
    if (kinds.get(x.shape) !== "shape") throw fail("DSL_BAD_RETURN", where + ".shape is a 2D sketch", "Return 3D shapes: extrude or revolve sketches first.");
    const name = x.name === undefined || x.name === null ? null : String(x.name);
    const color = typeof x.color === "string" || isArray(x.color) ? x.color : null;
    return { id: ids.get(x.shape), name: name, color: color, key: key };
  }
  throw fail("DSL_BAD_RETURN", where + " is not a shape or a { name, shape } descriptor (got " + (x === null ? "null" : isArray(x) ? "an array" : typeof x) + ")",
    "Return a shape, an array of shapes, [{ name, shape, color }], or an object of named shapes.");
}
g.__finish = function (ret) {
  const parts = [];
  if (ret === undefined) throw fail("DSL_BAD_RETURN", "the script returned nothing", "End the script with return, for example return box(10, 10, 10);");
  if (isArray(ret)) {
    for (let i = 0; i < ret.length; i++) {
      const x = ret[i];
      if (x === null || x === undefined || x === false) continue;
      if (isArray(x)) { for (let j = 0; j < x.length; j++) if (x[j]) parts.push(part(x[j], null, "item " + i + "[" + j + "]")); continue; }
      parts.push(part(x, null, "item " + i));
    }
  } else if (ids.has(ret) || (ret && typeof ret === "object" && ids.has(ret.shape))) {
    parts.push(part(ret, null, "the return value"));
  } else if (ret && typeof ret === "object") {
    for (const key of Object.keys(ret)) {
      const x = ret[key];
      if (x === null || x === undefined || x === false) continue;
      parts.push(part(x, key, key));
    }
  } else {
    part(ret, null, "the return value");
  }
  if (parts.length === 0) throw fail("DSL_BAD_RETURN", "the script returned no shapes", "Return at least one 3D shape.");
  return { parts: parts };
};
})(globalThis);`;
