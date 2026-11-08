// One tool call as an MCP CallResult. The stdio server (server.ts) calls callTool(), and the
// planned agent panel (@open3dj/agent, RFC 0001) will call it too, so a tool behaves the same
// whichever way it is reached.
import type { RenderImage } from "@open3dj/compute";
import type { ToolName } from "@open3dj/schemas";
import { toScriptError } from "./errors.ts";
import { noJob } from "./handlers.ts";
import { TOOL_NAMES } from "./tools.ts";
import type { ToolHandlers } from "./types.ts";

/** One content item of a tool result, as MCP sends it. */
export type CallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; text: string } };

/** A tools/call result: structuredContent, its JSON text mirror and any images. */
export interface CallResult {
  structuredContent: Record<string, unknown>;
  content: CallContent[];
  isError?: boolean;
  [key: string]: unknown;
}

/** A tool result: structuredContent plus a JSON text mirror for clients that ignore it. */
export function toolResult(structured: object, extra: CallContent[] = []): CallResult {
  const sc = structured as Record<string, unknown>;
  const result: CallResult = { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }, ...extra] };
  // docs has no status: a docs result with an error is an error result too.
  if (sc.status === "error" || (sc.status === undefined && sc.error !== undefined)) result.isError = true;
  return result;
}

/**
 * PNG renders as image content, SVG renders as an embedded text resource. The resource URI
 * names the project by its folder name only, never by the path the caller passed, which can
 * be absolute and hold the server's local paths.
 */
export function imageContent(images: RenderImage[], projectArg: string, rev: string | undefined): CallContent[] {
  const project = projectArg.split(/[\\/]/).filter((s) => s !== "").pop() ?? "";
  const out: CallContent[] = [];
  for (const img of images) {
    if (img.format === "png") out.push({ type: "image", data: Buffer.from(img.bytes).toString("base64"), mimeType: "image/png" });
    else out.push({ type: "resource", resource: { uri: `open3dj://${encodeURIComponent(project)}/${rev ?? "head"}/${encodeURIComponent(img.name)}`, mimeType: "image/svg+xml", text: Buffer.from(img.bytes).toString("utf8") } });
  }
  return out;
}

const failed = (e: unknown): CallResult => toolResult({ status: "error", error: toScriptError(e), compute: noJob("the handler failed") });

/**
 * Call one of the five tools and return its CallResult. A handler that throws becomes a
 * status "error" result with a ScriptError, never an exception. An unknown name is a
 * BAD_INPUT result too: the MCP server registers only the five tools, but the agent panel
 * passes on whatever name the model sent.
 */
export async function callTool(handlers: ToolHandlers, name: string, args: Record<string, unknown>): Promise<CallResult> {
  try {
    switch (name as ToolName) {
      case "run": return toolResult(await handlers.run(args as never));
      case "inspect": return toolResult(await handlers.inspect(args as never));
      case "export": return toolResult(await handlers.export(args as never));
      case "docs": return toolResult(await handlers.docs(args as never));
      case "render": {
        const r = await handlers.render(args as never);
        return toolResult(r.output, imageContent(r.images, String(args.project ?? ""), r.output.rev));
      }
    }
  } catch (e) {
    return failed(e);
  }
  const shown = String(name).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return toolResult({
    status: "error",
    error: { code: "BAD_INPUT", message: `there is no tool called '${shown}'`, hint: `Use one of ${TOOL_NAMES.join(", ")}.` },
    compute: noJob("no such tool"),
  });
}
