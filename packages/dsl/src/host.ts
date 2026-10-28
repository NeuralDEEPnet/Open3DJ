// The host functions behind the guest prelude. Each takes plain data (ids, numbers, small
// objects), checks it, runs the kernel through Solids/Sketches/Library, and returns a new id
// or plain data. Kernel failures leave as errors with code KERNEL_<code>, elements and hint.
import type { ParamValue, Vec3 } from "@open3dj/schemas";
import type { KernelAdapter } from "@open3dj/kernel";
import type { GuestValue, HostFunction } from "@open3dj/sandbox";
import * as B from "brepjs";
import { DslError, badArgument, guard } from "./errors.ts";
import { Library, fastener } from "./lib.ts";
import type { LibShape } from "./lib.ts";
import { normalize, parseColor } from "./math.ts";
import { matchEdges, parseEdgeQuery } from "./queries.ts";
import { nameElement } from "./refs.ts";
import { Sketches, drawPath } from "./sketch.ts";
import { Solids } from "./solid.ts";
import { dir3, ids, int, nonNeg, num, obj, optNum, pos, str, vec2, vec3 } from "./state.ts";
import type { ConnectorFrame, ParamSpec, RunState, SketchEntry, SolidEntry } from "./state.ts";

export interface HostParts {
  solids: Solids;
  sketches: Sketches;
  library: Library;
}

