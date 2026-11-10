// Certified Envelopes spike: lint the seeded corpus, as bench task-lint does for references and
// mutants. Every brief must pass every assertion at its nominal values; every defect must fail
// one of its defect assertions at each analytic point inside its region and pass everything at
// each point just outside it (scripts/envelope-spike/corpus/regions.ts). Only those fixed
// points and the nominal values run: no search and no sampling.
//
//   node scripts/envelope-spike/lint-corpus.ts [id ...]
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "@open3dj/compute";
import type { ParamValue } from "@open3dj/schemas";
import { evaluatePoint, loadBrief, watchDistance } from "./brief.ts";
import type { LoadedBrief } from "./brief.ts";
import { REGIONS } from "./corpus/regions.ts";
import { runPoint } from "./point.ts";

const DIR = fileURLToPath(new URL("./corpus/", import.meta.url));

export function corpusFiles(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".brief.json")).sort().map((f) => join(DIR, f));
}

export function nominal(lb: LoadedBrief): Record<string, ParamValue> {
  return Object.fromEntries(lb.brief.params.map((d) => [d.name, d.default]));
}

/** The corners of the declared box (numeric axes only, discrete parameters at nominal), for the watch distance. */
export function boxCorners(lb: LoadedBrief): Array<Record<string, ParamValue>> {
  let out: Array<Record<string, ParamValue>> = [nominal(lb)];
  for (const d of lb.brief.params) {
    if (d.type !== "number") continue;
    out = out.flatMap((p) => [{ ...p, [d.name]: d.min! }, { ...p, [d.name]: d.max! }]);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const files = corpusFiles().filter((f) => only.length === 0 || only.some((x) => f.includes(x)));
  const pool = createPool({ size: 4, log: () => {} });
  let problems = 0;
  try {
    await Promise.all(files.map(async (file) => {
      const lb = loadBrief(file);
      const watch = watchDistance(lb.brief, boxCorners(lb));
      const lines: string[] = [];
      const nom = nominal(lb);
      const run = await runPoint(pool, lb.brief, lb.script, nom, { watch });
      const ev = evaluatePoint(lb.brief, nom, run, watch);
      const failing = ev.margins.filter((m) => !m.pass);
      const counts = run.report?.parts.map((p) => `${p.def} faces ${p.counts?.faces} edges ${p.counts?.edges}`).join("; ") ?? run.error?.code;
      lines.push(`${lb.brief.id}: nominal ${failing.length === 0 ? "passes" : `FAILS ${failing.map((m) => `${m.id} (${m.detail})`).join(", ")}`}; ${counts}; ${run.ms} ms`);
      if (failing.length > 0) problems++;
      for (const d of ev.disagreements) lines.push(`  margin disagrees with evaluate: ${d}`), problems++;
      const region = REGIONS[lb.brief.id];
      const defect = lb.brief["defect"] as { fails: string[] } | undefined;
      if (defect) {
        if (!region) {
          lines.push("  no region"), problems++;
        } else {
          if (region.fails(nom)) lines.push("  the nominal point is inside the analytic region"), problems++;
          for (const pt of [region.witness, ...(region.more ?? [])]) {
            if (!region.fails({ ...nom, ...pt })) lines.push(`  ${JSON.stringify(pt)} is outside the analytic region`), problems++;
            const w = { ...nom, ...pt };
            const wr = await runPoint(pool, lb.brief, lb.script, w, { watch });
            const we = evaluatePoint(lb.brief, w, wr, watch);
            const wf = we.margins.filter((m) => !m.pass && !m.skipped);
            const hit = wf.filter((m) => defect.fails.includes(m.id));
            lines.push(`  inside ${JSON.stringify(pt)}: ${hit.length > 0 ? "fails" : "DOES NOT FAIL"} ${wf.map((m) => `${m.id} (${m.signed ?? "-"}; ${m.detail})`).join(", ")}`);
            if (hit.length === 0) problems++;
          }
          for (const pt of region.outside) {
            const w = { ...nom, ...pt };
            if (region.fails(w)) lines.push(`  ${JSON.stringify(pt)} is inside the analytic region`), problems++;
            const or = await runPoint(pool, lb.brief, lb.script, w, { watch });
            const oe = evaluatePoint(lb.brief, w, or, watch);
            const of = oe.margins.filter((m) => !m.pass);
            lines.push(`  outside ${JSON.stringify(pt)}: ${of.length === 0 ? "passes" : `FAILS ${of.map((m) => `${m.id} (${m.signed ?? "-"}; ${m.detail})`).join(", ")}`}`);
            if (of.length > 0) problems++;
          }
        }
      }
      process.stdout.write(lines.join("\n") + "\n");
    }));
  } finally {
    await pool.close();
  }
  process.stdout.write(`${problems === 0 ? "corpus lint passed" : `${problems} problem(s)`}\n`);
  process.exitCode = problems === 0 ? 0 : 1;
}
