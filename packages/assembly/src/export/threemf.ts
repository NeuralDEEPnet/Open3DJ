// 3MF core (2015/02) written with fflate: one mesh object per definition with welded
// vertices, sub-assemblies as objects with components, one build item per top-level
// occurrence with its transform, units millimeter, colours as base materials.
import { zipSync } from "fflate";
import type { Transform } from "@open3dj/schemas";
import { matrixFromTransform } from "@open3dj/kernel";
import type { Assembly } from "../types.ts";
import type { ExportNode, ExportTree } from "../resolve.ts";
import { isIdentity } from "../math.ts";
import { weld } from "./mesh.ts";
import type { Mesh } from "./mesh.ts";

const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
// DOS zip timestamps are local time; building the date from local fields keeps the bytes
// the same in every time zone.
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

export function write3mf(asm: Assembly, tree: ExportTree, meshes: Map<string, Mesh>): { bytes: Uint8Array; warnings: string[] } {
  const warnings: string[] = [];
  let nextId = 1;
  const colors: string[] = [];
  const colorIndex = new Map<string, number>();
  const materialsId = Object.values(asm.file.definitions).some((d) => d.kind !== "assembly" && d.color) ? nextId++ : 0;

  const objects: string[] = [];
  const meshObject = new Map<string, number>();
  for (const [def, mesh] of meshes) {
    const { vertices, triangles } = weld(mesh);
    if (triangles.length === 0) {
      warnings.push(`3MF: definition '${def}' has no triangles and is left out.`);
      continue;
    }
    const d = asm.file.definitions[def];
    const id = nextId++;
    meshObject.set(def, id);
    let attrs = `id="${id}" type="model" name="${xml(d?.name ?? def)}"`;
    if (d?.partNumber) attrs += ` partnumber="${xml(d.partNumber)}"`;
    if (materialsId && d?.color) {
      const hex = toHex(d.color);
      let at = colorIndex.get(hex);
      if (at === undefined) {
        at = colors.length;
        colors.push(hex);
        colorIndex.set(hex, at);
      }
      attrs += ` pid="${materialsId}" pindex="${at}"`;
    }
    const v: string[] = [];
    for (let i = 0; i < vertices.length; i += 3) v.push(`<vertex x="${num(vertices[i]!)}" y="${num(vertices[i + 1]!)}" z="${num(vertices[i + 2]!)}"/>`);
    const t: string[] = [];
    for (let i = 0; i < triangles.length; i += 3) t.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
    objects.push(`<object ${attrs}><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`);
  }

  // Sub-assemblies become component objects; each is written after the objects it uses.
  const objectFor = (node: ExportNode): number | undefined => {
    if (!node.children) return meshObject.get(node.def);
    const components = node.children
      .map((c) => ({ c, id: objectFor(c) }))
      .filter((x): x is { c: ExportNode; id: number } => x.id !== undefined)
      .map(({ c, id }) => `<component objectid="${id}"${transformAttr(c.transform)}/>`);
    if (components.length === 0) return undefined;
    const id = nextId++;
    objects.push(`<object id="${id}" type="model" name="${xml(node.name)}"><components>${components.join("")}</components></object>`);
    return id;
  };
  const items: string[] = [];
  for (const node of tree.nodes) {
    const id = objectFor(node);
    if (id !== undefined) items.push(`<item objectid="${id}"${transformAttr(node.transform)}/>`);
  }
  if (tree.nodes.some((n) => n.color)) warnings.push("3MF: per-occurrence colour overrides are not written; each object uses its definition colour.");

  const materials = materialsId && colors.length > 0
    ? `<basematerials id="${materialsId}">${colors.map((c, i) => `<base name="color_${i}" displaycolor="${c}"/>`).join("")}</basematerials>`
    : "";
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}"><metadata name="Application">Open3DJ</metadata><metadata name="Title">${xml(tree.name)}</metadata><resources>${materials}${objects.join("")}</resources><build>${items.join("")}</build></model>`;

  const enc = new TextEncoder();
  const bytes = zipSync({
    "[Content_Types].xml": [enc.encode(CONTENT_TYPES), { mtime: ZIP_TIME }],
    "_rels/.rels": [enc.encode(RELS), { mtime: ZIP_TIME }],
    "3D/3dmodel.model": [enc.encode(model), { mtime: ZIP_TIME }],
  }, { level: 6 });
  return { bytes, warnings };
}

/**
 * 3MF uses row vectors: [x y z 1] * M, written "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31
 * m32". Row i of the 3x3 part is the image of axis i, which is column i of our matrix.
 */
export function threeMfTransform(tr: Transform): string {
  const m = matrixFromTransform(tr);
  const r = (i: number, j: number) => m[i * 4 + j]!;
  return [r(0, 0), r(1, 0), r(2, 0), r(0, 1), r(1, 1), r(2, 1), r(0, 2), r(1, 2), r(2, 2), m[3]!, m[7]!, m[11]!].map(num).join(" ");
}

function transformAttr(tr: Transform): string {
  return isIdentity(tr) ? "" : ` transform="${threeMfTransform(tr)}"`;
}

function num(x: number): string {
  const s = String(Number(x.toFixed(6)));
  return s === "-0" ? "0" : s;
}

function toHex(c: [number, number, number]): string {
  return `#${c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Attribute-safe text: escaped, and without the characters XML 1.0 does not allow at all. */
function xml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
