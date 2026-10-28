// buildAssembly: a script's parts become definitions and occurrences (ASSEMBLIES.md 2 and 3).
//
// Sharing rules, strongest first:
// 1. Clone provenance (cloneOf + cloneTransform from the DSL): the definition is the clone
//    source at its own origin and each occurrence carries the recorded transform ("measured").
// 2. Same name, same measures, and a translated copy confirmed by an exact common() volume:
//    shared with the translation as the transform ("inferred").
// 3. Anything else is its own definition. A same-named part that matches in volume, area and
//    counts but is rotated cannot be recovered from final geometry alone; it stays separate
//    and a warning says so.
import type { AssemblyFile, Color3, Connector, Definition, Mate, Occurrence, Transform, Vec3 } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle, ShapeMeasure } from "@open3dj/kernel";
import { IDENTITY, KernelError, isUnitQuaternion } from "@open3dj/kernel";
import type { ScriptPart, ScriptReturn } from "@open3dj/dsl";
import type { Assembly, AssemblyInstance, BuildOptions } from "./types.ts";
import { AssemblyError } from "./errors.ts";
import { bboxDiagonal, bboxSize, compose, invert, isIdentity, rotateVector, tidy, translation } from "./math.ts";
import { nameBasedId, sha256Hex, toDefId, uniqueId } from "./names.ts";

/** Relative tolerance for "same measures" when matching clones by geometry. */
const MATCH_REL = 1e-6;

interface Member {
  part: ScriptPart;
  index: number;
  shape: ShapeHandle;
  /** Definition frame to world. */
  transform: Transform;
}

interface Draft {
  baseName: string;
  /** Id of the clone group (cloneOf), when the definition came from clone provenance. */
  cloneOf?: string;
  shape: ShapeHandle;
  measure: ShapeMeasure;
  sharedBy?: "measured" | "inferred";
  members: Member[];
  id?: string;
}

interface GroupNode {
  path: string[];
  defId?: string;
  occurrenceName: string;
  children: Array<{ kind: "group"; node: GroupNode } | { kind: "part"; member: Member; draft: Draft }>;
  groups: Map<string, GroupNode>;
}

export function buildAssembly(kernel: KernelAdapter, script: ScriptReturn, options: BuildOptions = {}): Assembly {
  if (!script || !Array.isArray(script.parts) || script.parts.length === 0) {
    throw new AssemblyError("EMPTY_ASSEMBLY", "the script returned no parts", "Return a shape, or a list of { name, shape } descriptors.");
  }
  const warnings: string[] = [];
  const drafts: Draft[] = [];
  const cloneDrafts = new Map<string, Draft>();

  script.parts.forEach((part, index) => {
    const label = describe(part, index);
    const shape = normalizeShape(kernel, part, label);
    const measure = measureOf(kernel, shape, label);
    if (measure.counts.solids === 0) {
      warnings.push(`${label} holds no solid (a ${kernel.shapeType(shape)}); its volume, mass and fits are not meaningful.`);
    }
    const baseName = part.name && part.name.trim() !== "" ? part.name : "part";

    if (part.cloneOf !== undefined && part.cloneTransform !== undefined) {
      if (!isUnitQuaternion(part.cloneTransform.q)) {
        throw new AssemblyError("BAD_TRANSFORM", `${label}: cloneTransform quaternion [${part.cloneTransform.q.join(", ")}] is not unit length`);
      }
      const transform = tidy(part.cloneTransform);
      const key = `${part.cloneOf}\u0000${baseName}`;
      const existing = cloneDrafts.get(key);
      if (!existing) {
        const defShape = kernel.place(shape, invert(transform));
        const draft: Draft = { baseName, cloneOf: part.cloneOf, shape: defShape, measure: measureOf(kernel, defShape, label), members: [{ part, index, shape, transform }] };
        cloneDrafts.set(key, draft);
        drafts.push(draft);
        return;
      }
      if (sameMeasures(existing.measure, measure) && placedMatches(kernel, existing, transform, measure)) {
        existing.members.push({ part, index, shape, transform });
        existing.sharedBy = existing.sharedBy === "inferred" ? "inferred" : "measured";
        return;
      }
      warnings.push(`${label} claims to be a clone of '${part.cloneOf}' but its geometry differs from the clone source; kept as its own definition.`);
    }

    // Geometry match against earlier definitions with the same name.
    let rotatedLookalike = false;
    for (const draft of drafts) {
      if (draft.baseName !== baseName || !sameMeasures(draft.measure, measure)) continue;
      if (!sameSize(draft.measure, measure)) {
        rotatedLookalike = true;
        continue;
      }
      const offset = translation(sub(measure.bbox.min, draft.measure.bbox.min));
      if (confirmedCopy(kernel, draft, offset, shape, measure)) {
        draft.members.push({ part, index, shape, transform: offset });
        draft.sharedBy = "inferred";
        return;
      }
    }
    if (rotatedLookalike) {
      warnings.push(`${label} matches an earlier '${baseName}' in volume, area and counts but is rotated; it stays a separate definition. Use clone() so the assembly can share one definition with a measured transform.`);
    }
    drafts.push({ baseName, shape, measure, members: [{ part, index, shape, transform: IDENTITY }] });
  });

  return assemble(script, drafts, warnings, options);
}

