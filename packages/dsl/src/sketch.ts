// 2D profiles. A profile is a brepjs Drawing while it is still being edited (booleans, corner
// fillets), or a kernel face once it has been offset. Solids are always made through the
// kernel adapter (extrude, revolve, loft are checked there), except twisted and tapered
// extrusions, which use brepjs sweeps and are checked here the same way.
import type { Vec3 } from "@open3dj/schemas";
import { KernelError } from "@open3dj/kernel";
import type { Kernel, KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import * as B from "brepjs";
import type { Drawing } from "brepjs";
import { DslError, badArgument, notImplemented } from "./errors.ts";
import type { SketchEntry } from "./state.ts";

/** brepjs results are { ok, value } or { ok: false, error }. */
function unwrap<T>(op: string, r: unknown): T {
  if (r && typeof r === "object" && "ok" in r) {
    const res = r as { ok: boolean; value?: T; error?: { code?: string; message?: string } };
    if (res.ok) return res.value as T;
    const e = res.error ?? {};
    throw new KernelError("CONSTRUCTION_FAILED", op, `${op} failed: ${e.message ?? e.code ?? "no detail"}`);
  }
  return r as T;
}

/** Kernel id of a brepjs shape (its handle wraps the occt-wasm arena id). */
function idOf(shape: unknown): ShapeHandle {
  const id = (shape as { wrapped?: { id?: unknown } })?.wrapped?.id;
  if (typeof id !== "number") throw new KernelError("CONSTRUCTION_FAILED", "brepjs", "brepjs returned no kernel shape");
  return id as ShapeHandle;
}

/** A brepjs shape for a kernel handle (the reverse of idOf). */
function brepShape(kind: "wire" | "face", id: ShapeHandle): unknown {
  return B.castShape({ __occtWasm: true, type: kind, id, delete() {}, HashCode: (u: number) => (id as number) % u, IsNull: () => false } as never);
}

export class Sketches {
  readonly kernel: KernelAdapter;
  readonly raw: Kernel["raw"] | undefined;

  constructor(kernel: KernelAdapter) {
    this.kernel = kernel;
    this.raw = (kernel as Partial<Kernel>).raw;
  }

  #needRaw(op: string): void {
    if (!this.raw) throw new DslError("DSL_UNSUPPORTED", `${op} needs the occt-wasm kernel (initKernel), not a kernel adapter fake`);
  }

  drawing(d: Drawing): SketchEntry {
    this.#needRaw("2D profiles");
    return { kind: "sketch", drawing: d };
  }

  /** The profile as kernel face(s) at z = 0. */
  face(s: SketchEntry): ShapeHandle {
    if (s.face !== undefined) return s.face;
    const sk = s.drawing!.clone().sketchOnPlane("XY") as unknown as { faces(): unknown };
    s.face = idOf(sk.faces());
    return s.face;
  }

  /** The single closed outer wire of the profile; refuses holes and several regions. */
  outerWire(s: SketchEntry, op: string): ShapeHandle {
    const face = this.face(s);
    const faces = this.kernel.shapeType(face) === "face" ? [face] : this.kernel.subShapes(face, "face");
    if (faces.length !== 1) throw badArgument(`${op} needs one closed profile, got ${faces.length} regions`, "Extrude the regions separately and union them.");
    if (this.kernel.subShapes(faces[0]!, "wire").length > 1) throw notImplemented(`${op} of a profile with holes`);
    return this.raw!.outerWire(faces[0]!) as ShapeHandle;
  }

  // ---- constructors -------------------------------------------------------------------
  polygon(points: [number, number][]): SketchEntry {
    const clean: [number, number][] = [];
    for (const p of points) {
      const q = clean[clean.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) clean.push(p);
    }
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (clean.length > 1 && first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) clean.pop();
    if (clean.length < 3) throw badArgument(`polygon needs at least 3 distinct points, got ${clean.length}`);
    let pen = B.draw(clean[0]!);
    for (const p of clean.slice(1)) pen = pen.lineTo(p);
    return this.drawing(pen.close());
  }

  // ---- transforms ---------------------------------------------------------------------
  /** Apply a 2D transform: as a Drawing op when possible, else to the kernel face. */
  transform(s: SketchEntry, onDrawing: (d: Drawing) => Drawing, onFace: (f: ShapeHandle) => ShapeHandle): SketchEntry {
    if (s.drawing) return { kind: "sketch", drawing: onDrawing(s.drawing) };
    return { kind: "sketch", face: onFace(s.face!) };
  }

  translate(s: SketchEntry, x: number, y: number): SketchEntry {
    return this.transform(s, (d) => d.translate(x, y), (f) => this.kernel.translate(f, [x, y, 0]));
  }

  rotate(s: SketchEntry, deg: number): SketchEntry {
    return this.transform(s, (d) => d.rotate(deg, [0, 0]), (f) => this.kernel.rotate(f, deg));
  }

  scale(s: SketchEntry, f: number): SketchEntry {
    return this.transform(s, (d) => d.scale(f, [0, 0]), (face) => this.kernel.scale(face, f));
  }

  /**
   * Mirror through the line through the origin whose NORMAL is n. brepjs's "plane" mode takes
   * the line's direction, so pass the normal turned by 90 degrees. (The spike passed the
   * normal as the direction and returned silently wrong geometry.)
   */
  mirror(s: SketchEntry, n: [number, number]): SketchEntry {
    const len = Math.hypot(n[0], n[1]);
    if (len < 1e-12) throw badArgument("mirror normal must not be the zero vector");
    const dir: [number, number] = [-n[1] / len, n[0] / len];
    return this.transform(s, (d) => d.mirror(dir, [0, 0], "plane"), (f) => this.kernel.mirror(f, { origin: [0, 0, 0], normal: [n[0], n[1], 0] }));
  }

  // ---- drawing-only edits -------------------------------------------------------------
  #drawingOf(s: SketchEntry, op: string): Drawing {
    if (!s.drawing) throw notImplemented(`sketch.${op} after offset()`);
    return s.drawing;
  }

  boolean(op: "add" | "subtract" | "intersect", a: SketchEntry, others: SketchEntry[]): SketchEntry {
    let d = this.#drawingOf(a, op);
    for (const o of others) {
      const od = this.#drawingOf(o, op);
      d = op === "add" ? d.fuse(od) : op === "subtract" ? d.cut(od) : d.intersect(od);
    }
    return { kind: "sketch", drawing: d };
  }

  filletCorners(s: SketchEntry, r: number): SketchEntry {
    return { kind: "sketch", drawing: this.#drawingOf(s, "filletCorners").fillet(r) };
  }

  chamferCorners(s: SketchEntry, r: number): SketchEntry {
    return { kind: "sketch", drawing: this.#drawingOf(s, "chamferCorners").chamfer(r) };
  }

  /** Exact 2D offset through OCCT (brepjs Drawing.offset gave an invalid hexagon inset in the spike). */
  offset(s: SketchEntry, dist: number): SketchEntry {
    const wire = this.outerWire(s, "offset");
    const out = idOf(unwrap("offset", B.offsetWire2D(brepShape("wire", wire) as never, dist, "arc")));
    return { kind: "sketch", face: this.kernel.face(out) };
  }

  // ---- measures -----------------------------------------------------------------------
  area(s: SketchEntry): number {
    return this.kernel.area(this.face(s));
  }

  bounds(s: SketchEntry): { min: [number, number]; max: [number, number]; size: [number, number]; center: [number, number] } {
    const b = this.kernel.bbox(this.face(s));
    const min: [number, number] = [b.min[0], b.min[1]];
    const max: [number, number] = [b.max[0], b.max[1]];
    return { min, max, size: [max[0] - min[0], max[1] - min[1]], center: [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2] };
  }

  // ---- to 3D --------------------------------------------------------------------------
  /** Extrude along +Z. twist (degrees) and scaleTop use brepjs sweeps on the outer wire. */
  extrude(s: SketchEntry, h: number, opts: { twist?: number; scaleTop?: number }): { handle: ShapeHandle; prismWire?: ShapeHandle } {
    const twist = opts.twist ?? 0;
    const scaleTop = opts.scaleTop ?? 1;
    if (twist === 0 && scaleTop === 1) {
      const face = this.face(s);
      const handle = this.kernel.extrude(face, [0, 0, h]);
      const single = this.kernel.shapeType(face) === "face" && this.kernel.subShapes(face, "wire").length === 1;
      return single && h > 0 ? { handle, prismWire: this.raw!.outerWire(face) as ShapeHandle } : { handle };
    }
    if (!(scaleTop > 0)) throw badArgument(`extrude scaleTop must be greater than 0, got ${scaleTop}`);
    const wire = brepShape("wire", this.outerWire(s, "extrude with twist or scaleTop"));
    const profile = scaleTop !== 1 ? { profile: "linear" as const, endFactor: scaleTop } : undefined;
    const raw = twist !== 0
      ? B.twistExtrude(wire as never, twist, [0, 0, 0], [0, 0, h], profile)
      : B.complexExtrude(wire as never, [0, 0, 0], [0, 0, h], profile);
    const solid = unwrap<unknown>("extrude", raw);
    return { handle: this.checkedSolid("extrude", idOf(Array.isArray(solid) ? solid[0] : solid)) };
  }

  /** Sketch X becomes the radius (world X), sketch Y becomes height (world Z); revolve about Z. */
  revolve(s: SketchEntry, deg: number): ShapeHandle {
    const upright = this.kernel.rotate(this.face(s), 90, { origin: [0, 0, 0], dir: [1, 0, 0] });
    return this.kernel.revolve(upright, { origin: [0, 0, 0], dir: [0, 0, 1] }, deg);
  }

  /** Loft through the profiles' outer wires placed at the given heights. */
  loft(profiles: SketchEntry[], heights: number[]): ShapeHandle {
    const wires = profiles.map((p, i) => {
      const w = this.outerWire(p, "loft");
      const z = heights[i]!;
      return z === 0 ? w : this.kernel.translate(w, [0, 0, z]);
    });
    return this.kernel.loft(wires, { solid: true, ruled: false });
  }

  /** The checks the adapter runs for its own ops, for shapes made by brepjs. */
  checkedSolid(op: string, handle: ShapeHandle): ShapeHandle {
    const type = this.kernel.shapeType(handle);
    const shape = type === "compound" && this.kernel.counts(handle).solids === 1 ? this.kernel.asSolid(handle) : handle;
    if (!this.kernel.isValid(shape)) {
      const c = this.kernel.counts(shape);
      throw new KernelError("INVALID_RESULT", op, `${op} produced an invalid shape (${c.solids} solids, ${c.faces} faces)`, { hint: "Use a smaller twist or a scaleTop closer to 1." });
    }
    return shape;
  }
}

/** A profile drawn with path(): the commands the guest recorded, in order. */
export function drawPath(cmds: unknown[]): Drawing {
  let pen: ReturnType<typeof B.draw> | undefined;
  let cur: [number, number] = [0, 0];
  const need = () => pen ?? (pen = B.draw(cur));
  for (const raw of cmds) {
    if (!Array.isArray(raw) || typeof raw[0] !== "string") throw badArgument("path(): malformed command list");
    const [op, ...a] = raw as [string, ...unknown[]];
    for (const v of a) if (typeof v !== "number" || !Number.isFinite(v)) throw badArgument(`path().${op}: arguments must be finite numbers`);
    const p = a as number[];
    switch (op) {
      case "moveTo":
        if (pen) throw badArgument("path(): moveTo must come first");
        cur = [p[0]!, p[1]!];
        break;
      case "lineTo":
        need().lineTo([p[0]!, p[1]!]);
        cur = [p[0]!, p[1]!];
        break;
      case "lineH":
        need().hLine(p[0]!);
        cur = [cur[0] + p[0]!, cur[1]];
        break;
      case "lineV":
        need().vLine(p[0]!);
        cur = [cur[0], cur[1] + p[0]!];
        break;
      case "lineAngled": {
        const rad = (p[1]! * Math.PI) / 180;
        need().polarLine(p[0]!, p[1]!);
        cur = [cur[0] + p[0]! * Math.cos(rad), cur[1] + p[0]! * Math.sin(rad)];
        break;
      }
      case "arcTo": {
        // Positive r bulges to the left of the direction of travel, negative to the right;
        // the arc is always the shorter one.
        const end: [number, number] = [p[0]!, p[1]!];
        const r = p[2]!;
        const chord = Math.hypot(end[0] - cur[0], end[1] - cur[1]);
        if (chord === 0 || Math.abs(r) < chord / 2 - 1e-9) throw badArgument(`path().arcTo: radius ${Math.abs(r)} is smaller than half the chord (${chord / 2})`);
        const sag = Math.abs(r) - Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
        need().sagittaArcTo(end, Math.sign(r) * sag);
        cur = end;
        break;
      }
      default:
        throw badArgument(`path(): unknown command ${op}`);
    }
  }
  if (!pen) throw badArgument("path(): draw at least one segment before close()");
  return pen.close();
}

export type { Vec3 };
