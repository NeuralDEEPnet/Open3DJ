// The five tools (C1, ARCHITECTURE.md section 9), S1 subset. Descriptions are written for
// agents: what the tool does, what comes back, and the next useful call.
import { dereferencedSchema } from "@open3dj/schemas";
import type { SchemaObject, ToolName } from "@open3dj/schemas";

/** MCP tool annotations: hints for clients, never a security boundary. */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  /** Self-contained JSON Schema (no $ref), as published in tools/list. */
  inputSchema: SchemaObject;
  /**
   * The output's top-level shape, as published in tools/list. Nested objects are only typed
   * here; the full schemas in @open3dj/schemas (tool-<name>-output) describe them and
   * validate every result in the tests. This keeps tools/list small in every agent's context.
   */
  outputSchema: SchemaObject;
  annotations: ToolAnnotations;
}

// Nothing reaches the network (openWorld false) and nothing deletes user files (run adds a
// revision; render and export overwrite only their own output files).
const writes = (idempotent: boolean): ToolAnnotations => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });
const reads: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const def = (name: ToolName, title: string, description: string, annotations: ToolAnnotations): ToolDefinition => ({
  name,
  title,
  description,
  inputSchema: dereferencedSchema(`tool-${name}-input`),
  outputSchema: slimSchema(dereferencedSchema(`tool-${name}-output`)),
  annotations,
});

export const TOOL_DEFINITIONS: Readonly<Record<ToolName, ToolDefinition>> = Object.freeze({
  run: def(
    "run",
    "Run a design script",
    "Run a DSL script (3dj dialect, units mm, Z up) or apply assembly ops in a project, and get a concise GeometryReport: validity, volume, bbox and counts per part, clashes and contacts between parts, and next steps. Every design is an assembly; return [{ name, shape }] for several parts. Errors come back as results with line, code, faulty elements and a hint. Pass base_rev from the last result to build on it; a stale base_rev returns REV_CONFLICT. params set Param values and are saved as the project's working values: later runs of the same script, and set_param, keep them until changed. A script that differs from the project's stored one starts from its own defaults plus the params passed, and the report warns which stored values it did not use. S1 ops: set_param (re-runs the stored script), and cancel_job for a run that returned status queued with a job_id.",
    writes(false),
  ),
  inspect: def(
    "inspect",
    "Inspect a design or this machine",
    "Read details without changing anything: the assembly tree, references, fits, measurements of chosen targets, or the compute devices of this machine (devices needs no project). fields: tree, refs, fits, measure (with targets), devices, job (with job_id, to poll a queued run).",
    reads,
  ),
  render: def(
    "render",
    "Render a four-view drawing",
    "Render the assembly or chosen parts as a deterministic four-view hidden-line drawing (front, top, right, iso) with overall dimensions. Returns the PNG as image content (format png, the default), the SVG as an embedded resource (format svg), or both, and writes them under out/<rev>/ in the project.",
    writes(true),
  ),
  export: def(
    "export",
    "Export files",
    "Export the assembly, a sub-assembly or one occurrence as STEP (assembly structure with names), STL (one file per part), glTF (binary .glb) or 3MF. Files go to out/<rev>/ in the project (or out_dir, relative to the project) with an evidence sidecar. Returns file paths with sizes and sha256.",
    writes(true),
  ),
  docs: def(
    "docs",
    "Search the DSL docs",
    "Search the DSL reference, the standard parts library, the error playbook, worked examples and the gallery examples. Paged, five hits per page. Start here before writing a script: query \"entries\" lists every entry, an entry name gives its signature and an example, an error code gives its fix.",
    reads,
  ),
});

export const TOOL_NAMES: readonly ToolName[] = ["run", "inspect", "render", "export", "docs"];

/**
 * The top level of an object schema: each property keeps its type, enum or const and its
 * description; a nested object or array keeps only its type. Never stricter than the full schema.
 */
export function slimSchema(full: SchemaObject): SchemaObject {
  const out: SchemaObject = { type: "object" };
  for (const k of ["title", "description", "required"] as const) if (full[k] !== undefined) out[k] = full[k];
  const props = (full.properties ?? {}) as Record<string, SchemaObject>;
  const slim: Record<string, SchemaObject> = {};
  for (const [name, p] of Object.entries(props)) {
    const q: SchemaObject = {};
    if (typeof p.description === "string") q.description = p.description;
    if (p.enum !== undefined) q.enum = p.enum;
    else if (p.const !== undefined) q.const = p.const;
    else if (p.type !== undefined) q.type = p.type;
    else if (p.properties !== undefined) q.type = "object";
    else if (p.items !== undefined) q.type = "array";
    slim[name] = q;
  }
  out.properties = slim;
  return out;
}

/** One tool as tools/list publishes it. */
export type ListedTool = Pick<ToolDefinition, "name" | "title" | "description" | "inputSchema" | "outputSchema" | "annotations">;

/** The tools as tools/list publishes them. `open3dj tools` prints this (CLI parity). */
export function toolList(): ListedTool[] {
  return TOOL_NAMES.map((n) => {
    const { name, title, description, inputSchema, outputSchema, annotations } = TOOL_DEFINITIONS[n];
    return { name, title, description, inputSchema, outputSchema, annotations };
  });
}
