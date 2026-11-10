// The envelope search on analytic margin functions: no kernel, no pool.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParamDecl } from "./brief.ts";
import { axesOf, cornerPoints, cornerRows, guardEvents, haltonPoints, search, uniformPoints } from "./search.ts";
import type { Evaluator, P, Scored } from "./search.ts";

/** An evaluator from one margin function: fails below 0; the signature flips with the sign. */
const fromMargin = (f: (p: P) => number, calls: P[] = []): Evaluator => async (points) =>
  points.map((p): Scored => {
    calls.push(p);
    const m = f(p);
    return { failing: m < 0 ? ["wall"] : [], margins: { wall: m }, signature: m < 0 ? "error:THIN" : JSON.stringify({ status: "ok" }) };
  });

const num = (name: string, def: number, min: number, max: number, extra: Partial<ParamDecl> = {}): ParamDecl => ({ name, type: "number", default: def, min, max, ...extra });

test("corner rows: complements in pairs below 9 axes, a pairwise covering array above", () => {
  assert.deepEqual(cornerRows(2), [[false, false], [true, true], [true, false], [false, true]]);
  const rows = cornerRows(12);
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      const seen = new Set(rows.map((r) => `${r[i]}${r[j]}`));
      assert.equal(seen.size, 4, `axes ${i} and ${j}`);
    }
  }
  assert.ok(rows.length < 2 ** 12 / 100);
});

test("corner points cover every corner and every discrete value within the first max(corners, values) points", () => {
  const params = [num("A", 1, 0, 2), num("B", 1, 0, 2), num("N", 5, 3, 12, { integer: true })];
  const pts = cornerPoints(axesOf(params));
  assert.equal(pts.length, 4 * 10);
  const head = pts.slice(0, 10);
  assert.equal(new Set(head.map((p) => p["N"])).size, 10);
  assert.equal(new Set(head.map((p) => `${p["A"]},${p["B"]}`)).size, 4);
});

test("an affine margin that fails at one corner is found by the corners", async () => {
  const params = [num("W", 60, 40, 90), num("P", 36, 20, 50)];
  const r = await search(params, fromMargin((p) => (p["W"] as number) - (p["P"] as number) - 7.18), { budget: 64, seed: 1 });
  const first = r.visits.find((v) => v.fresh.length > 0)!;
  assert.equal(first.phase, "corner");
  assert.ok(r.visits.length <= 64);
  // Shrinking moves the counterexample towards nominal; bisection then pins the boundary.
  const shrunk = r.visits[r.shrunk!]!;
  assert.ok((shrunk.params["W"] as number) - (shrunk.params["P"] as number) < 7.18);
  assert.ok(r.line && r.line.hi - r.line.lo < 0.05, JSON.stringify(r.line));
  assert.ok(guardEvents(r).some((e) => e.kind === "line"));
});

test("a thin interior band that no corner reaches is found only from inside the box", async () => {
  const params = [num("X", -20, -30, 30), num("Y", 0, -12, 12)];
  const band = (p: P) => Math.abs((p["X"] as number) - 7) - 2.5;
  const r = await search(params, fromMargin(band), { budget: 64, seed: 1 });
  const hit = r.visits.find((v) => v.fresh.length > 0);
  assert.ok(hit, "found");
  assert.notEqual(hit!.phase, "corner");
});

test("an integer cliff and a choice are found by enumeration, each value early even when the product is capped", async () => {
  const params: ParamDecl[] = [num("N", 6, 3, 16, { integer: true }), { name: "S", type: "choice", default: "M3", options: ["M3", "M4", "M6"] }, num("R", 5, 4, 8)];
  for (const f of [(p: P) => (p["N"] === 13 ? -1 : 1), (p: P) => (p["S"] === "M6" && (p["R"] as number) < 4.5 ? -1 : 1)]) {
    const r = await search(params, fromMargin(f), { budget: 64, seed: 1 });
    assert.ok(r.visits.some((v) => v.fresh.length > 0 && v.phase === "corner"));
  }
});

test("the trace does not depend on the order in which a batch finishes", async () => {
  const params = [num("A", 0.5, 0, 1), num("B", 0.5, 0, 1), num("C", 0.5, 0, 1)];
  const f = (p: P) => (p["A"] as number) * 3 + (p["B"] as number) - 3.2 + (p["C"] as number) * 0.1;
  const plain = fromMargin(f);
  const shuffled: Evaluator = async (points) => {
    const out = await Promise.all(points.map(async (p, i) => {
      await new Promise((res) => setTimeout(res, ((i * 7) % 5) * 2));
      return (await plain([p]))[0]!;
    }));
    return out;
  };
  const a = await search(params, plain, { budget: 48, seed: 3 });
  const b = await search(params, shuffled, { budget: 48, seed: 3 });
  assert.deepEqual(a.visits.map((v) => [v.phase, v.params]), b.visits.map((v) => [v.phase, v.params]));
});

test("seeded sequences repeat for one seed and differ between seeds", () => {
  const axes = axesOf([num("A", 0, -1, 1), { name: "V", type: "bool", default: false }]);
  assert.deepEqual(haltonPoints(axes, 5, 1), haltonPoints(axes, 5, 1));
  assert.notDeepEqual(haltonPoints(axes, 5, 1), haltonPoints(axes, 5, 2));
  assert.deepEqual(uniformPoints(axes, 5, 4), uniformPoints(axes, 5, 4));
  for (const p of uniformPoints(axes, 200, 9)) assert.ok((p["A"] as number) >= -1 && (p["A"] as number) <= 1 && typeof p["V"] === "boolean");
});
