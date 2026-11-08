// The dual-era stdio server. @modelcontextprotocol/server 2.4.0 serveStdio() answers
// 2025-era initialize (2025-06-18, 2025-11-25) and 2026-07-28 server/discover from one
// factory (legacy: "serve"). Tools are registered from TOOL_DEFINITIONS, so tools/list
// publishes exactly the schemas in @open3dj/schemas, and the same schemas validate input.
import { Console } from "node:console";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio as sdkServeStdio } from "@modelcontextprotocol/server/stdio";
import { callTool } from "./call.ts";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "./tools.ts";
import type { ServeOptions, ToolHandlers } from "./types.ts";
import { schemaValidator } from "./validator.ts";

export const SERVER_NAME = "open3dj";

export const INSTRUCTIONS = [
  "Open3DJ is local, agent-first CAD. Units are mm and Z is up. Every design is an assembly: return one shape, or [{ name, shape }] for several parts.",
  "Loop: docs {query} for the DSL (docs {query: \"entries\"} lists them all), run {project: \"name.o3j\", script} for a GeometryReport, render {project, view: \"multiview\"} to see it, export {project, format: \"step\"} for STEP (or stl, gltf, 3mf).",
  "Pass base_rev from the last result to build on it. Errors are results with code, line, faulty elements and a hint.",
].join(" ");

/** Build one McpServer with the five tools. serveStdio calls this once per connection era. */
export function createServer(handlers: ToolHandlers, options: ServeOptions = {}): McpServer {
  const server = new McpServer(
    { name: options.name ?? SERVER_NAME, version: options.version ?? "0.0.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const validator = schemaValidator();
  // The SDK checks inputs only for being an object; the handlers validate against the full
  // published schema, so a bad input becomes a structured BAD_INPUT result with a hint
  // instead of the SDK's plain-text validation error.
  const objectsOnly = permissiveValidator();
  for (const name of TOOL_NAMES) {
    const def = TOOL_DEFINITIONS[name];
    const config = {
      title: def.title,
      description: def.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(def.inputSchema as never, objectsOnly),
      outputSchema: fromJsonSchema<Record<string, unknown>>(def.outputSchema as never, validator),
      annotations: def.annotations,
    };
    server.registerTool(name, config, (args: Record<string, unknown>) => callTool(handlers, name, args));
  }
  return server;
}

/**
 * Serve the handlers over stdio until stdin closes. Every byte on stdout is a JSON-RPC
 * message; the stdout-leak gate (scripts/leak-gate.ts) checks this in CI.
 */
export async function serveStdio(handlers: ToolHandlers, options: ServeOptions = {}): Promise<void> {
  const log = options.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  // The transport closes itself on a fatal read error (for example a line over its 10 MiB
  // buffer) and pauses stdin, which then never ends. Ending on the transport's own close too
  // means the daemon exits, so the client sees it die and can start a new one.
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
    onTransportClose(transport, () => {
      log("open3dj mcp: the transport closed; shutting down");
      resolve();
    });
  });
  const handle = sdkServeStdio((ctx?: { era?: string }) => {
    log(`open3dj mcp: ${ctx?.era ?? "unknown"} era connection`);
    return createServer(handlers, options);
  }, { legacy: "serve", transport, onerror: (e) => log(`open3dj mcp: ${e.message}`) });
  await closed;
  handlers.shutdown();
  await handle.close();
  process.stdin.destroy();
}

/**
 * Call fn when the transport closes, whatever onclose handler the SDK installs on it. The
 * SDK owns the transport's callbacks, so this wraps the property instead of replacing it.
 */
function onTransportClose(transport: StdioServerTransport, fn: () => void): void {
  let inner = transport.onclose;
  Object.defineProperty(transport, "onclose", {
    configurable: true,
    get: () => () => {
      inner?.();
      fn();
    },
    set: (next: (() => void) | undefined) => {
      inner = next;
    },
  });
}

/** A validator that accepts any object: the handlers do the real input validation. */
function permissiveValidator(): ReturnType<typeof schemaValidator> {
  return {
    getValidator<T>() {
      return (input: unknown) => input !== null && typeof input === "object" && !Array.isArray(input)
        ? { valid: true as const, data: input as T, errorMessage: undefined }
        : { valid: false as const, data: undefined, errorMessage: "arguments must be an object" };
    },
  };
}

/**
 * Send all console output to stderr. Call first in the daemon: stdout carries JSON-RPC,
 * and one stray console.log from any library would corrupt it for strict clients.
 */
export function guardStdout(): void {
  const c = new Console({ stdout: process.stderr, stderr: process.stderr });
  const methods = ["log", "info", "debug", "dir", "dirxml", "table", "group", "groupCollapsed", "groupEnd", "count", "countReset", "time", "timeEnd", "timeLog", "trace", "warn", "error", "assert"] as const;
  for (const m of methods) (console as unknown as Record<string, unknown>)[m] = (c[m] as (...a: unknown[]) => void).bind(c);
}
