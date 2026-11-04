// End-to-end test of the Step 1 design: main thread (stands in for the MCP server) +
// one sandbox worker (kernel + fresh capped QuickJS per run) + watchdog.
// Prints EXACTLY ONE line to stdout (like an MCP stdio server must), full results to a file.
// usage: node worker-suite.mjs <deps> <out-dir> [--no-capture] [--quick]
import { readFileSync, writeFileSync } from "node:fs";
import { SandboxHost } from "./lib/host.mjs";
import { CASES, SANITY } from "./lib/cases.mjs";
import { depsPath, now, stats, r2 } from "./lib/util.mjs";
const deps = depsPath(); const outDir = process.argv[3];
const capture = !process.argv.includes("--no-capture");
const quick = process.argv.includes("--quick");
const enclosure = readFileSync(new URL("./scripts/enclosure.js", import.meta.url), "utf8");
const R = {};

// 1. cold start: spawn -> ready (kernel init + QuickJS compile inside the worker)
const cold = [];
for (let i = 0; i < (quick ? 1 : 5); i++) { const h = new SandboxHost({ deps, captureStdout: capture }); const t = now(); const r = await h.start(); cold.push({ wall: now() - t, ...r }); await h.close(); }
R.cold_start_ms = stats(cold.map((c) => c.wall));
R.worker_internal_init_ms = stats(cold.map((c) => c.worker_init_ms));

const host = new SandboxHost({ deps, captureStdout: capture });
await host.start();

// 2. warm runs of the realistic script (also exports STEP so the kernel prints to stdout)
const rt = [], inner = [], inst = [];
let first;
for (let i = 0; i < (quick ? 3 : 21); i++) {
  const res = await host.run(enclosure, { exportStep: true });
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  first ??= res.parts[0];
  rt.push(res.roundtrip_ms); inner.push(res.timings.total_ms); inst.push(res.timings.instantiate_ms);
}
R.enclosure = { part: first, roundtrip_ms: stats(rt), inside_worker_total_ms: stats(inner), fresh_qjs_instantiate_ms: stats(inst),
  message_overhead_ms_median: r2(stats(rt).median - stats(inner).median - stats(inst).median) };
R.kernel_stdout_captured = { chunks: host.kernelStdout.length, bytes: host.kernelStdout.join("").length, sample: host.kernelStdout.join("").slice(0, 200) };

// 3. every hostile case through the worker, each followed by a sanity run
R.cases = [];
if (!quick) for (const c of CASES) {
  const spawnsBefore = host.spawns;
  const res = await host.run(c.code, { limits: c.limits || {}, test: true });
  const sanity = await host.run(SANITY);
  R.cases.push({ id: c.id, group: c.group, ok: res.ok, kind: res.error?.kind, name: res.error?.name, message: res.error?.message?.slice(0, 160),
    ms: r2(res.roundtrip_ms ?? res.timings?.total_ms), terminate_ms: res.timings?.terminate_ms, reports: res.reports?.slice(0, 2).map((x) => x.slice(0, 300)),
    disposeError: res.stats?.disposeError?.slice(0, 120), respawned: host.spawns > spawnsBefore, sanity_ok: sanity.ok, sanity_volume: sanity.parts?.[0].volume });
}
// 4. host-side failures simulated inside the worker
for (const [id, code] of [["host-op-throws", "__x.hostThrow();"], ["worker-thread-exits", "__x.workerExit();"]]) {
  const spawnsBefore = host.spawns;
  const res = await host.run(code, { test: true });
  const sanity = await host.run(SANITY);
  R.cases.push({ id, group: "crash", ok: res.ok, kind: res.error?.kind, message: res.error?.message?.slice(0, 160), ms: r2(res.roundtrip_ms ?? res.timings?.total_ms),
    respawned: host.spawns > spawnsBefore, sanity_ok: sanity.ok });
}
R.respawns = host.spawns - 1;
R.events = host.events;
R.main_rss_mb = Math.round(process.memoryUsage().rss / 1e6);
await host.close();
writeFileSync(`${outDir}/worker-suite${capture ? "" : "-nocapture"}${quick ? "-quick" : ""}.json`, JSON.stringify(R, null, 1));
process.stdout.write(JSON.stringify({ done: true, cases: R.cases.length, all_sanity_ok: R.cases.every((c) => c.sanity_ok), respawns: R.respawns }) + "\n");
