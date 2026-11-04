// Runs every example in examples/ through the real CLI, each command in a fresh process
// (open3dj run, render and export, as a person would), prints how long each took, and
// compares the measures with examples/<name>/expected.json.
//
//   node scripts/examples.ts            check every example and print timings
//   node scripts/examples.ts --write    also rewrite expected.json and drawing.png
//   node scripts/examples.ts bracket    only the examples whose name contains "bracket"
//
// Each run starts from a deleted project folder, so the timings include creating the
// project, starting a worker and loading the kernel.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeVersions } from "@open3dj/compute";
import type { ExportOutput, RunOutput } from "@open3dj/schemas";
import { compare, listExamples, readExpected, summarize, toleranceFor } from "./examples-lib.ts";
import type { Expected } from "./examples-lib.ts";
import { ROOT, rel } from "./lib.ts";

const CLI = join(ROOT, "packages", "open3dj", "src", "cli.ts");
const write = process.argv.includes("--write");
const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FORMATS = ["step", "stl", "glb", "3mf"] as const;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}

function cli(args: string[]): CliResult {
  const t = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, ms: Math.round(performance.now() - t) };
}

function must(r: CliResult, what: string): CliResult {
  if (r.code !== 0) throw new Error(`${what} exited ${r.code}\n${r.stderr}${r.stdout}`.slice(0, 4000));
  return r;
}

const versions = runtimeVersions();
const rows: string[] = [];
const failures: string[] = [];
for (const ex of listExamples().filter((e) => filters.length === 0 || filters.some((f) => e.name.includes(f)))) {
  rmSync(ex.project, { recursive: true, force: true });
  try {
    const run = must(cli(["run", ex.script, "--detailed", "--json"]), `open3dj run ${rel(ex.script)}`);
    const out = JSON.parse(run.stdout) as RunOutput;
    if (!out.report || !out.rev) throw new Error(`run gave no report: ${run.stdout.slice(0, 2000)}`);
    const renderArgs = ["render", ex.project, "--format", "png"];
    if (write) renderArgs.push("--out", ex.drawingFile);
    const render = must(cli(renderArgs), `open3dj render ${rel(ex.project)}`);
    const exportMs: number[] = [];
    const files: string[] = [];
    for (const format of FORMATS) {
      const r = must(cli(["export", ex.project, "--format", format, "--json"]), `open3dj export ${rel(ex.project)} --format ${format}`);
      exportMs.push(r.ms);
      const eo = JSON.parse(r.stdout) as ExportOutput;
      for (const f of eo.files ?? []) files.push(f.path.split("/").pop()!);
    }
    const source = readFileSync(ex.script, "utf8");
    const measured = summarize({ ...out.report, status: out.status === "queued" ? "error" : out.status });
    const expected: Expected = {
      example: ex.name,
      script: `${ex.name}.o3j.js`,
      note: "Written by node scripts/examples.ts --write from a detailed open3dj run. scripts/examples.test.ts compares status, counts and fits exactly, and volume, area, bbox and fit measures within the tolerance (relative).",
      engine: { occt_wasm: versions.occt_wasm ?? "unknown", brepjs: versions.brepjs ?? "unknown" },
      tolerance: toleranceFor(source),
      status: measured.status,
      assembly: measured.assembly,
      parts: measured.parts,
      fits: measured.fits,
      exports: [...new Set(files)].sort(),
    };
    if (write) {
      writeFileSync(ex.expectedFile, `${JSON.stringify(expected, null, 2)}\n`);
    } else {
      const diffs = compare(readExpected(ex), measured, expected.tolerance);
      if (diffs.length > 0) failures.push(`${ex.name}:\n    ${diffs.join("\n    ")}`);
    }
    const vol = measured.parts.reduce((s, p) => s + p.volume_mm3 * p.occurrences, 0);
    rows.push(`| ${ex.name} | ${measured.status} | ${measured.assembly.occurrences} / ${measured.assembly.definitions} | ${vol.toFixed(1)} | ${run.ms} | ${render.ms} | ${exportMs.join(" / ")} |`);
    process.stderr.write(`${ex.name}: run ${run.ms} ms, render ${render.ms} ms, export ${exportMs.join("/")} ms\n`);
  } catch (e) {
    failures.push(`${ex.name}: ${(e as Error).message}`);
  }
}

process.stdout.write([
  "| Example | Status | Occurrences / definitions | Volume (mm3) | run (ms) | render (ms) | export step / stl / glb / 3mf (ms) |",
  "|---|---|---|---|---|---|---|",
  ...rows,
  "",
].join("\n"));
if (failures.length > 0) {
  process.stderr.write(`FAIL examples:\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
process.stderr.write(`${write ? "WROTE" : "PASS"} ${rows.length} examples\n`);
