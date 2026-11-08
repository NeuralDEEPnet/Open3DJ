// @open3dj/agent: the agent panel of open3dj view (RFC 0001). So far it holds the tool
// entries for the Messages API, the mapping of tool results, the system prompt, and the
// parts of Engine A below its turn loop: a client for the Messages API over fetch, the model
// list, a server-sent-events parser and the accumulator that turns stream events into the
// final message. The turn loop, approvals and the budget ledger come in later steps; nothing
// calls this package yet. It never loads the kernel.
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
export { API_VERSION, ApiError, DEFAULT_BASE_URL, KEY_PATTERN, MAX_RETRIES, MAX_RETRY_WAIT_MS, abortableSleep, createApiClient, retryWait } from "./client.ts";
export type { ApiClient, ApiClientOptions, RequestOptions, RetryInfo } from "./client.ts";
export { MAX_MODEL_PAGES, MODELS_PAGE_SIZE, listModels } from "./models.ts";
export type { ModelInfo } from "./models.ts";

/**
 * "stub" until Engine A runs a turn (RFC 0001, plan step B4). The helpers above are built
 * and tested now; the placeholder test in index.test.ts fails on purpose once this flips.
 */
export const PACKAGE_STATUS: PackageStatus = "stub";
