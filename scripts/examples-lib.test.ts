// compare() pairs fits by pair, kind and order, so two clearances of one pair (a shank gap
// and a head gap) are each checked against their own expected value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "./examples-lib.ts";

const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
const summary = (gaps: number[]) => ({
  status: "ok" as const,
  assembly: { occurrences: 2, definitions: 2, bbox: box },
  parts: [],
  fits: gaps.map((d) => ({ a: "lid", b: "screw#1", kind: "clearance" as const, distance_mm: d })),
});

test("repeated fits of one pair and kind are compared in order", () => {
  assert.deepEqual(compare(summary([0.2, 0.5]), summary([0.2, 0.5]), 1e-6), []);
  assert.deepEqual(compare(summary([0.2, 0.5]), summary([0.2, 0.6]), 1e-6), ["fits[lid|screw#1|clearance#2].distance_mm: expected 0.5, got 0.6 (tolerance 0.000001 relative)"]);
  assert.equal(compare(summary([0.2, 0.5]), summary([0.2]), 1e-6).length, 1);
});
