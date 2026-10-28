// TypeScript mirrors of the v0 JSON Schemas in ../json. The JSON Schema files are the
// contract; these types must accept exactly the same documents. The fixtures test
// (schemas.test.ts) types each fixture with these interfaces and validates it with the
// schema, so a drift between the two shows up as a type error or a failed test.

export type Vec3 = [number, number, number];
/** Unit quaternion [x, y, z, w] in glTF order. */
export type Quaternion = [number, number, number, number];
/** RGB, each channel 0 to 1. */
export type Color3 = [number, number, number];

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Translation in mm plus a unit quaternion. No scale and no shear. */
export interface Transform {
  t: Vec3;
  q: Quaternion;
}

export type Confidence = "measured" | "observed" | "inferred" | "assumed";
export type ComputeMode = "auto" | "cpu" | "gpu" | "cloud";
/** Revision id, for example r_0193ab. */
export type Rev = string;

export interface FileRef {
  path: string;
  format: string;
  bytes: number;
  sha256: string;
}

// ---- C5 compute -----------------------------------------------------------------------

export interface ComputeBlock {
  /** cpu.wasm, cpu.subprocess, webgpu.vulkan, sidecar.cuda, cloud.<provider>, ... */
  backend: string;
  device: string;
  placement_reason: string;
  fallback_from?: string;
  cpu_confirmed?: number;
}

export interface DeviceInventory {
  created: string;
  os: { platform: string; release?: string; arch: string };
  runtime: { node: string; open3dj?: string; occt_wasm?: string; brepjs?: string; quickjs?: string };
  cpu: { model?: string; cores: number; arch?: string };
  memory: { total_bytes: number; free_bytes: number };
  gpus: GpuRecord[];
  backends: string[];
  pool?: { workers: number; interactive_reserved?: number; recycle_limit_bytes?: number };
  power?: { ac_connected?: boolean };
  providers?: string[];
}

export interface GpuRecord {
  id: string;
  vendor?: string;
  model?: string;
  vram_bytes?: number;
  shared_memory?: boolean;
  backends?: string[];
}

// ---- C1 reports and errors --------------------------------------------------------------

export interface ScriptError {
  /** UPPER_SNAKE code, for example SCRIPT_RUNTIME, SCRIPT_TIMEOUT, KERNEL_INVALID_RESULT. */
  code: string;
  message: string;
  line?: number;
  column?: number;
  op?: string;
  /** Element addresses such as edge:7 or face:3, optionally prefixed by an occurrence path. */
  elements?: string[];
  hint?: string;
}

export interface GateFailure {
  gate: string;
  value?: number;
  limit?: number;
  at?: string;
  waivable?: "agent" | "human";
}

export interface PartGates {
  pass?: string[];
  fail?: GateFailure[];
}

export interface PartReport {
  /** Definition id. One entry per definition, not per occurrence. */
  def: string;
  occurrences?: number;
  valid: boolean;
  volume_mm3: number;
  /** Detailed reports only. */
  area_mm2?: number;
  mass_g?: number;
  bbox: BBox;
  /** Detailed reports only. */
  center_of_mass?: Vec3;
  /** Detailed reports give all three; concise ones give solids, and only when it is not 1. */
  counts?: { solids: number; faces?: number; edges?: number };
  gates?: PartGates;
}

export type FitKind = "clash" | "contact" | "clearance";

export interface FitReport {
  /** Occurrence paths. */
  a: string;
  b: string;
  kind: FitKind;
  volume_mm3?: number;
  distance_mm?: number;
  confidence: Confidence;
  /** Concise reports: how many identical fits this line stands for (a or b is then a range). */
  n?: number;
  /** Another distinct gap of the pair; the pair's closest relation is the line without extra (or a mated contact, not listed). */
  extra?: true;
}

export type RefState = "exact" | "re-resolved" | "disambiguated" | "ambiguous" | "broken";

/**
 * The geometric fingerprint of a named face or edge (ARCHITECTURE.md section 10), in the
 * frame of its part definition. A later run compares it with the new geometry.
 */
