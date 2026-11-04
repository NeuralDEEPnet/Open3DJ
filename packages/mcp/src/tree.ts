// Read-only views of a stored assembly graph for inspect: the occurrence tree and target
// addressing. Pure data, so the daemon answers these without a kernel job. Paths follow
// @open3dj/assembly: relative to the root, joined by "/", for example pcb_assy/standoff#1.
import type { AssemblyFile, BBox, Quaternion, Transform, TreeNode, Vec3 } from "@open3dj/schemas";
import { ToolError } from "./errors.ts";

export interface FlatOccurrence {
  path: string;
  def: string;
  /** True for a part (a leaf), false for a sub-assembly. */
  leaf: boolean;
}

const IDENTITY: Transform = { t: [0, 0, 0], q: [0, 0, 0, 1] };

/**
 * Most occurrences one assembly may expand to. A stored graph is untrusted (a cloned
 * project), and a definition used n times by the level above multiplies, so a few kB of JSON
 * can describe billions of occurrences.
 */
export const MAX_OCCURRENCES = 100_000;
/** Deepest sub-assembly nesting, as in @open3dj/assembly. */
export const MAX_DEPTH = 32;

function tooLarge(what: string): ToolError {
  return new ToolError("PROJECT_CORRUPT", `${what} expands to more than ${MAX_OCCURRENCES} occurrences or nests deeper than ${MAX_DEPTH} levels`, "The stored assembly graph is not one Open3DJ writes. Restore the revision from git, or run the script again in a fresh project.");
}

/**
 * How many occurrences the graph expands to, counted per definition without expanding it,
 * so it costs one visit per definition. Throws PROJECT_CORRUPT above MAX_OCCURRENCES, for a
 * cycle, or for nesting deeper than MAX_DEPTH.
 */
export function checkGraphSize(asm: AssemblyFile, what = "the assembly"): number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (defId: string, depth: number): number => {
    const known = memo.get(defId);
    if (known !== undefined) return known;
    if (depth > MAX_DEPTH || visiting.has(defId)) throw tooLarge(what);
    visiting.add(defId);
    let n = 0;
    const def = Object.hasOwn(asm.definitions, defId) ? asm.definitions[defId] : undefined;
    for (const o of def?.occurrences ?? []) {
      n += 1 + (asm.definitions[o.def]?.kind === "assembly" ? count(o.def, depth + 1) : 0);
      if (n > MAX_OCCURRENCES) throw tooLarge(what);
    }
    visiting.delete(defId);
    memo.set(defId, n);
    return n;
  };
  return count(asm.root, 0);
}

export function flatten(asm: AssemblyFile): Array<FlatOccurrence & { node: TreeNode; world: Transform }> {
  const out: Array<FlatOccurrence & { node: TreeNode; world: Transform }> = [];
  const walk = (defId: string, prefix: string, parent: Transform, depth: number) => {
    if (depth > MAX_DEPTH) throw tooLarge("the assembly");
    for (const o of asm.definitions[defId]?.occurrences ?? []) {
      if (o.suppressed) continue;
      if (out.length >= MAX_OCCURRENCES) throw tooLarge("the assembly");
      const def = asm.definitions[o.def];
      const path = prefix ? `${prefix}/${o.name}` : o.name;
      const node: TreeNode = { path, def: o.def, kind: def?.kind ?? "script", transform: o.transform };
      const children = def?.occurrences?.length;
      if (def?.kind === "assembly") node.children = children ?? 0;
      const world = compose(parent, o.transform);
      out.push({ path, def: o.def, leaf: def?.kind !== "assembly", node, world });
      if (def?.kind === "assembly") walk(o.def, path, world, depth + 1);
    }
  };
  walk(asm.root, "", IDENTITY, 0);
  return out;
}

/** World bounding boxes of part occurrences, from each definition's local bbox. */
export function placements(asm: AssemblyFile, paths: string[], localBox: (def: string) => BBox | undefined): Array<{ path: string; def: string; bbox: BBox }> {
  const wanted = new Set(paths);
  const out: Array<{ path: string; def: string; bbox: BBox }> = [];
  for (const f of flatten(asm)) {
    if (!f.leaf || !wanted.has(f.path)) continue;
    const local = localBox(f.def);
    if (local) out.push({ path: f.path, def: f.def, bbox: worldBox(local, f.world) });
  }
  return out;
}

/** The box around the 8 transformed corners: exact for a translation, enclosing for a rotation. */
function worldBox(b: BBox, tr: Transform): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
    const p = add(rotate(tr.q, corner), tr.t);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  const r = (x: number) => Number(x.toFixed(6)) + 0;
  return { min: [r(min[0]), r(min[1]), r(min[2])], max: [r(max[0]), r(max[1]), r(max[2])] };
}

function compose(a: Transform, b: Transform): Transform {
  return { t: add(rotate(a.q, b.t), a.t), q: qmul(a.q, b.q) };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function qmul(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** Rotate v by the unit quaternion q ([x, y, z, w]). */
function rotate(q: Quaternion, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export function tree(asm: AssemblyFile): TreeNode[] {
  return flatten(asm).map((f) => f.node);
}

/**
 * Part occurrences addressed by targets: occurrence paths, sub-assembly paths, definition
 * ids or the root. Returns their definition ids and paths. Throws UNKNOWN_TARGET naming the
 * first target that matches nothing.
 */
export function resolveTargets(asm: AssemblyFile, targets: string[]): { defs: string[]; paths: string[] } {
  const flat = flatten(asm);
  const leaves = flat.filter((f) => f.leaf);
  const chosen = new Set<FlatOccurrence>();
  for (const raw of targets) {
    let t = raw.trim().replace(/^\/+/, "");
    if (t.startsWith(`${asm.root}/`)) t = t.slice(asm.root.length + 1);
    let found: FlatOccurrence[];
    if (t === "" || t === "root" || t === asm.root) found = leaves;
    else {
      found = leaves.filter((f) => f.path === t);
      if (!found.length) found = leaves.filter((f) => f.path.startsWith(`${t}/`));
      if (!found.length && t.endsWith("#1")) found = leaves.filter((f) => f.path === t.slice(0, -2));
      if (!found.length) found = leaves.filter((f) => f.def === t);
    }
    if (!found.length) {
      const known = flat.slice(0, 12).map((f) => f.path).join(", ");
      throw new ToolError("UNKNOWN_TARGET", `no occurrence, sub-assembly or definition is called '${raw}'`, `Known occurrence paths: ${known}${flat.length > 12 ? ", ..." : ""}.`);
    }
    for (const f of found) chosen.add(f);
  }
  const picked = leaves.filter((f) => chosen.has(f));
  return { defs: [...new Set(picked.map((f) => f.def))], paths: picked.map((f) => f.path) };
}
