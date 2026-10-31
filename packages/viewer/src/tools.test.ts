// The pure parts of the viewer's picking, measure and view tools, tested in Node: face ranges
// and element names (web/faces.js), measure math (web/measure.js), explode offsets and the
// analysis overlay classes (web/analysis.js).
import { test } from "node:test";
import assert from "node:assert/strict";

type V3 = [number, number, number];
type Ranges = { starts: Uint32Array; contiguous: boolean };
type Element = { kind: string; face?: number; faces?: number[]; addressed: boolean; reason?: string };
const faces = (await import(new URL("../web/faces.js", import.meta.url).href)) as {
  faceRanges(index: ArrayLike<number>, vertexCount: number): Ranges;
  faceOfTriangle(starts: Uint32Array, tri: number): number;
  faceAddressing(r: Ranges, kernelFaces?: number): { faces: number; addressed: boolean; reason: string };
  faceEdges(positions: ArrayLike<number>, index: ArrayLike<number>, starts: Uint32Array): { edges: Array<{ faces: number[]; segments: Float32Array; length: number }>; faceEdges: number[][] };
  weldVertices(positions: ArrayLike<number>, tolerance: number): Int32Array;
  elementName(path: string, element: Element | null): { address: string | null; text: string };
};
const measure = (await import(new URL("../web/measure.js", import.meta.url).href)) as {
  distance(a: V3, b: V3): number;
  facePatch(p: ArrayLike<number>, idx: ArrayLike<number>, t0: number, t1: number): { area: number; normal: V3; centre: V3; planar: boolean };
  angleDeg(a: V3, b: V3): number;
  facesRelation(a: { normal: V3; centre: V3 }, b: { normal: V3; centre: V3 }): { angle: number; parallel: boolean; gap?: number };
  segmentsLength(s: ArrayLike<number>): number;
  applyPoint(m: ArrayLike<number>, p: V3): V3;
  applyDirection(m: ArrayLike<number>, v: V3): V3;
  kernelFit(fits: unknown[], a: string, b: string, pairs: (f: { a: string; b: string }) => string[][]): { kind: string } | null;
};
const analysis = (await import(new URL("../web/analysis.js", import.meta.url).href)) as {
  explodeOffsets(c: Map<string, V3>, centre: V3, factor: number): Map<string, V3>;
  overhangAngle(n: V3, build?: V3): number;
  overhangClass(n: V3, onBed: boolean, limit?: number): string;
  draftAngle(n: V3, pull: V3): number;
  draftClass(n: V3, pull: V3, minDeg?: number): string;
  classifyMesh(p: ArrayLike<number>, n: ArrayLike<number>, idx: ArrayLike<number>, rot: ArrayLike<number>, o: object): { vertexClass: Uint8Array; area: number[] };
  rotationKey(m: ArrayLike<number>): string;
  LEGENDS: Record<string, string[][]>;
};
const fits = (await import(new URL("../web/fits.js", import.meta.url).href)) as { fitPairs(f: { a: string; b: string }): string[][] };

