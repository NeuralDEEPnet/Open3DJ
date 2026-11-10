// Certified Envelopes spike: run one parameter point of a brief on the compute pool. Ordinary
// run jobs, as bench/lib.ts runOnPool sends them, with a detailed report, the fit watch
// distance (the spike's fitOptions patch in packages/compute) and the fdm.v1 gates with one
// build direction per gate group. The first group rides on the full run; every further group
// is a second run job with fits: false that only reads that group's gates.
import type { ParamValue } from "@open3dj/schemas";
import type { JobRequest, Lane, Pool } from "@open3dj/compute";
import { flattenAssembly } from "../../bench/lib.ts";
import type { Brief, PointRun } from "./brief.ts";

export interface PointOptions {
  watch: number;
  lane?: Lane;
  timeoutMs?: number;
  /** Run on a fresh kernel instance (replay and recheck). Default false: the worker's warm kernel. */
  freshKernel?: boolean;
}

export async function runPoint(pool: Pool, brief: Brief, script: string, params: Record<string, ParamValue>, o: PointOptions): Promise<PointRun> {
  const base: JobRequest = {
    kind: "run", script, params, rev: "r_0001", detail: "detailed", fitOptions: { watchDistance: o.watch },
    ...(o.freshKernel ? { freshKernel: true } : {}),
  };
  const groups = brief.gates ?? [];
  const jobs: JobRequest[] = groups.length === 0
    ? [base]
    : groups.map((g, i) => ({ ...base, gates: { profile: "fdm.v1", build: g.build, defs: g.targets }, ...(i > 0 ? { fits: false as const } : {}) }));
  const opts = { lane: o.lane ?? "interactive", timeoutMs: o.timeoutMs ?? 120_000 };
  const results = await Promise.all(jobs.map((j) => pool.run(j, opts)));
  const ms = results.reduce((s, r) => s + r.stats.wallMs, 0);
  const first = results[0]!;
  if (!first.ok) return { ok: false, error: { code: first.error.code, message: first.error.message }, ms };
  const bad = results.find((r) => !r.ok);
  if (bad && !bad.ok) return { ok: false, error: { code: bad.error.code, message: `gate job: ${bad.error.message}` }, ms };
  const gates = results.flatMap((r) => (r.ok && r.gates ? [r.gates] : []));
  return { ok: true, report: first.report, occurrences: flattenAssembly(first.assembly), gates, ms };
}
