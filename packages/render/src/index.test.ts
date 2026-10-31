import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initKernel } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import { buildAssembly } from "@open3dj/assembly";
import { enclosure } from "../../assembly/src/fixtures.ts";
import { DEFAULT_SIZE, PACKAGE_STATUS, RenderError, renderAssembly } from "./index.ts";

let kernel: Kernel;
before(async () => {
  kernel = await initKernel();
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const pngSize = (b: Uint8Array) => {
  const dv = new DataView(b.buffer, b.byteOffset);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
};

test("exports renderAssembly", () => {
  assert.equal(typeof renderAssembly, "function");
  assert.equal(PACKAGE_STATUS, "ready");
});

describe("renderAssembly", () => {
  test("renders the same PNG bytes twice, and again on a fresh kernel", async () => {
    const asm = buildAssembly(kernel, { parts: [{ name: "bracket", shape: kernel.box(30, 20, 10) }], mates: [], params: {}, warnings: [] });
    const a = await renderAssembly(kernel, asm, { view: "multiview" });
    const b = await renderAssembly(kernel, asm, { view: "multiview" });
    assert.deepEqual(a.map((i) => [i.format, i.name]), [["png", "multiview.png"], ["svg", "multiview.svg"]]);
    assert.deepEqual(a.map((i) => sha(i.bytes)), b.map((i) => sha(i.bytes)));
    const fresh = await initKernel();
    const asm2 = buildAssembly(fresh, { parts: [{ name: "bracket", shape: fresh.box(30, 20, 10) }], mates: [], params: {}, warnings: [] });
    const c = await renderAssembly(fresh, asm2, { view: "multiview" });
    assert.deepEqual(c.map((i) => sha(i.bytes)), a.map((i) => sha(i.bytes)));
  });

  test("the PNG has the requested size and the SVG says what it shows", async () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const [png, svg] = await renderAssembly(kernel, asm, { view: "multiview" });
    assert.deepEqual(pngSize(png!.bytes), DEFAULT_SIZE);
    assert.deepEqual([png!.width, png!.height], [1200, 900]);
    const text = new TextDecoder().decode(svg!.bytes);
    assert.match(text, /^<svg[^>]*width="1200" height="900"/);
    assert.match(text, /<title>enclosure \(6 occurrences\)<\/title>/);
    assert.ok(text.endsWith(">80 × 60 × 34 (X×Y×Z)</text></svg>"), "footer gives the assembly size");
    assert.equal(png!.note, undefined);
  });

  test("targets are drawn alone at their world positions, with a note", async () => {
    const asm = buildAssembly(kernel, enclosure(kernel), { rootName: "enclosure" });
    const images = await renderAssembly(kernel, asm, { view: "multiview", targets: ["lid", "screw#1"], format: "svg", width: 800, height: 600 });
    assert.equal(images.length, 1);
    const [svg] = images;
    assert.equal(svg!.name, "multiview-lid-screw_1.svg");
    assert.deepEqual([svg!.width, svg!.height], [800, 600]);
    assert.match(svg!.note ?? "", /lid, screw#1 drawn/);
    // The lid spans 80 x 60; the screw runs from z 20 to 34.
    const footer = /<text[^>]*>([^<]*X×Y×Z[^<]*)<\/text><\/svg>$/.exec(new TextDecoder().decode(svg!.bytes))?.[1];
    assert.equal(footer, "80 × 60 × 14 (X×Y×Z)");
  });

  test("bad targets, views and sizes are structured errors", async () => {
    const asm = buildAssembly(kernel, enclosure(kernel));
    const code = (c: string) => (e: unknown) => e instanceof RenderError && e.code === c;
    await assert.rejects(renderAssembly(kernel, asm, { view: "multiview", targets: ["nope"] }), code("UNKNOWN_TARGET"));
    await assert.rejects(renderAssembly(kernel, asm, { view: "section" as never }), code("UNSUPPORTED_VIEW"));
    await assert.rejects(renderAssembly(kernel, asm, { view: "multiview", width: 10 }), code("BAD_SIZE"));
  });

  test("rendering leaves no kernel handles behind", async () => {
    const asm = buildAssembly(kernel, enclosure(kernel));
    const before = kernel.stats().liveShapes;
    await renderAssembly(kernel, asm, { view: "multiview", format: "png" });
    assert.equal(kernel.stats().liveShapes, before);
  });
});
