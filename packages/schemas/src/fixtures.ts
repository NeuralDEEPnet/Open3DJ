// Fixtures for the schema tests. Each valid fixture is typed with the matching TypeScript
// interface, so the typecheck and the JSON Schema must both accept it.
import type {
  AssemblyFile, ComputeBlock, DeviceInventory, DocsInput, DocsOutput, ExportInput, ExportOutput,
  GeometryReport, InspectInput, InspectOutput, ProjectManifest, ProvenanceLine, RenderInput,
  RenderOutput, RunInput, RunOutput, ScriptError,
} from "./types.ts";
import type { SchemaName } from "./index.ts";

const HASH = "a".repeat(64);

export const compute: ComputeBlock = { backend: "cpu.wasm", device: "cpu x3", placement_reason: "auto: no gpu backend for kind" };

export const report: GeometryReport = {
  status: "ok",
  rev: "r_0193ab",
  assembly: { occurrences: 3, definitions: 2, bbox: { min: [0, 0, 0], max: [60, 40, 30] } },
  parts: [
    {
      def: "base", occurrences: 1, valid: true, volume_mm3: 18747.61, area_mm2: 6430.2,
      bbox: { min: [-30, -20, 0], max: [30, 20, 8] }, center_of_mass: [0, 0, 4],
      counts: { solids: 1, faces: 12, edges: 30 },
    },
    {
      def: "screw", occurrences: 2, valid: true, volume_mm3: 120.5, area_mm2: 200,
      bbox: { min: [-2.75, -2.75, 0], max: [2.75, 2.75, 14] }, center_of_mass: [0, 0, 6.5],
      counts: { solids: 1, faces: 5, edges: 6 },
      gates: { fail: [{ gate: "min_wall", value: 0.7, limit: 0.8, at: "@elem:op_4:side:2", waivable: "agent" }] },
    },
  ],
  fits: [{ a: "base#1", b: "screw#2", kind: "clash", volume_mm3: 14.7, confidence: "measured" }],
  refs: [{ name: "pcb_seat", state: "exact" }],
  compute,
  warnings: [],
  next: ["render view=multiview targets=[base#1,screw#2]"],
};

export const scriptError: ScriptError = {
  code: "KERNEL_FILLET_FAILED", message: "fillet failed on 2 edges", line: 12, column: 5, op: "fillet",
  elements: ["edge:3", "edge:7"], hint: "reduce the radius below 1.5 mm or fillet fewer edges",
};

export const devices: DeviceInventory = {
  created: "2026-10-28T12:00:00.000Z",
  os: { platform: "linux", release: "6.18", arch: "x64" },
  runtime: { node: "24.22.1", open3dj: "0.0.0", occt_wasm: "5.8.1" },
  cpu: { model: "test cpu", cores: 4, arch: "x64" },
  memory: { total_bytes: 8_000_000_000, free_bytes: 4_000_000_000 },
  gpus: [],
  backends: ["cpu.wasm"],
  pool: { workers: 3, interactive_reserved: 1, recycle_limit_bytes: 1_610_612_736 },
};

export const provenance: ProvenanceLine = {
  ts: "2026-10-28T12:00:00.000Z", tool: "run", args_hash: HASH, result_hash: HASH, base_rev: "r_1", rev: "r_2",
  engine: { open3dj: "0.0.0", occt_wasm: "5.8.1", brepjs: "20.11.1", quickjs: "0.32.0" },
  device_inventory_hash: HASH, compute,
};

export const project: ProjectManifest = {
  o3j: "0", name: "bracket", units: "mm", up: "Z", rev: "r_2", engine: { open3dj: "0.0.0", occt_wasm: "5.8.1", brepjs: "20.11.1" },
};

