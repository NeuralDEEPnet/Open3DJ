// Every example declares ranges for its Params, and a person may move a slider anywhere in them.
// expected.json checks one point: the default values. This test runs chosen points at the
// edges of the declared ranges and checks that the part still builds, stays valid, keeps the
// default status, and still passes every print check (fdm.v1, build direction +Z) that it
// passes at the default values. Checks that already fail at the defaults are not required.
//
// Each case comes from a defect found by the certified-envelopes experiment (#67, written up
// in rfcs/experiments/2026-11-09-certified-envelopes.md). The edges are read from the script's
// own Param declarations, so a changed bound is tested where it now is. RFC 0002 proposes a
// corner-first sweep that would cover every example without a hand-written list.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPool } from "@open3dj/compute";
import type { JobResult } from "@open3dj/compute";
import type { GateFailure, ParamValue } from "@open3dj/schemas";
import { listExamples } from "./examples-lib.ts";

/** A value: "min" and "max" are read from the script's Param.number declaration; anything else is used as given. */
type Edge = ParamValue | "min" | "max";
interface RangeCase {
  example: string;
  issue: number;
  points: Array<Record<string, Edge>>;
  /**
   * Also require the default face and edge counts. Only for an example whose topology does
   * not depend on the values at these points: a hole that runs into another feature changes
   * the counts without failing any check.
   */
  sameCounts?: boolean;
}

/** Every combination of the given values, one point each. */
function corners(axes: Record<string, Edge[]>): Array<Record<string, Edge>> {
  let points: Array<Record<string, Edge>> = [{}];
  for (const [name, values] of Object.entries(axes)) points = points.flatMap((p) => values.map((v) => ({ ...p, [name]: v })));
  return points;
}

const CASES: RangeCase[] = [
  // The bolt holes broke through the rim below Diameter 53.2 and left a wall under the
  // 0.84 mm fail line below 56.56, while the run still said ok.
  {
    example: "flange",
    issue: 60,
    points: [
      { Diameter: "min", Thickness: "min", "Bolt holes": "min" },
      { Diameter: "min", Thickness: "min", "Bolt holes": "max" },
      { Diameter: "min", Thickness: "max", "Bolt holes": "min" },
      { Diameter: "min", Thickness: "max", "Bolt holes": "max" },
    ],
  },
  // At Thickness 2 the fixed 1 mm fillet failed. With a thick flange the holes cut into the
  // other flange at short Leg (64 edges became 84, with no check failing), and came 0.75 mm
  // from the side at narrow Width. Every corner of the numeric ranges, with the largest screw.
  {
    example: "bracket",
    issue: 62,
    points: corners({ Width: ["min", "max"], Leg: ["min", "max"], Thickness: ["min", "max"], Screw: ["M5"] }),
    sameCounts: true,
  },
  // At Height 12 and below the 12 mm D-bore opened the top of the dome: one face fewer, and
  // the knob came out lower than its Height, with no check failing. Flutes stay at the
  // default, since their count changes the faces.
  {
    example: "knob",
    issue: 64,
    points: corners({ Radius: ["min", "max"], Height: ["min", "max"] }),
    sameCounts: true,
  },
  // Below Wall 1.31 to 1.42 mm the 3 mm outer base fillet came within the 0.84 mm fail line
  // of the cavity's bottom corner (0.531 mm at Height 120, Wall 1.2).
  {
    example: "tapered-cup",
    issue: 65,
    points: corners({ Height: ["min", "max"], Wall: ["min", "max"] }),
  },
];

