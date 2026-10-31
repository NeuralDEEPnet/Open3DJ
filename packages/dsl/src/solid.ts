// 3D operations on host entries. Every shape-changing op goes through the kernel adapter,
// which runs isValid after booleans, fillets, chamfers, shells, extrudes, revolves and lofts.
import type { BBox, Transform, Vec3 } from "@open3dj/schemas";
import { KernelError } from "@open3dj/kernel";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import { DslError, badArgument } from "./errors.ts";
import { IDENTITY, add, cross, dot, length, mirrorDir, mirrorPoint, mul, normalize, rotatePoint, sub, thenRotate, thenTranslate } from "./math.ts";
import { matchEdges } from "./queries.ts";
import { moveFingerprint } from "./refs.ts";
import type { NamedRef } from "./refs.ts";
import { checkShellWalls } from "./shellcheck.ts";
import type { EdgeQuery } from "./queries.ts";
import type { Sketches } from "./sketch.ts";
import type { ConnectorFrame, Prism, RunState, SolidEntry } from "./state.ts";

export interface Bounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export function boundsOf(b: BBox): Bounds {
  return { min: b.min, max: b.max, size: sub(b.max, b.min), center: mul(add(b.min, b.max), 0.5) };
}

interface DeriveHow {
  pt?: (p: Vec3) => Vec3;
  dir?: (d: Vec3) => Vec3;
  /** Rigid transforms keep the body and update the clone lineage; anything else starts a new body. */
  rigid?: (t: Transform) => Transform;
  prism?: Prism;
}

export class Solids {
  readonly kernel: KernelAdapter;
  readonly state: RunState;
  readonly sketches: Sketches;
  readonly tol: number;

  constructor(kernel: KernelAdapter, state: RunState, sketches: Sketches, tol: number) {
    this.kernel = kernel;
    this.state = state;
    this.sketches = sketches;
    this.tol = tol;
  }

  /** A new entry for a new shape, carrying refs, connectors, name and colour from e. */
  derive(e: SolidEntry, handle: ShapeHandle, how: DeriveHow = {}): SolidEntry {
    const pt = how.pt ?? ((p: Vec3) => p);
    const dir = how.dir ?? ((d: Vec3) => d);
    const refs = Object.fromEntries(Object.entries(e.refs).map(([k, p]) => [k, pt(p)]));
    const connectors = Object.fromEntries(Object.entries(e.connectors).map(([k, c]) => [k, { ...c, origin: pt(c.origin), axis: dir(c.axis), up: dir(c.up) }]));
    const out: SolidEntry = { kind: "shape", handle, refs, connectors, body: how.rigid ? e.body : this.state.newBody() };
    if (e.named) {
      // Named faces and edges move with the shape; collect() resolves them on the final part.
      // frame collects the rigid moves since naming (the next revision compares in the naming
      // frame); a mirror or scale changes the element itself, so the moved fingerprint becomes
      // the new naming frame. Booleans and features (no pt) keep the frame.
      out.named = Object.fromEntries(Object.entries(e.named).map(([k, r]) => {
        const moved: NamedRef = r.fingerprint ? { ...r, fingerprint: moveFingerprint(r.fingerprint, pt, dir) } : { ...r };
        if (how.rigid) moved.frame = how.rigid(r.frame ?? IDENTITY);
        else if (how.pt) delete moved.frame;
        return [k, moved];
      }));
    }
    if (e.name !== undefined) out.name = e.name;
    if (e.color !== undefined) out.color = e.color;
    if (how.rigid && e.lineage) out.lineage = { id: e.lineage.id, t: how.rigid(e.lineage.t) };
    if (how.prism) out.prism = how.prism;
    return out;
  }

  /** Same shape, new metadata (name, colour, references, connectors). */
  withMeta(e: SolidEntry, meta: Partial<Pick<SolidEntry, "name" | "color" | "refs" | "named" | "connectors">>): SolidEntry {
    const out: SolidEntry = { ...e, ...meta };
    delete out.line; // the new entry gets the line of the call that made it
    return out;
  }

  // ---- transforms ---------------------------------------------------------------------
  translate(e: SolidEntry, d: Vec3): SolidEntry {
    const prism = e.prism ? { ...e.prism, offset: add(e.prism.offset, d) } : undefined;
    return this.derive(e, this.kernel.translate(e.handle, d), {
      pt: (p) => add(p, d),
      rigid: (t) => thenTranslate(t, d),
      ...(prism ? { prism } : {}),
    });
  }

