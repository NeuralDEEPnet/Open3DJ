import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DoctorReport } from "@open3dj/compute";
import { EXIT, main, parseCommand } from "./index.ts";
import { HARDWARE_REPORT_URL, formatHardwareReport, gpuNames, installContext } from "./report.ts";

const REPORT: DoctorReport = {
  inventory: {
    created: "2026-10-31T10:00:00.000Z",
    os: { platform: "win32", release: "10.0.26100", arch: "arm64" },
    runtime: { node: "24.11.0", open3dj: "0.0.0", occt_wasm: "5.8.1", brepjs: "20.11.1", quickjs: "0.32.0" },
    cpu: { cores: 12, arch: "arm64", model: "Snapdragon(R) X | Elite" },
    memory: { total_bytes: 32 * 1024 ** 3, free_bytes: 20 * 1024 ** 3 },
    gpus: [],
    backends: ["cpu.wasm"],
    pool: { workers: 11, interactive_reserved: 1, recycle_limit_bytes: 1.5 * 1024 ** 3 },
  },
  inventory_hash: "sha256:abc",
  notes: ["GPU discovery arrives in a later step."],
  bench: {
    kernel_init_ms: 412.3,
    part_first_ms: 95.1,
    part_ms: 41.2,
    part_volume_mm3: 22943.123,
    peak_worker_memory_bytes: 210 * 1024 ** 2,
    baseline_job_ms: 12.4,
    kernel_ops_ms: { boolean: 10.1, fillet: 20.2, shell: 30.3, tessellate_glb: 4, step_write: 5, hlr_render: 60 },
    scaling: [
      { workers: 1, jobs: 4, wall_ms: 170.4, jobs_per_s: 23.47, speedup: 1 },
      { workers: 2, jobs: 8, wall_ms: 180.2, jobs_per_s: 44.4, speedup: 1.89 },
    ],
  },
};

test("doctor --report parses, implies the bench and refuses --json", async () => {
  assert.deepEqual(parseCommand(["doctor", "--report"]).command, { cmd: "doctor", bench: true, report: true });
  assert.deepEqual(parseCommand(["doctor"]).command, { cmd: "doctor", bench: false, report: false });
  const err: string[] = [];
  assert.equal(await main(["doctor", "--report", "--json"], { out: () => {}, err: (t) => void err.push(t) }), EXIT.usage);
  assert.match(err.join(""), /--json or --report/);
});

test("the hardware report is Markdown with the machine, the bench and the raw JSON", () => {
  const md = formatHardwareReport(REPORT, { commit: "0123456789abcdef0123", install: "installer (ref main)", gpus: ["Qualcomm(R) Adreno(TM) X1-85 GPU"] });
  assert.ok(md.startsWith("<!-- open3dj doctor --report."));
  assert.ok(md.includes(`"open3dj doctor --report output" field of ${HARDWARE_REPORT_URL} -->`));
  assert.match(md, /\| OS \| win32 10\.0\.26100 \|/);
  assert.match(md, /\| Arch \| arm64 \|/);
  // A pipe in a value would break the table row.
  assert.match(md, /\| CPU \| Snapdragon\(R\) X Elite \(12 logical cores, arm64\) \|/);
  assert.match(md, /\| RAM \| 32 GiB total, 20 GiB free \|/);
  assert.match(md, /\| GPU \(from the OS, not used yet\) \| Qualcomm\(R\) Adreno\(TM\) X1-85 GPU \|/);
  assert.match(md, /\| Open3DJ \| 0\.0\.0, commit 0123456789ab, installer \(ref main\) \|/);
  assert.match(md, /\| Kernels \| occt-wasm 5\.8\.1, brepjs 20\.11\.1, quickjs-emscripten 0\.32\.0 \|/);
  assert.match(md, /\| Warm part \(median\) \| 41\.2 ms \(22943\.12 mm3\) \|/);
  assert.match(md, /\| hlr_render \(minus baseline\) \| 60 ms \|/);
  assert.match(md, /\| 2 \| 8 \| 180 ms \| 44\.4 \| x1\.89 \|/);
  // The JSON block is the doctor --bench --json output the form's required field asks for.
  const json = /```json\n([\s\S]+?)\n```/.exec(md)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), REPORT);

  const bare = formatHardwareReport({ ...REPORT, bench: undefined } as DoctorReport, { install: "git clone", gpus: [] });
  assert.match(bare, /commit unknown, git clone/);
  assert.match(bare, /none found; please name yours/);
  assert.match(bare, /No bench in this report/);
});

test("gpuNames keeps only adapter names from each OS tool", () => {
  const calls: string[] = [];
  const fake = (out: string | undefined) => (command: string, args: string[]) => {
    calls.push([command, ...args].join(" "));
    return out;
  };
  assert.deepEqual(gpuNames("linux", fake("00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 620 (rev 07)\n01:00.0 3D controller: NVIDIA Corporation GP108M [GeForce MX150] (rev a1)\n00:1f.3 Audio device: Intel Corporation Sunrise Point\n")), [
    "Intel Corporation UHD Graphics 620 (rev 07)",
    "NVIDIA Corporation GP108M [GeForce MX150] (rev a1)",
  ]);
  assert.deepEqual(gpuNames("darwin", fake(JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M2", spdisplays_ndrvs: [{ "_spdisplays_display-serial-number": "secret" }] }] }))), ["Apple M2"]);
  assert.deepEqual(gpuNames("win32", fake("NVIDIA GeForce RTX 4070\r\nMicrosoft Basic Display Adapter\r\n\r\n")), ["NVIDIA GeForce RTX 4070", "Microsoft Basic Display Adapter"]);
  // A missing tool or odd output gives an empty list, never a throw.
  assert.deepEqual(gpuNames("linux", fake(undefined)), []);
  assert.deepEqual(gpuNames("darwin", fake("not json")), []);
  assert.deepEqual(calls.map((c) => c.split(" ")[0]), ["lspci", "system_profiler", "powershell.exe", "lspci", "system_profiler"]);
});

test("installContext reads the installers' install.json when there is no .git folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "o3j-report-"));
  try {
    const app = join(dir, "app");
    mkdirSync(app);
    assert.match(installContext(app).install, /^unknown/);
    writeFileSync(join(dir, "install.json"), JSON.stringify({ ref: "main", commit: "2fb573aca616c50c60c616057c3a2d232200051e", source: "github" }));
    assert.deepEqual(installContext(app), { install: "installer (ref main)", commit: "2fb573aca616c50c60c616057c3a2d232200051e" });
    writeFileSync(join(dir, "install.json"), JSON.stringify({ commit: "not a hash", source: "local" }));
    assert.deepEqual(installContext(app), { install: "installer (a local folder)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
