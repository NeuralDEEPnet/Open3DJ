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

/** Vertices closer than this (mm, on every axis) are one vertex. 3MF writes 1e-6 mm. */
export const WELD_TOLERANCE_MM = 1e-5;

/**
 * Merge vertices that sit within WELD_TOLERANCE_MM of each other (the tessellator repeats
 * them per face, sometimes with noise such as 7e-15 against 1.4e-14) and drop triangles that
 * collapse, so 3MF gets the shared-vertex, closed mesh its spec asks for. Each vertex looks
 * in its grid cell and the 26 around it, so two close points are merged even when they
 * round into neighbouring cells.
 */
export function weld(mesh: Mesh, tolerance = WELD_TOLERANCE_MM): { vertices: number[]; triangles: number[] } {
  const cells = new Map<string, number[]>();
  const vertices: number[] = [];
  const remap = new Uint32Array(mesh.positions.length / 3);
  const cell = (x: number) => Math.round(x / tolerance);
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const [cx, cy, cz] = [cell(x), cell(y), cell(z)];
    let at: number | undefined;
    for (let dx = -1; dx <= 1 && at === undefined; dx++) {
      for (let dy = -1; dy <= 1 && at === undefined; dy++) {
        for (let dz = -1; dz <= 1 && at === undefined; dz++) {
          for (const v of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (Math.abs(vertices[v * 3]! - x) <= tolerance && Math.abs(vertices[v * 3 + 1]! - y) <= tolerance && Math.abs(vertices[v * 3 + 2]! - z) <= tolerance) {
              at = v;
              break;
            }
          }
        }
      }
    }
    if (at === undefined) {
      at = vertices.length / 3;
      vertices.push(x, y, z);
      const key = `${cx},${cy},${cz}`;
      const list = cells.get(key);
      if (list) list.push(at);
      else cells.set(key, [at]);
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

/**
 * Edges of a welded mesh that are not shared by exactly two triangles. A closed solid has
 * none; a crack (a dropped sliver face) or an open shell has some. The 3MF core spec requires
 * manifold meshes, and slicers repair or reject the rest.
 */
export function openEdgeCount(welded: { triangles: number[] }): number {
  const uses = new Map<number, number>();
  const t = welded.triangles;
  const n = t.length / 3 + 3;
  for (let i = 0; i + 2 < t.length; i += 3) {
    for (const [a, b] of [[t[i]!, t[i + 1]!], [t[i + 1]!, t[i + 2]!], [t[i + 2]!, t[i]!]] as const) {
      const key = a < b ? a * n * 3 + b : b * n * 3 + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of uses.values()) if (count !== 2) open++;
  return open;
}

/** One warning per definition whose mesh has open or non-manifold edges. */
export function manifoldWarnings(meshes: Map<string, Mesh>, label: (def: string) => string): string[] {
  const out: string[] = [];
  for (const [def, mesh] of meshes) {
    const open = openEdgeCount(weld(mesh));
    if (open > 0) out.push(`definition '${label(def)}': the mesh has ${open} open or non-manifold edges, so it is not watertight; slicers may report or repair it. Check the part for sliver faces or open shells.`);
  }
  return out;
}