  rotate(e: SolidEntry, axis: Vec3, deg: number, pivot: Vec3): SolidEntry {
    // A turn about Z keeps the extrusion upright, so shell's profile-offset fallback still applies.
    const n = normalize(axis);
    const aboutZ = Math.abs(n[0]) < 1e-12 && Math.abs(n[1]) < 1e-12;
    const prism = e.prism && aboutZ
      ? { ...e.prism, angle: e.prism.angle + Math.sign(n[2]) * deg, offset: rotatePoint(e.prism.offset, axis, deg, pivot) }
      : undefined;
    return this.derive(e, this.kernel.rotate(e.handle, deg, { origin: pivot, dir: axis }), {
      pt: (p) => rotatePoint(p, axis, deg, pivot),
      dir: (v) => rotatePoint(v, axis, deg),
      rigid: (t) => thenRotate(t, axis, deg, pivot),
      ...(prism ? { prism } : {}),
    });
  }

  mirror(e: SolidEntry, normal: Vec3, at: Vec3): SolidEntry {
    return this.derive(e, this.kernel.mirror(e.handle, { origin: at, normal }), {
      pt: (p) => mirrorPoint(p, normal, at),
      dir: (v) => mirrorDir(v, normal),
    });
  }

  scale(e: SolidEntry, f: number): SolidEntry {
    return this.derive(e, this.kernel.scale(e.handle, f, [0, 0, 0]), { pt: (p) => mul(p, f) });
  }

  /** Lay the shape's +Z axis along dir, rotating about the origin. */
  pointAlong(e: SolidEntry, dirIn: Vec3): SolidEntry {
    const d = normalize(dirIn);
    const c = dot([0, 0, 1], d);
    if (c > 1 - 1e-12) return this.translate(e, [0, 0, 0]);
    if (c < -1 + 1e-12) return this.rotate(e, [1, 0, 0], 180, [0, 0, 0]);
    return this.rotate(e, cross([0, 0, 1], d), (Math.acos(c) * 180) / Math.PI, [0, 0, 0]);
  }

  /** Put the bounding-box min corner at p. */
  moveTo(e: SolidEntry, p: Vec3): SolidEntry {
    return this.translate(e, sub(p, this.bounds(e).min));
  }

  /** A rigid copy: a new body in the same clone lineage as e (one shared definition later). */
  clone(e: SolidEntry): SolidEntry {
    if (!e.lineage) e.lineage = { id: this.state.newLineage(), t: IDENTITY };
    const out: SolidEntry = { ...e, body: this.state.newBody(), lineage: { ...e.lineage }, refs: { ...e.refs }, connectors: { ...e.connectors } };
    if (e.named) out.named = { ...e.named };
    delete out.line;
    return out;
  }

  // ---- anchors, references, connectors ------------------------------------------------
  anchor(e: SolidEntry, name: string): Vec3 {
    // Own keys only: names like "constructor" must not find Object.prototype members.
    if (Object.hasOwn(e.refs, name)) return e.refs[name]!;
    const b = this.bounds(e);
    const c = b.center;
    const anchors: Record<string, Vec3> = {
      center: c,
      top: [c[0], c[1], b.max[2]],
      bottom: [c[0], c[1], b.min[2]],
      left: [b.min[0], c[1], c[2]],
      right: [b.max[0], c[1], c[2]],
      front: [c[0], b.min[1], c[2]],
      back: [c[0], b.max[1], c[2]],
    };
    const a = Object.hasOwn(anchors, name) ? anchors[name] : undefined;
    if (!a) {
      const known = [...Object.keys(e.refs), ...Object.keys(anchors)].join(", ");
      throw new DslError("DSL_UNKNOWN_ANCHOR", `unknown anchor or reference "${name}"`, `Use one of: ${known}.`);
    }
    return a;
  }

  attachTo(e: SolidEntry, parent: SolidEntry, parentAnchor: string, myAnchor: string, offset: Vec3): SolidEntry {
    const target = this.anchor(parent, parentAnchor);
    const mine = this.anchor(e, myAnchor);
    return this.translate(e, add(sub(target, mine), offset));
  }

  /** Seat connector m of e on connector f of target: axes anti-aligned, ups aligned, origins together. */
  matchTo(e: SolidEntry, target: SolidEntry, movingName: string, targetName: string): SolidEntry {
    const m = Object.hasOwn(e.connectors, movingName) ? e.connectors[movingName] : undefined;
    const f = Object.hasOwn(target.connectors, targetName) ? target.connectors[targetName] : undefined;
    if (!m || !f) {
      const [who, name, list] = !m ? ["this part", movingName, e.connectors] : ["the target", targetName, target.connectors];
      throw new DslError("DSL_MISSING_CONNECTOR", `matchTo: ${who} has no connector "${name}"`, `Connectors there: ${Object.keys(list).join(", ") || "none"}. Add them with withConnectors().`);
    }
    let s = this.align(e, m.axis, mul(f.axis, -1));
    // The second turn must keep the seated axis: when the ups are opposite it is a half turn
    // about the connector axis, not about an arbitrary perpendicular.
    s = this.align(s, s.connectors[movingName]!.up, f.up, f.axis);
    return this.translate(s, sub(f.origin, s.connectors[movingName]!.origin));
  }

