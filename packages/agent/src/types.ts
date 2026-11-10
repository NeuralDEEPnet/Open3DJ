// The shared contract of the agent panel (RFC 0001): engines, turns, limits, token usage and
// the events the panel shows. Engine A (the Messages API with the person's key) and Engine B
// (the person's own Claude Code) both implement Engine. The session drives one engine at a
// time and adds the envelope (seq, ts, turn) to every event before the page sees it.

/** Which engine runs a turn: the Messages API with the person's key, or their Claude Code. */
export type EngineId = "api" | "cli";

/** What the approval card and the engine switch show about one engine. */
export interface EngineStatus {
  id: EngineId;
  /** True when a turn can start now. */
  ready: boolean;
  /** Why the engine is not ready, in one sentence. */
  reason?: string;
  /** Who pays, for example "billed to the API key in ANTHROPIC_API_KEY". */
  billing: string;
  /** Where requests go, for example "api.anthropic.com". */
  host: string;
  /** The conversation the next request would resend: messages and bytes. */
  conversation?: { messages: number; bytes: number };
  /** Open3DJ's instructions and tool list as sent: tools, bytes and a short sha256 (16 hex). */
  instructions?: { tools: number; bytes: number; hash: string };
}

/** The limits of one prompt. They come only from CLI options; the page cannot raise them. */
export interface TurnLimits {
  /** Requests to the model per prompt. A reply that asks for tools in the last round gets "not run" results. */
  maxRounds: number;
  /** max_tokens per request, before the budget caps it. */
  maxOutputTokens: number;
  /** The whole turn, retries and tool runs included. */
  timeoutMs: number;
}

/** Tokens of one request or of a session. input is the uncached input only. */
export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/** Why a turn ended. context_window: the conversation filled the model's context window, so only a new conversation goes on. */
export type TurnEndReason = "end_turn" | "max_rounds" | "max_tokens" | "context_window" | "refusal" | "stopped" | "budget" | "timeout" | "error";

/** How a turn ended, with one sentence for the person when it was not a plain end_turn. */
export interface TurnEnd {
  reason: TurnEndReason;
  message?: string;
}

export type AgentState = "idle" | "awaiting_approval" | "running" | "stopping";
export type ToolStepStatus = "ok" | "warning" | "error" | "queued";
export type NoticeLevel = "info" | "warn" | "error";
/** "prompt" covers one prompt; "session" covers later prompts with the same engine, model and limits until the viewer stops. */
export type ApprovalScope = "prompt" | "session";
export type ApprovalDecision = "approved" | "denied" | "expired";

/** What an approval card shows: everything that decides what leaves the machine and who pays. */
export interface ApprovalPayload {
  engine: EngineId;
  billing: string;
  host: string;
  /** The model id, or null when the engine reports it only once it starts (Engine B). */
  model: string | null;
  /** The project folder's name, never its path. */
  project: string;
  prompt: string;
  conversation: { messages: number; bytes: number };
  instructions: { tools: number; bytes: number; hash: string };
  limits: TurnLimits;
  budget: { input: number; output: number };
  estimate: { input_tokens: number; basis: "bytes / 4, an estimate" };
}

/** One event of the panel, without the envelope the session adds. Keyed by kind. */
export type AgentEventBody =
  | { kind: "status"; state: AgentState; engine?: EngineId; model?: string }
  | { kind: "prompt"; text: string }
  | { kind: "text"; delta: string }
  | { kind: "discard"; reason: string }
  | { kind: "tool_call"; call: string; tool: string; input_preview: string; input_bytes: number }
  | { kind: "tool_result"; call: string; status: ToolStepStatus; rev?: string; code?: string; summary: string }
  | { kind: "usage"; request: TokenUsage; session: TokenUsage; remaining: { input: number; output: number } }
  | { kind: "notice"; level: NoticeLevel; text: string }
  | { kind: "turn_end"; reason: TurnEndReason; message?: string }
  | { kind: "approval"; id: string; payload: ApprovalPayload; payload_hash: string; expires_at: string; scopes: ApprovalScope[] }
  | { kind: "approval_result"; id: string; decision: ApprovalDecision; scope?: ApprovalScope; by: string }
  | { kind: "reset" }
  | { kind: "resync" };

export type AgentEventKind = AgentEventBody["kind"];

/** An event as the page sees it: a sequence number, a time and the turn it belongs to. */
export type AgentEvent = AgentEventBody & { seq: number; ts: string; turn?: string };

/** The part of the session budget an engine sees: what is left, and a way to book usage. */
export interface BudgetLedgerView {
  remaining(): { input: number; output: number };
  add(u: TokenUsage): void;
}

/** One request the engine sent, reported when it ended, for the egress log. Never its text. */
export interface RequestReport {
  /** The request body in bytes (UTF-8). */
  bytes: number;
  /** HTTP attempts, retries included. */
  attempts: number;
  /** What the API reported, when a reply started. */
  usage?: TokenUsage;
  outcome: "ok" | "error" | "stopped" | "timeout";
}

/** One prompt for an engine. */
export interface TurnRequest {
  /** The turn id the session gave this prompt. */
  turn: string;
  text: string;
  /** The model id. Engine A needs one from the API's model list; Engine B may leave it out. */
  model?: string;
  limits: TurnLimits;
  ledger: BudgetLedgerView;
  /** The person's Stop. */
  signal: AbortSignal;
  /** Events for the page: text, discard, tool_call, tool_result, usage and notice. */
  emit(e: AgentEventBody): void;
  /** Called after a tool step that returned a revision, so the viewer loads it. */
  onRevision(): void;
  /** Called once for every request that left the machine, when it ended. */
  onRequest?(r: RequestReport): void;
}

/** An engine runs one turn at a time and keeps its conversation until reset(). */
export interface Engine {
  readonly id: EngineId;
  status(): Promise<EngineStatus>;
  /** Runs one prompt to its end. Never throws: a failure is reason "error" with a message. */
  turn(req: TurnRequest): Promise<TurnEnd>;
  /** Forget the conversation. A running turn is stopped. */
  reset(): void;
  /** Stop any running turn and its tool jobs. */
  close(): Promise<void>;
}
