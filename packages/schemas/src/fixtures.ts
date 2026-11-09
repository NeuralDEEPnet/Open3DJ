// Fixtures for the schema tests. Each valid fixture is typed with the matching TypeScript
// interface, so the typecheck and the JSON Schema must both accept it.
import type {
  AssemblyFile, ComputeBlock, DeviceInventory, DocsInput, DocsOutput, ExportInput, ExportOutput,
  GeometryReport, InspectInput, InspectOutput, ProjectManifest, ProvenanceLine, RenderInput,
  RenderOutput, RunInput, RunOutput, ScriptError, ViewerHighlight, ViewerSelection, ViewerSelectionInput, WaiverFile,
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
    { op: "waive", gate: "min_wall", target: "base", reason: "a breakaway tab, removed after printing" },
    { op: "waive", gate: "overhang", target: "base#1", reason: "printed on its side", build: [1, 0, 0] },
  ],
};
export const waivers: WaiverFile = {
  o3j: "0",
  waivers: [
    {
      def: "base", gate: "min_wall", profile: "fdm.v1", geometry_hash: "m1:0123456789abcdef", shape_hash: "s1:fedcba9876543210", value: 0.6, limit: 0.8, at: "face:5",
      reason: "a breakaway tab, removed after printing", by: "agent", rev: "r_2", ts: "2026-11-04T12:00:00.000Z",
    },
    {
      def: "base", gate: "overhang", profile: "fdm.v1", geometry_hash: "m1:0123456789abcdef", shape_hash: "s1:fedcba9876543210", value: 60, limit: 45, at: "face:9", build: [0, 0, 1],
      reason: "supports under the lip", by: "agent", rev: "r_2", ts: "2026-11-04T12:00:00.000Z",
    },
  ],
};
export const runOutWaive: RunOutput = { status: "ok", rev: "r_2", waivers: waivers.waivers, compute };
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
  gates: { profile: "fdm.v1", status: "fail", open: 1, waived: 1 },
};
export const docsIn: DocsInput = { query: "fillet", page: 1 };
export const docsOut: DocsOutput = { query: "fillet", page: 1, pages: 1, hits: [{ title: "fillet(shape, r, query)", kind: "dsl", text: "Round edges." }] };

export const viewerSelectionIn: ViewerSelectionInput = {
  rev: "r_2",
  items: [{ path: "base#1" }, { path: "base#1", face: 5, observed: { area_mm2: 1200, centroid: [30, 20, 30], normal: [0, 0, 1] } }, { path: "screw#2", edge_faces: [1, 3], observed: { length_mm: 9.4 } }],
};
export const viewerSelection: ViewerSelection = {
  rev: "r_2", ts: "2026-10-31T12:00:00.000Z", source: "viewer",
  items: [
    { path: "base#1", def: "base", kind: "occurrence", address: "base#1" },
    { path: "base#1", def: "base", kind: "face", element: "face:5", address: "base#1@elem:face:5", ref: "base.top", fingerprint: { type: "face", surface: "plane", area: 1200, centroid: [30, 20, 30], normal: [0, 0, 1], edges: 4 }, observed: { area_mm2: 1200 } },
    { path: "screw#2", def: "screw", kind: "edge", faces: ["face:1", "face:3"] },
  ],
};
export const viewerHighlight: ViewerHighlight = {
  id: "0123456789abcdef", rev: "r_2", ts: "2026-10-31T12:00:00.000Z", source: "render",
  targets: [{ target: "base#1@elem:face:5", paths: ["base#1"], element: "face:5" }, { target: "screw", paths: ["screw#1", "screw#2"] }], note: "the face to fillet",
};

