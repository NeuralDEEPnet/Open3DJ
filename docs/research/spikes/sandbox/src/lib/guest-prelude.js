// Guest-side 3dj-style DSL facade. Runs INSIDE QuickJS before the agent script.
// It only ever sees integer handles; every geometric operation is a host call on
// the hidden capability object __k, which is captured here and deleted from the global.
"use strict";
(function installDsl(g) {
  const K = g.__k;
  const RAW_PARAMS = g.__params;
  delete g.__k;
  delete g.__params;
  // Capture intrinsics we rely on BEFORE user code runs (defence against poisoning
  // even if freezing were disabled).
  const JSONparse = JSON.parse, JSONstringify = JSON.stringify;
  const isArray = Array.isArray;
  const TOKEN = {};
  const params = RAW_PARAMS ? JSONparse(RAW_PARAMS) : {};
  const flat = (xs) => { const out = []; const walk = (x) => { if (isArray(x)) { for (let i = 0; i < x.length; i++) walk(x[i]); } else out.push(x); }; walk(xs); return out; };
  const idOf = (s) => { if (!(s instanceof Shape)) throw new TypeError("expected a Shape, got " + (s === null ? "null" : typeof s)); return s.id; };

  class Shape {
    #id; #name; #color;
    constructor(token, id) {
      if (token !== TOKEN) throw new TypeError("Shape cannot be constructed directly; use box(), cylinder(), ...");
      this.#id = id;
    }
    get id() { return this.#id; }
    translate(x = 0, y = 0, z = 0) { return wrap(K.translate(this.#id, x, y, z)); }
    rotate(angleDeg, axis = "Z") {
      const a = axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : axis === "Z" ? [0, 0, 1] : axis;
      return wrap(K.rotate(this.#id, a[0], a[1], a[2], angleDeg));
    }
    add(...others) { return union(this, ...others); }
    subtract(...others) { return difference(this, ...others); }
    intersect(other) { return wrap(K.common(this.#id, idOf(other))); }
    fillet(r, query) { return fillet(this, r, query); }
    chamfer(d, query) { return chamfer(this, d, query); }
    volume() { return K.volume(this.#id); }
    bounds() { return JSONparse(K.bounds(this.#id)); }
    name(n) { this.#name = String(n); return this; }
    color(c) { this.#color = String(c); return this; }
    get meta() { return { name: this.#name, color: this.#color }; }
  }
  const wrap = (id) => new Shape(TOKEN, id);

  const box = (w, d, h) => wrap(K.box(w, d, h));
  const cylinder = (h, r, rTop) => wrap(rTop === undefined ? K.cylinder(h, r) : K.cone(h, r, rTop));
  const sphere = (r) => wrap(K.sphere(r));
  const translate = (s, x, y, z) => s.translate(x, y, z);
  const rotate = (s, a, axis) => s.rotate(a, axis);
  function union(...shapes) {
    const ids = flat(shapes).map(idOf);
    if (ids.length === 1) return wrap(ids[0]);
    return wrap(ids.length === 2 ? K.fuse(ids[0], ids[1]) : K.fuseAll(...ids));
  }
  function difference(base, ...tools) {
    const ids = flat(tools).map(idOf);
    if (ids.length === 0) return base;
    return wrap(ids.length === 1 ? K.cut(idOf(base), ids[0]) : K.cutAll(idOf(base), ...ids));
  }
  const intersection = (a, b) => a.intersect(b);
  // Edge queries are evaluated on the HOST in one call, not edge-by-edge across the boundary.
  const fillet = (s, r, query) => wrap(K.fillet(idOf(s), r, JSONstringify(query || {})));
  const chamfer = (s, d, query) => wrap(K.chamfer(idOf(s), d, JSONstringify(query || {})));
  const linearPattern = (s, n, dx, dy = 0, dz = 0) => { const out = []; for (let i = 0; i < n; i++) out.push(s.translate(i * dx, i * dy, i * dz)); return out; };
  const circularPattern = (s, n, totalDeg = 360) => { const out = []; for (let i = 0; i < n; i++) out.push(s.rotate((i * totalDeg) / n, "Z")); return out; };
  const volume = (s) => s.volume();
  const bounds = (s) => s.bounds();

  const Param = Object.freeze({
    number(name, def, opts = {}) {
      let v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : def;
      if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`Param ${name} must be a finite number`);
      if (opts.min !== undefined && v < opts.min) v = opts.min;
      if (opts.max !== undefined && v > opts.max) v = opts.max;
      return v;
    },
    bool(name, def) { return Object.prototype.hasOwnProperty.call(params, name) ? !!params[name] : !!def; },
    string(name, def) { return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : String(def); },
    choice(name, def, options) { const v = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : def; if (!options.includes(v)) throw new RangeError(`Param ${name} must be one of ${options.join(", ")}`); return v; },
  });

  // Normalise the script's return value to plain JSON: [{name, id, color}]
  function finish(ret) {
    const list = isArray(ret) ? ret : [ret];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item instanceof Shape) out.push({ name: item.meta.name || `part${i + 1}`, id: item.id, color: item.meta.color || null });
      else if (item && item.shape instanceof Shape) out.push({ name: String(item.name || `part${i + 1}`), id: item.shape.id, color: item.color ? String(item.color) : null });
      else throw new TypeError("script must return a Shape, an array of Shapes, or {name, shape, color} descriptors");
    }
    return JSONstringify(out);
  }

  const api = { Shape: undefined, box, cylinder, sphere, translate, rotate, union, difference, intersection,
    add: union, subtract: difference, intersect: intersection, fillet, chamfer, linearPattern, circularPattern,
    volume, bounds, Param };
  for (const k of Object.keys(api)) if (api[k] !== undefined) Object.defineProperty(g, k, { value: api[k], writable: false, enumerable: false, configurable: false });
  Object.defineProperty(g, "__finish", { value: finish, writable: false, enumerable: false, configurable: false });
})(globalThis);
