// Per-run host state: the guest-id table, declared params, mates and warnings. The guest
// only ever sees the integer ids; every entry is immutable once made, except that clone()
// marks its source as the start of a clone lineage.
import type { Color3, ParamValue, Transform, Vec3 } from "@open3dj/schemas";
import type { ShapeHandle } from "@open3dj/kernel";
import type { Drawing } from "brepjs";
import type { GuestValue } from "@open3dj/sandbox";
import { DslError, badArgument } from "./errors.ts";
import type { ParamSpec } from "./types.ts";

export type { ParamSpec };

/** A connector frame as the DSL stores it (3dj names: axis and up). */
export interface ConnectorFrame {
  kind: "male" | "female";
  type: string;
  origin: Vec3;
  axis: Vec3;
  up: Vec3;
}

/** A straight extrusion of a planar profile, kept so shell() can fall back to a profile offset. */
/**
 * A straight extrusion along +Z, kept so shell() can fall back to a profile offset. Its
 * placement is: turn the profile by `angle` degrees about the Z axis, then move by `offset`.
 * Translations and rotations about Z keep it; any other change drops it.
 */
export interface Prism {
  /** Outer wire of the profile at z = 0, before the placement. */
  wire: ShapeHandle;
  height: number;
  angle: number;
  offset: Vec3;
}

export interface SolidEntry {
  kind: "shape";
  handle: ShapeHandle;
  refs: Record<string, Vec3>;
  connectors: Record<string, ConnectorFrame>;
  name?: string;
  color?: Color3;
  /** Identity of the body for mates: kept by transforms and metadata, new after geometry changes and clone(). */
  body: number;
  /** Clone lineage: parts with the same id are rigid copies; t maps the lineage source to this shape. */
  lineage?: { id: string; t: Transform };
  prism?: Prism;
  line?: number;
}

export interface SketchEntry {
  kind: "sketch";
  /** brepjs 2D drawing, when the profile is still a drawing (not after offset). */
  drawing?: Drawing;
  /** Kernel face(s) of the profile at z = 0 (a face, or a compound of faces). */
  face?: ShapeHandle;
  /**
   * The face is exact and the drawing only approximates it (ellipse): solids and measures
   * use the face, and transforms update both.
   */
  exactFace?: boolean;
  line?: number;
}

export type Entry = SolidEntry | SketchEntry;

export interface PendingMate {
  movingBody: number;
  movingConnector: string;
  targetBody: number;
  targetConnector: string;
  line?: number;
}

export class RunState {
  readonly entries = new Map<number, Entry>();
  readonly params = new Map<string, ParamSpec>();
  readonly mates: PendingMate[] = [];
  readonly warnings: string[] = [];
  overrides: Record<string, ParamValue> = {};
  maxHandles = 20000;
  /** User line of the host call being served (from the sandbox's beforeCall). */
  line: number | undefined;
  #next = 1;
  #bodies = 1;
  #lineages = 1;

  reset(overrides: Record<string, ParamValue> = {}): void {
    this.entries.clear();
    this.params.clear();
    this.mates.length = 0;
    this.warnings.length = 0;
    this.overrides = { ...overrides };
    this.line = undefined;
    this.#next = 1;
    this.#bodies = 1;
    this.#lineages = 1;
  }

  newBody(): number {
    return this.#bodies++;
  }

  newLineage(): string {
    return `clone${this.#lineages++}`;
  }

  add(entry: Entry): number {
    if (this.entries.size >= this.maxHandles) {
      const e = new DslError("SCRIPT_LIMIT", `The script made more than ${this.maxHandles} shapes and sketches`, "Build fewer intermediate shapes, or batch booleans.");
      throw e;
    }
    if (entry.line === undefined && this.line !== undefined) entry.line = this.line;
    const id = this.#next++;
    this.entries.set(id, entry);
    return id;
  }

  /** A new solid entry with a fresh body. */
  solid(handle: ShapeHandle, extra: Partial<SolidEntry> = {}): number {
    return this.add({ kind: "shape", handle, refs: {}, connectors: {}, body: this.newBody(), ...extra });
  }

