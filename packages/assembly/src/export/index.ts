// exportArtifacts and exportFiles: STEP, STL, GLB and 3MF for a scope, plus the evidence
// sidecar. Every kernel handle made here is released before returning.
import type { FileRef } from "@open3dj/schemas";
import type { KernelAdapter } from "@open3dj/kernel";
import type { ArtifactFormat, Assembly, ExportArtifact, ExportFilesOptions, ExportOptions } from "../types.ts";
import { AssemblyError } from "../errors.ts";
import { exportTree } from "../resolve.ts";
import { toFileStem } from "../names.ts";
import { evidenceJson } from "./evidence.ts";
import { writeArtifacts } from "./files.ts";
import { writeGlb } from "./gltf.ts";
import { definitionMeshes } from "./mesh.ts";
import type { Mesh } from "./mesh.ts";
import { writeStep } from "./step.ts";
import { write3mf } from "./threemf.ts";

const FORMATS: ReadonlySet<string> = new Set<ArtifactFormat>(["step", "stl", "gltf", "3mf"]);

export function exportArtifacts(kernel: KernelAdapter, asm: Assembly, formats: ArtifactFormat[], options: ExportOptions = {}): ExportArtifact[] {
  for (const f of formats) if (!FORMATS.has(f)) throw new AssemblyError("BAD_FORMAT", `unknown export format '${f}'`, "Use step, stl, gltf or 3mf.");
  const linearDeflection = options.linearDeflection ?? 0.1;
  if (!(linearDeflection > 0)) throw new AssemblyError("BAD_OPTION", "linearDeflection must be greater than 0");
  const tree = exportTree(asm, options.scope);
  const scoped = options.scope !== undefined && tree.name !== asm.file.root;
  const base = toFileStem(options.baseName ?? (scoped ? `${asm.file.root}-${tree.name}` : asm.file.root));
  const defs = [...new Set(tree.instances.map((i) => i.def))];
  const out: ExportArtifact[] = [];
  const mark = kernel.checkpoint();
  try {
    let meshes: Map<string, Mesh> | undefined;
    const meshesOnce = () => (meshes ??= definitionMeshes(kernel, asm, defs, linearDeflection));
    for (const format of [...new Set(formats)]) {
      switch (format) {
        case "step":
          out.push({ name: `${base}.step`, format, bytes: writeStep(kernel, asm, tree) });
          break;
        case "stl": {
          const placed = tree.instances.map((i) => kernel.place(asm.shapes.get(i.def)!, i.world));
          out.push({ name: `${base}.stl`, format, bytes: kernel.exportStl(kernel.compound(placed), { linearDeflection }) });
          if ((options.stlPerDefinition ?? true) && defs.length > 1) {
            for (const def of defs) {
              out.push({ name: `${base}-${toFileStem(def)}.stl`, format, bytes: kernel.exportStl(asm.shapes.get(def)!, { linearDeflection }) });
            }
          }
          break;
        }
        case "gltf": {
          const { bytes, warnings } = writeGlb(asm, tree, meshesOnce());
          out.push(withWarnings({ name: `${base}.glb`, format, bytes }, warnings));
          break;
        }
        case "3mf": {
          const { bytes, warnings } = write3mf(asm, tree, meshesOnce());
          out.push(withWarnings({ name: `${base}.3mf`, format, bytes }, warnings));
          break;
        }
      }
    }
    if (options.evidence ?? true) {
      out.push({ name: `${base}.evidence.json`, format: "evidence", bytes: evidenceJson(kernel, asm, tree, out, options, linearDeflection) });
    }
  } finally {
    kernel.releaseSince(mark);
  }
  return out;
}

/**
 * Export and write into dir (created if needed). Writes only plain file names inside dir,
 * never through symlinks; with options.root, dir must stay inside that project folder.
 * Returns the files with their sha256, the evidence sidecar last.
 */
export async function exportFiles(kernel: KernelAdapter, asm: Assembly, formats: ArtifactFormat[], dir: string, options: ExportFilesOptions = {}): Promise<FileRef[]> {
  return writeArtifacts(exportArtifacts(kernel, asm, formats, options), dir, options);
}

function withWarnings(a: ExportArtifact, warnings: string[]): ExportArtifact {
  return warnings.length > 0 ? { ...a, warnings } : a;
}
