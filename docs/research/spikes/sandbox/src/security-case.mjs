// Run ONE hostile case in this process, then a sanity build in the same process.
// usage: node security-case.mjs <deps> <caseId> [variant]
import { loadQuickJS, loadKernel, runScript } from "./lib/bridge.mjs";
import { CASES, SANITY } from "./lib/cases.mjs";
import { depsPath, now, r2 } from "./lib/util.mjs";
const deps = depsPath();
const c = CASES.find((x) => x.id === process.argv[3]);
if (!c) throw new Error("unknown case " + process.argv[3]);
const qjs = await loadQuickJS(deps, process.argv[4] || "quickjs");
const kernel = await loadKernel(deps);
const rssBefore = process.memoryUsage().rss;
const runOnce = () => {
  const reports = [];
  const t = now();
  let res;
  try { res = runScript({ qjs, kernel, code: c.code, limits: c.limits || {}, extraOps: { report: (s) => { reports.push(String(s).slice(0, 4000)); return 0; } } }); }
  catch (e) { res = { ok: false, error: { kind: "HOST-THREW", message: String(e && e.message || e).slice(0, 500) } }; }
  return { wall_ms: r2(now() - t), ok: res.ok, error: res.error ? { ...res.error, stack: res.error.stack ? String(res.error.stack).slice(0, 300) : undefined } : undefined, parts: res.parts, stats: res.stats, reports };
};
const first = runOnce();
const second = c.twice ? runOnce() : undefined;
let sanity;
try { const s = runScript({ qjs, kernel, code: SANITY }); sanity = { ok: s.ok, volume: s.parts && Math.round(s.parts[0].volume * 1000) / 1000, error: s.error && s.error.message }; }
catch (e) { sanity = { ok: false, error: "HOST-THREW " + String(e.message).slice(0, 300) }; }
console.log(JSON.stringify({ id: c.id, group: c.group, result: first, second, sanity_after: sanity,
  rss_mb_before: Math.round(rssBefore / 1e6), rss_mb_after: Math.round(process.memoryUsage().rss / 1e6) }));
