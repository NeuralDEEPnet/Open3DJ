// STEP AP214 through an XCAF document: a pure assembly root, one shared definition label per
// part definition, names on both the definition (referred) label and each instance label,
// and colours (ASSEMBLIES.md section 12).
import { matrixFromTransform } from "@open3dj/kernel";
import type { KernelAdapter, Label, ShapeHandle, XcafDocument } from "@open3dj/kernel";
import type { Assembly } from "../types.ts";
import type { ExportNode, ExportTree } from "../resolve.ts";
import { AssemblyError } from "../errors.ts";
import { matrixDistance, xcafLocation } from "../math.ts";

/** Largest allowed difference between the intended and the stored location matrix. */
const LOCATION_TOLERANCE = 1e-9;

export function writeStep(kernel: KernelAdapter, asm: Assembly, tree: ExportTree): Uint8Array {
  const mark = kernel.checkpoint();
  const doc = kernel.createDocument();
  try {
    const defs = [...new Set(tree.instances.map((i) => i.def))];
    const xcafShape = xcafShapes(kernel, asm, defs);
    const root = doc.addShape(kernel.compound([]), { name: tree.name, assembly: true });
    const named = new Set<string>();
    const add = (parent: Label, node: ExportNode) => {
      const def = asm.file.definitions[node.def];
      const location = xcafLocation(node.transform);
      if (node.children) {
        // Each sub-assembly occurrence gets its own definition label: XCAF shares labels by
        // shape handle, and an assembly label's shape changes as children are added.
        const label = doc.addChild(parent, kernel.compound([]), { name: node.name, location });
        checkLocation(doc, label, node);
        const ref = doc.getReferredLabel(label) ?? label;
        doc.setName(ref, def?.name ?? node.def);
        for (const child of node.children) add(ref, child);
        return;
      }
      const entry = xcafShape.get(node.def);
      if (!entry) throw new AssemblyError("UNKNOWN_DEFINITION", `occurrence '${node.name}' uses definition '${node.def}', which has no geometry`);
      const options: { name: string; location: typeof location; color?: [number, number, number] } = { name: node.name, location };
      if (node.color) options.color = node.color;
      const label = doc.addChild(parent, entry.shape, options);
      checkLocation(doc, label, node);
      if (named.has(node.def)) return;
      named.add(node.def);
      const ref = doc.getReferredLabel(label);
      if (ref === null) return;
      const name = def?.name ?? node.def;
      doc.setName(ref, name);
      if (def?.color) doc.setColor(ref, def.color);
      if (entry.wrapped) {
        // The wrapper's single component and its part get the definition's name too.
        for (const inner of doc.getChildren(ref)) {
          doc.setName(inner, name);
          const innerRef = doc.getReferredLabel(inner);
          if (innerRef !== null) {
            doc.setName(innerRef, name);
            if (def?.color) doc.setColor(innerRef, def.color);
          }
        }
      }
    };
    for (const node of tree.nodes) add(root, node);
    return new TextEncoder().encode(doc.exportStep());
  } finally {
    doc.close();
    kernel.releaseSince(mark);
  }
}

/**
 * The shape to hand XCAF per definition. Measured on occt-wasm 5.8.1: a shape that carries
 * its own location (place(), or any op applied to a placed shape) gets a new definition label
 * on every addChild, and its name is lost in the STEP file. Such definitions are wrapped in a
 * one-shape compound, which XCAF shares and names; the STEP then has one extra level inside
 * that definition. A kernel op that bakes the location would remove the wrapper.
 */
function xcafShapes(kernel: KernelAdapter, asm: Assembly, defs: string[]): Map<string, { shape: ShapeHandle; wrapped: boolean }> {
  const out = new Map<string, { shape: ShapeHandle; wrapped: boolean }>();
  const probe = kernel.createDocument();
  try {
    const root = probe.addShape(kernel.compound([]), { assembly: true });
    for (const def of defs) {
      const shape = asm.shapes.get(def);
      if (shape === undefined) continue;
      const a = probe.addChild(root, shape);
      const b = probe.addChild(root, shape);
      const shared = probe.getReferredLabel(a) === probe.getReferredLabel(b);
      out.set(def, shared ? { shape, wrapped: false } : { shape: kernel.compound([shape]), wrapped: true });
    }
  } finally {
    probe.close();
  }
  return out;
}

function checkLocation(doc: XcafDocument, label: Label, node: ExportNode): void {
  const got = doc.getLocation(label);
  const want = matrixFromTransform(node.transform);
  const d = matrixDistance(got, want);
  if (!(d <= LOCATION_TOLERANCE * Math.max(1, ...node.transform.t.map(Math.abs)))) {
    throw new AssemblyError("XCAF_LOCATION_MISMATCH", `the STEP writer stored a different placement for '${node.name}' (difference ${d.toExponential(2)})`, "Report this with the script: the Euler conversion at the XCAF boundary disagrees with the kernel.");
  }
}