  /**
   * Rotate about the origin so that direction `from` points along `to`. When the two are
   * opposite, the half turn is about `halfTurnAxis` if given (it must be perpendicular to
   * `from`), otherwise about any perpendicular.
   */
  align(e: SolidEntry, from: Vec3, to: Vec3, halfTurnAxis?: Vec3): SolidEntry {
    const a = normalize(from);
    const b = normalize(to);
    const c = dot(a, b);
    if (c > 1 - 1e-12) return e;
    let axis = cross(a, b);
    if (length(axis) < 1e-12) axis = halfTurnAxis ? normalize(halfTurnAxis) : Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return this.rotate(e, axis, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI, [0, 0, 0]);
  }

  // ---- booleans -----------------------------------------------------------------------
  union(e: SolidEntry, others: SolidEntry[]): SolidEntry {
    if (others.length === 0) return e;
    return this.derive(e, this.kernel.fuseAll([e.handle, ...others.map((o) => o.handle)]));
  }

  subtract(e: SolidEntry, tools: SolidEntry[]): SolidEntry {
    if (tools.length === 0) return e;
    return this.derive(e, this.kernel.cutAll(e.handle, tools.map((t) => t.handle)));
  }

  intersect(e: SolidEntry, others: SolidEntry[]): SolidEntry {
    let h = e.handle;
    for (const o of others) h = this.kernel.common(h, o.handle);
    return h === e.handle ? e : this.derive(e, h);
  }

  /** Keep the side of an axis plane: "positive" keeps coordinates >= offset. */
  cutPlane(e: SolidEntry, plane: string, offset: number, keep: string): SolidEntry {
    const axis = { XY: 2, XZ: 1, YZ: 0 }[plane.toUpperCase()];
    if (axis === undefined) throw badArgument(`cutPlane plane must be "XY", "XZ" or "YZ", got ${plane}`);
    if (keep !== "positive" && keep !== "negative") throw badArgument(`cutPlane keep must be "positive" or "negative", got ${keep}`);
    const b = this.bounds(e);
    const m = 10 + Math.max(...b.size);
    const lo = sub(b.min, [m, m, m]);
    const hi = add(b.max, [m, m, m]);
    if (keep === "positive") lo[axis] = offset;
    else hi[axis] = offset;
    const size = sub(hi, lo);
    if (size.some((x) => x <= 0)) throw badArgument("cutPlane keeps nothing of the shape", "Check the offset and the side to keep.");
    const big = this.kernel.translate(this.kernel.box(size[0], size[1], size[2]), lo);
    return this.derive(e, this.kernel.common(e.handle, big));
  }

  // ---- features -----------------------------------------------------------------------
  edges(e: SolidEntry, q: EdgeQuery, op: string): ShapeHandle[] {
    const { matched, handles, infos } = matchEdges(this.kernel, e.handle, q, this.tol);
    if (matched.length === 0) {
      throw new DslError("DSL_NO_EDGES", `${op}: the edge query ${JSON.stringify(q)} matched none of the ${infos.length} edges`, "Check the coordinates (atZ must be the exact Z of the edges), or list them with shape.edges().", { op });
    }
    return handles;
  }

  fillet(e: SolidEntry, r: number, q: EdgeQuery): SolidEntry {
    return this.derive(e, this.kernel.fillet(e.handle, this.edges(e, q, "fillet"), r));
  }

  chamfer(e: SolidEntry, d: number, q: EdgeQuery): SolidEntry {
    return this.derive(e, this.kernel.chamfer(e.handle, this.edges(e, q, "chamfer"), d));
  }

