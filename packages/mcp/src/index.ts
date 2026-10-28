// @open3dj/mcp: the five tool handlers and the dual-era stdio MCP server.
//
// Intended implementation:
// - createHandlers(): project store (project.o3j.json, assembly.o3j.json, parts/*.o3j.js,
//   provenance.jsonl, out/<rev>/), revisions with base_rev checks, compute placement, and
//   jobs on the pool. Writes files only inside the project folder: relative paths, symlinks
//   resolved, O_NOFOLLOW, no absolute paths in error text (spike path policy).
// - serveStdio(): @modelcontextprotocol/server 2.4.0 serveStdio(factory, { legacy: "serve" }),
//   which answers 2025-era initialize and 2026-07-28 server/discover. Register each tool from
//   TOOL_DEFINITIONS with fromJsonSchema(schema, validator), where the validator adapts
//   @open3dj/schemas validate() (the SDK's default validator needs ajv, which is only a dev
//   dependency here). Return structuredContent plus a JSON text mirror; render adds image
//   content and the SVG as an embedded resource.
// - Before anything else: console.log/info/debug go to stderr. The kernel never loads in
//   this process; it runs in pool workers with captured stdout.
import { NotImplementedError } from "@open3dj/schemas";
import type { PackageStatus } from "@open3dj/schemas";
import type { HandlerDeps, ServeOptions, ToolHandlers } from "./types.ts";

export type * from "./types.ts";
export { TOOL_DEFINITIONS, TOOL_NAMES } from "./tools.ts";
export type { ToolDefinition } from "./tools.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

/** The tool handlers shared by the MCP server and the CLI. */
export function createHandlers(deps: HandlerDeps): ToolHandlers {
  void deps;
  throw new NotImplementedError("mcp.createHandlers");
}

/**
 * Serve the handlers over stdio until stdin closes. Every byte on stdout is a JSON-RPC
 * message; the stdout-leak gate (scripts/leak-gate.ts) checks this in CI.
 */
export async function serveStdio(handlers: ToolHandlers, options?: ServeOptions): Promise<void> {
  void handlers;
  void options;
  throw new NotImplementedError("mcp.serveStdio");
}

/** Send console.log, console.info and console.debug to stderr. Call first in the daemon. */
export function guardStdout(): void {
  throw new NotImplementedError("mcp.guardStdout");
}
