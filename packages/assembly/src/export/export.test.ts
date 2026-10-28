import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { initKernel, matrixFromTransform } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import type { Quaternion } from "@open3dj/schemas";
import { AssemblyError, buildAssembly, exportArtifacts, exportFiles, writeArtifacts, xcafLocation } from "../index.ts";
import type { ExportArtifact } from "../index.ts";
import { enclosure } from "../fixtures.ts";
import { sha256Hex } from "../names.ts";
import { threeMfTransform } from "./threemf.ts";

let kernel: Kernel;
let dir: string;
before(async () => {
  kernel = await initKernel();
  dir = await mkdtemp(join(tmpdir(), "open3dj-export-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const text = (a: ExportArtifact | undefined) => new TextDecoder().decode(a!.bytes);
const byName = (list: ExportArtifact[], suffix: string) => list.find((a) => a.name.endsWith(suffix));

describe("STEP", () => {
  test("the enclosure round-trips with names at both levels and 3 definitions for 6 occurrences", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const [step] = exportArtifacts(kernel, asm, ["step"], { evidence: false });
    assert.equal(step?.name, "enclosure.step");
    const doc = kernel.raw.importXCAFFromSTEP(text(step));
    try {
      const [root] = doc.getRoots();
      assert.equal(doc.getLabelInfo(root!).name, "enclosure");
      const children = doc.getChildren(root!);
      const names = children.map((c) => doc.getLabelInfo(c).name);
      assert.deepEqual(names, ["base", "lid", "screw#1", "screw#2", "screw#3", "screw#4"]);
      const refs = children.map((c) => doc.getReferredLabel(c)!);
      assert.equal(new Set(refs).size, 3);
      assert.deepEqual([...new Set(refs.map((r) => doc.getLabelInfo(r).name))], ["base", "lid", "screw"]);
      // A definition written through the one-shape wrapper names its inner part the same way.
      for (const ref of new Set(refs)) {
        for (const inner of doc.getChildren(ref)) assert.equal(doc.getLabelInfo(doc.getReferredLabel(inner) ?? inner).name, doc.getLabelInfo(ref).name);
      }
      assert.deepEqual(doc.getLocation(children[3]!).map((x) => Number(x.toFixed(9))), [1, 0, 0, 74, 0, 1, 0, 6, 0, 0, 1, 20]);
    } finally {
      doc.close();
    }
    assert.ok((text(step).match(/COLOUR_RGB/g) ?? []).length >= 3, "colours are written");
    // The flattened geometry lands where the assembly says.
    const all = kernel.importStep(text(step));
    const b = kernel.bbox(all);
    assert.deepEqual([b.min, b.max].flat().map((x) => Number(x.toFixed(6)) + 0), [0, 0, 0, 80, 60, 34]);
  });

  test("rotations survive the Euler conversion at the XCAF boundary", () => {
    const q = (x: number, y: number, z: number, w: number): Quaternion => {
      const n = Math.hypot(x, y, z, w);
      return [x / n, y / n, z / n, w / n];
    };
    const samples: Quaternion[] = [q(0.3, -0.5, 0.7, 0.4), q(0, 1, 0, 1), q(0, 1, 0, -1), q(0.5, 0.5, 0.5, 0.5), q(0.1, 0.2, 0.3, 0.9), q(1, 0, 0, 0)];
    const peg = kernel.box(2, 3, 5);
    const parts = samples.map((qq, i) => {
      const t = { t: [i * 10, 1, 2] as [number, number, number], q: qq };
      return { name: "peg", shape: kernel.place(peg, t), cloneOf: "peg", cloneTransform: t };
    });
    const asm = buildAssembly(kernel, { parts, mates: [], params: {}, warnings: [] });
    assert.equal(asm.shapes.size, 1);
    // writeStep compares every stored location with the intended matrix and throws on a mismatch.
    const [step] = exportArtifacts(kernel, asm, ["step"], { evidence: false });
    const doc = kernel.raw.importXCAFFromSTEP(text(step));
    try {
      const children = doc.getChildren(doc.getRoots()[0]!);
      children.forEach((c, i) => {
        const got = doc.getLocation(c);
        const want = matrixFromTransform(asm.instances[i]!.world);
        for (let k = 0; k < 12; k++) assert.ok(Math.abs(got[k]! - want[k]!) < 1e-6, `instance ${i} entry ${k}`);
      });
    } finally {
      doc.close();
    }
    for (const qq of samples) assert.ok(Number.isFinite(xcafLocation({ t: [0, 0, 0], q: qq }).ry!));
  });

  test("an occurrence scope exports just that part at its world placement", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const [step] = exportArtifacts(kernel, asm, ["step"], { scope: "screw#2", evidence: false });
    assert.equal(step?.name, "enclosure-screw_2.step");
    const b = kernel.bbox(kernel.importStep(text(step)));
    assert.ok(Math.abs(b.min[0] - (74 - 2.75)) < 1e-6);
    assert.throws(() => exportArtifacts(kernel, asm, ["step"], { scope: "nope" }), (e: unknown) => e instanceof AssemblyError && e.code === "UNKNOWN_TARGET");
  });
});

describe("STL, GLB and 3MF", () => {
  test("STL is binary, one file for the assembly plus one per definition", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const files = exportArtifacts(kernel, asm, ["stl"], { evidence: false });
    assert.deepEqual(files.map((f) => f.name), ["enclosure.stl", "enclosure-base.stl", "enclosure-lid.stl", "enclosure-screw.stl"]);
    for (const f of files) {
      const n = new DataView(f.bytes.buffer, f.bytes.byteOffset).getUint32(80, true);
      assert.equal(f.bytes.byteLength, 84 + 50 * n);
    }
  });

  test("GLB has one mesh per definition and a node per occurrence", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const [glb] = exportArtifacts(kernel, asm, ["gltf"], { evidence: false });
    const dv = new DataView(glb!.bytes.buffer, glb!.bytes.byteOffset);
    assert.equal(dv.getUint32(0, true), 0x46546c67);
    assert.equal(dv.getUint32(8, true), glb!.bytes.byteLength);
    const jsonLength = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb!.bytes.subarray(20, 20 + jsonLength))) as { meshes: unknown[]; nodes: Array<{ name: string; mesh?: number; translation?: number[] }>; accessors: Array<{ min?: number[] }> };
    assert.equal(json.meshes.length, 3);
    assert.equal(json.nodes.length, 7);
    assert.deepEqual(json.nodes.slice(1).map((n) => n.name), ["base", "lid", "screw#1", "screw#2", "screw#3", "screw#4"]);
    assert.equal(new Set(json.nodes.slice(3).map((n) => n.mesh)).size, 1);
    assert.deepEqual(json.nodes[4]!.translation, [74, 6, 20]);
    assert.ok(json.accessors[0]!.min);
  });

  test("3MF is a zip with a millimetre model, mesh objects and build items with transforms", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const [mf] = exportArtifacts(kernel, asm, ["3mf"], { evidence: false });
    assert.deepEqual([...mf!.bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const zip = unzipSync(mf!.bytes);
    assert.deepEqual(Object.keys(zip).sort(), ["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    const model = new TextDecoder().decode(zip["3D/3dmodel.model"]);
    assert.match(model, /<model unit="millimeter"[^>]*xmlns="http:\/\/schemas.microsoft.com\/3dmanufacturing\/core\/2015\/02"/);
    assert.equal((model.match(/<object /g) ?? []).length, 3);
    assert.equal((model.match(/<item /g) ?? []).length, 6);
    assert.match(model, /<item objectid="\d+" transform="1 0 0 0 1 0 0 0 1 74 6 20"\/>/);
    assert.match(model, /<basematerials id="1">/);
    // Every triangle points at an existing vertex and no triangle is degenerate.
    for (const obj of model.match(/<mesh>.*?<\/mesh>/g) ?? []) {
      const nv = (obj.match(/<vertex /g) ?? []).length;
      for (const [, a, b, c] of obj.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
        const v = [Number(a), Number(b), Number(c)];
        assert.ok(v.every((x) => x < nv) && new Set(v).size === 3);
      }
    }
    // Welded meshes are closed: every edge is shared by exactly two triangles.
    const screwMesh = (model.match(/<object [^>]*name="screw"[^>]*><mesh>.*?<\/mesh>/) ?? [""])[0];
    const edges = new Map<string, number>();
    for (const [, a, b, c] of screwMesh.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as Array<[string, string]>) {
        const key = Number(p) < Number(q) ? `${p}-${q}` : `${q}-${p}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok(edges.size > 0 && [...edges.values()].every((n) => n === 2), "screw mesh is watertight");
  });

  test("3MF transforms use the row-vector layout", () => {
    // 90 degrees about Z maps X to Y: the first row (image of X) is 0 1 0.
    assert.equal(threeMfTransform({ t: [1, 2, 3], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }), "0 1 0 -1 0 0 0 0 1 1 2 3");
  });

  test("GLB, 3MF and STL bytes are the same on every run", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const a = exportArtifacts(kernel, asm, ["gltf", "3mf", "stl"], { evidence: false });
    const b = exportArtifacts(kernel, asm, ["gltf", "3mf", "stl"], { evidence: false });
    assert.deepEqual(a.map((x) => sha256Hex(x.bytes)), b.map((x) => sha256Hex(x.bytes)));
  });
});

describe("evidence and files", () => {
  test("the sidecar lists every file with its hash, the measures and the engine pin", () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const files = exportArtifacts(kernel, asm, ["step", "3mf"], { rev: "r_7", engine: { open3dj: "0.0.0" } });
    const evidence = byName(files, ".evidence.json")!;
    assert.equal(evidence.format, "evidence");
    const doc = JSON.parse(text(evidence)) as { rev: string; engine: Record<string, string>; files: Array<{ name: string; sha256: string }>; assembly: { occurrences: number; definitions: number } };
    assert.equal(doc.rev, "r_7");
    assert.deepEqual(doc.engine, { open3dj: "0.0.0", occt_wasm: "5.8.1" });
    assert.deepEqual(doc.files.map((f) => f.name), ["enclosure.step", "enclosure.3mf"]);
    assert.equal(doc.files[1]!.sha256, sha256Hex(byName(files, ".3mf")!.bytes));
    assert.deepEqual([doc.assembly.occurrences, doc.assembly.definitions], [6, 3]);
  });

  test("exportFiles writes inside the project folder and returns hashed file refs", async () => {
    const root = join(dir, "project");
    await mkdir(root);
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const refs = await exportFiles(kernel, asm, ["3mf"], "out/r_1", { root });
    assert.deepEqual(refs.map((r) => r.path), ["out/r_1/enclosure.3mf", "out/r_1/enclosure.evidence.json"]);
    const bytes = await readFile(join(root, "out/r_1/enclosure.3mf"));
    assert.equal(refs[0]!.sha256, sha256Hex(bytes));
    // Writing twice overwrites in place.
    const again = await exportFiles(kernel, asm, ["3mf"], "out/r_1", { root });
    assert.equal(again[0]!.sha256, refs[0]!.sha256);
  });

  test("the path policy refuses .., absolute paths, symlink escapes and unsafe names", async () => {
    const root = join(dir, "policy");
    await mkdir(root);
    const outside = join(dir, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, "escape"));
    const files = [{ name: "a.step", format: "step", bytes: new Uint8Array([1]) }];
    const refused = (e: unknown) => e instanceof AssemblyError && e.code === "PATH_REFUSED";
    await assert.rejects(writeArtifacts(files, "../outside", { root }), refused);
    await assert.rejects(writeArtifacts(files, "out/../../outside", { root }), refused);
    await assert.rejects(writeArtifacts(files, outside, { root }), refused);
    await assert.rejects(writeArtifacts(files, "escape", { root }), refused);
    await assert.rejects(writeArtifacts(files, "escape/deeper", { root }), refused);
    await assert.rejects(writeArtifacts([{ name: "../a.step", format: "step", bytes: new Uint8Array([1]) }], "out", { root }), refused);
    await assert.rejects(writeArtifacts([{ name: ".hidden", format: "step", bytes: new Uint8Array([1]) }], "out", { root }), refused);
    await mkdir(join(root, "out2"));
    await symlink(join(outside, "target.step"), join(root, "out2", "a.step"));
    await assert.rejects(writeArtifacts(files, "out2", { root }), refused);
    const ok = await writeArtifacts(files, "./out3/", { root });
    assert.deepEqual(ok.map((r) => r.path), ["out3/a.step"]);
  });
});