export type RefFingerprint =
  | {
    type: "face";
    /** plane, cylinder, cone, sphere, torus, bspline, ... */
    surface: string;
    area: number;
    centroid: Vec3;
    /** Outward normal of a plane. */
    normal?: Vec3;
    /** Axis of a cylinder, cone or torus (either sense). */
    axis?: Vec3;
    /** Edges bounding the face (adjacency count). */
    edges: number;
    /** Other faces of the same kind, orientation, area and edge count when it was taken (a pattern of holes). */
    twins?: number;
  }
  | {
    type: "edge";
    /** line, circle, ellipse, bspline, ... */
    curve: string;
    length: number;
    centroid: Vec3;
    /** Direction of a line (either sense). */
    direction?: Vec3;
    /** Axis of a circle or ellipse (either sense). */
    axis?: Vec3;
    /** Faces that share the edge (adjacency count). */
    faces: number;
    /** Other edges of the same kind, orientation, length and face count when it was taken. */
    twins?: number;
  };

export interface RefReport {
  /** <definition>.<reference name>, for example bracket.hole. */
  name: string;
  state: RefState;
  /** Element addresses (face:7, edge:12) a broken or ambiguous reference could mean. Never auto-picked. */
  candidates?: string[];
  reason?: string;
  /** The element the reference resolves to when exact. Detailed reports and inspect only. */
  at?: string;
  /** inspect fields=[refs] only. */
  fingerprint?: RefFingerprint;
}

/** A named face or edge stored with its part definition in the assembly graph. */
export interface DefinitionRef {
  name: string;
  type: "face" | "edge";
  state: RefState;
  at?: string;
  candidates?: string[];
  reason?: string;
  fingerprint?: RefFingerprint;
  /**
   * Maps the frame the name was given in to the definition's frame, when the part was moved
   * or turned after withReferences. The next run compares fingerprints in the naming frame,
   * so moving a whole part does not change what a name means.
   */
  frame?: Transform;
}

export interface GeometryReport {
  status: "ok" | "warning" | "error";
  rev: Rev;
  assembly: { occurrences: number; definitions: number; mass_g?: number; bbox?: BBox };
  parts: PartReport[];
  fits: FitReport[];
  refs?: RefReport[];
  compute: ComputeBlock;
  warnings?: string[];
  next?: string[];
}

// ---- C4 project files -------------------------------------------------------------------

export interface ProjectManifest {
  o3j: "0";
  name: string;
  units: "mm";
  up: "Z";
  rev?: Rev;
  /** Author and organisation for exported STEP headers. */
  author?: string;
  organization?: string;
  engine: { open3dj: string; occt_wasm: string; brepjs?: string };
}

export type DefinitionKind = "script" | "lib" | "assembly" | "imported";

export interface Connector {
  name: string;
  origin: Vec3;
  z: Vec3;
  x?: Vec3;
  gender?: "male" | "female" | "none";
  type?: string;
  /** Named reference, "literal" or "implicit". */
  anchor?: string;
}

export interface Occurrence {
  id: string;
  /** Instance name, for example bracket#1. */
  name: string;
  def: string;
  transform: Transform;
  fixed?: boolean;
  suppressed?: boolean;
  bom?: boolean;
  color?: Color3;
}

export interface Definition {
  kind: DefinitionKind;
  name?: string;
  partNumber?: string;
  script?: string;
  export?: string;
  lib?: string;
  params?: Record<string, unknown>;
  file?: string;
  geometry_hash?: string;
  shared_by?: "measured" | "inferred";
  color?: Color3;
  connectors?: Connector[];
  /** Named faces and edges (withReferences) with their fingerprints and resolution state. */
  refs?: DefinitionRef[];
  /** Children, for assembly-kind definitions only. */
  occurrences?: Occurrence[];
}

export interface Mate {
  id: string;
  type: "fastened";
  a: string;
  b: string;
  flip?: boolean;
  owner: "script" | "graph";
}

export interface AssemblyFile {
  o3j: "0";
  root: string;
  definitions: Record<string, Definition>;
  mates?: Mate[];
}

export interface ProvenanceLine {
  ts: string;
  tool: ToolName;
  args_hash: string;
  result_hash: string;
  base_rev?: Rev;
  rev?: Rev;
  engine: { open3dj: string; occt_wasm: string; brepjs?: string; quickjs?: string };
  device_inventory_hash: string;
  compute: ComputeBlock;
  approvals?: string[];
}

