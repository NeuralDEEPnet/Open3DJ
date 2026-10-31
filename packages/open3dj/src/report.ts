// open3dj doctor --report: a Markdown hardware report to paste into the hardware report issue
// form. It holds what doctor --bench measures, the GPU names the operating system gives (Open3DJ
// does not use GPUs yet), the commit and how Open3DJ was installed. It holds no user names, host
// names or file paths.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorReport } from "@open3dj/compute";

export const HARDWARE_REPORT_URL = "https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml";

/** Facts about the install that the inventory does not hold. */
export interface ReportContext {
  /** Commit hash, or undefined when it is not known. */
  commit?: string;
  /** "git clone", "installer (ref main)" or similar. */
  install: string;
  /** GPU names as the operating system reports them; empty when none were found. */
  gpus: string[];
}

/** The repository root: packages/open3dj/src/../../.. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Where this copy came from. A git clone answers with its HEAD; an installer copy has the
 * install.json the installers write next to the app folder.
 */
export function installContext(root: string = ROOT): Pick<ReportContext, "commit" | "install"> {
  if (existsSync(join(root, ".git"))) {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 5000, windowsHide: true });
    const commit = r.status === 0 ? r.stdout.trim() : undefined;
    return commit ? { commit, install: "git clone" } : { install: "git clone" };
  }
  try {
    const info = JSON.parse(readFileSync(join(root, "..", "install.json"), "utf8").replace(/^\uFEFF/, "")) as { commit?: string; ref?: string; source?: string };
    const from = info.source === "local" ? "a local folder" : `ref ${info.ref ?? "unknown"}`;
    const out: Pick<ReportContext, "commit" | "install"> = { install: `installer (${from})` };
    if (info.commit && /^[0-9a-f]{7,40}$/.test(info.commit)) out.commit = info.commit;
    return out;
  } catch {
    return { install: "unknown (no .git folder and no install.json)" };
  }
}

type Run = (command: string, args: string[]) => string | undefined;

const runQuiet: Run = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, windowsHide: true });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : undefined;
};

/**
 * GPU names from the operating system, best effort: Win32_VideoController on Windows,
 * system_profiler on macOS, lspci on Linux. Only the adapter names are kept.
 */
export function gpuNames(platform: NodeJS.Platform = process.platform, run: Run = runQuiet): string[] {
  const names: string[] = [];
  if (platform === "win32") {
    const out = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController).Name"]);
    for (const line of out?.split(/\r?\n/) ?? []) if (line.trim()) names.push(line.trim());
  } else if (platform === "darwin") {
    const out = run("system_profiler", ["SPDisplaysDataType", "-json"]);
    try {
      const data = JSON.parse(out ?? "{}") as { SPDisplaysDataType?: Array<{ sppci_model?: string; _name?: string }> };
      for (const d of data.SPDisplaysDataType ?? []) {
        const name = d.sppci_model ?? d._name;
        if (name) names.push(name);
      }
    } catch {
      // Not JSON: leave the list empty.
    }
  } else {
    const out = run("lspci", []);
    for (const line of out?.split("\n") ?? []) {
      const m = /^\S+\s+(?:VGA compatible controller|3D controller|Display controller):\s*(.+)$/.exec(line.trim());
      if (m) names.push(m[1]!.trim());
    }
  }
  return [...new Set(names)];
}

const fmt = (x: number, digits = 1): string => String(Number(x.toFixed(digits)));
const gib = (bytes: number): string => `${fmt(bytes / 1024 ** 3, 1)} GiB`;
/** Keep a table cell on one line and free of pipes. */
const cell = (s: string): string => s.replace(/\s*[|\r\n]+\s*/g, " ").trim();

/** The Markdown report. Pure: the caller measures, this only lays it out. */
export function formatHardwareReport(r: DoctorReport, ctx: ReportContext): string {
  const inv = r.inventory;
  const rt = inv.runtime;
  const kernels = [
    rt.occt_wasm ? `occt-wasm ${rt.occt_wasm}` : "",
    rt.brepjs ? `brepjs ${rt.brepjs}` : "",
    rt.quickjs ? `quickjs-emscripten ${rt.quickjs}` : "",
  ].filter(Boolean).join(", ");
  const lines = [
    `<!-- open3dj doctor --report. Read it first: it should hold nothing you do not want to share.`,
    `     Then paste all of it into the "open3dj doctor --report output" field of ${HARDWARE_REPORT_URL} -->`,
    "",
    "### Machine",
    "",
    "| Field | Value |",
    "|---|---|",
    `| OS | ${cell(`${inv.os.platform} ${inv.os.release ?? ""}`)} |`,
    `| Arch | ${cell(inv.os.arch)} |`,
    `| CPU | ${cell(inv.cpu.model ?? "unknown")} (${inv.cpu.cores} logical cores, ${cell(inv.cpu.arch ?? inv.os.arch)}) |`,
    `| RAM | ${gib(inv.memory.total_bytes)} total, ${gib(inv.memory.free_bytes)} free |`,
    `| GPU (from the OS, not used yet) | ${ctx.gpus.length ? cell(ctx.gpus.join("; ")) : "none found; please name yours"} |`,
    `| Node | ${cell(rt.node)} |`,
    `| Open3DJ | ${cell(rt.open3dj ?? "unknown")}, commit ${ctx.commit ? ctx.commit.slice(0, 12) : "unknown"}, ${cell(ctx.install)} |`,
    `| Kernels | ${cell(kernels || "unknown")} |`,
    `| Backends | ${cell(inv.backends.join(", "))} |`,
    `| Worker pool | ${inv.pool ? `${inv.pool.workers} workers, ${inv.pool.interactive_reserved} reserved for interactive jobs` : "unknown"} |`,
  ];
  const b = r.bench;
  if (b) {
    lines.push(
      "",
      "### Bench",
      "",
      "| Measure | Value |",
      "|---|---|",
      `| Kernel init | ${fmt(b.kernel_init_ms)} ms |`,
      `| First part | ${fmt(b.part_first_ms)} ms |`,
      `| Warm part (median) | ${fmt(b.part_ms)} ms (${fmt(b.part_volume_mm3, 2)} mm3) |`,
      `| Peak worker memory | ${fmt(b.peak_worker_memory_bytes / 1024 ** 2)} MiB |`,
      `| Baseline job | ${fmt(b.baseline_job_ms)} ms |`,
      ...Object.entries(b.kernel_ops_ms).map(([op, ms]) => `| ${op} (minus baseline) | ${fmt(ms)} ms |`),
      "",
      "| Workers | Jobs | Wall | Jobs/s | Speedup |",
      "|---|---|---|---|---|",
      ...b.scaling.map((s) => `| ${s.workers} | ${s.jobs} | ${fmt(s.wall_ms, 0)} ms | ${fmt(s.jobs_per_s, 2)} | x${fmt(s.speedup, 2)} |`),
    );
  } else {
    lines.push("", "No bench in this report. Run open3dj doctor --report to measure.");
  }
  if (r.notes.length) lines.push("", ...r.notes.map((x) => `Note: ${x}`));
  lines.push("", "### doctor --bench JSON", "", "```json", JSON.stringify(r, null, 2), "```", "");
  return lines.join("\n");
}