const near = (a: number, b: number, tol = 1e-9, msg?: string) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} != ${b}`);

/**
 * A box mesh laid out the way OCCT tessellates: each face has its own four vertices (nothing
 * shared between faces) and its two triangles, faces in order -X +X -Y +Y -Z +Z.
 */
function boxMesh(sx = 2, sy = 3, sz = 4) {
  const faceDefs: Array<{ n: V3; quad: V3[] }> = [
    { n: [-1, 0, 0], quad: [[0, 0, 0], [0, 0, sz], [0, sy, sz], [0, sy, 0]] },
    { n: [1, 0, 0], quad: [[sx, 0, 0], [sx, sy, 0], [sx, sy, sz], [sx, 0, sz]] },
    { n: [0, -1, 0], quad: [[0, 0, 0], [sx, 0, 0], [sx, 0, sz], [0, 0, sz]] },
    { n: [0, 1, 0], quad: [[0, sy, 0], [0, sy, sz], [sx, sy, sz], [sx, sy, 0]] },
    { n: [0, 0, -1], quad: [[0, 0, 0], [0, sy, 0], [sx, sy, 0], [sx, 0, 0]] },
    { n: [0, 0, 1], quad: [[0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (const f of faceDefs) {
    const base = positions.length / 3;
    for (const v of f.quad) {
      positions.push(...v);
      normals.push(...f.n);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), index: Uint32Array.from(index) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test("face ranges: one run of triangles per face, in mesh order", () => {
  const m = boxMesh();
  const r = faces.faceRanges(m.index, m.positions.length / 3);
  assert.equal(r.contiguous, true);
  assert.deepEqual([...r.starts], [0, 2, 4, 6, 8, 10, 12]);
  assert.equal(faces.faceOfTriangle(r.starts, 0), 0);
  assert.equal(faces.faceOfTriangle(r.starts, 5), 2);
  assert.equal(faces.faceOfTriangle(r.starts, 11), 5);
  assert.equal(faces.faceOfTriangle(r.starts, 12), -1);
  assert.equal(faces.faceOfTriangle(r.starts, -1), -1);
});

test("face addresses only when the runs match the kernel's face count", () => {
  const m = boxMesh();
  const r = faces.faceRanges(m.index, m.positions.length / 3);
  assert.equal(faces.faceAddressing(r, 6).addressed, true);
  const off = faces.faceAddressing(r, 7);
  assert.equal(off.addressed, false);
  assert.match(off.reason, /6 face patches and the kernel counts 7 faces/);
  assert.equal(faces.faceAddressing(r, undefined).addressed, false);
  // A face whose triangles come back after another face's is not in kernel order.
  const shuffled = Uint32Array.from([...m.index.slice(0, 3), ...m.index.slice(6, 9), ...m.index.slice(3, 6), ...m.index.slice(9)]);
  const s = faces.faceRanges(shuffled, m.positions.length / 3);
  assert.equal(s.contiguous, false);
  assert.match(faces.faceAddressing(s, 6).reason, /not in kernel order/);
});

test("a welded mesh (vertices shared between faces) is one patch, so it gets no addresses", () => {
  // A tetrahedron with shared vertices: four triangles, one connected patch.
  const idx = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];
  const r = faces.faceRanges(idx, 4);
  assert.equal(r.starts.length - 1, 1);
  assert.equal(faces.faceAddressing(r, 4).addressed, false);
});

test("edges are the seams between faces: a box has 12, each between two faces, 4 per face", () => {
  const m = boxMesh(2, 3, 4);
  const r = faces.faceRanges(m.index, m.positions.length / 3);
  const { edges, faceEdges } = faces.faceEdges(m.positions, m.index, r.starts);
  assert.equal(edges.length, 12);
  for (const e of edges) assert.ok(e.faces[0]! >= 0 && e.faces[1]! > e.faces[0]!, JSON.stringify(e.faces));
  for (const list of faceEdges) assert.equal(list.length, 4);
  const total = edges.reduce((s, e) => s + e.length, 0);
  near(total, 4 * (2 + 3 + 4), 1e-5);
  // Seams of one face (a periodic face meeting itself) are not edges: drop one face and its seams open.
  const open = faces.faceEdges(m.positions, m.index.slice(0, 30), Uint32Array.from([0, 2, 4, 6, 8, 10]));
  assert.equal(open.edges.filter((e) => e.faces[1] === -1).length, 4, "the missing top leaves four open edges");
});

test("welding merges float noise within the tolerance and nothing farther", () => {
  const w = faces.weldVertices([0, 0, 0, 1e-7, 0, 0, 1, 0, 0], 1e-5);
  assert.equal(w[0], w[1]);
  assert.notEqual(w[0], w[2]);
});

test("element names: face addresses in the @elem: form, edges by their faces", () => {
  assert.deepEqual(faces.elementName("screw#2", { kind: "face", face: 6, addressed: true }), { address: "screw#2@elem:face:7", text: "screw#2@elem:face:7" });
  const edge = faces.elementName("lid", { kind: "edge", faces: [0, 4], addressed: true });
  assert.equal(edge.address, null);
  assert.equal(edge.text, "lid: the edge between face:1 and face:5");
  const un = faces.elementName("lid", { kind: "face", face: 2, addressed: false, reason: "the mesh has 3 face patches and the kernel counts 4 faces" });
  assert.equal(un.address, null);
  assert.match(un.text, /no address: the mesh has 3/);
  assert.deepEqual(faces.elementName("base", null), { address: "base", text: "base" });
});

test("measure: face area, normal and centre of a planar face; angle and gap between faces", () => {
  const m = boxMesh(2, 3, 4);
  const top = measure.facePatch(m.positions, m.index, 10, 12);
  near(top.area, 6);
  assert.deepEqual(top.normal, [0, 0, 1]);
  assert.equal(top.planar, true);
  assert.deepEqual(top.centre.map((x) => Math.round(x * 1e9) / 1e9), [1, 1.5, 4]);
  const bottom = measure.facePatch(m.positions, m.index, 8, 10);
  const side = measure.facePatch(m.positions, m.index, 2, 4);
  const opp = measure.facesRelation(top, bottom);
  near(opp.angle, 180);
  assert.equal(opp.parallel, true);
  near(opp.gap!, 4);
  const perp = measure.facesRelation(top, side);
  near(perp.angle, 90);
  assert.equal(perp.parallel, false);
  assert.equal(perp.gap, undefined);
  // Two triangles that fold are not planar.
  const bent = measure.facePatch([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0], [0, 1, 2, 3, 4, 5], 0, 2);
  assert.equal(bent.planar, false);
});

test("measure: distances, segment lengths and rigid transforms", () => {
  near(measure.distance([0, 0, 0], [3, 4, 12]), 13);
  near(measure.segmentsLength([0, 0, 0, 3, 4, 0, 3, 4, 0, 3, 4, 12]), 17);
  near(measure.angleDeg([1, 0, 0], [0, 1, 0]), 90);
  // A turn of 90 degrees about Z and a move of (10, 0, 0), column-major like three's Matrix4.
  const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  assert.deepEqual(measure.applyPoint(m, [1, 0, 0]).map((x) => Math.round(x * 1e9) / 1e9), [10, 1, 0]);
  assert.deepEqual(measure.applyDirection(m, [1, 0, 0]).map((x) => Math.round(x * 1e9) / 1e9), [0, 1, 0]);
  assert.deepEqual(measure.applyPoint(IDENTITY, [1, 2, 3]), [1, 2, 3]);
});

test("measure: the kernel's fit line for two occurrences, concise ranges included", () => {
  const list = [{ a: "base", b: "screw#1..4", kind: "clearance", distance_mm: 0.5 }, { a: "lid", b: "screw#2", kind: "contact", distance_mm: 0 }];
  assert.equal(measure.kernelFit(list, "screw#3", "base", fits.fitPairs)?.kind, "clearance");
  assert.equal(measure.kernelFit(list, "lid", "screw#2", fits.fitPairs)?.kind, "contact");
  assert.equal(measure.kernelFit(list, "lid", "base", fits.fitPairs), null);
});

test("explode offsets move each part from the assembly centre along its own direction", () => {
  const c = new Map<string, V3>([["a", [10, 0, 0]], ["b", [0, -4, 2]], ["mid", [0, 0, 0]]]);
  const o = analysis.explodeOffsets(c, [0, 0, 0], 0.5);
  assert.deepEqual(o.get("a"), [5, 0, 0]);
  assert.deepEqual(o.get("b"), [0, -2, 1]);
  assert.deepEqual(o.get("mid"), [0, 0, 0]);
  assert.deepEqual(analysis.explodeOffsets(c, [0, 0, 0], 0).get("a"), [0, 0, 0]);
  assert.deepEqual(analysis.explodeOffsets(c, [10, 0, 0], 1).get("a"), [0, 0, 0]);
});

test("overhang: the angle past vertical, the 45 degree limit and the bed", () => {
  const down = (deg: number): V3 => [Math.cos((deg * Math.PI) / 180), 0, -Math.sin((deg * Math.PI) / 180)];
  near(analysis.overhangAngle([1, 0, 0]), 0, 1e-9, "a vertical wall");
  near(analysis.overhangAngle([0, 0, -1]), 90, 1e-9, "a ceiling");
  near(analysis.overhangAngle([0, 0, 1]), -90, 1e-9, "a floor looks up");
  assert.equal(analysis.overhangClass(down(44), false), "ok");
  assert.equal(analysis.overhangClass(down(46), false), "overhang");
  assert.equal(analysis.overhangClass(down(46), false, 50), "ok");
  assert.equal(analysis.overhangClass([0, 0, -1], true), "bed");
  assert.equal(analysis.overhangClass([0, 0, -1], false), "overhang");
  assert.equal(analysis.overhangClass([0, 0, 1], true), "ok");
});

test("draft: positive towards the pull, negative away, insufficient below the minimum", () => {
  const wall = (deg: number): V3 => [Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180)];
  near(analysis.draftAngle(wall(3), [0, 0, 1]), 3, 1e-9);
  assert.equal(analysis.draftClass(wall(3), [0, 0, 1], 1), "positive");
  assert.equal(analysis.draftClass(wall(-3), [0, 0, 1], 1), "negative");
  assert.equal(analysis.draftClass(wall(0.5), [0, 0, 1], 1), "insufficient");
  assert.equal(analysis.draftClass(wall(0.5), [0, 0, -1], 0.25), "negative");
  assert.equal(analysis.draftClass([1, 0, 0], [1, 0, 0], 1), "positive", "a face square to the pull has 90 degrees of draft");
});

test("overlay classes on a box: the bottom rests on the bed, a turned box overhangs", () => {
  const m = boxMesh(2, 3, 4);
  const kinds = analysis.LEGENDS.overhang!.map((e) => e[0]);
  const flat = analysis.classifyMesh(m.positions, m.normals, m.index, IDENTITY, { kind: "overhang", limitDeg: 45 });
  near(flat.area[kinds.indexOf("bed")]!, 6, 1e-6);
  near(flat.area[kinds.indexOf("overhang")]!, 0, 1e-6);
  near(flat.area[kinds.indexOf("ok")]!, 2 * (2 * 3 + 2 * 4 + 3 * 4) - 6, 1e-6);
  // Turned 180 degrees about X: the old top is now the bottom, at the lowest level: still the bed.
  const flip = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  const turned = analysis.classifyMesh(m.positions, m.normals, m.index, flip, { kind: "overhang", limitDeg: 45 });
  near(turned.area[kinds.indexOf("bed")]!, 6, 1e-6);
  // Draft with the pull along +Z: top positive, bottom negative, the four walls insufficient.
  const dk = analysis.LEGENDS.draft!.map((e) => e[0]);
  const draft = analysis.classifyMesh(m.positions, m.normals, m.index, IDENTITY, { kind: "draft", pull: [0, 0, 1], minDeg: 1 });
  near(draft.area[dk.indexOf("positive")]!, 6, 1e-6);
  near(draft.area[dk.indexOf("negative")]!, 6, 1e-6);
  near(draft.area[dk.indexOf("insufficient")]!, 2 * (2 * 4 + 3 * 4), 1e-6);
  assert.equal(draft.vertexClass.length, m.positions.length / 3);
  assert.equal(analysis.rotationKey(IDENTITY), analysis.rotationKey([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]), "a move is not a turn");
  assert.notEqual(analysis.rotationKey(IDENTITY), analysis.rotationKey(flip));
});

const keys = (await import(new URL("../web/keys.js", import.meta.url).href)) as {
  shortcutAction(key: string, shift: boolean): string | undefined;
  takesText(target: unknown): boolean;
};

test("shortcuts follow the Shift key, not the letter case, so Caps Lock changes nothing", () => {
  assert.equal(keys.shortcutAction("s", false), "section");
  assert.equal(keys.shortcutAction("S", false), "section", "Caps Lock on, no Shift");
  assert.equal(keys.shortcutAction("S", true), "screenshot");
  assert.equal(keys.shortcutAction("s", true), "screenshot", "Caps Lock on with Shift");
  assert.equal(keys.shortcutAction("H", false), "hide");
  assert.equal(keys.shortcutAction("F", false), "fit");
  assert.equal(keys.shortcutAction("A", false), "agent-frame");
  assert.equal(keys.shortcutAction("a", true), "agent-dismiss");
  assert.equal(keys.shortcutAction("?", true), "help");
  assert.equal(keys.shortcutAction("2", false), "view-top");
  assert.equal(keys.shortcutAction("x", true), undefined, "no Shift action");
  assert.equal(keys.shortcutAction("Escape", false), undefined);
  assert.equal(keys.shortcutAction("q", false), undefined);
});

test("shortcuts are held back only in controls that take typed text", () => {
  assert.equal(keys.takesText({ tagName: "INPUT", type: "range" }), false);
  assert.equal(keys.takesText({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(keys.takesText({ tagName: "BUTTON" }), false);
  assert.equal(keys.takesText({ tagName: "INPUT", type: "text" }), true);
  assert.equal(keys.takesText({ tagName: "INPUT", type: "number" }), true);
  assert.equal(keys.takesText({ tagName: "INPUT" }), true, "an input without a type is text");
  assert.equal(keys.takesText({ tagName: "TEXTAREA" }), true);
  assert.equal(keys.takesText({ tagName: "SELECT" }), true);
  assert.equal(keys.takesText({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(keys.takesText(null), false);
});

test("the edge snap distance shrinks with the face's size on screen", () => {
  const snap = (faces as unknown as { edgeSnapPx(extent: number, max?: number): number }).edgeSnapPx;
  assert.equal(snap(400), 4, "a large face: the full 4 px");
  assert.equal(snap(40), 4);
  near(snap(20), 2, 1e-12, "a 20 px face: 2 px");
  near(snap(10), 1, 1e-12);
  assert.equal(snap(0), 0);
  assert.equal(snap(Number.NaN), 0);
  assert.equal(snap(400, 10), 10);
});

test("measure rows: the same face twice is two points on it, and a pair without a fit line is a plain note", () => {
  const m = measure as unknown as { measureRows(a: unknown, b: unknown, o: object): Array<[string, string, string | null]> };
  const round = (x: number, d = 3) => String(Number(x.toFixed(d)) + 0);
  const name = (p: { path: string; element: { face: number } }) => `${p.path}@elem:face:${p.element.face + 1}`;
  const top = { path: "lid", element: { kind: "face", face: 4 }, point: [0, 0, 36], face: { area: 100, normal: [0, 0, 1], centre: [0, 0, 36] } };
  const again = { ...top, point: [3, 4, 36] };
  const rows = m.measureRows(top, again, { name, fits: [], pairsOf: fits.fitPairs, round });
  assert.deepEqual(rows.map((r) => r[0]), ["lid@elem:face:5", "lid@elem:face:5", "Point to point"]);
  assert.equal(rows[1]![2], null);
  assert.match(rows[1]![1], /same element/);
  assert.match(rows[2]![1], /^5 mm/);
  assert.ok(!rows.some((r) => /Angle|planes/.test(r[0])), "no face relation for one face");

  const other = { path: "kind_1#165", element: { kind: "face", face: 0 }, point: [0, 0, 0], face: { area: 1, normal: [0, 0, -1], centre: [0, 0, 0] } };
  const pair = m.measureRows(top, other, { name, fits: [], pairsOf: fits.fitPairs, round });
  const last = pair[pair.length - 1]!;
  assert.match(last[1], /no fit line/);
  assert.equal(last[2], null, "a note that there is no number is not labelled measured");
  assert.ok(pair.some((r) => r[0] === "Angle between faces"));
});
