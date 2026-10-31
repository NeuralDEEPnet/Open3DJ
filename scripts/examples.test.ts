// Regression test for examples/: every example runs on the real compute pool (worker
// threads, captured stdout) as one export job, which returns the detailed GeometryReport
// and the STEP, STL, glTF and 3MF artifacts. The measures must match expected.json within
// 1e-6 relative, or 1e-4 when the script uses fillets or lofts (see examples-lib.ts).
// Regenerate expected.json with: node scripts/examples.ts --write
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPool } from "@open3dj/compute";
import type { JobResult } from "@open3dj/compute";
import { initKernel } from "@open3dj/kernel";
import { compare, listExamples, readExpected, summarize, toleranceFor } from "./examples-lib.ts";

// The one example that must clash; every other example must have clean fits.
const NEGATIVE = "lid-interference";

/** Area of a rounded rectangle w x h with corner radius r. */
const rr = (w: number, h: number, r: number) => w * h - (4 - Math.PI) * r * r;

/**
 * Volumes worked out by hand, so a regenerated expected.json cannot lock in wrong geometry.
 * Regression (review round 2): a sketch-boolean bug made the box lid's 1.6 mm locating lip a
 * solid plug (22369.28 mm3), and expected.json recorded it. The lid is a 3 mm plate on a 4 mm
 * ring 1.6 mm wide, with the ring 0.25 mm clear of the base's 2 mm walls.
 */
const HAND_CHECKED: Record<string, Record<string, number>> = {
  "box-with-lid": {
    lid: 3 * rr(70, 50, 4) + 4 * (rr(65.5, 45.5, 1.75) - rr(62.3, 42.3, 0.4)),
  },
};

const examples = listExamples();
const pool = createPool({ size: 2, log: () => {} });
// A kernel in this thread to re-import the STEP files; its STEP reader output is discarded.
const kernel = initKernel({ sink: () => {} });
after(() => pool.close());

// Queue every job at once so both workers stay busy; each test awaits its own.
const results = new Map<string, Promise<JobResult>>(examples.map((ex) => [ex.name, pool.run({
  kind: "export",
  script: readFileSync(ex.script, "utf8"),
  rev: "r_0001",
  detail: "detailed",
  export: { formats: ["step", "stl", "gltf", "3mf"], baseName: ex.name },
}, { lane: "interactive", timeoutMs: 120_000 })]));

test("examples/ holds at least ten examples, each with expected.json and drawing.png", () => {
  assert.ok(examples.length >= 10, `found ${examples.length}`);
  for (const ex of examples) {
    const e = readExpected(ex);
    assert.equal(e.example, ex.name);
    assert.equal(e.tolerance, toleranceFor(readFileSync(ex.script, "utf8")), `${ex.name}: tolerance in expected.json differs from the script's`);
    assert.equal(readFileSync(ex.drawingFile).subarray(1, 4).toString(), "PNG", `${ex.name}/drawing.png`);
  }
});

for (const ex of examples) {
  test(`example ${ex.name} matches expected.json`, async () => {
    const r = await results.get(ex.name)!;
    assert.ok(r.ok, `${ex.name} failed: ${JSON.stringify(!r.ok && r.error)}`);
    if (!r.ok) return;
    const expected = readExpected(ex);
    const measured = summarize(r.report);
    const diffs = compare(expected, measured, toleranceFor(readFileSync(ex.script, "utf8")));
    assert.deepEqual(diffs, [], `${ex.name} drifted from expected.json:\n  ${diffs.join("\n  ")}`);
    for (const p of measured.parts) assert.ok(p.valid, `${ex.name}: ${p.def} is not a valid solid`);
    for (const [def, want] of Object.entries(HAND_CHECKED[ex.name] ?? {})) {
      const got = measured.parts.find((p) => p.def === def)?.volume_mm3;
      assert.ok(got !== undefined && Math.abs(got - want) <= 1e-6 * want, `${ex.name}: ${def} volume ${got} mm3, hand value ${want} mm3`);
    }

    const clashes = measured.fits.filter((f) => f.kind === "clash");
    if (ex.name === NEGATIVE) {
      assert.equal(measured.status, "warning");
      assert.ok(clashes.length > 0, "the negative example must report a clash");
    } else {
      assert.equal(measured.status, "ok");
      assert.deepEqual(clashes, [], `${ex.name} must have no clash`);
    }

    const names = (r.artifacts ?? []).map((a) => a.name).sort();
    assert.deepEqual(names, expected.exports, `${ex.name}: exported files`);
    for (const a of r.artifacts ?? []) assert.ok(a.bytes.byteLength > 0, `${a.name} is empty`);
    const step = r.artifacts!.find((a) => a.format === "step")!;
    assert.match(Buffer.from(step.bytes).subarray(0, 64).toString("latin1"), /^ISO-10303-21;/);

    // The STEP file must re-import as the same solids (the export checks this too; a header
    // check alone missed a knob whose dome came back with a zero-area face).
    const k = await kernel;
    const mark = k.checkpoint();
    try {
      const back = k.importStep(Buffer.from(step.bytes).toString("latin1"));
      const solids = k.subShapes(back, "solid");
      const want = measured.parts.reduce((n, p) => n + p.counts.solids * p.occurrences, 0);
      assert.equal(solids.length, want, `${ex.name}: solids in the STEP file`);
      for (const s of solids) assert.ok(k.isValid(s), `${ex.name}: a solid in the STEP file is invalid`);
      const volume = solids.reduce((v, s) => v + k.volume(s), 0);
      const wantVolume = measured.parts.reduce((v, p) => v + p.volume_mm3 * p.occurrences, 0);
      assert.ok(Math.abs(volume - wantVolume) <= 1e-6 * wantVolume, `${ex.name}: STEP volume ${volume} != ${wantVolume}`);
    } finally {
      k.releaseSince(mark);
    }
  });
}
