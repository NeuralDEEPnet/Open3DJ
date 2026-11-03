// The terminal layout of inspect fields=[selection] (open3dj inspect <project> --fields selection).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInspect } from "./format.ts";

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
