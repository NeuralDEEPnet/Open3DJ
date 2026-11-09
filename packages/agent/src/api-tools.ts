// The five Open3DJ tools as Messages API tool entries ({name, description, input_schema}),
// made from the MCP tool definitions, so both paths describe the same tools (RFC 0001,
// Engine A). The Messages API wants an object schema without a top-level anyOf, oneOf or
// allOf; the handlers still check the full schema, so nothing is lost by dropping them here.
// The viewer pins one project, so project is not offered to the model, and withProject()
// puts it back on every call.
import { TOOL_DEFINITIONS, noJob, toolResult } from "@open3dj/mcp";
import type { CallResult } from "@open3dj/mcp";
import type { ToolName } from "@open3dj/schemas";

/** One tool entry of a Messages API request. */
export interface ApiTool {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The order the tools are sent in. It never changes, so the tools part of every request is
 * the same bytes and prompt caching can reuse it.
 */
export const API_TOOL_ORDER: readonly ToolName[] = Object.freeze(["run", "inspect", "render", "export", "docs"] as const);

/** The tools that take a project. The engine fills it in; docs has none. */
export const PINNED_TOOLS: readonly ToolName[] = Object.freeze(["run", "inspect", "render", "export"] as const);

const DROPPED = new Set(["$schema", "$id", "title"]);
const COMBINATORS = new Set(["anyOf", "oneOf", "allOf"]);

/** The Messages API tool entries, in API_TOOL_ORDER. Each call returns new objects with the same bytes. */
export function apiTools(): ApiTool[] {
  return API_TOOL_ORDER.map(apiTool);
}

function apiTool(name: ToolName): ApiTool {
  const def = TOOL_DEFINITIONS[name];
  const source = structuredClone(def.inputSchema) as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (DROPPED.has(key)) continue;
    if (COMBINATORS.has(key)) notes.push(describeCombinator(name, key, value));
    else schema[key] = value;
  }
  if (PINNED_TOOLS.includes(name)) unpin(schema);
  return { name, description: [def.description, ...notes].join(" "), input_schema: schema };
}

/**
 * A top-level anyOf whose branches each require one field (run: script or ops) becomes one
 * sentence of the description. Any other shape stops here, so a schema change cannot drop a
 * rule without a test noticing.
 */
function describeCombinator(tool: ToolName, key: string, value: unknown): string {
  const branches = Array.isArray(value) ? value : [];
  const fields = branches.map((b) => {
    const req = (b as { required?: unknown }).required;
    const only = Object.keys(b as object).length === 1 && Array.isArray(req) && req.length === 1 && typeof req[0] === "string";
    return only ? (req[0] as string) : undefined;
  });
  if (key !== "anyOf" || fields.length < 2 || fields.some((f) => f === undefined)) {
    throw new Error(`apiTools: the ${tool} input schema has a top-level ${key} that the Messages API mapping cannot describe; describe it in packages/agent/src/api-tools.ts`);
  }
  return `Pass ${(fields as string[]).join(" or ")}: at least one is required.`;
}

function unpin(schema: Record<string, unknown>): void {
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props) delete props.project;
  if (Array.isArray(schema.required)) {
    const required = (schema.required as unknown[]).filter((r) => r !== "project");
    if (required.length > 0) schema.required = required;
    else delete schema.required;
  }
}

/** The input with the pinned project, or the result that refuses the call. */
export type Pinned = { ok: true; input: Record<string, unknown> } | { ok: false; result: CallResult };

/**
 * Put the pinned project into a tool input from the model. A project the model sent anyway
 * is accepted only when it is the pinned path or the pinned folder's name (which tool
 * results show); anything else is refused with a PATH_REFUSED result, never a throw. Tools
 * without a project (docs, or an unknown name, which callTool refuses) pass unchanged.
 */
export function withProject(name: string, input: unknown, project: string): Pinned {
  const label = project.split(/[\\/]/).filter((s) => s !== "").pop() ?? project;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return refuse("BAD_INPUT", "the tool input must be a JSON object", "Send the tool's arguments as an object, for example {\"query\": \"fillet\"}.");
  }
  const rest = { ...(input as Record<string, unknown>) };
  if (!PINNED_TOOLS.includes(name as ToolName)) return { ok: true, input: rest };
  const sent = rest.project;
  delete rest.project;
  if (sent !== undefined && sent !== project && sent !== label) {
    return refuse("PATH_REFUSED", `this conversation works on ${label} only, and the call named another project`, `Leave project out; Open3DJ fills in ${label}.`);
  }
  return { ok: true, input: { project, ...rest } };
}

function refuse(code: string, message: string, hint: string): Pinned {
  return { ok: false, result: toolResult({ status: "error", error: { code, message, hint }, compute: noJob("refused before any job") }) };
}
