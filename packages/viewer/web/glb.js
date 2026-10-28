// Reads the GLB that the export job writes (packages/assembly/src/export/gltf.ts): one mesh
// per definition and colour, a node per occurrence, sub-assemblies as nested nodes. Meshes of
// one definition share their accessors, so they share one BufferGeometry here.
//
// The writer's root node scales mm to metres and turns Z-up into glTF's Y-up. The viewer
// works in mm with Z up, like the GeometryReport, so it drops that one node's transform.
import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3 } from "three";

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };

/** True when the bytes start with the GLB magic. */
export function isGlb(buffer) {
  return buffer.byteLength >= 12 && new DataView(buffer).getUint32(0, true) === MAGIC;
}

/**
 * Parse GLB bytes (an ArrayBuffer) into parts with world matrices in mm, Z up.
 * Returns { root, parts: [{ path, name, geometry, geometryKey, color, matrix }], groups: [path] }.
 */
export function parseGlb(buffer) {
  if (!isGlb(buffer)) throw new Error("not a GLB file (no glTF magic)");
  const dv = new DataView(buffer);
  const total = Math.min(dv.getUint32(8, true), buffer.byteLength);
  let json;
  let binStart = -1;
  let binLength = 0;
  for (let at = 12; at + 8 <= total;) {
    const length = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const start = at + 8;
    if (start + length > total) throw new Error("GLB chunk runs past the end of the file");
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === BIN_CHUNK && binStart < 0) {
      binStart = start;
      binLength = length;
    }
    at = start + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");

  const accessorCache = new Map();
  const accessor = (index) => {
    let a = accessorCache.get(index);
    if (a) return a;
    const acc = json.accessors?.[index];
    const view = acc && json.bufferViews?.[acc.bufferView];
    const Arr = acc && ARRAYS[acc.componentType];
    const width = acc && COMPONENTS[acc.type];
    if (!acc || !view || !Arr || !width || binStart < 0) throw new Error(`GLB accessor ${index} is not one this viewer reads`);
    const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const bytes = acc.count * width * Arr.BYTES_PER_ELEMENT;
    if (offset + bytes > binLength) throw new Error(`GLB accessor ${index} runs past the binary chunk`);
    // Copy, so the typed array is aligned whatever the chunk offset is.
    const array = new Arr(buffer.slice(binStart + offset, binStart + offset + bytes));
    a = new BufferAttribute(array, width);
    accessorCache.set(index, a);
    return a;
  };

  const geometryCache = new Map();
  const geometryFor = (prim) => {
    const key = `${prim.attributes.POSITION}/${prim.attributes.NORMAL ?? "-"}/${prim.indices ?? "-"}`;
    let g = geometryCache.get(key);
    if (!g) {
      g = new BufferGeometry();
      g.setAttribute("position", accessor(prim.attributes.POSITION));
      if (prim.attributes.NORMAL !== undefined) g.setAttribute("normal", accessor(prim.attributes.NORMAL));
      if (prim.indices !== undefined) g.setIndex(accessor(prim.indices));
      if (prim.attributes.NORMAL === undefined) g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      geometryCache.set(key, g);
    }
    return { geometry: g, key };
  };

  const colorOf = (materialIndex) => {
    const f = json.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
    // baseColorFactor is linear, which is three's working colour space.
    return f ? new Color().setRGB(f[0], f[1], f[2]) : new Color().setRGB(0.45, 0.45, 0.47);
  };

  const local = (node) => {
    if (node.matrix) return new Matrix4().fromArray(node.matrix);
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    return new Matrix4().compose(new Vector3(...t), new Quaternion(...r), new Vector3(...s));
  };

  const parts = [];
  const groups = [];
  const seen = new Set();
  const walk = (index, prefix, parent, depth) => {
    if (depth > 64 || seen.has(index)) throw new Error("GLB node graph is too deep or has a cycle");
    seen.add(index);
    const node = json.nodes?.[index];
    if (!node) return;
    const name = String(node.name ?? `node${index}`);
    const path = prefix ? `${prefix}/${name}` : name;
    const world = parent.clone().multiply(local(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue;
        const { geometry, key } = geometryFor(prim);
        parts.push({ path, name, geometry, geometryKey: key, color: colorOf(prim.material), matrix: world });
      }
    }
    if (node.children?.length) {
      if (node.mesh === undefined) groups.push(path);
      for (const c of node.children) walk(c, path, world, depth + 1);
    }
  };

  const scene = json.scenes?.[json.scene ?? 0];
  const tops = scene?.nodes ?? [];
  let root = "";
  for (const top of tops) {
    const node = json.nodes?.[top];
    if (!node) continue;
    root = String(node.name ?? "");
    // The root node only converts units and axes: its children are the occurrences.
    if (node.mesh !== undefined) walk(top, "", new Matrix4(), 0);
    else {
      seen.add(top);
      for (const c of node.children ?? []) walk(c, "", new Matrix4(), 1);
    }
  }
  return { root, parts, groups };
}
