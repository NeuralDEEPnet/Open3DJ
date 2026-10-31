// A fake compute pool for handler, server and CLI tests. It answers like the real pool
// without a kernel: parts are named after `name: "..."` in the script, `throw` gives a
// SCRIPT_RUNTIME error at its line, `clash` gives a warning with a clash, and `slow` makes the
// job wait (and honour cancellation). Not exported from the package index.
import type { DeviceInventory, ComputeBlock, ComputeMode, AssemblyFile, GeometryReport, PartReport, FitReport } from "@open3dj/schemas";
import type { JobKind, JobRequest, JobResult, Pool, PoolStats, RenderImage, ExportArtifact } from "@open3dj/compute";

export const FAKE_INVENTORY: DeviceInventory = {
  created: "2026-10-28T00:00:00.000Z",
  os: { platform: "linux", arch: "x64" },
  runtime: { node: "24.22.1", open3dj: "0.0.0", occt_wasm: "5.8.1", brepjs: "20.11.1", quickjs: "0.32.0" },
  cpu: { cores: 4 },
  memory: { total_bytes: 8 * 1024 ** 3, free_bytes: 4 * 1024 ** 3 },
  gpus: [],
  backends: ["cpu.wasm"],
};

export function fakePlace(mode: ComputeMode, kind: JobKind): ComputeBlock {
  if (mode === "gpu" || mode === "cloud") throw Object.assign(new Error(`no ${mode} backend can run ${kind} jobs in S1`), { code: "NO_BACKEND" });
  return { backend: "cpu.wasm", device: "cpu x3", placement_reason: `${mode}: cpu pool (fake)` };
}

// A 1x1 PNG, so clients that decode images accept it.
export const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));

export interface FakePool extends Pool {
  calls: JobRequest[];
  closed: boolean;
}

export function fakePool(options: { slowMs?: number } = {}): FakePool {
  const slowMs = options.slowMs ?? 300;
  let completed = 0;
  const pool: FakePool = {
    calls: [],
    closed: false,
    place: (mode, kind) => fakePlace(mode, kind),
    async run(job, opts) {
      pool.calls.push(structuredClone(job));
      const signal = opts?.signal;
      if (/\bslow\b/.test(job.script)) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, slowMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("cancelled"));
          });
        }).catch(() => "cancelled");
        if (signal?.aborted) return { ok: false, kind: job.kind, error: { code: "JOB_CANCELLED", message: "the job was cancelled" }, logs: [], stats, compute: job.compute ?? fakePlace("auto", job.kind) };
      }
      completed++;
      return fakeResult(job);
    },
    stats(): PoolStats {
      return { size: 1, workers: 1, busy: 0, queued: { interactive: 0, batch: 0 }, recycled: 0, timedOut: 0, crashed: 0, completed };
    },
    async close() {
      pool.closed = true;
    },
  };
  return pool;
}

const stats = { workerId: 1, jobs: 1, wallMs: 1, memoryBytes: 1, liveShapes: 0 };

export function fakeResult(job: JobRequest): JobResult {
  const compute = job.compute ?? fakePlace("auto", job.kind);
  const lines = job.script.split("\n");
  const throwLine = lines.findIndex((l) => /\bthrow\b/.test(l));
  if (throwLine >= 0) {
    return { ok: false, kind: job.kind, error: { code: "SCRIPT_RUNTIME", message: "Error: boom", line: throwLine + 1, column: 1, hint: "Fix the script at this line." }, logs: [], stats, compute };
  }
  const names = [...job.script.matchAll(/name:\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]!);
  if (names.length === 0) names.push("part");
  const assembly = fakeAssembly(names, job.previous);
  const report = fakeReport(job, names);
  const result: Extract<JobResult, { ok: true }> = { ok: true, kind: job.kind, report, assembly, params: job.params ?? {}, logs: [], stats, compute };
  if (job.kind === "render") {
    const fmt = job.render?.format ?? "both";
    const images: RenderImage[] = [];
    const suffix = job.render?.targets?.length ? `-${job.render.targets.join("-").replace(/[^A-Za-z0-9_-]/g, "_")}` : "";
    if (fmt !== "svg") images.push({ format: "png", name: `multiview${suffix}.png`, bytes: TINY_PNG, width: 1, height: 1 });
    if (fmt !== "png") images.push({ format: "svg", name: `multiview${suffix}.svg`, bytes: new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"><title>fake</title></svg>"), width: 1200, height: 900 });
    result.images = images;
  }
  if (job.kind === "export" && job.export) {
    const base = job.export.baseName ?? "model";
    const artifacts: ExportArtifact[] = [];
    for (const f of job.export.formats) {
      const ext = f === "gltf" ? "glb" : f;
      const a: ExportArtifact = { name: `${base}.${ext}`, format: f, bytes: new TextEncoder().encode(`fake ${f} of ${names.join(",")}`) };
      if (f === "3mf") a.warnings = ["3MF has no per-occurrence colour overrides (fake)"];
      artifacts.push(a);
    }
    artifacts.push({ name: `${base}.evidence.json`, format: "evidence", bytes: new TextEncoder().encode(JSON.stringify({ rev: job.rev })) });
    if (job.export.scope && !names.includes(job.export.scope)) {
      return { ok: false, kind: job.kind, error: { code: "UNKNOWN_TARGET", message: `no occurrence is called '${job.export.scope}'` }, logs: [], stats, compute };
    }
    result.artifacts = artifacts;
  }
  return result;
}

function fakeAssembly(names: string[], previous: AssemblyFile | undefined): AssemblyFile {
  const old = new Map((previous?.definitions[previous.root]?.occurrences ?? []).map((o) => [o.name, o.id]));
  const definitions: AssemblyFile["definitions"] = {
    root: {
      kind: "assembly",
      occurrences: names.map((n, i) => ({ id: old.get(n) ?? `occ-${n}-${i}`, name: n, def: n, transform: { t: [i * 10, 0, 0], q: [0, 0, 0, 1] } })),
    },
  };
  for (const n of names) definitions[n] = { kind: "script", name: n };
  return { o3j: "0", root: "root", definitions };
}

function fakeReport(job: JobRequest, names: string[]): GeometryReport {
  const parts: PartReport[] = names.map((n, i) => ({
    def: n, occurrences: 1, valid: true, volume_mm3: 1000 * (i + 1), area_mm2: 600, bbox: { min: [i * 10, 0, 0], max: [i * 10 + 10, 10, 10] },
    center_of_mass: [i * 10 + 5, 5, 5], counts: { solids: 1, faces: 6, edges: 12 },
  }));
  const clash = /\bclash\b/.test(job.script) && names.length >= 2;
  const fits: FitReport[] = clash ? [{ a: names[0]!, b: names[1]!, kind: "clash", volume_mm3: 14.679, confidence: "measured" }] : [];
  if (job.detail === "detailed" && names.length >= 2 && !clash) fits.push({ a: names[0]!, b: names[1]!, kind: "clearance", distance_mm: 0.2, confidence: "measured" });
  const report: GeometryReport = {
    status: clash ? "warning" : "ok", rev: job.rev, assembly: { occurrences: names.length, definitions: names.length },
    parts, fits, compute: job.compute ?? { backend: "cpu.wasm", device: "cpu x1", placement_reason: "fake" },
  };
  if (clash) report.next = [`render view=multiview targets=[${names[0]},${names[1]}]`];
  return report;
}