export function hostFunctions(kernel: KernelAdapter, state: RunState, parts: HostParts): Record<string, HostFunction> {
  const { solids, sketches, library } = parts;
  const shape = (id: GuestValue | undefined, what?: string) => state.shape(id ?? null, what);
  const sketch = (id: GuestValue | undefined, what?: string) => state.sketch(id ?? null, what);
  const put = (e: SolidEntry | SketchEntry) => state.add(e);
  const solidOf = (handle: SolidEntry["handle"], extra: Partial<SolidEntry> = {}) => state.solid(handle, extra);
  const fromLib = (s: LibShape) => solidOf(s.handle, s.connectors ? { connectors: s.connectors } : {});

  const fns: Record<string, (...a: GuestValue[]) => GuestValue> = {
    // ---- parameters -------------------------------------------------------------------
    param: (kind, name, def, opts) => declareParam(state, kind, name, def, opts),

    // ---- 3D primitives (3dj conventions: box centred on XY with its base on Z = 0) ------
    box: (w, d, h) => {
      const [x, y, z] = [pos(w, "box width"), pos(d, "box depth"), pos(h, "box height")];
      return solidOf(kernel.translate(kernel.box(x, y, z), [-x / 2, -y / 2, 0]));
    },
    cylinder: (h, r, rTop) => {
      const height = pos(h, "cylinder height");
      const radius = pos(r, "cylinder radius");
      if (rTop === null || rTop === undefined || rTop === radius) return solidOf(kernel.cylinder(radius, height));
      return solidOf(kernel.cone(radius, nonNeg(rTop, "cylinder radiusTop"), height));
    },
    sphere: (r) => solidOf(kernel.sphere(pos(r, "sphere radius"))),
    torus: (R, r) => {
      const major = pos(R, "torus major radius");
      const minor = pos(r, "torus minor radius");
      if (minor >= major) throw badArgument(`torus minor radius (${minor}) must be smaller than the major radius (${major})`);
      return solidOf(kernel.torus(major, minor));
    },

    // ---- 2D profiles (centred on the origin) -------------------------------------------
    rect: (w, h) => put(sketches.drawing(B.drawRectangle(pos(w, "rect width"), pos(h, "rect height")))),
    roundedRect: (w, h, r) => {
      const [x, y] = [pos(w, "roundedRect width"), pos(h, "roundedRect height")];
      const radius = nonNeg(r ?? 0, "roundedRect radius");
      if (radius * 2 > Math.min(x, y) + 1e-9) throw badArgument(`roundedRect radius ${radius} is more than half the smaller side (${Math.min(x, y) / 2})`);
      return put(sketches.drawing(radius === 0 ? B.drawRectangle(x, y) : B.drawRoundedRectangle(x, y, radius)));
    },
    circle2d: (r) => put(sketches.drawing(B.drawCircle(pos(r, "circle2d radius")))),
    ellipse: (rx, ry) => {
      return put(sketches.ellipse(pos(rx, "ellipse rx"), pos(ry, "ellipse ry")));
    },
    ngon: (n, r) => put(sketches.drawing(B.drawPolysides(pos(r, "ngon radius"), int(n, "ngon sides", 3, 1000)))),
    star: (n, R, r) => {
      const points = int(n, "star points", 2, 1000);
      const outer = pos(R, "star outer radius");
      const inner = pos(r, "star inner radius");
      if (inner >= outer) throw badArgument(`star inner radius (${inner}) must be smaller than the outer radius (${outer})`);
      const pts = Array.from({ length: 2 * points }, (_, i) => {
        const a = Math.PI / 2 + (i * Math.PI) / points;
        const rr = i % 2 ? inner : outer;
        return [rr * Math.cos(a), rr * Math.sin(a)] as [number, number];
      });
      return put(sketches.polygon(pts));
    },
    slot: (len, w) => {
      const [l, width] = [pos(len, "slot length"), pos(w, "slot width")];
      if (width > l) throw badArgument(`slot width (${width}) must not exceed its length (${l})`);
      // A stadium: a rounded rectangle whose corner radius is exactly half the width. A radius
      // a hair less left 2e-6 mm sliver faces at the ends, which broke meshes, fillets and shells.
      return put(sketches.drawing(B.drawRoundedRectangle(l, width, width / 2)));
    },
    polygon: (points) => {
      if (!Array.isArray(points)) throw badArgument("polygon needs a list of [x, y] points");
      return put(sketches.polygon(points.map((p, i) => vec2(p, `polygon point ${i}`))));
    },
    path: (cmds) => {
      if (!Array.isArray(cmds)) throw badArgument("path(): malformed command list");
      return put(sketches.drawing(drawPath(cmds)));
    },

    // ---- sketch operations ---------------------------------------------------------------
    skOffset: (id, d) => put(sketches.offset(sketch(id), num(d, "offset distance"))),
    skFillet: (id, r) => put(sketches.filletCorners(sketch(id), pos(r, "filletCorners radius"))),
    skChamfer: (id, r) => put(sketches.chamferCorners(sketch(id), pos(r, "chamferCorners size"))),
    skTranslate: (id, x, y) => put(sketches.translate(sketch(id), num(x, "x"), num(y, "y"))),
    skRotate: (id, deg) => put(sketches.rotate(sketch(id), num(deg, "angle"))),
    skScale: (id, f) => put(sketches.scale(sketch(id), pos(f, "scale factor"))),
    skMirror: (id, n) => put(sketches.mirror(sketch(id), vec2(n, "mirror normal"))),
    skBoolean: (op, id, others) => {
      if (op !== "add" && op !== "subtract" && op !== "intersect") throw badArgument("unknown sketch boolean");
      return put(sketches.boolean(op, sketch(id), ids(others, "sketches").map((o) => sketch(o))));
    },
    skArea: (id) => sketches.area(sketch(id)),
    skBounds: (id) => sketches.bounds(sketch(id)),
    skExtrude: (id, h, opts) => {
      const o = obj(opts, "extrude options");
      const height = num(h, "extrude height");
      if (height === 0) throw badArgument("extrude height must not be 0");
      const r = sketches.extrude(sketch(id), height, { twist: optNum(o["twist"], "twist", 0), scaleTop: optNum(o["scaleTop"], "scaleTop", 1) });
      return solidOf(r.handle, r.prismWire !== undefined ? { prism: { wire: r.prismWire, height, angle: 0, offset: [0, 0, 0] } } : {});
    },
    skRevolve: (id, deg) => {
      const angle = num(deg, "revolve angle");
      if (angle === 0 || Math.abs(angle) > 360) throw badArgument(`revolve angle must be in (0, 360], got ${angle}`);
      return solidOf(sketches.revolve(sketch(id), angle));
    },
    loft: (profiles, heights) => {
      const ps = ids(profiles, "loft profiles").map((p) => sketch(p, "loft profile"));
      if (ps.length < 2) throw badArgument("loft needs at least 2 profiles");
      if (!Array.isArray(heights) || heights.length !== ps.length) throw badArgument(`loft needs one height per profile (${ps.length}), for example loft([a, b], [0, 20])`);
      const hs = heights.map((h, i) => num(h, `loft height ${i}`));
      for (let i = 1; i < hs.length; i++) if (!(hs[i]! > hs[i - 1]!)) throw badArgument("loft heights must increase");
      return solidOf(sketches.loft(ps, hs));
    },

    // ---- transforms ------------------------------------------------------------------------
    translate: (id, d) => put(solids.translate(shape(id), vec3(d, "translation"))),
    rotate: (id, axis, deg, pivot) => put(solids.rotate(shape(id), dir3(axis, "rotation axis"), num(deg, "rotation angle"), vec3(pivot ?? [0, 0, 0], "pivot"))),
    scale: (id, f) => put(solids.scale(shape(id), pos(f, "scale factor"))),
    mirror: (id, n, at) => put(solids.mirror(shape(id), dir3(n, "mirror normal"), vec3(at ?? [0, 0, 0], "mirror point"))),
    pointAlong: (id, d) => put(solids.pointAlong(shape(id), dir3(d, "direction"))),
    moveTo: (id, p) => put(solids.moveTo(shape(id), vec3(p, "position"))),
    clone: (id) => put(solids.clone(shape(id))),

    // ---- booleans ----------------------------------------------------------------------------
    union: (id, others) => put(solids.union(shape(id), ids(others, "shapes").map((o) => shape(o)))),
    subtract: (id, others) => put(solids.subtract(shape(id), ids(others, "tools").map((o) => shape(o)))),
    intersect: (id, others) => put(solids.intersect(shape(id), ids(others, "shapes").map((o) => shape(o)))),
    cutPlane: (id, plane, offset, keep) => put(solids.cutPlane(shape(id), str(plane, "plane", 4), num(offset, "offset"), str(keep, "keep", 10))),

    // ---- features -----------------------------------------------------------------------------
    fillet: (id, r, q) => put(solids.fillet(shape(id), pos(r, "fillet radius"), parseEdgeQuery(q))),
    chamfer: (id, d, q) => put(solids.chamfer(shape(id), pos(d, "chamfer size"), parseEdgeQuery(q))),
    shell: (id, t, opts) => {
      const o = obj(opts, "shell options");
      const thickness = num(t, "shell thickness");
      if (thickness === 0) throw badArgument("shell thickness must not be 0");
      return put(solids.shell(shape(id), thickness, o["openTop"] === undefined ? true : !!o["openTop"], !!o["openBottom"]));
    },
    edges: (id, q) => {
      const { matched } = matchEdges(kernel, shape(id).handle, parseEdgeQuery(q), solids.tol);
      return matched.map((e) => ({ index: e.index, curve: e.curve, length: e.length, start: e.start, end: e.end }));
    },

    // ---- patterns -------------------------------------------------------------------------------
    linearPattern: (id, count, d) => put(solids.linearPattern(shape(id), int(count, "pattern count", 1, 1000), vec3(d, "pattern step"))),
    circularPattern: (id, count, opts) => {
      const o = obj(opts, "circularPattern options");
      const center: Vec3 = [optNum(o["centerX"], "centerX", 0), optNum(o["centerY"], "centerY", 0), 0];
      return put(solids.circularPattern(shape(id), int(count, "pattern count", 1, 1000), center, optNum(o["startDeg"], "startDeg", 0), optNum(o["angle"], "angle", 360)));
    },
    mirrorCopy: (id, n) => put(solids.mirrorCopy(shape(id), dir3(n, "mirror normal"))),

    // ---- measures ---------------------------------------------------------------------------------
    volume: (id) => kernel.volume(shape(id).handle),
    area: (id) => kernel.area(shape(id).handle),
    bounds: (id) => solids.bounds(shape(id)) as unknown as GuestValue,
    geometryInfo: (id) => solids.geometryInfo(shape(id)),

    // ---- metadata, references, connectors ------------------------------------------------------------
    meta: (id, m) => {
      const e = shape(id);
      const o = obj(m, "metadata");
      if (o["name"] !== undefined) return put(solids.withMeta(e, { name: str(String(o["name"]), "name", 200) }));
      const color = parseColor(o["color"]);
      if (!color) throw badArgument(`color must be "#rrggbb", "#rgb" or [r, g, b], got ${JSON.stringify(o["color"])}`);
      return put(solids.withMeta(e, { color }));
    },
    withReferences: (id, map) => {
      const e = shape(id);
      const refs = { ...e.refs };
      const named = { ...e.named };
      for (const [k, v] of Object.entries(obj(map, "references"))) {
        const name = str(k, "reference name", 100);
        // A point [x, y, z] is a construction point; { face } or { edge } names an element.
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          if (!/^[A-Za-z0-9_-]+$/.test(name)) throw badArgument(`reference name "${name}" for a face or edge may use letters, digits, _ and - only`);
          ownSet(named, name, nameElement(kernel, e.handle, v, name, solids.tol));
          delete refs[name];
        } else {
          ownSet(refs, name, vec3(v, `reference ${k}`));
          delete named[name];
        }
      }
      return put(solids.withMeta(e, Object.keys(named).length ? { refs, named } : { refs }));
    },
    referenceNames: (id) => Object.keys(shape(id).refs),
    referencePoint: (id, name) => solids.anchor(shape(id), str(name, "reference name", 100)),
    placeReference: (id, name, at) => {
      const e = shape(id);
      const p = solids.anchor(e, str(name, "reference name", 100));
      const target = vec3(at, "position");
      return put(solids.translate(e, [target[0] - p[0], target[1] - p[1], target[2] - p[2]]));
    },
    attachTo: (id, parent, pa, ma, offset) =>
      put(solids.attachTo(shape(id), shape(parent, "attachTo parent"), str(pa, "parent anchor", 100), str(ma, "own anchor", 100), vec3(offset ?? [0, 0, 0], "offset"))),
    withConnectors: (id, map) => {
      const e = shape(id);
      const connectors = { ...e.connectors };
      for (const [k, v] of Object.entries(obj(map, "connectors"))) ownSet(connectors, str(k, "connector name", 100), connectorFrame(k, v));
      return put(solids.withMeta(e, { connectors }));
    },
    matchTo: (id, target, m, t) => {
      const moving = shape(id);
      const tgt = shape(target, "matchTo target");
      const mName = str(m, "moving connector name", 100);
      const tName = str(t, "target connector name", 100);
      const out = solids.matchTo(moving, tgt, mName, tName);
      const mate = { movingBody: out.body, movingConnector: mName, targetBody: tgt.body, targetConnector: tName };
      state.mates.push(state.line === undefined ? mate : { ...mate, line: state.line });
      return put(out);
    },

    // ---- lib ------------------------------------------------------------------------------------------
    fastener: (size) => fastener(size) as unknown as GuestValue,
    lib: (name, args) => {
      const a = Array.isArray(args) ? args : [];
      switch (name) {
        case "clearanceHole": return fromLib(library.clearanceHole(a[0], a[1]));
        case "screwCutter": return fromLib(library.screwCutter(a[0], a[1]));
        case "heatSetPocket": return fromLib(library.heatSetPocket(a[0], a[1]));
        case "hexNutPocket": return fromLib(library.hexNutPocket(a[0], a[1]));
        case "bolt": return fromLib(library.bolt(a[0], a[1]));
        case "nut": return fromLib(library.nut(a[0]));
        case "washer": return fromLib(library.washer(a[0]));
        default: throw new DslError("DSL_NOT_IMPLEMENTED", `lib.${String(name)} is not implemented in Open3DJ DSL v1 yet`);
      }
    },
  };

  // Every function converts kernel failures; the op name is the DSL entry the user called.
  return Object.fromEntries(Object.entries(fns).map(([name, fn]) => [name, (...args: GuestValue[]) => guard(opName(name), () => fn(...args))]));
}

