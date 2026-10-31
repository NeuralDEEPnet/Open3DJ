// @open3dj/mcp: the five tool handlers, the .o3j project store and the dual-era stdio MCP
// server. The kernel never loads in this process: geometry runs as jobs on the compute pool,
// whose workers capture their stdout. See README.md for the project layout and the rules.
import type { PackageStatus } from "@open3dj/schemas";

export type * from "./types.ts";
export { TOOL_DEFINITIONS, TOOL_NAMES, toolList } from "./tools.ts";
export type { ToolDefinition, ToolAnnotations, ListedTool } from "./tools.ts";
export { createHandlers, noJob, DEFAULT_INTERACTIVE_MS } from "./handlers.ts";
export { serveStdio, createServer, guardStdout, toolResult, imageContent, INSTRUCTIONS, SERVER_NAME } from "./server.ts";
export { ToolError, toScriptError, redactPaths } from "./errors.ts";
export type { DaemonErrorCode } from "./errors.ts";
export { ProjectStore, FILES, formatRev, revNumber } from "./store.ts";
export type { RevisionRecord, Engine } from "./store.ts";
export { resolveProject, safeSegments } from "./paths.ts";
export type { ProjectDir } from "./paths.ts";
export { DEFAULT_DOCS_FILE, PAGE_SIZE, parseDocs, searchDocs, loadDocs } from "./docs.ts";
export { schemaValidator } from "./validator.ts";
export {
  SELECTION_FILE, HIGHLIGHT_FILE, MAX_VIEW_STATE_BYTES, MAX_HIGHLIGHT_PATHS, MAX_HIGHLIGHT_BYTES,
  buildSelection, writeSelection, readSelection, selectionForAgent, buildHighlight, writeHighlight, readHighlight, faceCounts,
} from "./viewstate.ts";
export type { FaceCount } from "./viewstate.ts";
export { canonicalJson, hashJson, sha256Hex } from "./hash.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";
