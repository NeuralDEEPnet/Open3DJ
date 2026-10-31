// Addressing: turn occurrence paths, sub-assembly paths and definition ids into instances,
// and build the node tree that the exporters walk.
import type { Color3, Transform } from "@open3dj/schemas";
import type { Assembly, AssemblyInstance } from "./types.ts";
import { AssemblyError } from "./errors.ts";

/** Strip a leading "/" or "<root>/" so agents may write either form. */
function normalizeTarget(asm: Assembly, target: string): string {
  let t = target.trim().replace(/^\/+/, "");
  const rootPrefix = `${asm.file.root}/`;
  if (t.startsWith(rootPrefix)) t = t.slice(rootPrefix.length);
  return t;
}

/**
 * Instances addressed by one target: an occurrence path (lid, screw#2, pcb_assy/led#1), a
 * sub-assembly path (every part below it), a part definition id (every occurrence of it) or
 * the root id (everything). "lid#1" also finds a lone "lid". Empty when nothing matches.
 */
export function resolveTarget(asm: Assembly, target: string): AssemblyInstance[] {
  const t = normalizeTarget(asm, target);
  if (t === "" || t === asm.file.root || t === "root") return [...asm.instances];
  const exact = asm.instances.filter((i) => i.path === t);
  if (exact.length > 0) return exact;
  const below = asm.instances.filter((i) => i.path.startsWith(`${t}/`));
  if (below.length > 0) return below;
  const lone = /^(.*)#1$/.exec(t);
  if (lone) {
    const bare = asm.instances.filter((i) => i.path === lone[1]);
    if (bare.length > 0) return bare;
  }
  return asm.instances.filter((i) => i.def === t);
}

/**
 * Instances for a list of targets, without duplicates, in assembly order. Throws
 * AssemblyError UNKNOWN_TARGET naming the first target that matches nothing.
 */
export function resolveTargets(asm: Assembly, targets: string[]): AssemblyInstance[] {
  const chosen = new Set<AssemblyInstance>();
  for (const target of targets) {
    const found = resolveTarget(asm, target);
    if (found.length === 0) {
      const known = asm.instances.slice(0, 12).map((i) => i.path).join(", ");
      throw new AssemblyError("UNKNOWN_TARGET", `no occurrence, sub-assembly or definition is called '${target}'`, `Known occurrence paths: ${known}${asm.instances.length > 12 ? ", ..." : ""}.`);
    }
    for (const i of found) chosen.add(i);
  }
  return asm.instances.filter((i) => chosen.has(i));
}

/** One node of the export tree: a part occurrence or a sub-assembly occurrence. */
export interface ExportNode {
  name: string;
  /** Definition id: a part definition, or an assembly definition when children is set. */
  def: string;
  /** Relative to the parent node. */
  transform: Transform;
  color?: Color3;
  children?: ExportNode[];
}

export interface ExportTree {
  /** Name of the exported root: the root definition id, or the scope. */
  name: string;
  nodes: ExportNode[];
  /** Every part instance in the scope, with world transforms. */
  instances: AssemblyInstance[];
}

/**
 * The tree for a scope. The root scope keeps the sub-assembly structure; any other scope is
 * flattened to its part instances at their world transforms.
 */
export function exportTree(asm: Assembly, scope?: string): ExportTree {
  if (scope === undefined || ["", "root", asm.file.root].includes(normalizeTarget(asm, scope))) {
    const walk = (defId: string, depth: number): ExportNode[] => {
      if (depth > 32) throw new AssemblyError("ASSEMBLY_TOO_DEEP", "sub-assemblies nest deeper than 32 levels");
      return (asm.file.definitions[defId]?.occurrences ?? []).filter((o) => !o.suppressed).map((o) => {
        const node: ExportNode = { name: o.name, def: o.def, transform: o.transform };
        if (o.color) node.color = o.color;
        if (asm.file.definitions[o.def]?.kind === "assembly") node.children = walk(o.def, depth + 1);
        return node;
      });
    };
    return { name: asm.file.root, nodes: walk(asm.file.root, 0), instances: [...asm.instances] };
  }
  const instances = resolveTargets(asm, [scope]);
  const nodes = instances.map((i): ExportNode => {
    const node: ExportNode = { name: i.path, def: i.def, transform: i.world };
    const color = occurrenceColor(asm, i);
    if (color) node.color = color;
    return node;
  });
  return { name: normalizeTarget(asm, scope), nodes, instances };
}

/** The colour override stored on an instance's occurrence, if any. */
export function occurrenceColor(asm: Assembly, instance: AssemblyInstance): Color3 | undefined {
  for (const def of Object.values(asm.file.definitions)) {
    const occ = def.occurrences?.find((o) => o.id === instance.id);
    if (occ) return occ.color;
  }
  return undefined;
}

/** The effective colour of a node: its override, else its definition's colour. */
export function nodeColor(asm: Assembly, node: ExportNode): Color3 | undefined {
  return node.color ?? asm.file.definitions[node.def]?.color;
}
