// STEP AP214 through an XCAF document: a pure assembly root, one shared definition label per
// part definition, names on both the definition (referred) label and each instance label,
// and colours (ASSEMBLIES.md section 12).
import { matrixFromTransform } from "@open3dj/kernel";
import type { KernelAdapter, Label, ShapeHandle, XcafDocument } from "@open3dj/kernel";
import { cleanName } from "@open3dj/schemas";
import type { Assembly } from "../types.ts";
import type { ExportNode, ExportTree } from "../resolve.ts";
import { AssemblyError } from "../errors.ts";
import { matrixDistance, srgbToLinear, xcafLocation } from "../math.ts";

/** Largest allowed difference between the intended and the stored location matrix. */
const LOCATION_TOLERANCE = 1e-9;

export function writeStep(kernel: KernelAdapter, asm: Assembly, tree: ExportTree): Uint8Array {
  const mark = kernel.checkpoint();
  const doc = kernel.createDocument();
  try {
    const defs = [...new Set(tree.instances.map((i) => i.def))];
    const xcafShape = xcafShapes(kernel, asm, defs);
    const root = doc.addShape(kernel.compound([]), { name: stepName(tree.name), assembly: true });
    const named = new Set<string>();
    const add = (parent: Label, node: ExportNode) => {
      const def = asm.file.definitions[node.def];
      const location = xcafLocation(node.transform);
      if (node.children) {
        // Each sub-assembly occurrence gets its own definition label: XCAF shares labels by
        // shape handle, and an assembly label's shape changes as children are added.
        const label = doc.addChild(parent, kernel.compound([]), { name: stepName(node.name), location });
        checkLocation(doc, label, node);
        const ref = doc.getReferredLabel(label) ?? label;
        doc.setName(ref, stepName(def?.name ?? node.def));
        for (const child of node.children) add(ref, child);
        return;
      }
      const entry = xcafShape.get(node.def);
      if (!entry) throw new AssemblyError("UNKNOWN_DEFINITION", `occurrence '${node.name}' uses definition '${node.def}', which has no geometry`);
      const options: { name: string; location: typeof location; color?: [number, number, number] } = { name: stepName(node.name), location };
      if (node.color) options.color = srgbToLinear(node.color);
      const label = doc.addChild(parent, entry.shape, options);
      checkLocation(doc, label, node);
      if (named.has(node.def)) return;
      named.add(node.def);
      const ref = doc.getReferredLabel(label);
      if (ref === null) return;
      const name = def?.name ?? node.def;
      doc.setName(ref, stepName(name));
      if (def?.color) doc.setColor(ref, srgbToLinear(def.color));
      // XCAF expands a wrapped definition, or one of several solids, into a sub-assembly. Name
      // its components too: the wrapper's single part gets the definition's name, and each
      // solid of a multi-solid part is "<name> body <n>".
      if (entry.wrapped || entry.solids > 1) nameInside(ref, name, def?.color, 0);
    };
    const nameInside = (label: Label, name: string, color: [number, number, number] | undefined, depth: number): void => {
      const children = doc.getChildren(label);
      children.forEach((inner, i) => {
        const n = children.length === 1 ? name : `${name} body ${i + 1}`;
        doc.setName(inner, stepName(n));
        const innerRef = doc.getReferredLabel(inner);
        if (innerRef === null || innerRef === inner) return;
        doc.setName(innerRef, stepName(n));
        if (color) doc.setColor(innerRef, srgbToLinear(color));
        if (depth < 2 && doc.getLabelInfo(innerRef).isAssembly) nameInside(innerRef, n, color, depth + 1);
      });
    };
    for (const node of tree.nodes) add(root, node);
    const text = doc.exportStep();
    checkStepRoundTrip(kernel, asm, tree, text);
    return new TextEncoder().encode(text);
  } finally {
    doc.close();
    kernel.releaseSince(mark);
  }
}

/**
 * A name as XCAF's STEP writer needs it. Measured on occt-wasm 5.8.1: setName takes bytes as
 * Latin-1 (UTF-8 text came out encoded twice), it escapes quotes and backslashes itself, and
 * it passes ISO 10303-21 \X2\ ... \X0\ runs through untouched, also when they were typed
 * literally into a name. So every character outside printable ASCII, and every backslash,
 * goes out as a \X2\ run of UTF-16 code units, which the reader turns back into the text.
 */
export function stepName(name: string): string {
  const clean = cleanName(name);
  return clean.replace(/[^\u0020-\u005b\u005d-\u007e]+/g, (run) => {
    let hex = "";
    for (let i = 0; i < run.length; i++) hex += run.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
    return `\\X2\\${hex}\\X0\\`;
  });
}