/** The min or max of a Param.number declaration in the script; throws when there is none. */
function declaredBound(script: string, name: string, side: "min" | "max"): number {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const decl = new RegExp(`Param\\.number\\(\\s*"${quoted}"\\s*,[^,]+,\\s*\\{([^}]*)\\}`).exec(script);
  if (!decl) throw new Error(`no Param.number("${name}", default, { ... }) in the script`);
  const bound = new RegExp(`\\b${side}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(decl[1]!);
  if (!bound) throw new Error(`Param "${name}" declares no ${side}`);
  return Number(bound[1]);
}

test("declaredBound reads min and max from a Param.number declaration", () => {
  const script = `const D = Param.number("Diameter", 80, { min: 60, max: 160, unit: "mm" });\nconst n = Param.number("Bolt holes", 6, { min: 3, max: 12, integer: true });`;
  assert.equal(declaredBound(script, "Diameter", "min"), 60);
  assert.equal(declaredBound(script, "Diameter", "max"), 160);
  assert.equal(declaredBound(script, "Bolt holes", "max"), 12);
  assert.throws(() => declaredBound(script, "Width", "min"), /no Param\.number\("Width"/);
  assert.throws(() => declaredBound(`Param.number("W", 1, { max: 2 })`, "W", "min"), /declares no min/);
});

test("corners crosses every value of every axis", () => {
  assert.deepEqual(corners({ A: ["min", "max"], B: [1, 2], C: ["M5"] }), [
    { A: "min", B: 1, C: "M5" },
    { A: "min", B: 2, C: "M5" },
    { A: "max", B: 1, C: "M5" },
    { A: "max", B: 2, C: "M5" },
  ]);
});

const examples = new Map(listExamples().map((e) => [e.name, e]));
const pool = createPool({ size: 2, log: () => {} });
after(() => pool.close());

const run = (script: string, params: Record<string, ParamValue>): Promise<JobResult> =>
  pool.run({ kind: "run", script, rev: "r_0001", detail: "detailed", gates: { profile: "fdm.v1" }, params }, { lane: "batch", timeoutMs: 120_000 });

/** "definition: check" for every print check a result passes. */
const passing = (r: JobResult & { ok: true }): Set<string> =>
  new Set((r.gates?.parts ?? []).flatMap((p) => p.pass.map((g) => `${p.def}: ${g}`)));

for (const c of CASES) {
  test(`${c.example} keeps its default checks at the edges of its declared ranges (#${c.issue})`, async () => {
    const example = examples.get(c.example);
    assert.ok(example, `no example named ${c.example}`);
    const script = readFileSync(example.script, "utf8");
    const nominal = await run(script, {});
    if (!nominal.ok) assert.fail(`the default values fail: ${nominal.error.code} ${nominal.error.message}`);
    const required = passing(nominal);
    // Every point is checked and every problem listed, so a failure shows the whole edge.
    const problems: string[] = [];
    for (const point of c.points) {
      const params: Record<string, ParamValue> = {};
      for (const [name, edge] of Object.entries(point)) params[name] = edge === "min" || edge === "max" ? declaredBound(script, name, edge) : edge;
      const at = JSON.stringify(params);
      const r = await run(script, params);
      if (!r.ok) {
        problems.push(`${at}: ${r.error.code} ${r.error.message.split("\n")[0]}`);
        continue;
      }
      if (r.report.status !== nominal.report.status) problems.push(`${at}: status ${r.report.status}, ${nominal.report.status} at the defaults`);
      for (const p of r.report.parts) if (!p.valid) problems.push(`${at}: ${p.def} is not a valid solid`);
      if (c.sameCounts) {
        for (const p of r.report.parts) {
          const d = nominal.report.parts.find((q) => q.def === p.def)?.counts;
          if (p.counts?.faces !== d?.faces || p.counts?.edges !== d?.edges) problems.push(`${at}: ${p.def} has ${p.counts?.faces} faces and ${p.counts?.edges} edges, ${d?.faces} and ${d?.edges} at the defaults`);
        }
      }
      const now = passing(r);
      const failures = new Map<string, GateFailure>((r.gates?.parts ?? []).flatMap((p) => p.fail.map((f) => [`${p.def}: ${f.gate}`, f] as const)));
      for (const check of required) {
        if (now.has(check)) continue;
        const f = failures.get(check);
        problems.push(f ? `${at}: ${check} ${f.value ?? "?"} against ${f.limit ?? "?"} at ${f.at ?? "?"}` : `${at}: ${check} is not reported`);
      }
    }
    assert.deepEqual(problems, [], "checks that hold at the default values fail at the edges of the declared ranges");
  });
}