  get(id: GuestValue): Entry {
    if (typeof id !== "number" || !Number.isInteger(id)) throw new DslError("DSL_BAD_HANDLE", `expected a shape or sketch, got ${describe(id)}`);
    const e = this.entries.get(id);
    if (!e) throw new DslError("DSL_BAD_HANDLE", `unknown shape handle ${id}`);
    return e;
  }

  shape(id: GuestValue, what = "shape"): SolidEntry {
    const e = this.get(id);
    if (e.kind !== "shape") throw badArgument(`${what} must be a 3D shape, got a 2D sketch`, "Extrude or revolve the sketch first.");
    return e;
  }

  sketch(id: GuestValue, what = "profile"): SketchEntry {
    const e = this.get(id);
    if (e.kind !== "sketch") throw badArgument(`${what} must be a 2D sketch, got a 3D shape`);
    return e;
  }

  warn(message: string): void {
    if (this.warnings.length < 100 && !this.warnings.includes(message)) this.warnings.push(message);
  }
}

export function describe(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "an array";
  return typeof x === "object" ? "an object" : `${typeof x} ${String(x).slice(0, 40)}`;
}

// ---- argument checks ----------------------------------------------------------------------

/** Largest size the DSL accepts, in mm. */
export const MAX_SIZE = 1e6;

export function num(x: GuestValue | undefined, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw badArgument(`${what} must be a finite number, got ${describe(x)}`);
  if (Math.abs(x) > MAX_SIZE) throw badArgument(`${what} is too large (${x}; the limit is ${MAX_SIZE} mm)`);
  return x;
}

export function pos(x: GuestValue | undefined, what: string): number {
  const v = num(x, what);
  if (v <= 0) throw badArgument(`${what} must be greater than 0, got ${v}`);
  return v;
}

export function nonNeg(x: GuestValue | undefined, what: string): number {
  const v = num(x, what);
  if (v < 0) throw badArgument(`${what} must be 0 or more, got ${v}`);
  return v;
}

export function optNum(x: GuestValue | undefined, what: string, fallback: number): number {
  return x === undefined || x === null ? fallback : num(x, what);
}

export function int(x: GuestValue | undefined, what: string, min = 1, max = 10000): number {
  const v = num(x, what);
  if (!Number.isInteger(v) || v < min || v > max) throw badArgument(`${what} must be a whole number from ${min} to ${max}, got ${v}`);
  return v;
}

export function vec3(x: GuestValue | undefined, what: string): Vec3 {
  if (!Array.isArray(x) || x.length < 2 || x.length > 3) throw badArgument(`${what} must be [x, y, z], got ${describe(x)}`);
  return [num(x[0], `${what}[0]`), num(x[1], `${what}[1]`), x.length === 3 ? num(x[2], `${what}[2]`) : 0];
}

export function dir3(x: GuestValue | undefined, what: string): Vec3 {
  if (typeof x === "string") {
    const axis = AXES[x.toUpperCase()];
    if (axis) return axis;
  }
  const v = vec3(x, what);
  if (Math.hypot(...v) < 1e-12) throw badArgument(`${what} must not be the zero vector`);
  return v;
}

export const AXES: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

export function vec2(x: GuestValue | undefined, what: string): [number, number] {
  if (!Array.isArray(x) || x.length !== 2) throw badArgument(`${what} must be [x, y], got ${describe(x)}`);
  return [num(x[0], `${what}[0]`), num(x[1], `${what}[1]`)];
}

export function str(x: GuestValue | undefined, what: string, max = 200): string {
  if (typeof x !== "string" || x.length === 0 || x.length > max) throw badArgument(`${what} must be a non-empty string of at most ${max} characters`);
  return x;
}

export function obj(x: GuestValue | undefined, what: string): Record<string, GuestValue> {
  if (x === undefined || x === null) return {};
  if (typeof x !== "object" || Array.isArray(x)) throw badArgument(`${what} must be an object, got ${describe(x)}`);
  return x;
}

export function ids(x: GuestValue | undefined, what: string): number[] {
  if (!Array.isArray(x)) throw badArgument(`${what} must be a list of shapes`);
  return x.map((v, i) => {
    if (typeof v !== "number") throw badArgument(`${what}[${i}] must be a shape, got ${describe(v)}`);
    return v;
  });
}
