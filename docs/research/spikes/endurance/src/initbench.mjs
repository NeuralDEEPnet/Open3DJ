// Driver: runs init_probe.mjs in fresh processes N times per mode/flag set and reports medians.
// usage: node initbench.mjs <deps> <out.json> [N]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { median } from "./lib.mjs";

const [DEPS, OUT, NS = "7"] = process.argv.slice(2);
const N = +NS;
const probe = fileURLToPath(new URL("./init_probe.mjs", import.meta.url));
const CONFIGS = [
  { name: "default", flags: [], mode: "default" },
  { name: "bytes-preread", flags: [], mode: "bytes" },
  { name: "precompiled-in-process", flags: [], mode: "precompiled" },
  { name: "second-kernel-same-process", flags: [], mode: "second" },
  { name: "eager-liftoff(--no-wasm-lazy-compilation)", flags: ["--no-wasm-lazy-compilation"], mode: "default" },
  { name: "turbofan-only(--no-liftoff)", flags: ["--no-liftoff"], mode: "default" },
  { name: "liftoff-only(--no-wasm-tier-up)", flags: ["--no-wasm-tier-up"], mode: "default" },
  { name: "worker-self-compile", flags: [], mode: "worker-self" },
  { name: "worker-shared-module", flags: [], mode: "worker-shared" },
];
const results = {};
for (const c of CONFIGS) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [...c.flags, probe, DEPS, c.mode], { encoding: "utf8", timeout: 300000 });
    const wall = Number(process.hrtime.bigint() - t) / 1e6;
    try { const j = JSON.parse(r.stdout.trim().split("\n").pop()); j.wall_ms = wall; runs.push(j); }
    catch { runs.push({ error: (r.stderr || "").slice(0, 300), wall_ms: wall }); }
  }
  const pick = (f) => runs.map(f).filter((x) => typeof x === "number");
  const s = {
    n: runs.length,
    wall_ms: median(pick((r) => r.wall_ms)),
    import_ms: median(pick((r) => r.timings?.import_ms)),
    init_ms: median(pick((r) => r.timings?.init_ms)),
    compile_ms: median(pick((r) => r.compile_ms)),
    instantiate_ms: median(pick((r) => r.timings?.instantiate_ms)),
    first_build_ms: median(pick((r) => r.first_builds_ms?.[0])),
    fifth_build_ms: median(pick((r) => r.first_builds_ms?.[4])),
    second_kernel_init_ms: c.mode === "second" ? median(pick((r) => r.timings?.init_ms)) : undefined,
    second_kernel_first_build_ms: c.mode === "second" ? median(pick((r) => r.second_builds_ms?.[0])) : undefined,
    rss_mib: median(pick((r) => r.mem?.VmRSS)),
    hwm_mib: median(pick((r) => r.mem?.VmHWM)),
    errors: runs.filter((r) => r.error).length,
  };
  if (c.mode.startsWith("worker")) {
    // per worker index: median across runs of spawn->ready and first build
    s.worker_spawn_to_ready_ms = [0, 1, 2, 3].map((w) => +median(pick((r) => r.workers?.[w]?.spawn_to_ready_ms)).toFixed(1));
    s.worker_first_build_ms = [0, 1, 2, 3].map((w) => +median(pick((r) => r.workers?.[w]?.first_build_ms)).toFixed(1));
  }
  for (const k of Object.keys(s)) if (typeof s[k] === "number") s[k] = +s[k].toFixed(1);
  results[c.name] = { summary: s, runs };
  process.stderr.write(`${c.name}: ${JSON.stringify(s)}\n`);
}
writeFileSync(OUT, JSON.stringify(results, null, 1));
