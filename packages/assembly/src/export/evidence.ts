// The evidence sidecar written next to exports: file hashes, measures and engine pins, so a
// reviewer can check that the files belong to the reported geometry. No timestamps, so the
// same export gives the same bytes.
import type { KernelAdapter } from "@open3dj/kernel";
import type { Assembly, ExportArtifact, ExportOptions } from "../types.ts";
import type { ExportTree } from "../resolve.ts";
import { bboxUnion, clean } from "../math.ts";
import { sha256Hex } from "../names.ts";

export function evidenceJson(kernel: KernelAdapter, asm: Assembly, tree: ExportTree, files: ExportArtifact[], options: ExportOptions, linearDeflection: number): Uint8Array {
  const r = (x: number) => clean(Number(x.toFixed(6)));
  const defs = [...new Set(tree.instances.map((i) => i.def))];
  const occurrences = new Map<string, number>();
  for (const i of tree.instances) occurrences.set(i.def, (occurrences.get(i.def) ?? 0) + 1);
  const definitions = defs.map((def) => {
    const m = kernel.measure(asm.shapes.get(def)!);
    return {
      def,
      occurrences: occurrences.get(def) ?? 0,
      valid: m.valid,
      volume_mm3: r(m.volume),
      area_mm2: r(m.area),
      bbox: { min: m.bbox.min.map(r), max: m.bbox.max.map(r) },
      counts: { solids: m.counts.solids, faces: m.counts.faces, edges: m.counts.edges },
      geometry_hash: asm.file.definitions[def]?.geometry_hash,
    };
  });
  const volumes = new Map(definitions.map((d) => [d.def, d.volume_mm3]));
  const mark = kernel.checkpoint();
  let bbox;
  try {
    bbox = bboxUnion(tree.instances.map((i) => kernel.bbox(kernel.place(asm.shapes.get(i.def)!, i.world))));
  } finally {
    kernel.releaseSince(mark);
  }
  const doc = {
    o3j_evidence: "0",
    ...(options.rev ? { rev: options.rev } : {}),
    scope: tree.name,
    engine: { ...options.engine, occt_wasm: kernel.versions.occtWasm },
    tessellation: { linear_deflection_mm: linearDeflection },
    confidence: "measured",
    files: files.map((f) => ({ name: f.name, format: f.format, bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) })),
    assembly: {
      root: asm.file.root,
      occurrences: tree.instances.length,
      definitions: defs.length,
      volume_mm3: r(tree.instances.reduce((s, i) => s + (volumes.get(i.def) ?? 0), 0)),
      ...(bbox ? { bbox: { min: bbox.min.map(r), max: bbox.max.map(r) } } : {}),
    },
    definitions,
    warnings: files.flatMap((f) => f.warnings ?? []),
  };
  return new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
}
