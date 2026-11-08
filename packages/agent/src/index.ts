// @open3dj/agent: the agent panel of open3dj view (RFC 0001). So far it holds the parts that
// do not talk to anything: the tool entries for the Messages API, the mapping of tool results,
// the system prompt, and the wire format Engine A reads: a server-sent-events parser and the
// accumulator that turns stream events into the final message. The client, the turn loop,
// approvals and the budget ledger come in later steps; nothing calls this package yet. It
// never loads the kernel.
import type { PackageStatus } from "@open3dj/schemas";

export type * from "./types.ts";
export { API_TOOL_ORDER, PINNED_TOOLS, apiTools, withProject } from "./api-tools.ts";
export type { ApiTool, Pinned } from "./api-tools.ts";
export { MAX_IMAGE_BASE64_CHARS, MAX_IMAGE_SIDE_PX, MAX_TEXT_BYTES, redactText, toApiContent } from "./results.ts";
export type { ApiContentBlock, ApiImageBlock, ApiTextBlock, ApiToolResult } from "./results.ts";
export { PANEL_PREAMBLE, SKILL_FILE, skillBody, systemPrompt } from "./prompt.ts";
export { MAX_EVENT_BYTES, SseParser, readSse } from "./sse.ts";
export type { SseEvent } from "./sse.ts";
export { MessageAccumulator, StreamError, parseInput } from "./stream.ts";
export type { AssistantBlock, AssistantMessage, FinalMessage, StopDetails, StreamErrorCode, StreamUpdate, ToolInput } from "./stream.ts";

/**
 * "stub" until Engine A runs a turn (RFC 0001, plan step B4). The helpers above are built
 * and tested now; the placeholder test in index.test.ts fails on purpose once this flips.
 */
export const PACKAGE_STATUS: PackageStatus = "stub";