export const assembly: AssemblyFile = {
  o3j: "0",
  root: "enclosure",
  definitions: {
    enclosure: {
      kind: "assembly", partNumber: "EN-0000",
      occurrences: [
        { id: "0193a1", name: "base#1", def: "base", transform: { t: [0, 0, 0], q: [0, 0, 0, 1] }, fixed: true },
        { id: "0193a2", name: "screw#1", def: "screw", transform: { t: [6, 6, 20], q: [0, 0, 0, 1] } },
        { id: "0193a3", name: "screw#2", def: "screw", transform: { t: [54, 6, 20], q: [0, 0, 0, 1] }, color: [0.8, 0.8, 0.8] },
      ],
    },
    base: {
      kind: "script", script: "parts/base.o3j.js", export: "base",
      connectors: [{ name: "boss_1", origin: [6, 6, 20], z: [0, 0, 1], x: [1, 0, 0], gender: "female", type: "insert_m3", anchor: "literal" }],
    },
    screw: { kind: "script", script: "parts/base.o3j.js", export: "screw", geometry_hash: "abc", shared_by: "inferred" },
  },
  mates: [{ id: "m1", type: "fastened", a: "base#1.boss_1", b: "screw#1.tip", owner: "script" }],
};

export const runIn: RunInput = { project: "bracket.o3j", script: "return box(10, 10, 10);", params: { width: 10 }, compute: "auto" };
export const runInOps: RunInput = {
  project: "bracket.o3j", base_rev: "r_2",
  ops: [
    { op: "set_param", name: "width", value: 12 },
    { op: "cancel_job", job_id: "j_01" },
  ],
};
export const runOut: RunOutput = { status: "ok", rev: "r_2", report, compute };
export const runOutError: RunOutput = { status: "error", error: scriptError, compute };
export const inspectIn: InspectInput = { project: "bracket.o3j", fields: ["tree", "fits", "devices"] };
export const inspectOut: InspectOutput = {
  status: "ok", rev: "r_2",
  tree: [{ path: "enclosure/base#1", def: "base", kind: "script", transform: { t: [0, 0, 0], q: [0, 0, 0, 1] } }],
  fits: report.fits, devices, compute,
};
export const inspectJob: InspectOutput = {
  status: "ok",
  job: { job_id: "j_01", kind: "export", state: "running", progress: { done: 3, total: 7, unit: "pairs" }, attempts: [{ backend: "cpu.wasm", device: "cpu x3", outcome: "ok" }] },
  compute,
};
export const renderIn: RenderInput = { project: "bracket.o3j", view: "multiview", format: "both", targets: ["base#1"] };
export const renderOut: RenderOutput = {
  status: "ok", rev: "r_2", view: "multiview",
  files: [{ path: "out/r_2/multiview.png", format: "png", bytes: 22000, sha256: HASH }], compute,
};
export const exportIn: ExportInput = { project: "bracket.o3j", format: "step", scope: "root" };
export const exportOut: ExportOutput = {
  status: "ok", rev: "r_2", files: [{ path: "out/r_2/bracket.step", format: "step", bytes: 29199, sha256: HASH }], warnings: [], compute,
};
export const docsIn: DocsInput = { query: "fillet", page: 1 };
export const docsOut: DocsOutput = { query: "fillet", page: 1, pages: 1, hits: [{ title: "fillet(shape, r, query)", kind: "dsl", text: "Round edges." }] };

export const VALID: Array<[SchemaName, unknown]> = [
  ["compute", compute], ["geometry-report", report], ["script-error", scriptError], ["device-inventory", devices],
  ["provenance", provenance], ["project", project], ["assembly", assembly],
  ["tool-run-input", runIn], ["tool-run-input", runInOps], ["tool-run-output", runOut], ["tool-run-output", runOutError],
  ["tool-inspect-input", inspectIn], ["tool-inspect-input", { fields: ["job"], job_id: "j_01" }], ["tool-inspect-output", inspectOut], ["tool-inspect-output", inspectJob],
  ["tool-render-input", renderIn], ["tool-render-output", renderOut],
  ["tool-export-input", exportIn], ["tool-export-output", exportOut],
  ["tool-docs-input", docsIn], ["tool-docs-output", docsOut],
];

const clone = <T>(v: T): T => structuredClone(v);
const with_ = <T>(v: T, f: (x: T) => void): T => {
  const c = clone(v);
  f(c);
  return c;
};