// ---- C1 tools (S1 subset) ---------------------------------------------------------------

export type ToolName = "run" | "inspect" | "render" | "export" | "docs";
export type ParamValue = number | string | boolean;

/** The S1 ops. add_occurrence, remove, set_transform and replace_definition arrive in S2. */
export type RunOp =
  | { op: "set_param"; name: string; value: ParamValue }
  | { op: "cancel_job"; job_id: string };

export interface RunInput {
  project: string;
  base_rev?: Rev;
  script?: string;
  params?: Record<string, ParamValue>;
  /** false: run with params but keep the working copy's params.o3j.json as it was. Default true. */
  save_params?: boolean;
  ops?: RunOp[];
  compute?: ComputeMode;
  detail?: "concise" | "detailed";
}

/** The report inside a run result: status, rev and compute sit next to it, once. */
export type RunReport = Omit<GeometryReport, "status" | "rev" | "compute">;

export interface RunOutput {
  status: "ok" | "warning" | "error" | "queued";
  rev?: Rev;
  report?: RunReport;
  error?: ScriptError;
  job_id?: string;
  compute: ComputeBlock;
}

export type InspectField = "tree" | "refs" | "fits" | "measure" | "devices" | "job";

export interface InspectInput {
  project?: string;
  rev?: Rev;
  fields: InspectField[];
  targets?: string[];
  job_id?: string;
  detail?: "concise" | "detailed";
  compute?: ComputeMode;
}

export type JobState = "queued" | "running" | "deferred" | "awaiting_approval" | "done" | "failed" | "cancelled";

/** Minimal job model (S1). Long work returns job_id; agents poll with inspect fields=[job]. */
export interface JobStatus {
  job_id: string;
  kind: string;
  state: JobState;
  progress?: { done: number; total: number; unit: string };
  attempts?: Array<{ backend: string; device: string; outcome: "ok" | "failed" | "cancelled" | "fallback"; reason?: string }>;
  reason?: string;
  rev?: Rev;
  /** A finished run job: the output run would have returned (report, or error with line and hint). */
  result?: RunOutput;
}

export interface TreeNode {
  path: string;
  def: string;
  kind: DefinitionKind;
  transform?: Transform;
  children?: number;
}

export interface InspectOutput {
  status: "ok" | "error";
  rev?: Rev;
  tree?: TreeNode[];
  refs?: RefReport[];
  fits?: FitReport[];
  measure?: PartReport[];
  /** World bounding boxes of the targeted part occurrences (with measure and targets). */
  placements?: Array<{ path: string; def: string; bbox: BBox }>;
  devices?: DeviceInventory;
  job?: JobStatus;
  error?: ScriptError;
  compute: ComputeBlock;
}

export type RenderView = "multiview";
export type RenderFormat = "png" | "svg" | "both";

export interface RenderInput {
  project: string;
  rev?: Rev;
  view: RenderView;
  targets?: string[];
  format?: RenderFormat;
  width?: number;
  height?: number;
  compute?: ComputeMode;
}

export interface RenderOutput {
  status: "ok" | "error";
  rev?: Rev;
  view?: RenderView;
  targets?: string[];
  files?: FileRef[];
  error?: ScriptError;
  compute: ComputeBlock;
}

export type ExportFormat = "step" | "stl" | "gltf" | "3mf";

export interface ExportInput {
  project: string;
  rev?: Rev;
  format: ExportFormat;
  scope?: string;
  out_dir?: string;
  compute?: ComputeMode;
}

export interface ExportOutput {
  status: "ok" | "error";
  rev?: Rev;
  files?: FileRef[];
  warnings?: string[];
  error?: ScriptError;
  compute: ComputeBlock;
}

export interface DocsInput {
  query: string;
  page?: number;
}

export interface DocsHit {
  title: string;
  kind: "dsl" | "lib" | "error" | "example";
  text: string;
  ref?: string;
}

export interface DocsOutput {
  query: string;
  page: number;
  pages: number;
  hits: DocsHit[];
  /** A docs call with bad input: the problem, so an empty hit list is not read as "nothing documented". */
  error?: ScriptError;
}
