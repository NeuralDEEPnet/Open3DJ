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
  area_mm2: number;
  mass_g?: number;
  bbox: BBox;
  center_of_mass: Vec3;
  counts: { solids: number; faces: number; edges: number };
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
}

export type RefState = "exact" | "re-resolved" | "disambiguated" | "ambiguous" | "broken";

export interface RefReport {
  name: string;
  state: RefState;
  candidates?: string[];
  reason?: string;
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

export type RunOp =
  | { op: "add_occurrence"; def: string; name?: string; parent?: string; transform?: Transform; fixed?: boolean }
  | { op: "remove"; target: string }
  | { op: "set_transform"; target: string; transform: Transform }
  | { op: "set_param"; name: string; value: ParamValue }
  | { op: "replace_definition"; target: string; def: string };

export interface RunInput {
  project: string;
  base_rev?: Rev;
  script?: string;
  params?: Record<string, ParamValue>;
  ops?: RunOp[];
  compute?: ComputeMode;
  detail?: "concise" | "detailed";
}

export interface RunOutput {
  status: "ok" | "warning" | "error" | "queued";
  rev?: Rev;
  report?: GeometryReport;
  error?: ScriptError;
  job_id?: string;
  compute: ComputeBlock;
}

export type InspectField = "tree" | "refs" | "fits" | "measure" | "devices";

export interface InspectInput {
  project?: string;
  rev?: Rev;
  fields: InspectField[];
  targets?: string[];
  detail?: "concise" | "detailed";
  compute?: ComputeMode;
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
  devices?: DeviceInventory;
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
}