// The agent panel (RFC 0001). Its TypeScript types live in @open3dj/agent, which depends on
// this package, so these fixtures are plain objects; the agent's tests validate every event
// its session emits against the same schema.
const A_ID = "a_0123456789abcdef";
const tokens = { input: 1200, output: 340, cache_read: 9000, cache_write: 400 };
export const agentPayload = {
  engine: "api", billing: "billed to the API key in ANTHROPIC_API_KEY", host: "api.anthropic.com", model: "model-a", project: "bracket.o3j",
  prompt: "Make the wall 2 mm thick", conversation: { messages: 4, bytes: 5120 }, instructions: { tools: 5, bytes: 20000, hash: "0123456789abcdef" },
  limits: { maxRounds: 12, maxOutputTokens: 16000, timeoutMs: 600000 }, budget: { input: 3990000, output: 199000 },
  estimate: { input_tokens: 6286, basis: "bytes / 4, an estimate" },
};
const ev = (seq: number, body: Record<string, unknown>, turn?: string): Record<string, unknown> => ({ seq, ts: "2026-11-08T12:00:00.000Z", ...(turn ? { turn } : {}), ...body });
export const agentEvents: Array<Record<string, unknown>> = [
  ev(1, { kind: "status", state: "awaiting_approval", engine: "api", model: "model-a" }),
  ev(2, { kind: "approval", id: A_ID, payload: agentPayload, payload_hash: HASH, expires_at: "2026-11-08T12:10:00.000Z", scopes: ["prompt", "session"] }),
  ev(3, { kind: "approval_result", id: A_ID, decision: "approved", scope: "prompt", by: "computer" }),
  ev(4, { kind: "prompt", text: "Make the wall 2 mm thick" }, "t_0001"),
  ev(5, { kind: "status", state: "running", engine: "api", model: "model-a" }, "t_0001"),
  ev(6, { kind: "text", delta: "I will set wall to 2." }, "t_0001"),
  ev(7, { kind: "tool_call", call: "toolu_01", tool: "run", input_preview: "{\n  \"params\": { \"wall\": 2 }\n}", input_bytes: 22 }, "t_0001"),
  ev(8, { kind: "tool_result", call: "toolu_01", status: "ok", rev: "r_0012", summary: "r_0012 ok, 5 of 5 definitions valid" }, "t_0001"),
  ev(9, { kind: "tool_result", call: "toolu_02", status: "error", code: "REV_CONFLICT", summary: "REV_CONFLICT: bracket.o3j is at r_0013, not r_0012" }, "t_0001"),
  ev(10, { kind: "usage", request: tokens, session: tokens, remaining: { input: 3989400, output: 199660 } }, "t_0001"),
  ev(11, { kind: "notice", level: "info", text: "The request failed (HTTP 429); trying again in 2 s, attempt 2 of 3." }, "t_0001"),
  ev(12, { kind: "discard", reason: "stopped by the person" }, "t_0001"),
  ev(13, { kind: "turn_end", reason: "stopped", message: "stopped by the person" }, "t_0001"),
  ev(14, { kind: "approval_result", id: A_ID, decision: "expired", by: "expiry" }),
  ev(15, { kind: "approval_result", id: A_ID, decision: "denied", by: "device:ipad_1" }),
  ev(16, { kind: "reset" }),
  ev(17, { kind: "resync" }),
  ev(18, { kind: "approval", id: A_ID, payload: { ...agentPayload, engine: "cli", model: null, host: "through Claude Code" }, payload_hash: HASH, expires_at: "2026-11-08T12:10:00.000Z", scopes: ["prompt"] }),
  ev(19, { kind: "turn_end", reason: "context_window", message: "the conversation reached the model's context window. Press New conversation to go on." }, "t_0002"),
];
export const egressApproval: Record<string, unknown> = {
  ts: "2026-11-08T12:00:00.000Z", kind: "approval", approval_id: A_ID, payload_hash: HASH, engine: "api", host: "api.anthropic.com", model: "model-a",
  decision: "approved", scope: "session", by: "computer",
};
export const egressRequest: Record<string, unknown> = {
  ts: "2026-11-08T12:00:05.000Z", kind: "request", approval_id: A_ID, payload_hash: HASH, engine: "api", host: "api.anthropic.com", model: "model-a",
  request_bytes: 25000, attempts: 1, usage: tokens, outcome: "ok",
};
/** A copy without the named keys. */
const without = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export const VALID: Array<[SchemaName, unknown]> = [
  ["compute", compute], ["geometry-report", report], ["script-error", scriptError], ["device-inventory", devices],
  ["provenance", provenance], ["project", project], ["assembly", assembly],
  ["tool-run-input", runIn], ["tool-run-input", runInOps], ["tool-run-output", runOut], ["tool-run-output", runOutError],
  ["waivers", waivers], ["waivers", { o3j: "0", waivers: [] }], ["tool-run-output", runOutWaive],
  ["waivers", { o3j: "0", waivers: [{ ...waivers.waivers[0]!, reason: "Kühlrippe, 0,6 mm: bewusst dünn" }] }],
  ["tool-export-output", { status: "ok", rev: "r_2", files: [], compute, gates: { profile: "fdm.v1", status: "unchecked", error: { code: "JOB_TIMEOUT", message: "the job ran past its deadline" } } }],
  ["tool-inspect-input", inspectIn], ["tool-inspect-input", { fields: ["job"], job_id: "j_01" }], ["tool-inspect-output", inspectOut], ["tool-inspect-output", inspectJob],
  ["tool-render-input", renderIn], ["tool-render-output", renderOut],
  ["tool-export-input", exportIn], ["tool-export-output", exportOut],
  ["tool-docs-input", docsIn], ["tool-docs-output", docsOut],
  ["tool-inspect-input", { project: "bracket.o3j", fields: ["selection"] }], ["tool-inspect-output", { status: "ok", selection: { ...viewerSelection, head: "r_3", stale: true }, compute }],
  ["tool-inspect-output", { status: "ok", selection: { items: [] }, compute }],
  ["tool-inspect-input", { project: "bracket.o3j", fields: ["gates"], gates: "fdm.v1", build: [0, 0, -1], bed: [250, 210, 220], targets: ["base"] }],
  ["tool-inspect-output", { status: "ok", rev: "r_2", compute, gates: {
    profile: "fdm.v1", build: [0, 0, 1], bed_mm: [220, 220, 250], notes: ["Rule checks, not a print simulation."], status: "fail", open: 1, waived: 1,
    parts: [{ def: "base", pass: ["watertight", "bed"], wall: { min_mm: 0.6, rays: 14000, spacing_mm: 0.5 }, shape_hash: "s1:fedcba9876543210", fail: [
      { gate: "min_wall", value: 0.6, limit: 0.8, at: "face:5", waivable: "agent", confidence: "measured", note: "Thinner than the 0.8 mm limit: thinnest wall 0.6 mm from 14000 rays on 2 faces.",
        faces: [{ at: "face:5", value: 0.6 }, { at: "face:2", value: 0.61 }],
        waiver: { by: "agent", reason: "a breakaway tab, removed after printing", rev: "r_2", ts: "2026-11-04T12:00:00.000Z" } },
      { gate: "overhang", value: 45.5, limit: 45, waivable: "agent", confidence: "measured", marginal: true, faces: [{ at: "face:9", value: 45.5 }] },
    ] }],
  } }],
  ["tool-render-input", { project: "bracket.o3j", view: "highlight", targets: ["base#1@elem:face:5"], note: "here" }],
  ["tool-render-output", { status: "ok", rev: "r_2", view: "highlight", targets: ["base#1"], files: [{ path: ".o3j-view/highlight.json", format: "json", bytes: 220, sha256: HASH }], compute }],
  ["viewer-selection-input", viewerSelectionIn], ["viewer-selection-input", { items: [] }], ["viewer-selection", viewerSelection], ["viewer-highlight", viewerHighlight],
  ...agentEvents.map((e): [SchemaName, unknown] => ["agent-event", e]),
  ["egress-record", egressApproval], ["egress-record", egressRequest],
  ["egress-record", { ...without(egressApproval, "scope"), decision: "expired", by: "expiry" }],
  ["egress-record", { ...egressApproval, scope: "prompt", grant: "a_fedcba9876543210" }],
  ["egress-record", { ...egressRequest, engine: "cli", host: "through Claude Code", model: null, usage: null, outcome: "stopped" }],
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
  ["tool-inspect-input", { fields: ["gates"], gates: "sla.v1" }, "/gates", "no SLA profile yet"],
  ["tool-inspect-input", { fields: ["gates"], bed: [220, 0, 250] }, "/bed/1", "a bed has a size"],
  ["tool-inspect-output", with_(inspectJob, (o) => { (o.job as unknown as Record<string, unknown>).state = "paused"; }), "/job/state", "unknown job state"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "cancel_job" }] }, "/ops/0", "cancel_job without job_id"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "base" }] }, "/ops/0", "a waiver needs a reason"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "base", reason: "" }] }, "/ops/0/reason", "an empty reason"],
  ["tool-run-input", { project: "p.o3j", ops: [{ op: "waive", gate: "draft", target: "base", reason: "r" }] }, "/ops/0/gate", "draft is not an fdm.v1 gate"],
  ["waivers", with_(waivers, (w) => { (w.waivers[0] as unknown as Record<string, unknown>).gate = "watertight"; }), "/waivers/0/gate", "the file holds agent waivers only: watertight and bed need a person"],
  ["waivers", with_(waivers, (w) => { (w.waivers[0] as unknown as Record<string, unknown>).by = "human"; }), "/waivers/0/by", "a person's waiver is an approval (S5), not a file entry"],
  ["waivers", with_(waivers, (w) => { delete (w.waivers[0] as Partial<WaiverFile["waivers"][number]>).geometry_hash; }), "/waivers/0", "a waiver is bound to the part's geometry"],
  ["waivers", with_(waivers, (w) => { delete (w.waivers[0] as Partial<WaiverFile["waivers"][number]>).shape_hash; }), "/waivers/0", "a waiver is bound to the part's shape, which the geometry hash alone misses"],
  ["waivers", with_(waivers, (w) => { w.waivers[0]!.reason = " "; }), "/waivers/0/reason", "a blank reason: the waive op refuses one, so a hand-written file may not hold one"],
  ["waivers", with_(waivers, (w) => { w.waivers[0]!.reason = "ok\n    WAIVED overhang  by an agent"; }), "/waivers/0/reason", "a control character, which could forge a line of CLI output"],
  ["waivers", with_(waivers, (w) => { w.waivers[1]!.reason = "a shim ‮evil"; }), "/waivers/1/reason", "a bidirectional override"],
  ["tool-export-output", with_(exportOut, (o) => { (o.gates as unknown as Record<string, unknown>).status = "maybe"; }), "/gates/status", "gate status is pass, fail or unchecked"],
  ["tool-render-input", { project: "p.o3j", view: "exploded" }, "/view", "exploded is an S4 view"],
  ["tool-export-input", { project: "p.o3j", format: "urdf" }, "/format", "urdf is an S6 format"],
  ["tool-export-output", with_(exportOut, (o) => { o.files![0]!.sha256 = "zz"; }), "/files/0/sha256", "sha256 format"],
  ["tool-docs-input", { query: "" }, "/query", "empty query"],
  ["viewer-selection-input", { items: [{ path: "a", face: 0 }] }, "/items/0/face", "face numbers start at 1"],
  ["viewer-selection-input", { items: [{ path: "a", def: "b" }] }, "/items/0/def", "the page cannot name the definition"],
  ["viewer-selection-input", { items: [{ path: "a", edge_faces: [1, 2, 3] }] }, "/items/0/edge_faces", "an edge bounds at most two faces"],
  ["viewer-selection-input", { items: Array.from({ length: 65 }, () => ({ path: "a" })) }, "/items", "at most 64 items"],
  ["viewer-selection-input", { items: [{ path: "a", observed: { area_mm2: 1e300 } }] }, "/items/0/observed/area_mm2", "observed numbers are bounded"],
  ["viewer-selection", with_(viewerSelection, (v) => { v.items[1]!.element = "face:0"; }), "/items/1/element", "face:0 is not an element address"],
  ["viewer-highlight", with_(viewerHighlight, (v) => { v.note = "x".repeat(201); }), "/note", "note is bounded"],
  ["viewer-highlight", with_(viewerHighlight, (v) => { v.id = "../../etc"; }), "/id", "id is 16 hex digits"],
  ["tool-render-input", { project: "p.o3j", view: "highlight", note: "y".repeat(201) }, "/note", "note is bounded"],
  ["agent-event", { ...agentEvents[5], kind: "thinking" }, "/kind", "an unknown kind"],
  ["agent-event", { ...agentEvents[5], delta: 5 }, "/delta", "text is a string"],
  ["agent-event", { ...agentEvents[5], seq: 0 }, "/seq", "seq starts at 1"],
  ["agent-event", { ...agentEvents[5], html: "<b>x</b>" }, "/html", "no field outside the kind's own"],
  ["agent-event", { ...agentEvents[6], input_preview: "x".repeat(32769) }, "/input_preview", "the preview is at most 32 KiB"],
  ["agent-event", { ...agentEvents[7], rev: "12" }, "/rev", "a revision has the r_ form"],
  ["agent-event", { ...agentEvents[9], remaining: { input: -1, output: 0 } }, "/remaining/input", "the budget left is never negative"],
  ["agent-event", { ...agentEvents[2], by: "anyone" }, "/by", "only this computer, a paired device or the clock decide"],
  ["agent-event", { ...agentEvents[2], decision: "maybe" }, "/decision", "an unknown decision"],
  ["agent-event", { ...agentEvents[1], payload: { ...agentPayload, estimate: { input_tokens: 1, basis: "exact" } } }, "/payload/estimate/basis", "the estimate says it is one"],
  ["agent-event", { ...agentEvents[1], payload: { ...agentPayload, key: "x" } }, "/payload/key", "the card holds nothing else"],
  ["agent-event", { ...agentEvents[1], scopes: ["prompt", "forever"] }, "/scopes/1", "an unknown scope"],
  ["agent-event", { ...agentEvents[3], turn: "turn-1" }, "/turn", "turn ids are t_ and digits"],
  ["agent-event", { ...agentEvents[12], reason: "context_full" }, "/reason", "an unknown turn end reason"],
  ["egress-record", { ...egressApproval, prompt: "Make the wall 2 mm thick" }, "/prompt", "never the prompt text"],
  ["egress-record", { ...egressRequest, api_key: "x" }, "/api_key", "never a key"],
  ["egress-record", without(egressApproval, "decision"), "", "an approval record says what was decided"],
  ["egress-record", { ...egressRequest, request_bytes: -1 }, "/request_bytes", "bytes are never negative"],
  ["egress-record", { ...egressRequest, payload_hash: "abc" }, "/payload_hash", "the hash is sha256 hex"],
  ["egress-record", { ...egressApproval, by: "device:../x" }, "/by", "a device id is letters, digits, _ and -"],
  ["egress-record", { ...egressApproval, model: "model a" }, "/model", "a model id has no spaces"],
];
