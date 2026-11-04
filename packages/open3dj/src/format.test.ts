// The terminal layout of inspect fields=[selection] (open3dj inspect <project> --fields selection).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatExport, formatInspect, formatRun } from "./format.ts";

const compute = { backend: "none" as const, device: "daemon", placement_reason: "test" };

test("inspect --fields selection prints what the person selected, or says nothing is", () => {
  const none = formatInspect({ status: "ok", compute, selection: { items: [], head: "r_0001", note: "Nothing is selected in open3dj view." } });
  assert.match(none, /^selection: none/m);
  const some = formatInspect({
    status: "ok", compute,
    selection: {
      rev: "r_0001", head: "r_0002", stale: true, items: [
        { path: "lid", def: "lid", kind: "face", element: "face:5", address: "lid@elem:face:5", ref: "lid.top" },
        { path: "screw#2", def: "screw", kind: "occurrence", address: "screw#2" },
        { path: "base", def: "base", kind: "edge", faces: ["face:3", "face:7"] },
      ],
    },
  });
  assert.equal(some, [
    "selection (r_0001, stale; head r_0002):",
    "  lid@elem:face:5 (lid.top)",
    "  screw#2",
    "  base: the edge between face:3 and face:7",
    "",
  ].join("\n"));
});

// Regression (review, findings 8 and 11): a failure without value and limit printed "? against ?".
test("inspect --fields gates prints value against limit only where they apply", () => {
  const text = formatInspect({
    status: "ok", compute,
    gates: {
      profile: "fdm.v1", build: [0, 0, 1], bed_mm: [220, 220, 250], notes: [],
      parts: [{ def: "pair", pass: ["bed"], wall: { rays: 10, spacing_mm: 0.5 }, fail: [
        { gate: "watertight", waivable: "human", note: "Not a closed solid: it holds 2 solids." },
        { gate: "min_wall", limit: 0.8, waivable: "agent", note: "No wall was measured." },
        { gate: "overhang", value: 45.5, limit: 45, at: "face:3", waivable: "agent", marginal: true },
      ] }],
    },
  });
  assert.doesNotMatch(text, /\?/);
  assert.match(text, /FAIL watertight {2}waivable by a person only: Not a closed solid/);
  assert.match(text, /FAIL min_wall {2}limit 0\.8 {2}waivable by an agent/);
  assert.match(text, /FAIL overhang \(marginal\) {2}45\.5 against 45 at face:3 {2}waivable/);
});

test("inspect --fields gates says the overall status and marks waived failures with who and why", () => {
  const text = formatInspect({
    status: "ok", compute,
    gates: {
      profile: "fdm.v1", build: [0, 0, 1], bed_mm: [220, 220, 250], notes: [], status: "fail", open: 1, waived: 1,
      parts: [{ def: "tray", pass: ["watertight", "bed"], wall: { rays: 10, spacing_mm: 0.5 }, fail: [
        { gate: "min_wall", value: 0.6, limit: 0.8, at: "face:3", waivable: "agent", waiver: { by: "agent", reason: "a drain tray", rev: "r_0002", ts: "2026-11-04T12:00:00.000Z" } },
        { gate: "overhang", value: 60, limit: 45, at: "face:5", waivable: "agent" },
      ] }],
    },
  });
  assert.match(text, /^gates fdm\.v1 \(build 0, 0, 1; bed 220 x 220 x 250 mm\): fail, 1 open, 1 waived$/m);
  assert.match(text, /^ {4}WAIVED min_wall {2}0\.6 against 0\.8 at face:3 {2}by an agent on r_0002: a drain tray$/m);
  assert.match(text, /^ {4}FAIL overhang {2}60 against 45 at face:5 {2}waivable by an agent/m);
});

test("run prints the waivers it recorded, and export the gate status", () => {
  const run = formatRun({ status: "ok", rev: "r_0002", compute, waivers: [
    { def: "tray", gate: "min_wall", profile: "fdm.v1", geometry_hash: "m1:x", value: 0.6, limit: 0.8, at: "face:3", reason: "a drain tray", by: "agent", rev: "r_0002", ts: "2026-11-04T12:00:00.000Z" },
  ] });
  assert.equal(run, "ok  r_0002  waived min_wall on tray (0.6 against 0.8 at face:3): a drain tray\n");
  const exp = formatExport({ status: "ok", rev: "r_0002", compute, files: [], gates: { profile: "fdm.v1", status: "fail", open: 2, waived: 1 } }, "tray.o3j");
  assert.match(exp, /^gates fdm\.v1: fail, 2 open, 1 waived; the evidence sidecar lists them$/m);
  const unchecked = formatExport({ status: "ok", rev: "r_0002", compute, files: [], gates: { profile: "fdm.v1", status: "unchecked", error: { code: "JOB_TIMEOUT", message: "too slow" } } }, "tray.o3j");
  assert.match(unchecked, /^gates fdm\.v1: unchecked \(JOB_TIMEOUT: too slow\)$/m);
});