function assemble(script: ScriptReturn, drafts: Draft[], warnings: string[], options: BuildOptions): Assembly {
  const rootId = toDefId(options.rootName ?? "root", "root");
  const used = new Set<string>([rootId]);

  // Sub-assemblies from part.group, in order of first appearance.
  const root: GroupNode = { path: [], defId: rootId, occurrenceName: rootId, children: [], groups: new Map() };
  const memberList = drafts.flatMap((d) => d.members.map((m) => ({ m, d }))).sort((a, b) => a.m.index - b.m.index);
  for (const { m, d } of memberList) {
    let node = root;
    for (const segment of m.part.group ?? []) {
      const name = toDefId(segment, "group");
      let child = node.groups.get(name);
      if (!child) {
        child = { path: [...node.path, name], occurrenceName: name, children: [], groups: new Map() };
        node.groups.set(name, child);
        node.children.push({ kind: "group", node: child });
      }
      node = child;
    }
    node.children.push({ kind: "part", member: m, draft: d });
  }
  forEachGroup(root, (g) => {
    if (g !== root) g.defId = uniqueId(g.path.join("_"), used);
  });
  for (const d of drafts) d.id = uniqueId(toDefId(d.baseName), used);

  const previousIds = previousOccurrenceIds(options.previous);
  const definitions: Record<string, Definition> = {};
  const instances: AssemblyInstance[] = [];
  const shapes = new Map<string, ShapeHandle>();
  const pathOfMember = new Map<Member, string>();

  const emitGroup = (g: GroupNode, prefix: string, world: Transform): Occurrence[] => {
    const occurrences: Occurrence[] = [];
    const counts = new Map<string, number>();
    for (const c of g.children) if (c.kind === "part") counts.set(occName(c.member), (counts.get(occName(c.member)) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const c of g.children) {
      if (c.kind === "group") {
        const path = prefix + c.node.occurrenceName;
        occurrences.push({ id: previousIds.get(path) ?? nameBasedId(`${rootId}/${path}`), name: c.node.occurrenceName, def: c.node.defId!, transform: IDENTITY });
        const children = emitGroup(c.node, `${path}/`, world);
        definitions[c.node.defId!] = { kind: "assembly", name: c.node.path.at(-1)!, occurrences: children };
        continue;
      }
      const base = occName(c.member);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const name = (counts.get(base) ?? 1) > 1 ? `${base}#${n}` : base;
      const path = prefix + name;
      const id = previousIds.get(path) ?? nameBasedId(`${rootId}/${path}`);
      const def = definitions[c.draft.id!];
      const color = cleanColor(c.member.part.color);
      const occ: Occurrence = { id, name, def: c.draft.id!, transform: c.member.transform };
      if (color && def?.color && !sameColor(color, def.color)) occ.color = color;
      occurrences.push(occ);
      instances.push({ id, path, name, def: c.draft.id!, world: compose(world, c.member.transform) });
      pathOfMember.set(c.member, path);
    }
    return occurrences;
  };

  // Part definitions first, so occurrences can compare colours; then the root and groups.
  for (const d of drafts) {
    const first = d.members[0]!;
    const def: Definition = { kind: "script", name: d.baseName, export: d.baseName, geometry_hash: geometryHash(d.measure) };
    if (d.members.length > 1 && d.sharedBy) def.shared_by = d.sharedBy;
    const color = cleanColor(first.part.color);
    if (color) def.color = color;
    const connectors = (first.part.connectors ?? []).map((c) => toDefinitionFrame(c, first.transform));
    if (connectors.length > 0) def.connectors = connectors;
    definitions[d.id!] = def;
    shapes.set(d.id!, d.shape);
  }
  const rootOccurrences = emitGroup(root, "", IDENTITY);
  const ordered: Record<string, Definition> = { [rootId]: { kind: "assembly", name: options.rootName ?? rootId, occurrences: rootOccurrences } };
  forEachGroup(root, (g) => {
    if (g !== root) ordered[g.defId!] = definitions[g.defId!]!;
  });
  for (const d of drafts) ordered[d.id!] = definitions[d.id!]!;

  const file: AssemblyFile = { o3j: "0", root: rootId, definitions: ordered };
  const mates = buildMates(script, drafts, pathOfMember, warnings);
  if (mates.length > 0) file.mates = mates;
  return { file, shapes, instances, warnings: [...script.warnings ?? [], ...warnings] };
}

// ---- part checks ---------------------------------------------------------------------------

function describe(part: ScriptPart, index: number): string {
  const line = part.line !== undefined ? `, line ${part.line}` : "";
  return `part '${part.name ?? "part"}' (#${index + 1}${line})`;
}

function normalizeShape(kernel: KernelAdapter, part: ScriptPart, label: string): ShapeHandle {
  try {
    const type = kernel.shapeType(part.shape);
    if ((type === "compound" || type === "compsolid") && kernel.counts(part.shape).solids === 1) return kernel.asSolid(part.shape);
    return part.shape;
  } catch (e) {
    const detail = e instanceof KernelError ? e.message : String(e);
    throw new AssemblyError("BAD_PART", `${label} is not a usable shape: ${detail}`);
  }
}

function measureOf(kernel: KernelAdapter, shape: ShapeHandle, label: string): ShapeMeasure {
  try {
    return kernel.measure(shape);
  } catch (e) {
    const detail = e instanceof KernelError ? e.message : String(e);
    throw new AssemblyError("BAD_PART", `${label} could not be measured: ${detail}`);
  }
}

function close(a: number, b: number, scale: number): boolean {
  return Math.abs(a - b) <= MATCH_REL * Math.max(1, Math.abs(scale));
}

/** Rotation-invariant measures agree: counts, volume and area. */
function sameMeasures(a: ShapeMeasure, b: ShapeMeasure): boolean {
  return a.counts.solids === b.counts.solids && a.counts.faces === b.counts.faces && a.counts.edges === b.counts.edges
    && close(a.volume, b.volume, a.volume) && close(a.area, b.area, a.area);
}

/** Axis-aligned extents agree, so a pure translation can map one onto the other. */
function sameSize(a: ShapeMeasure, b: ShapeMeasure): boolean {
  const sa = bboxSize(a.bbox);
  const sb = bboxSize(b.bbox);
  const tol = MATCH_REL * Math.max(1, bboxDiagonal(a.bbox));
  return sa.every((x, i) => Math.abs(x - sb[i]!) <= tol);
}

/** The definition placed by transform lands where the clone's bbox says it should. */
function placedMatches(kernel: KernelAdapter, draft: Draft, transform: Transform, measure: ShapeMeasure): boolean {
  const mark = kernel.checkpoint();
  try {
    const b = kernel.bbox(kernel.place(draft.shape, transform));
    const tol = 1e-6 * Math.max(1, bboxDiagonal(measure.bbox));
    return [0, 1, 2].every((i) => Math.abs(b.min[i]! - measure.bbox.min[i]!) <= tol && Math.abs(b.max[i]! - measure.bbox.max[i]!) <= tol);
  } finally {
    kernel.releaseSince(mark);
  }
}

/** Exact check that shape is the definition moved by offset: their common volume is the whole volume. */
function confirmedCopy(kernel: KernelAdapter, draft: Draft, offset: Transform, shape: ShapeHandle, measure: ShapeMeasure): boolean {
  if (measure.counts.solids === 0 || measure.volume <= 0) return false;
  const mark = kernel.checkpoint();
  try {
    const placed = kernel.place(draft.shape, offset);
    const overlap = kernel.volume(kernel.common(placed, shape));
    return Math.abs(overlap - measure.volume) <= MATCH_REL * Math.max(1, measure.volume);
  } catch {
    return false;
  } finally {
    kernel.releaseSince(mark);
  }
}

/** A fingerprint of the measures (not of the topology): equal parts give equal hashes. */
function geometryHash(m: ShapeMeasure): string {
  const r = (x: number) => Number(x.toPrecision(9));
  const size = bboxSize(m.bbox).map(r);
  const text = `v=${r(m.volume)};a=${r(m.area)};s=${m.counts.solids};f=${m.counts.faces};e=${m.counts.edges};bb=${size.join(",")}`;
  return `m1:${sha256Hex(text).slice(0, 16)}`;
}

// ---- names, colours, connectors, mates -----------------------------------------------------------

function occName(m: Member): string {
  return toDefId(m.part.name ?? "part");
}

function cleanColor(c: Color3 | undefined): Color3 | undefined {
  if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => typeof x === "number" && Number.isFinite(x))) return undefined;
  return c.map((x) => Math.min(1, Math.max(0, x))) as Color3;
}

