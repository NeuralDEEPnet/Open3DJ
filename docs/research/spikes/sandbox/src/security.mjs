// Run every hostile case in its own child process (external timeout = last line of defence).
// usage: node security.mjs <deps> <out-dir> [variant] [caseFilterRegex]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES } from "./lib/cases.mjs";
import { depsPath, now, r2 } from "./lib/util.mjs";
const deps = depsPath(); const out = process.argv[3]; const variant = process.argv[4] || "quickjs";
const filter = new RegExp(process.argv[5] || ".");
const runner = fileURLToPath(new URL("./security-case.mjs", import.meta.url));
const rows = [];
for (const c of CASES.filter((x) => filter.test(x.id))) {
  const t = now();
  const p = spawnSync(process.execPath, [runner, deps, c.id, variant], { encoding: "utf8", timeout: c.hostMayHang ? 30000 : 60000, maxBuffer: 64 << 20 });
  const wall = r2(now() - t);
  let j = null; try { j = JSON.parse(p.stdout.trim().split("\n").pop()); } catch {}
  const row = { id: c.id, group: c.group, process_wall_ms: wall, exit: p.status, signal: p.signal, timed_out: p.error ? String(p.error.code || p.error.message) : null,
    stderr_tail: p.stderr ? p.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400) : "", ...j };
  rows.push(row);
  const r = j && j.result;
  console.log([c.id.padEnd(38), r ? (r.ok ? "ok" : `${r.error.kind}: ${r.error.name || ""} ${String(r.error.message || "").slice(0, 70)}`) : `NO RESULT exit=${p.status} sig=${p.signal} ${row.timed_out || ""}`,
    r ? `${r.wall_ms}ms` : `${wall}ms`, j ? `sanity=${j.sanity_after.ok}` : "", j && r.reports && r.reports.length ? `reports=${r.reports[0].slice(0, 160)}` : ""].join("  "));
}
writeFileSync(`${out}/security-${variant}.json`, JSON.stringify(rows, null, 1));
