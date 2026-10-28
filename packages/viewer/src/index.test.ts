import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { IMPORT_MAP, PACKAGE_STATUS, THREE_VERSION, WEB_DIR, escapeHtml, viewerAssets, viewerPage } from "./index.ts";

// The page modules are plain browser JavaScript; Node imports them the same way (three resolves
// from node_modules), so their pure parts are tested here without a browser.
type Box = { min: number[]; max: number[] };
type FitLine = { a?: string; b?: string; kind: string; n?: number; volume_mm3?: number; distance_mm?: number; extra?: boolean };
const fits = (await import(new URL("../web/fits.js", import.meta.url).href)) as {
  fitAnchor(a: Box, b: Box): number[];
  expandSide(s: string): string[];
  fitPairs(f: { a: string; b: string }): string[][];
  fitValue(f: FitLine, all?: FitLine[]): string;
  fitCounts(f: FitLine[]): { clash: number; contact: number; clearance: number; extra: number };
  markerVisible(on: boolean, a: string, b: string, hidden: Set<string>, isolated: Set<string> | null): boolean;
};
interface ParsedPart { path: string; name: string; geometry: unknown; color: { r: number; g: number; b: number }; matrix: { elements: number[] } }
const glb = (await import(new URL("../web/glb.js", import.meta.url).href)) as {
  isGlb(b: ArrayBuffer): boolean;
  parseGlb(b: ArrayBuffer): { root: string; parts: ParsedPart[]; groups: string[] };
};

test("the package is ready and pins three", () => {
  assert.equal(PACKAGE_STATUS, "ready");
  assert.equal(THREE_VERSION, "0.186.1");
});

