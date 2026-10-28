// Tessellation per definition, shared by the glTF and 3MF writers.
import type { KernelAdapter } from "@open3dj/kernel";
import type { Assembly } from "../types.ts";

export interface Mesh {
  /** xyz per vertex, in the definition frame, mm. */
  positions: Float32Array;
  /** Unit normals per vertex. */
  normals: Float32Array;
  indices: Uint32Array;
}

/** One mesh per definition id. Definitions with no triangles map to an empty mesh. */
export function definitionMeshes(kernel: KernelAdapter, asm: Assembly, defs: Iterable<string>, linearDeflection: number): Map<string, Mesh> {
  const out = new Map<string, Mesh>();
  for (const def of defs) {
    if (out.has(def)) continue;
    const shape = asm.shapes.get(def);
    if (shape === undefined) continue;
    const m = kernel.tessellate(shape, { linearDeflection });
    const normals = new Float32Array(m.normals.length);
    for (let i = 0; i < m.normals.length; i += 3) {
      const x = m.normals[i]!;
      const y = m.normals[i + 1]!;
      const z = m.normals[i + 2]!;
      const n = Math.hypot(x, y, z);
      if (n > 0) {
        normals[i] = x / n;
        normals[i + 1] = y / n;
        normals[i + 2] = z / n;
      } else {
        normals[i + 2] = 1;
      }
    }
    out.set(def, { positions: Float32Array.from(m.positions), normals, indices: Uint32Array.from(m.indices) });
  }
  return out;
}

/**
 * Merge vertices at identical positions (the tessellator repeats them per face) and drop
 * triangles that collapse, so 3MF gets the shared-vertex mesh its spec asks for.
 */
export function weld(mesh: Mesh): { vertices: number[]; triangles: number[] } {
  const index = new Map<string, number>();
  const vertices: number[] = [];
  const remap = new Uint32Array(mesh.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${x},${y},${z}`;
    let at = index.get(key);
    if (at === undefined) {
      at = vertices.length / 3;
      index.set(key, at);
      vertices.push(x, y, z);
    }
    remap[i] = at;
  }
  const triangles: number[] = [];
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!;
    const b = remap[mesh.indices[t + 1]!]!;
    const c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return { vertices, triangles };
}
