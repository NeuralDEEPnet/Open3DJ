import { readFileSync, writeFileSync } from "node:fs";
const [OUT, ...files] = process.argv.slice(2);
const runs = files.map(f => JSON.parse(readFileSync(f, "utf8")));
const ids = runs[0].results.map(r => r.id);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rows = [];
for (const id of ids) {
  const rs = runs.map(r => r.results.find(x => x.id === id));
  const r0 = rs[0];
  if (!r0.runs) { rows.push({ id, runs: false, error: `${r0.errorType}: ${r0.error}` }); continue; }
  const allTimes = rs.flatMap(r => r.times_ms.slice(1)); // drop first (warm-up) rep per process
  const firsts = rs.map(r => r.first_ms);
  const hashes = rs.map(r => r.parts.map(p => p.brep_sha256).join("+"));
  const vols = rs.map(r => r.parts.map(p => p.volume).join("+"));
  rows.push({ id, runs: true, parts: r0.parts.length,
    volume: r0.parts.map(p => p.volume), solids: r0.parts.map(p => p.solids), valid: r0.parts.every(p => p.valid),
    bbox: r0.parts.map(p => [p.bbox_min, p.bbox_max]), mesh_rel_max: Math.max(...r0.parts.map(p => p.mesh_vs_brep_rel)),
    warm_median_ms: +med(allTimes).toFixed(1), warm_min_ms: +Math.min(...allTimes).toFixed(1), warm_max_ms: +Math.max(...allTimes).toFixed(1), n: allTimes.length,
    first_ms_median: +med(firsts).toFixed(1),
    brep_identical_across_processes: new Set(hashes).size === 1, volume_identical_across_processes: new Set(vols).size === 1,
    step_bytes: r0.parts.reduce((a, p) => a + p.step_bytes, 0), params: r0.params.length });
}
const out = { processes: runs.length, init_ms: runs.map(r => r.init_ms), rss_mb: runs.map(r => r.rss_mb), rows };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(out, null, 1));
for (const r of rows) console.log(r.runs ? `${r.id} | parts ${r.parts} | V ${r.volume.join("/")} | solids ${r.solids.join("/")} | valid ${r.valid} | warm med ${r.warm_median_ms} [${r.warm_min_ms}-${r.warm_max_ms}] n=${r.n} | first ${r.first_ms_median} | brepSame ${r.brep_identical_across_processes} volSame ${r.volume_identical_across_processes} | meshRelMax ${r.mesh_rel_max} | params ${r.params}` : `${r.id} | FAIL | ${r.error}`);
console.log("init", out.init_ms, "rss", out.rss_mb);
