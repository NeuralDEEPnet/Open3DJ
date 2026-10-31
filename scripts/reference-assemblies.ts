// Runs the generators in corpora/reference-assemblies and prints what they cost: the job's time
// on a fresh pool worker, the worker's memory (kernel WebAssembly memory plus JS heap) after
// the job, the size of the detailed and the concise report, and the wall time of a fresh CLI
// process (open3dj run --json, as an agent's first call would be). The numbers go in
// corpora/reference-assemblies/README.md; they are the timing corpus for S2, S3, S4 and S7a.
//
//   node scripts/reference-assemblies.ts            every configuration below
//   node scripts/reference-assemblies.ts plate      only configurations whose name contains "plate"
//   node scripts/reference-assemblies.ts --json     machine-readable output
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@open3dj/compute";
import type { ParamValue, RunOutput } from "@open3dj/schemas";
import { ROOT } from "./lib.ts";

const DIR = join(ROOT, "corpora", "reference-assemblies");
const CLI = join(ROOT, "packages", "open3dj", "src", "cli.ts");

interface Config { name: string; file: string; params: Record<string, ParamValue> }
const CONFIGS: Config[] = [
  { name: "plate-145", file: "plate-145.o3j.js", params: {} },
  { name: "plate-145 clean", file: "plate-145.o3j.js", params: { "Sunk screws": 0 } },
  { name: "grid-1025", file: "grid-1025.o3j.js", params: {} },
  { name: "grid-1025 kinds 50", file: "grid-1025.o3j.js", params: { Kinds: 50 } },
  { name: "grid-1025 seated", file: "grid-1025.o3j.js", params: { Lift: 0 } },
];

const args = process.argv.slice(2);
const json = args.includes("--json");
const filters = args.filter((a) => !a.startsWith("--"));
const configs = CONFIGS.filter((c) => filters.length === 0 || filters.some((f) => c.name.includes(f)));

function cliRun(c: Config, detailed: boolean): { ms: number; bytes: number; out?: RunOutput } {
  const tmp = mkdtempSync(join(tmpdir(), "o3dj-corpus-"));
  try {
    const script = join(tmp, c.file);
    copyFileSync(join(DIR, c.file), script);
    const params = Object.entries(c.params).flatMap(([k, v]) => ["--param", `${k}=${String(v)}`]);
    const t = performance.now();
    const r = spawnSync(process.execPath, [CLI, "run", script, "--json", ...(detailed ? ["--detailed"] : []), ...params], { cwd: tmp, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const ms = Math.round(performance.now() - t);
    let out: RunOutput | undefined;
    try {
      out = JSON.parse(r.stdout) as RunOutput;
    } catch {
      out = undefined;
    }
    return { ms, bytes: Buffer.byteLength(r.stdout ?? ""), ...(out ? { out } : {}) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const rows = [];
for (const c of configs) {
  // A fresh pool of one worker per configuration, so every job starts on a fresh kernel.
  const pool = createPool({ size: 1, log: () => {} });
  let r;
  try {
    r = await pool.run({ kind: "run", script: readFileSync(join(DIR, c.file), "utf8"), params: c.params, rev: "r_0001", detail: "detailed" }, { lane: "interactive", timeoutMs: 600_000 });
  } finally {
    await pool.close();
  }
  if (!r.ok) {
    rows.push({ name: c.name, error: `${r.error.code}: ${r.error.message}` });
    continue;
  }
  const kinds: Record<string, number> = {};
  for (const f of r.report.fits) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  const concise = cliRun(c, false);
  const detailed = cliRun(c, true);
  rows.push({
    name: c.name,
    params: c.params,
    status: r.report.status,
    occurrences: r.report.assembly.occurrences,
    definitions: r.report.assembly.definitions,
    fits: kinds,
    job_ms: Math.round(r.stats.wallMs),
    worker_memory_mb: Math.round(r.stats.memoryBytes / 2 ** 20),
    detailed_report_bytes: Buffer.byteLength(JSON.stringify(r.report)),
    cli_run_ms: concise.ms,
    cli_concise_bytes: concise.bytes,
    cli_concise_status: concise.out?.status ?? "no output",
    cli_detailed_ms: detailed.ms,
    cli_detailed_bytes: detailed.bytes,
  });
  process.stderr.write(`${c.name}: done\n`);
}

if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
else {
  process.stdout.write([
    "| Configuration | Occurrences / definitions | Status | Fits | Job on a fresh worker (ms) | Worker memory (MB) | Detailed report (bytes) | CLI run, fresh process (ms) | CLI concise output (bytes) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((x) => ("error" in x
      ? `| ${x.name} | | ${x.error} | | | | | | |`
      : `| ${x.name} | ${x.occurrences} / ${x.definitions} | ${x.status} | ${Object.entries(x.fits).map(([k, n]) => `${n} ${k}`).join(", ") || "none"} | ${x.job_ms} | ${x.worker_memory_mb} | ${x.detailed_report_bytes} | ${x.cli_run_ms} | ${x.cli_concise_bytes} |`)),
    "",
  ].join("\n"));
}
process.exit(rows.some((x) => "error" in x) ? 1 : 0);