function opName(fn: string): string {
  if (fn.startsWith("sk")) return `sketch.${fn.slice(2, 3).toLowerCase()}${fn.slice(3)}`;
  return fn;
}

/** Set an own property, also for names like "__proto__" that plain assignment would treat specially. */
function ownSet<T>(o: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}

function connectorFrame(name: string, v: GuestValue): ConnectorFrame {
  const o = obj(v, `connector ${name}`);
  const kind = o["kind"];
  if (kind !== "male" && kind !== "female") throw badArgument(`connector ${name} must come from connector.male() or connector.female()`);
  const type = o["type"] === undefined || o["type"] === null ? "seat" : str(o["type"], `connector ${name} type`, 100);
  const origin = vec3(o["origin"], `connector ${name} origin`);
  const axis = normalize(dir3(o["axis"], `connector ${name} axis`));
  const up = normalize(dir3(o["up"] ?? perpendicular(axis), `connector ${name} up`));
  if (Math.abs(axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2]) > 1e-6) throw badArgument(`connector ${name}: up must be perpendicular to axis`);
  return { kind, type, origin, axis, up };
}

function perpendicular(a: Vec3): Vec3 {
  return Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
}

/** Resolve one Param.* declaration: the caller's override, or the default, checked and clamped. */
function declareParam(state: RunState, kind: GuestValue, nameIn: GuestValue, def: GuestValue, optsIn: GuestValue): ParamValue {
  const name = str(nameIn, "Param name", 100);
  const known = state.params.get(name);
  if (known) return known.value;
  const opts = obj(optsIn, `Param ${name} options`);
  const has = Object.hasOwn(state.overrides, name);
  const given = state.overrides[name];
  const bad = (message: string) => new DslError("DSL_BAD_PARAM", `Param ${name}: ${message}`);
  let spec: ParamSpec;
  switch (kind) {
    case "number": {
      if (typeof def !== "number" || !Number.isFinite(def)) throw bad("the default must be a finite number");
      const raw = has ? given : def;
      let v = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof v !== "number" || !Number.isFinite(v)) throw bad(`the value must be a number, got ${JSON.stringify(raw)}`);
      spec = { name, type: "number", default: def, value: v };
      if (opts["integer"]) {
        spec.integer = true;
        v = Math.round(v);
      }
      for (const k of ["min", "max", "step"] as const) if (opts[k] !== undefined) spec[k] = num(opts[k], `Param ${name} ${k}`);
      if (typeof opts["unit"] === "string") spec.unit = opts["unit"].slice(0, 20);
      if (spec.min !== undefined && v < spec.min) {
        state.warn(`Param ${name} = ${v} is below its minimum ${spec.min}; using ${spec.min}`);
        v = spec.min;
      }
      if (spec.max !== undefined && v > spec.max) {
        state.warn(`Param ${name} = ${v} is above its maximum ${spec.max}; using ${spec.max}`);
        v = spec.max;
      }
      spec.value = v;
      break;
    }
    case "bool": {
      const raw = has ? given : def;
      const v = raw === "true" ? true : raw === "false" ? false : !!raw;
      spec = { name, type: "bool", default: !!def, value: v };
      break;
    }
    case "choice": {
      const options = opts["options"];
      if (!Array.isArray(options) || options.length === 0 || !options.every((x) => typeof x === "string" || typeof x === "number")) throw bad("options must be a non-empty list of strings or numbers");
      const list = options as (string | number)[];
      if (!list.includes(def as string | number)) throw bad(`the default ${JSON.stringify(def)} is not one of ${list.join(", ")}`);
      const v = has ? given : def;
      if (!list.includes(v as string | number)) throw bad(`${JSON.stringify(v)} is not one of ${list.join(", ")}`);
      spec = { name, type: "choice", default: def as ParamValue, value: v as ParamValue, options: list };
      break;
    }
    case "string": {
      const raw = has ? given : def;
      let v = String(raw ?? "");
      spec = { name, type: "string", default: String(def ?? ""), value: v };
      if (opts["maxLength"] !== undefined) {
        spec.maxLength = int(opts["maxLength"], `Param ${name} maxLength`, 0, 100000);
        v = v.slice(0, spec.maxLength);
        spec.value = v;
      }
      break;
    }
    default:
      throw bad("unknown Param kind");
  }
  state.params.set(name, spec);
  return spec.value;
}