function sameColor(a: Color3, b: Color3): boolean {
  return a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Connectors arrive in the part's world frame; definitions store them in their own frame. */
function toDefinitionFrame(c: Connector, transform: Transform): Connector {
  if (isIdentity(transform)) return c;
  const inv = invert(transform);
  const point = (p: Vec3): Vec3 => {
    const r = rotateVector(inv.q, p);
    return [r[0] + inv.t[0], r[1] + inv.t[1], r[2] + inv.t[2]];
  };
  const out: Connector = { ...c, origin: point(c.origin), z: rotateVector(inv.q, c.z) };
  if (c.x) out.x = rotateVector(inv.q, c.x);
  return out;
}

function forEachGroup(g: GroupNode, fn: (g: GroupNode) => void): void {
  fn(g);
  for (const c of g.children) if (c.kind === "group") forEachGroup(c.node, fn);
}

function previousOccurrenceIds(previous: AssemblyFile | undefined): Map<string, string> {
  const ids = new Map<string, string>();
  if (!previous) return ids;
  const walk = (defId: string, prefix: string, depth: number) => {
    const def = previous.definitions[defId];
    if (!def || depth > 32) return;
    for (const o of def.occurrences ?? []) {
      const path = prefix + o.name;
      ids.set(path, o.id);
      if (previous.definitions[o.def]?.kind === "assembly") walk(o.def, `${path}/`, depth + 1);
    }
  };
  walk(previous.root, "", 0);
  return ids;
}

/**
 * matchTo calls become script-owned fastened mates. The part half of "part.connector" is
 * rewritten to the occurrence path when the name is unambiguous. S1 does not solve mates
 * (the DSL already placed the part), so a second mate moving the same occurrence is reported.
 */
function buildMates(script: ScriptReturn, drafts: Draft[], pathOf: Map<Member, string>, warnings: string[]): Mate[] {
  const byName = new Map<string, string[]>();
  for (const d of drafts) {
    for (const m of d.members) {
      const path = pathOf.get(m)!;
      for (const key of new Set([m.part.name, toDefId(m.part.name ?? "part"), path, path.split("/").at(-1)!])) {
        if (!key) continue;
        const list = byName.get(key) ?? [];
        if (!list.includes(path)) list.push(path);
        byName.set(key, list);
      }
    }
  }
  const resolve = (ref: string, line: number | undefined): string => {
    const dot = ref.lastIndexOf(".");
    if (dot <= 0) return ref;
    const part = ref.slice(0, dot);
    const paths = byName.get(part) ?? [];
    if (paths.length === 1) return `${paths[0]}.${ref.slice(dot + 1)}`;
    const at = line !== undefined ? ` (line ${line})` : "";
    warnings.push(paths.length === 0
      ? `mate end '${ref}'${at} names no part in the assembly.`
      : `mate end '${ref}'${at} is ambiguous: '${part}' has ${paths.length} occurrences; name the parts uniquely.`);
    return ref;
  };
  const moved = new Map<string, number>();
  return (script.mates ?? []).map((m, i) => {
    const a = resolve(m.a, m.line);
    const b = resolve(m.b, m.line);
    const mover = a.slice(0, a.lastIndexOf("."));
    const n = (moved.get(mover) ?? 0) + 1;
    moved.set(mover, n);
    if (n === 2) warnings.push(`occurrence '${mover}' is moved by more than one matchTo; the later mates are not solved in S1 and may be redundant or conflicting.`);
    const mate: Mate = { id: `m${i + 1}`, type: "fastened", a, b, owner: "script" };
    if (m.flip) mate.flip = true;
    return mate;
  });
}
