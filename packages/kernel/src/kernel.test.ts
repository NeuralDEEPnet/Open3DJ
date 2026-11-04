import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { KernelError, applyTransform, initKernel, isUnitQuaternion, matrixFromTransform, quaternionFromAxisAngle } from "./index.ts";
import type { Kernel, ShapeHandle } from "./index.ts";

const close = (actual: number, expected: number, rel = 1e-6, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)), msg ?? `${actual} != ${expected} (rel ${rel})`);

let k: Kernel;
before(async () => {
  k = await initKernel();
});

describe("primitives and measures", () => {
  test("box volume, area, bbox, counts and validity", () => {
    const b = k.box(10, 20, 30);
    const m = k.measure(b);
    assert.equal(m.valid, true);
    close(m.volume, 6000);
    close(m.area, 2 * (10 * 20 + 10 * 30 + 20 * 30));
    assert.deepEqual(m.bbox, { min: [0, 0, 0], max: [10, 20, 30] });
    close(m.centerOfMass[2], 15);
    assert.deepEqual({ solids: m.counts.solids, faces: m.counts.faces, edges: m.counts.edges }, { solids: 1, faces: 6, edges: 12 });
    assert.equal(k.versions.occtWasm, "5.8.1");
  });

  test("bad sizes are rejected before reaching the kernel", () => {
    assert.throws(() => k.box(0, 1, 1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
    assert.throws(() => k.cylinder(Number.NaN, 1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
  });
});

describe("booleans", () => {
  test("fuse of overlapping boxes is one valid solid of the union volume", () => {
    const a = k.box(10, 10, 10);
    const b = k.translate(k.box(10, 10, 10), [5, 0, 0]);
    const u = k.fuse(a, b);
    assert.equal(k.shapeType(u), "solid");
    close(k.volume(u), 1500);
  });

  test("cutAll returns a solid (single-solid compound unwrapped)", () => {
    const plate = k.translate(k.box(60, 40, 8), [-30, -20, 0]);
    const holes = [[-20, -10], [20, 10]].map(([x, y]) => k.translate(k.cylinder(3, 20), [x!, y!, -5]));
    const r = k.cutAll(plate, holes);
    assert.equal(k.shapeType(r), "solid");
    close(k.volume(r), 60 * 40 * 8 - 2 * Math.PI * 9 * 8, 1e-6);
  });

  test("fuseAll of disjoint bodies keeps a compound, and asSolid refuses it", () => {
    const r = k.fuseAll([k.box(1, 1, 1), k.translate(k.box(1, 1, 1), [5, 0, 0])]);
    assert.equal(k.counts(r).solids, 2);
    close(k.volume(r), 2);
    assert.throws(() => k.asSolid(r), (e: unknown) => e instanceof KernelError && e.code === "NOT_A_SOLID");
  });

  test("common of disjoint shapes is empty, not an error", () => {
    const r = k.common(k.box(1, 1, 1), k.translate(k.box(1, 1, 1), [5, 0, 0]));
    close(k.volume(r), 0);
  });
});

describe("features", () => {
  test("fillet of every cube edge matches the analytic rounded-cube volume", () => {
    const a = 10, r = 1;
    const cube = k.box(a, a, a);
    const out = k.fillet(cube, k.subShapes(cube, "edge"), r);
    const s = a - 2 * r;
    const expected = s ** 3 + 6 * s * s * r + 3 * Math.PI * r * r * s + (4 / 3) * Math.PI * r ** 3;
    close(k.volume(out), expected, 1e-5);
    assert.equal(k.isValid(out), true);
  });

  test("fillet accepts a single-solid compound (from a boolean) as input", () => {
    const body = k.cutAll(k.box(20, 20, 10), [k.translate(k.cylinder(2, 20), [10, 10, -5])]);
    const top = k.edges(body).filter((e) => e.bbox.min[2] > 9.999 && e.curve === "line");
    assert.equal(top.length, 4);
    const all = k.subShapes(body, "edge");
    const out = k.fillet(body, top.map((e) => all[e.index - 1]!), 1);
    assert.ok(k.volume(out) < k.volume(body));
  });

  test("an oversized fillet fails with a structured error", () => {
    const cube = k.box(10, 10, 10);
    assert.throws(
      () => k.fillet(cube, k.subShapes(cube, "edge"), 6),
      (e: unknown) => e instanceof KernelError && (e.code === "FILLET_FAILED" || e.code === "INVALID_RESULT") && e.op === "fillet",
    );
  });

  test("a failed fillet names the faulty edges as element addresses", () => {
    const cube = k.box(10, 10, 10);
    const edges = k.subShapes(cube, "edge").slice(0, 2);
    assert.throws(
      () => k.fillet(cube, edges, 20),
      (e: unknown) => e instanceof KernelError && e.code === "FILLET_FAILED" && e.elements.join(",") === "edge:1,edge:2" && !!e.hint && !/fillet: fillet/.test(e.message),
    );
  });

  test("fillet with an empty edge query is a BAD_ARGUMENT with a hint", () => {
    assert.throws(() => k.fillet(k.box(1, 1, 1), [], 0.1), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT" && !!e.hint);
  });

  test("shell of a plain box: positive thickness walls inward, negative outward", () => {
    const b = k.box(40, 30, 20);
    const top = topFace(b, 20);
    const inward = k.shell(b, [top], 2);
    close(k.volume(inward), 40 * 30 * 20 - 36 * 26 * 18, 1e-6);
    assert.deepEqual(k.bbox(inward), { min: [0, 0, 0], max: [40, 30, 20] });
    const outward = k.shell(b, [top], -2);
    assert.deepEqual(k.bbox(outward).min.map(Math.round), [-2, -2, -2]);
  });

  test("shell that silently yields an invalid solid is reported as INVALID_RESULT", () => {
    // Endurance spike: a box with all 12 edges filleted, shelled with the top removed,
    // comes back from OCCT with no error but fails isValid.
    const W = 60, D = 50, H = 30;
    const b = k.translate(k.box(W, D, H), [-W / 2, -D / 2, 0]);
    const rounded = k.fillet(b, k.subShapes(b, "edge"), 3);
    const top = topFace(rounded, H);
    assert.throws(
      () => k.shell(rounded, [top], 2),
      (e: unknown) => e instanceof KernelError && e.code === "INVALID_RESULT" && e.op === "shell" && /invalid/.test(e.message),
    );
  });
});

describe("queries, transforms and sketches", () => {
  test("edge and face queries return plain data with element indices", () => {
    const b = k.box(10, 20, 30);
    const edges = k.edges(b);
    assert.equal(edges.length, 12);
    assert.deepEqual(edges.map((e) => e.index), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(edges.every((e) => e.curve === "line"));
    assert.deepEqual(edges.map((e) => Math.round(e.length)).sort((x, y) => x - y), [10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
    const faces = k.faces(b);
    assert.equal(faces.length, 6);
    const top = faces.find((f) => f.bbox.min[2] > 29.999)!;
    assert.equal(top.surface, "plane");
    assert.deepEqual(top.normal.map((x) => Math.round(x)), [0, 0, 1]);
    close(top.area, 200);
  });

  test("place applies translation plus quaternion and rejects non-unit quaternions", () => {
    const b = k.box(10, 20, 5);
    const p = k.place(b, { t: [100, 0, 0], q: quaternionFromAxisAngle([0, 0, 1], 90) });
    const bb = k.bbox(p);
    close(bb.min[0], 80, 1e-6);
    close(bb.max[0], 100, 1e-6);
    close(bb.max[1], 10, 1e-6);
    assert.throws(() => k.place(b, { t: [0, 0, 0], q: [0, 0, 0, 2] }), (e: unknown) => e instanceof KernelError && e.code === "BAD_ARGUMENT");
  });

  test("polygon, face and extrude make a prism; revolve makes a cylinder", () => {
    const tri = k.face(k.polygon([[0, 0, 0], [10, 0, 0], [0, 10, 0]]));
    close(k.volume(k.extrude(tri, [0, 0, 5])), 250);
    const rect = k.face(k.polygon([[0, 0, 0], [5, 0, 0], [5, 0, 10], [0, 0, 10]]));
    close(k.volume(k.revolve(rect, { origin: [0, 0, 0], dir: [0, 0, 1] }, 360)), Math.PI * 25 * 10, 1e-6);
  });

  test("loft between two squares makes a frustum", () => {
    const sq = (s: number, z: number) => k.polygon([[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]]);
    const v = k.volume(k.loft([sq(5, 0), sq(2.5, 10)], { solid: true, ruled: true }));
    const a1 = 100, a2 = 25;
    close(v, (10 / 3) * (a1 + a2 + Math.sqrt(a1 * a2)), 1e-6);
  });
});

describe("transform math", () => {
  test("quaternion to matrix and point transforms", () => {
    const q = quaternionFromAxisAngle([0, 0, 1], 90);
    assert.ok(isUnitQuaternion(q));
    const p = applyTransform({ t: [1, 2, 3], q }, [1, 0, 0]);
    [1, 3, 3].forEach((x, i) => close(p[i]!, x, 1e-12));
    assert.deepEqual(matrixFromTransform({ t: [4, 5, 6], q: [0, 0, 0, 1] }), [1, 0, 0, 4, 0, 1, 0, 5, 0, 0, 1, 6]);
    const qx = quaternionFromAxisAngle([1, 0, 0], 90);
    const py = applyTransform({ t: [0, 0, 0], q: qx }, [0, 1, 0]);
    [0, 0, 1].forEach((x, i) => close(py[i]!, x, 1e-12));
    assert.equal(isUnitQuaternion([0, 0, 0, 1.01]), false);
  });
});

describe("exchange, documents and renders", () => {
  test("STEP and STL export; STEP import round trip keeps the volume", () => {
    const b = k.box(10, 20, 30);
    const step = k.exportStep(b);
    assert.match(step, /^ISO-10303-21;/);
    close(k.volume(k.importStep(step)), 6000, 1e-6);
    const stl = k.exportStl(b);
    const tris = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
    assert.equal(stl.byteLength, 84 + 50 * tris);
    assert.ok(tris >= 12);
  });

  test("BREP round trip", () => {
    const c = k.cylinder(2, 5);
    close(k.volume(k.fromBrep(k.toBrep(c))), Math.PI * 4 * 5, 1e-6);
  });

  test("XCAF document keeps shared definitions and names at both levels", () => {
    const doc = k.createDocument();
    try {
      const root = doc.addShape(k.compound([]), { name: "root", assembly: true });
      const screw = k.cylinder(1, 5);
      const a = doc.addChild(root, screw, { name: "screw#1", location: { tx: 0 } });
      const b = doc.addChild(root, screw, { name: "screw#2", location: { tx: 10 } });
      const refA = doc.getReferredLabel(a);
      assert.ok(refA !== null);
      assert.equal(refA, doc.getReferredLabel(b), "two instances of one shape share a definition label");
      doc.setName(refA!, "screw");
      assert.equal(doc.getLabelInfo(a).name, "screw#1");
      assert.equal(doc.getLabelInfo(refA!).name, "screw");
      const step = doc.exportStep();
      assert.match(step, /screw#1/);
      assert.match(step, /screw#2/);
      const glb = doc.exportGlb();
      assert.equal(new TextDecoder().decode(glb.subarray(0, 4)), "glTF");
    } finally {
      doc.close();
    }
  });

  test("multiview SVG and PNG renders", async () => {
    const b = k.box(10, 20, 30);
    assert.match(k.multiviewSvg(b), /<svg[\s>]/);
    const png = await k.multiviewPng(b, { width: 400, height: 300 });
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("memory and output hygiene", () => {
  test("checkpoint and releaseSince keep the live handle count flat", () => {
    const base = k.stats().liveShapes;
    for (let i = 0; i < 30; i++) {
      const mark = k.checkpoint();
      const b = k.box(10 + i, 10, 10);
      k.fillet(b, k.subShapes(b, "edge"), 1);
      k.releaseSince(mark);
    }
    assert.equal(k.stats().liveShapes, base);
    assert.ok(k.stats().wasmHeapBytes > 0);
  });

  test("the print hook captures what OCCT prints during STEP export", () => {
    const before = k.stats().printedLines;
    k.exportStep(k.box(1, 2, 3));
    assert.ok(k.stats().printedLines > before, "OCCT prints transfer statistics; the hook must capture them");
    assert.ok(k.printed().some((l) => l.length > 0));
  });

  test("fresh() gives an empty instance whose output goes to the same sink; dispose() ends it", async () => {
    const lines: string[] = [];
    const parent = await initKernel({ sink: (stream, line) => lines.push(`${stream}:${line}`) });
    const kept = parent.box(1, 1, 1);
    const fresh = await parent.fresh();
    assert.notEqual(fresh.raw, parent.raw);
    assert.equal(fresh.stats().liveShapes, 0);
    const before = lines.length;
    fresh.exportStep(fresh.box(1, 2, 3));
    assert.ok(lines.length > before, "the fresh instance prints through the parent's sink");
    assert.equal(fresh.printed().length > 0, true);
    fresh.dispose();
    assert.throws(() => fresh.box(1, 1, 1));
    // The parent is untouched.
    close(parent.volume(kept), 1);
    parent.dispose();
  });

  test("a STEP export in a fresh process writes zero bytes to stdout", () => {
    const probe = fileURLToPath(new URL("./fixtures/print-probe.ts", import.meta.url));
    const r = spawnSync(process.execPath, [probe], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "kernel output leaked to stdout");
    const report = JSON.parse(r.stderr.trim().split("\n").at(-1)!) as { stepBytes: number; step2Bytes: number; captured: number };
    assert.ok(report.stepBytes > 0 && report.step2Bytes > 0);
    assert.ok(report.captured > 0, "the sink received the kernel's printed lines");
  });
});

function topFace(shape: ShapeHandle, z: number): ShapeHandle {
  const faces = k.subShapes(shape, "face");
  const info = k.faces(shape);
  const i = info.findIndex((f) => Math.abs(f.bbox.min[2] - z) < 1e-6 && Math.abs(f.bbox.max[2] - z) < 1e-6);
  assert.ok(i >= 0, "top face not found");
  return faces[i]!;
}
