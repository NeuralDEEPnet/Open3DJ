// The five tools (C1, ARCHITECTURE.md section 9), S1 subset. Descriptions are written for
// agents: what the tool does, what comes back, and the next useful call.
import { dereferencedSchema } from "@open3dj/schemas";
import type { SchemaObject, ToolName } from "@open3dj/schemas";

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  /** Self-contained JSON Schema (no $ref), as published in tools/list. */
  inputSchema: SchemaObject;
  outputSchema: SchemaObject;
}

const def = (name: ToolName, title: string, description: string): ToolDefinition => ({
  name,
  title,
  description,
  inputSchema: dereferencedSchema(`tool-${name}-input`),
  outputSchema: dereferencedSchema(`tool-${name}-output`),
});

export const TOOL_DEFINITIONS: Readonly<Record<ToolName, ToolDefinition>> = Object.freeze({
  run: def(
    "run",
    "Run a design script",
    "Run a DSL script (3dj dialect, units mm, Z up) or apply assembly ops in a project, and get a concise GeometryReport: validity, volume, bbox and counts per part, clashes and contacts between parts, and next steps. Every design is an assembly; return [{ name, shape }] for several parts. Errors come back as results with line, code, faulty elements and a hint. Pass base_rev from the last result to build on it.",
  ),
  inspect: def(
    "inspect",
    "Inspect a design or this machine",
    "Read details without changing anything: the assembly tree, references, fits, measurements of chosen targets, or the compute devices of this machine (devices needs no project).",
  ),
  render: def(
    "render",
    "Render a four-view drawing",
    "Render the assembly or chosen parts as a deterministic four-view hidden-line drawing (front, top, right, iso) with overall dimensions. Returns a PNG image and the SVG.",
  ),
  export: def(
    "export",
    "Export files",
    "Export the assembly, a sub-assembly or one occurrence as STEP (assembly structure with names), STL (one file per part), glTF (binary .glb) or 3MF. Returns file paths with sizes and sha256.",
  ),
  docs: def(
    "docs",
    "Search the DSL docs",
    "Search the DSL reference, the standard parts library, the error playbook and examples. Paged.",
  ),
});

export const TOOL_NAMES: readonly ToolName[] = ["run", "inspect", "render", "export", "docs"];
