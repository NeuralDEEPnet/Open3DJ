// Runs 3dj starters through the facade. Usage:
//   node run_starters.mjs <deps> <outDir> <startersDir> [reps=5] [ids,comma,separated]
// All human-readable output goes to STDERR; STDOUT must stay empty so any kernel
// prints that would corrupt an MCP stdio stream are visible (shell redirects it).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createRuntime } from "./dsl.mjs";

const [DEPS, OUT, DIR, repsArg, idsArg] = process.argv.slice(2);
const REPS = +(repsArg ?? 5);
const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const rt = await createRuntime(DEPS, { withLib: process.env.WITH_LIB === "1" });
const B = rt.B;
log(`init ${rt.initMs.toFixed(0)} ms`);

const ids = idsArg ? idsArg.split(",") : readdirSync(DIR).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")).sort();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = (x) => +(+x).toFixed(3);

function meshVolume(shape) {
  const m = B.mesh(shape.v, { tolerance: 0.01, angularTolerance: 0.1, cache: false });
  const V = m.vertices, T = m.triangles; let vol = 0;
  for (let i = 0; i < T.length; i += 3) {
    const a = 3 * T[i], b = 3 * T[i + 1], c = 3 * T[i + 2];
    vol += (V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c])) / 6;
  }
  return { vol, tris: T.length / 3 };
}

const results = [];
for (const id of ids) {
  const code = readFileSync(`${DIR}/${id}.js`, "utf8");
  const rec = { id, runs: false, error: null, errorType: null, times_ms: [], parts: [], params: [] };
  try {
    for (let i = 0; i < REPS; i++) {
      const t = performance.now();
      const res = rt.run(code);
      // force evaluation of every part (volume) so lazy work is inside the timing
      for (const p of res.parts) p.shape.volume();
      rec.times_ms.push(performance.now() - t);
      if (i === 0) {
        rec.params = res.params.map((p) => ({ name: p.name, type: p.type, default: p.default, min: p.min, max: p.max, integer: p.integer, unit: p.unit, options: p.options }));
        for (const p of res.parts) {
          const g = p.shape.geometryInfo(), b = p.shape.bounds(), vol = p.shape.volume();
          const mv = meshVolume(p.shape);
          const brep = B.unwrap(B.toBREP(p.shape.v));
          const tStep = performance.now();
          const step = B.unwrap(B.exportSTEP(p.shape.v));
          const stepMs = performance.now() - tStep;
          rec.parts.push({ name: p.name, color: p.color ?? null, volume: r3(vol), mesh_volume: r3(mv.vol), mesh_vs_brep_rel: +(Math.abs(mv.vol - vol) / vol).toExponential(2), triangles: mv.tris,
            bbox_min: b.min.map(r3), bbox_max: b.max.map(r3), solids: g.solids, faces: g.faces, edges: g.edges, valid: g.valid,
            brep_sha256: createHash("sha256").update(brep).digest("hex").slice(0, 16), step_bytes: step.size, step_ms: r3(stepMs) });
        }
      }
    }
    rec.runs = true;
  } catch (e) {
    rec.error = e.message; rec.errorType = e.name; rec.entry = e.entry ?? null;
  }
  rec.median_ms = rec.times_ms.length ? r3(median(rec.times_ms)) : null;
  rec.first_ms = rec.times_ms.length ? r3(rec.times_ms[0]) : null;
  results.push(rec);
  log(`${rec.runs ? "OK  " : "FAIL"} ${id.padEnd(26)} ${rec.runs ? `median ${rec.median_ms} ms first ${rec.first_ms} ms parts ${rec.parts.length} ` + rec.parts.map((p) => `[${p.name}: V=${p.volume} solids=${p.solids} valid=${p.valid} bbox=${JSON.stringify(p.bbox_min)}..${JSON.stringify(p.bbox_max)} meshRel=${p.mesh_vs_brep_rel}]`).join(" ") : `${rec.errorType}: ${rec.error}`}`);
}
const ops = Object.fromEntries(Object.entries(rt.opStats).map(([k, v]) => [k, { n: v.n, total_ms: r3(v.ms), mean_ms: r3(v.ms / v.n) }]));
writeFileSync(`${OUT}/starters-${process.pid}.json`, JSON.stringify({ node: process.version, reps: REPS, init_ms: r3(rt.initMs), rss_mb: Math.round(process.memoryUsage().rss / 1e6), results, ops }, null, 1));
writeFileSync(`${OUT}/starters-latest${process.env.WITH_LIB === "1" ? "-lib" : ""}.json`, JSON.stringify({ node: process.version, reps: REPS, init_ms: r3(rt.initMs), rss_mb: Math.round(process.memoryUsage().rss / 1e6), results, ops }, null, 1));
log(`rss ${Math.round(process.memoryUsage().rss / 1e6)} MB; wrote ${OUT}/starters-${process.pid}.json`);
