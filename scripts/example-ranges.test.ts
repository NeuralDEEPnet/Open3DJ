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
import type { ParamValue } from "@open3dj/schemas";
import { listExamples } from "./examples-lib.ts";

type Edge = number | "min" | "max";
interface RangeCase {
  example: string;
  issue: number;
  /** Points to check; "min" and "max" are read from the script's Param declaration. */
  points: Array<Record<string, Edge>>;
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
    for (const point of c.points) {
      const params: Record<string, ParamValue> = {};
      for (const [name, edge] of Object.entries(point)) params[name] = typeof edge === "number" ? edge : declaredBound(script, name, edge);
      const at = JSON.stringify(params);
      const r = await run(script, params);
      if (!r.ok) assert.fail(`${at}: ${r.error.code} ${r.error.message}`);
      assert.equal(r.report.status, nominal.report.status, `${at}: status`);
      for (const p of r.report.parts) assert.ok(p.valid, `${at}: ${p.def} is not a valid solid`);
      const now = passing(r);
      const lost = [...required].filter((g) => !now.has(g));
      const why = (r.gates?.parts ?? []).flatMap((p) => p.fail.filter((f) => lost.includes(`${p.def}: ${f.gate}`)).map((f) => `${p.def}: ${f.gate} ${f.value ?? "?"} against ${f.limit ?? "?"} at ${f.at ?? "?"}`));
      assert.deepEqual(lost, [], `${at}: checks that pass at the default values fail here: ${why.join("; ")}`);
    }
  });
}