/**
 * The shape to hand XCAF per definition. Measured on occt-wasm 5.8.1: a shape that carries
 * its own location (place(), or any op applied to a placed shape) gets a new definition label
 * on every addChild, and its name is lost in the STEP file. Such definitions are wrapped in a
 * one-shape compound, which XCAF shares and names; the STEP then has one extra level inside
 * that definition. A kernel op that bakes the location would remove the wrapper.
 */
function xcafShapes(kernel: KernelAdapter, asm: Assembly, defs: string[]): Map<string, { shape: ShapeHandle; wrapped: boolean; solids: number }> {
  const out = new Map<string, { shape: ShapeHandle; wrapped: boolean; solids: number }>();
  const probe = kernel.createDocument();
  try {
    const root = probe.addShape(kernel.compound([]), { assembly: true });
    for (const def of defs) {
      const shape = asm.shapes.get(def);
      if (shape === undefined) continue;
      const a = probe.addChild(root, shape);
      const b = probe.addChild(root, shape);
      const shared = probe.getReferredLabel(a) === probe.getReferredLabel(b);
      const solids = kernel.counts(shape).solids;
      out.set(def, shared ? { shape, wrapped: false, solids } : { shape: kernel.compound([shape]), wrapped: true, solids });
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

/** Relative volume difference allowed between the assembly and its re-imported STEP. */
const ROUND_TRIP_TOLERANCE = 1e-6;

/**
 * Re-import the STEP text and compare it with the assembly: same number of solids, every
 * solid valid, same total volume. OCCT can write a face that it cannot rebuild on import (a
 * revolved arc that meets the axis at an angle, measured on occt-wasm 5.8.1), and other
 * OCCT-based tools would then open a broken solid. Throws STEP_ROUNDTRIP_FAILED naming the
 * occurrence and the faces that did not come back.
 */
export function checkStepRoundTrip(kernel: KernelAdapter, asm: Assembly, tree: ExportTree, text: string): void {
  const mark = kernel.checkpoint();
  try {
    let wantSolids = 0;
    let wantVolume = 0;
    for (const i of tree.instances) {
      const shape = asm.shapes.get(i.def);
      if (shape === undefined) continue;
      wantSolids += kernel.counts(shape).solids;
      wantVolume += kernel.volume(shape);
    }
    const back = kernel.importStep(text);
    const solids = kernel.subShapes(back, "solid");
    const problems: string[] = [];
    let gotVolume = 0;
    for (const solid of solids) {
      gotVolume += kernel.volume(solid);
      if (kernel.isValid(solid)) continue;
      const faces = kernel.subShapes(solid, "face");
      const bad = kernel.faces(solid).filter((f) => f.area <= 1e-9 || !kernel.isValid(faces[f.index - 1]!)).map((f) => `face:${f.index} (${f.surface})`);
      problems.push(`'${occurrenceAt(kernel, asm, tree, kernel.bbox(solid))}' comes back invalid${bad.length ? `, bad ${bad.slice(0, 5).join(", ")}` : ""}`);
    }
    if (solids.length !== wantSolids) problems.push(`${solids.length} solids instead of ${wantSolids}`);
    if (Math.abs(gotVolume - wantVolume) > ROUND_TRIP_TOLERANCE * Math.max(1, Math.abs(wantVolume))) {
      problems.push(`volume ${gotVolume.toFixed(6)} mm3 instead of ${wantVolume.toFixed(6)} mm3`);
    }
    if (problems.length === 0) return;
    throw new AssemblyError(
      "STEP_ROUNDTRIP_FAILED",
      `the STEP file does not re-import as the assembly: ${problems.join("; ")}`,
      "The model is valid, but its STEP form is not. A revolved profile whose end meets the rotation axis at an angle is the usual cause: end it on the axis square to the axis (an arc centred on the axis, or a short flat), then export again. STL, glTF and 3MF are not affected.",
    );
  } finally {
    kernel.releaseSince(mark);
  }
}

/** The occurrence whose world bounding box is closest to b, for error messages. */
function occurrenceAt(kernel: KernelAdapter, asm: Assembly, tree: ExportTree, b: { min: number[]; max: number[] }): string {
  let best = tree.instances[0]?.path ?? tree.name;
  let bestD = Infinity;
  for (const i of tree.instances) {
    const shape = asm.shapes.get(i.def);
    if (shape === undefined) continue;
    const w = kernel.bbox(kernel.place(shape, i.world));
    const d = Math.hypot(w.min[0] - b.min[0]!, w.min[1] - b.min[1]!, w.min[2] - b.min[2]!) + Math.hypot(w.max[0] - b.max[0]!, w.max[1] - b.max[1]!, w.max[2] - b.max[2]!);
    if (d < bestD) [best, bestD] = [i.path, d];
  }
  return best;
}
