// @open3dj/agent: the agent panel of open3dj view (RFC 0001). It holds the tool entries for
// the Messages API, the mapping of tool results, the system prompt, Engine A (a client for
// the Messages API over fetch, a server-sent-events parser, a stream accumulator, the model
// list and the turn loop), and the records the session will keep: approval cards, the budget
// ledger and the egress log. The session itself comes next; nothing in open3dj view calls
// this package yet. It never loads the kernel.
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
export { API_BILLING, INPUT_PREVIEW_BYTES, MIN_OUTPUT_TOKENS, STOP_GRACE_MS, createApiEngine, summarize } from "./api-engine.ts";
export type { ApiEngineOptions, ApiMessage, ToolResultBlock, UserMessage } from "./api-engine.ts";
export { APPROVAL_TTL_MS, Approvals, COMPUTER, ESTIMATE_BASIS, EXPIRY, KEEP_DECIDED, buildPayload, isDecider, payloadHash } from "./approval.ts";
export type { ApprovalCard, ApprovalState, DecideResult, RefusalCode } from "./approval.ts";
export { BudgetLedger, DEFAULT_INPUT_BUDGET, DEFAULT_OUTPUT_BUDGET } from "./ledger.ts";
export type { BudgetCaps, LedgerSnapshot } from "./ledger.ts";
export { EgressLog } from "./egress-log.ts";
export type { EgressRecord } from "./egress-log.ts";

/** "ready" since Engine A runs a turn (RFC 0001, plan step B4). */
export const PACKAGE_STATUS: PackageStatus = "ready";