test("the asset table holds the page modules and four three.js files, all inside their folders", () => {
  const assets = viewerAssets();
  for (const name of ["app/main.js", "app/glb.js", "app/scene.js", "app/camera.js", "app/fits.js", "app/viewer.css", "app/icon.svg", "vendor/three.module.js", "vendor/three.core.js", "vendor/three.webgpu.js", "vendor/OrbitControls.js"]) {
    const a = assets.get(name);
    assert.ok(a, name);
    assert.ok(existsSync(a.file), name);
  }
  assert.equal([...assets.keys()].filter((k) => k.startsWith("vendor/")).length, 4);
  for (const [name, a] of assets) {
    assert.doesNotMatch(name, /\.\.|\/\/|^\//, name);
    if (name.startsWith("app/")) assert.ok(!relative(WEB_DIR, a.file).includes(`..${sep}`), name);
  }
  // index.html is the page itself, served with its CSP, not as an asset.
  assert.equal(assets.has("app/index.html"), false);
});

test("the page carries the import map and a CSP that allows exactly that inline script", () => {
  const page = viewerPage("enclosure <x>");
  const map = JSON.stringify(IMPORT_MAP);
  assert.ok(page.html.includes(`<script type="importmap">${map}</script>`));
  const hash = createHash("sha256").update(map).digest("base64");
  assert.match(page.csp, new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/=]/g, "\\$&")}'`));
  assert.match(page.csp, /default-src 'none'/);
  assert.match(page.csp, /frame-ancestors 'none'/);
  assert.ok(page.html.includes("enclosure &#60;x&#62;"));
  assert.doesNotMatch(page.html, /\{\{/);
  assert.equal(escapeHtml(`"a'&`), "&#34;a&#39;&#38;");
});

test("fit anchors sit in the overlap of two boxes, or in the middle of the gap", () => {
  assert.deepEqual(fits.fitAnchor({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [8, 2, 4], max: [20, 4, 6] }), [9, 3, 5]);
  assert.deepEqual(fits.fitAnchor({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [12, 0, 0], max: [20, 10, 10] }), [11, 5, 5]);
});

test("concise fit ranges expand into pairs", () => {
  assert.deepEqual(fits.expandSide("screw#1..3"), ["screw#1", "screw#2", "screw#3"]);
  assert.deepEqual(fits.expandSide("pcb_assy/standoff#2"), ["pcb_assy/standoff#2"]);
  assert.deepEqual(fits.fitPairs({ a: "base", b: "screw#1..2" }), [["base", "screw#1"], ["base", "screw#2"]]);
  assert.deepEqual(fits.fitPairs({ a: "lid", b: "base" }), [["lid", "base"]]);
  assert.equal(fits.fitValue({ kind: "clash", volume_mm3: 14.6789 }), "14.679 mm³ overlap");
  assert.equal(fits.fitValue({ kind: "contact", distance_mm: 0 }), "touching");
  assert.equal(fits.fitValue({ kind: "clearance", distance_mm: 0.5 }), "0.5 mm clearance");
});

test("further gaps of a pair (extra: true) are labelled and not counted as pairs", () => {
  assert.equal(fits.fitValue({ kind: "clearance", distance_mm: 0.25, extra: true }), "0.25 mm clearance, further gap");
  const lines = [
    { kind: "contact", n: 4 },
    { kind: "clearance", n: 4 },
    { kind: "clearance", n: 4, extra: true },
    { kind: "clearance", extra: true },
  ];
  assert.deepEqual(fits.fitCounts(lines), { clash: 0, contact: 4, clearance: 4, extra: 5 });
});

// Regression (review round 1): a mated lid's lip clearance is its pair's only line (the seat
// contact is exempt), but the header said "0 clearance, 1 further gap" and the row "further
// gap" for a pair listed nowhere else. Such a line now counts as the pair's relation.
test("an extra line that is its pair's only line counts as the pair and says why", () => {
  const lid = [{ a: "base", b: "lid", kind: "clearance", distance_mm: 0.25, extra: true }];
  assert.deepEqual(fits.fitCounts(lid), { clash: 0, contact: 0, clearance: 1, extra: 0 });
  assert.equal(fits.fitValue(lid[0]!, lid), "0.25 mm clearance, beside a mated seat");
  // Next to the pair's own line it is still a further gap, whichever order the sides are in.
  const screw = [{ a: "lid", b: "screw#1", kind: "contact", distance_mm: 0 }, { a: "screw#1", b: "lid", kind: "clearance", distance_mm: 0.2, extra: true }];
  assert.deepEqual(fits.fitCounts(screw), { clash: 0, contact: 1, clearance: 0, extra: 1 });
  assert.equal(fits.fitValue(screw[1]!, screw), "0.2 mm clearance, further gap");
});

// Regression (review round 1): fit markers ignored hide and isolate, and they draw without a
// depth test, so a base / lid marker floated over an isolated lid as if it belonged to it.
test("a fit marker shows only while both parts of its pair are shown", () => {
  const show = (hidden: string[], isolated: string[] | null, on = true) => fits.markerVisible(on, "base", "lid", new Set(hidden), isolated ? new Set(isolated) : null);
  assert.equal(show([], null), true);
  assert.equal(show([], null, false), false, "markers switched off");
  assert.equal(show(["base"], null), false, "one part hidden");
  assert.equal(show([], ["lid", "screw#1"]), false, "the other part is not isolated");
  assert.equal(show([], ["lid", "base"]), true);
});

/** A GLB laid out like packages/assembly/src/export/gltf.ts: a unit root, a sub-assembly, a shared mesh. */
function sampleGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
  const bin = new Uint8Array(positions.byteLength + normals.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(normals.buffer), 48);
  bin.set(new Uint8Array(indices.buffer), 96);
  const json = {
    asset: { version: "2.0", generator: "Open3DJ" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [0.001, 0.001, 0.001], children: [1, 4] },
      { name: "sub", translation: [100, 0, 0], children: [2, 3] },
      { name: "tet#1", mesh: 0 },
      { name: "tet#2", mesh: 1, translation: [0, 20, 0] },
      { name: "base", mesh: 0, translation: [0, 0, 5] },
    ],
    meshes: [
      { name: "tet", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] },
      { name: "tet", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 1, mode: 4 }] },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.125, 1] } }, { pbrMetallicRoughness: { baseColorFactor: [0.1, 0.2, 0.3, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: 12, type: "SCALAR" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 48 }, { buffer: 0, byteOffset: 96, byteLength: 48 }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Uint8Array.from([...text, ...new Array<number>(pad).fill(0x20)]);
  const total = 12 + 8 + text.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, text.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  dv.setUint32(20 + text.length, bin.length, true);
  dv.setUint32(24 + text.length, 0x004e4942, true);
  out.set(bin, 28 + text.length);
  return out.buffer;
}

test("a GLB becomes parts with occurrence paths, mm Z-up world matrices and one shared geometry per definition", () => {
  const bytes = sampleGlb();
  assert.equal(glb.isGlb(bytes), true);
  const parsed = glb.parseGlb(bytes);
  assert.equal(parsed.root, "root");
  assert.deepEqual(parsed.groups, ["sub"]);
  assert.deepEqual(parsed.parts.map((p) => p.path), ["sub/tet#1", "sub/tet#2", "base"]);
  // The root's mm-to-metres scale and Z-to-Y turn are dropped: translations stay in mm, Z up.
  const t = (p: ParsedPart) => p.matrix.elements.slice(12, 15);
  assert.deepEqual(t(parsed.parts[0]!), [100, 0, 0]);
  assert.deepEqual(t(parsed.parts[1]!), [100, 20, 0]);
  assert.deepEqual(t(parsed.parts[2]!), [0, 0, 5]);
  assert.equal(parsed.parts[0]!.geometry, parsed.parts[1]!.geometry, "two colours of one definition share one geometry");
  assert.equal(parsed.parts[0]!.geometry, parsed.parts[2]!.geometry);
  assert.ok(Math.abs(parsed.parts[0]!.color.r - 0.5) < 1e-6 && Math.abs(parsed.parts[1]!.color.b - 0.3) < 1e-6);
});

test("bytes that are not a GLB are refused with a message", () => {
  assert.equal(glb.isGlb(new TextEncoder().encode("fake gltf").buffer), false);
  assert.throws(() => glb.parseGlb(new TextEncoder().encode("fake gltf of part").buffer), /not a GLB/);
  const truncated = sampleGlb().slice(0, 200);
  assert.throws(() => glb.parseGlb(truncated), /GLB/);
});