  /**
   * Hollow the shape with walls of thickness t inside its skin, removing the flat top
   * (openTop, default) and/or bottom faces. With neither open, the inside becomes a closed
   * void. When OCCT's thick-solid fails on a straight extrusion (for example a wall thicker
   * than the corner radius), the cavity is built from the profile offset instead. That needs
   * the extrusion still upright: translations and rotations about Z keep it, others drop it.
   */
  shell(e: SolidEntry, t: number, openTop: boolean, openBottom: boolean): SolidEntry {
    const solid = this.kernel.asSolid(e.handle);
    const b = this.bounds(e);
    const faces = this.kernel.subShapes(solid, "face");
    const remove = this.kernel.faces(solid).filter((f) => {
      if (f.surface !== "plane" || Math.abs(f.bbox.max[2] - f.bbox.min[2]) > this.tol) return false;
      return (openTop && Math.abs(f.bbox.max[2] - b.max[2]) <= this.tol) || (openBottom && Math.abs(f.bbox.min[2] - b.min[2]) <= this.tol);
    }).map((f) => faces[f.index - 1]!);
    if ((openTop || openBottom) && remove.length === 0) {
      throw badArgument("shell: no flat top or bottom face to open", "Use { openTop: false } for a closed hollow, or shell a shape with a flat top.");
    }
    try {
      const out = this.#shellOnce(solid, remove, t);
      const check = checkShellWalls(this.kernel, solid, remove, out, t, this.tol);
      if (check && (!check.cavity || check.badFaces.length > 0)) {
        throw new KernelError("INVALID_RESULT", "shell", check.cavity
          ? `shell produced walls that are not ${Math.abs(t)} mm thick; the kernel reported no error`
          : "shell produced no cavity; the kernel reported no error", { elements: check.badFaces });
      }
      return this.derive(e, out);
    } catch (err) {
      const shellFailed = err instanceof KernelError && (err.code === "SHELL_FAILED" || err.code === "INVALID_RESULT");
      if (!shellFailed || !e.prism || t <= 0) throw err;
      let out: SolidEntry;
      try {
        out = this.prismShell(e, e.prism, t, openTop, openBottom);
      } catch {
        throw err; // the fallback failed too: report the original failure
      }
      this.state.warn(`shell: OCCT's thick-solid failed (${(err as KernelError).message}); the cavity was cut from the profile offset instead`);
      return out;
    }
  }

  #shellOnce(solid: ShapeHandle, remove: ShapeHandle[], t: number): ShapeHandle {
    {
      if (remove.length === 0) {
        const raw = (this.kernel as { raw?: { offset(s: number, d: number, tol: number): number } }).raw;
        if (!raw) throw new KernelError("SHELL_FAILED", "shell", "shell: a closed hollow needs the occt-wasm kernel");
        let inner: ShapeHandle;
        try {
          inner = raw.offset(solid, -Math.abs(t), 1e-6) as ShapeHandle;
        } catch (err) {
          throw new KernelError("SHELL_FAILED", "shell", `shell failed: the inner offset failed (${err instanceof Error ? err.message : String(err)})`);
        }
        return this.kernel.cut(solid, inner);
      }
      return this.kernel.shell(solid, remove, t);
    }
  }

  prismShell(e: SolidEntry, prism: Prism, t: number, openTop: boolean, openBottom: boolean): SolidEntry {
    const inner = this.sketches.offset({ kind: "sketch", face: this.kernel.face(prism.wire) }, -t);
    const zLo = openBottom ? -1 : t;
    const zHi = openTop ? prism.height + 1 : prism.height - t;
    if (zHi - zLo <= 0) throw new KernelError("SHELL_FAILED", "shell", "shell failed: the wall is thicker than half the height");
    const upright = this.kernel.translate(this.kernel.extrude(inner.face!, [0, 0, zHi - zLo]), [0, 0, zLo]);
    const turned = prism.angle % 360 === 0 ? upright : this.kernel.rotate(upright, prism.angle, { origin: [0, 0, 0], dir: [0, 0, 1] });
    const cavity = this.kernel.translate(turned, prism.offset);
    return this.derive(e, this.kernel.cut(e.handle, cavity));
  }

  // ---- patterns -----------------------------------------------------------------------
  linearPattern(e: SolidEntry, count: number, d: Vec3): SolidEntry {
    if (count === 1) return e;
    const copies = Array.from({ length: count }, (_, i) => (i === 0 ? e.handle : this.kernel.translate(e.handle, mul(d, i))));
    return this.derive(e, this.kernel.fuseAll(copies));
  }

  circularPattern(e: SolidEntry, count: number, center: Vec3, startDeg: number, angle: number): SolidEntry {
    const full = Math.abs(Math.abs(angle) - 360) < 1e-9;
    const step = full ? angle / count : angle / Math.max(1, count - 1);
    const copies = Array.from({ length: count }, (_, i) => {
      const deg = startDeg + i * step;
      return deg === 0 ? e.handle : this.kernel.rotate(e.handle, deg, { origin: center, dir: [0, 0, 1] });
    });
    return this.derive(e, count === 1 ? copies[0]! : this.kernel.fuseAll(copies));
  }

  mirrorCopy(e: SolidEntry, normal: Vec3): SolidEntry {
    return this.derive(e, this.kernel.fuseAll([e.handle, this.kernel.mirror(e.handle, { origin: [0, 0, 0], normal })]));
  }

  // ---- measures -----------------------------------------------------------------------
  bounds(e: SolidEntry): Bounds {
    return boundsOf(this.kernel.bbox(e.handle));
  }

  geometryInfo(e: SolidEntry): { solids: number; shells: number; faces: number; edges: number; vertices: number; valid: boolean } {
    return { ...this.kernel.counts(e.handle), valid: this.kernel.isValid(e.handle) };
  }
}

export type { ConnectorFrame };