/** [schema, value, JSON Pointer of the expected error, why] */
export const INVALID: Array<[SchemaName, unknown, string, string]> = [
  ["geometry-report", with_(report, (r) => { (r as unknown as Record<string, unknown>).status = "fine"; }), "/status", "status outside the enum"],
  ["geometry-report", with_(report, (r) => { delete (r as Partial<GeometryReport>).assembly; }), "", "assembly block missing"],
  ["geometry-report", with_(report, (r) => { (r.parts[0] as unknown as Record<string, unknown>).volume = 1; }), "/parts/0/volume", "unknown property (typo of volume_mm3)"],
  ["geometry-report", with_(report, (r) => { r.parts[0]!.bbox.min = [0, 0] as unknown as [number, number, number]; }), "/parts/0/bbox/min", "vec3 with two numbers"],
  ["geometry-report", with_(report, (r) => { (r.fits[0] as unknown as Record<string, unknown>).kind = "overlap"; }), "/fits/0/kind", "fit kind outside clash, contact, clearance"],
  ["geometry-report", with_(report, (r) => { (r.fits[0] as unknown as Record<string, unknown>).confidence = "sure"; }), "/fits/0/confidence", "unknown confidence label"],
  ["geometry-report", with_(report, (r) => { r.rev = "rev-2"; }), "/rev", "rev without the r_ prefix"],
  ["geometry-report", with_(report, (r) => { r.parts[0]!.volume_mm3 = Number.NaN; }), "/parts/0/volume_mm3", "NaN is not a JSON number"],
  ["script-error", { code: "bad code", message: "x" }, "/code", "code must be UPPER_SNAKE"],
  ["script-error", { code: "SCRIPT_RUNTIME", message: "x", line: 0 }, "/line", "line numbers start at 1"],
  ["compute", { backend: "cpu.wasm", device: "cpu" }, "", "placement_reason missing"],
  ["compute", { backend: "CPU WASM", device: "cpu", placement_reason: "x" }, "/backend", "backend id format"],
  ["device-inventory", with_(devices, (d) => { d.cpu.cores = 0; }), "/cpu/cores", "zero cores"],
  ["provenance", with_(provenance, (p) => { p.args_hash = "short"; }), "/args_hash", "hash must be sha256 hex"],
  ["project", with_(project, (p) => { (p as unknown as Record<string, unknown>).units = "inch"; }), "/units", "units are mm only"],
  ["assembly", with_(assembly, (a) => { a.definitions["Bad-Name"] = { kind: "script" }; }), "/definitions/Bad-Name", "definition ids are snake_case"],
  ["assembly", with_(assembly, (a) => { a.definitions.enclosure!.occurrences![0]!.transform.q = [0, 0, 1] as unknown as [number, number, number, number]; }), "/definitions/enclosure/occurrences/0/transform/q", "quaternion needs four numbers"],
  ["assembly", with_(assembly, (a) => { (a.definitions.base as unknown as Record<string, unknown>).kind = "part"; }), "/definitions/base/kind", "unknown definition kind"],
  ["tool-run-input", { project: "p.o3j" }, "", "neither script nor ops"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "explode" }] }, "/ops/0/op", "op not in the S1 subset"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "set_transform", target: "a#1", transform: { t: [0, 0, 0], q: [0, 0, 0, 1] } }] }, "/ops/0", "set_transform is an S2 op"],
  ["tool-run-input", { project: "p.o3j", script: "x", params: { s: "y".repeat(4097) } }, "/params/s", "param strings are bounded"],
  ["tool-run-input", { project: "p.o3j", script: "x", compute: "quantum" }, "/compute", "unknown compute mode"],
  ["tool-inspect-input", { fields: ["dof"] }, "/fields/0", "dof is an S4 field"],
  ["tool-inspect-input", { fields: [] }, "/fields", "at least one field"],
  ["tool-inspect-output", with_(inspectJob, (o) => { (o.job as unknown as Record<string, unknown>).state = "paused"; }), "/job/state", "unknown job state"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "cancel_job" }] }, "/ops/0", "cancel_job without job_id"],
  ["tool-render-input", { project: "p.o3j", view: "exploded" }, "/view", "exploded is an S4 view"],
  ["tool-export-input", { project: "p.o3j", format: "urdf" }, "/format", "urdf is an S6 format"],
  ["tool-export-output", with_(exportOut, (o) => { o.files![0]!.sha256 = "zz"; }), "/files/0/sha256", "sha256 format"],
  ["tool-docs-input", { query: "" }, "/query", "empty query"],
];
