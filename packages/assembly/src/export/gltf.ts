// Binary glTF 2.0 (GLB) from an own writer: one mesh per definition (and colour), a node per
// occurrence, sub-assemblies as nested nodes (ARCHITECTURE.md section 14). Geometry stays
// in mm and Z-up; one root node scales by 0.001 and turns Z-up into glTF's Y-up.
import type { Color3 } from "@open3dj/schemas";
import type { Assembly } from "../types.ts";
import type { ExportNode, ExportTree } from "../resolve.ts";
import { nodeColor } from "../resolve.ts";
import { isIdentity } from "../math.ts";
import type { Mesh } from "./mesh.ts";

const DEFAULT_COLOR: Color3 = [0.7, 0.7, 0.72];
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

interface GltfNode {
  name: string;
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
}

export function writeGlb(asm: Assembly, tree: ExportTree, meshes: Map<string, Mesh>): { bytes: Uint8Array; warnings: string[] } {
  const warnings: string[] = [];
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const push = (data: Uint8Array, target: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    chunks.push(data);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, target });
    byteLength += data.byteLength;
    return bufferViews.length - 1;
  };
  const bytesOf = (a: Float32Array | Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  // Accessors per definition, shared by every mesh (colour variant) of that definition.
  const geometry = new Map<string, { position: number; normal: number; indices: number }>();
  for (const [def, mesh] of meshes) {
    if (mesh.indices.length === 0) {
      warnings.push(`glTF: definition '${def}' has no triangles and is left out.`);
      continue;
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
    const count = mesh.positions.length / 3;
    accessors.push({ bufferView: push(bytesOf(mesh.positions), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3", min, max });
    const position = accessors.length - 1;
    accessors.push({ bufferView: push(bytesOf(mesh.normals), ARRAY_BUFFER), componentType: FLOAT, count, type: "VEC3" });
    const normal = accessors.length - 1;
    accessors.push({ bufferView: push(bytesOf(mesh.indices), ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_INT, count: mesh.indices.length, type: "SCALAR" });
    geometry.set(def, { position, normal, indices: accessors.length - 1 });
  }

  const materials: Array<Record<string, unknown>> = [];
  const materialIndex = new Map<string, number>();
  const material = (c: Color3): number => {
    const key = c.join(",");
    let at = materialIndex.get(key);
    if (at === undefined) {
      at = materials.length;
      materials.push({ name: `color_${materials.length}`, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 0.6 } });
      materialIndex.set(key, at);
    }
    return at;
  };
  const gltfMeshes: Array<Record<string, unknown>> = [];
  const meshIndex = new Map<string, number>();
  const meshFor = (node: ExportNode): number | undefined => {
    const g = geometry.get(node.def);
    if (!g) return undefined;
    const mat = material(nodeColor(asm, node) ?? DEFAULT_COLOR);
    const key = `${node.def}\u0000${mat}`;
    let at = meshIndex.get(key);
    if (at === undefined) {
      at = gltfMeshes.length;
      gltfMeshes.push({ name: asm.file.definitions[node.def]?.name ?? node.def, primitives: [{ attributes: { POSITION: g.position, NORMAL: g.normal }, indices: g.indices, material: mat, mode: 4 }] });
      meshIndex.set(key, at);
    }
    return at;
  };

  const nodes: GltfNode[] = [{ name: tree.name, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [0.001, 0.001, 0.001], children: [] }];
  const addNode = (n: ExportNode): number => {
    const node: GltfNode = { name: n.name };
    if (!isIdentity(n.transform)) {
      if (Math.hypot(...n.transform.t) > 0) node.translation = [...n.transform.t];
      if (Math.abs(n.transform.q[3]) < 1) node.rotation = [...n.transform.q];
    }
    const at = nodes.length;
    nodes.push(node);
    if (n.children) {
      node.children = n.children.map(addNode);
    } else {
      const mesh = meshFor(n);
      if (mesh !== undefined) node.mesh = mesh;
    }
    return at;
  };
  nodes[0]!.children = tree.nodes.map(addNode);

  const json = {
    asset: { version: "2.0", generator: "Open3DJ" },
    scene: 0,
    scenes: [{ name: tree.name, nodes: [0] }],
    nodes,
    ...(gltfMeshes.length ? { meshes: gltfMeshes } : {}),
    ...(materials.length ? { materials } : {}),
    ...(accessors.length ? { accessors } : {}),
    ...(bufferViews.length ? { bufferViews } : {}),
    ...(byteLength ? { buffers: [{ byteLength: byteLength + ((4 - (byteLength % 4)) % 4) }] } : {}),
  };
  return { bytes: glb(json, chunks, byteLength), warnings };
}

function glb(json: unknown, chunks: Uint8Array[], binLength: number): Uint8Array {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const total = 12 + 8 + jsonBytes.length + (binLength ? 8 + binPadded : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  if (binLength) {
    const at = 20 + jsonBytes.length;
    dv.setUint32(at, binPadded, true);
    dv.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    let o = at + 8;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
  }
  return out;
}
