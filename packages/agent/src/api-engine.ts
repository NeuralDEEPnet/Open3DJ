// Engine A: the Claude Messages API with the person's own key (RFC 0001). One turn sends
// streaming requests and runs the tool calls of each reply one after the other, through the
// same callTool() the MCP server uses, on the project the viewer pins. The conversation is
// append-only: a reply joins it only once it is complete, and every tool_use in it gets a
// tool_result in the next user message, also when a call is not run, so the history the API
// sees stays valid across Stop and limits. A refusal, or a prompt that got no reply, leaves the
// history as it was before the prompt. The engine never loads the kernel.
//
// Prompt caching: the tools and the one system block are the same bytes on every request,
// with a cache breakpoint on the system block; the growing conversation uses the top-level
// automatic breakpoint. Tools are sent with eager_input_streaming, so this engine owns their
// validation: each input is parsed strictly at its block's end and checked against the
// tool's schema before it runs, and nothing runs from a reply cut off by max_tokens or a
// refusal.
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { TOOL_NAMES, callTool } from "@open3dj/mcp";
import type { CallResult, ToolHandlers } from "@open3dj/mcp";
import { validate } from "@open3dj/schemas";
import type { ValidationIssue } from "@open3dj/schemas";
import { apiTools, withProject } from "./api-tools.ts";
import type { ApiClient, RetryInfo } from "./client.ts";
import { systemPrompt as defaultSystemPrompt } from "./prompt.ts";
import { toApiContent } from "./results.ts";
import type { ApiContentBlock } from "./results.ts";
import { SseParser } from "./sse.ts";
import { MessageAccumulator, safe } from "./stream.ts";
import type { AssistantMessage, FinalMessage, ToolInput, ToolUseBlock } from "./stream.ts";
import type { AgentEventBody, Engine, EngineStatus, RequestReport, TokenUsage, ToolStepStatus, TurnEnd, TurnLimits, TurnRequest } from "./types.ts";

/** Who pays for Engine A, as the approval card says it. */
export const API_BILLING = "billed to the API key in ANTHROPIC_API_KEY";
/** The smallest max_tokens a request is sent with; less budget than this ends the turn. */
export const MIN_OUTPUT_TOKENS = 1024;
/** A tool_call event shows at most this much of the input (32 KiB). */
export const INPUT_PREVIEW_BYTES = 32 * 1024;
/** After Stop, how long a running tool call may take to settle before the turn ends without it. */
export const STOP_GRACE_MS = 5_000;
/** The invalid input echoed back to the model is cut to this many characters. */
const ECHO_CHARS = 4096;

export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: ApiContentBlock[]; is_error?: true };
export type UserMessage = { role: "user"; content: Array<{ type: "text"; text: string } | ToolResultBlock> };
export type ApiMessage = UserMessage | AssistantMessage;

export interface ApiEngineOptions {
  client: ApiClient;
  /** A set of handlers for the agent alone, so shutdown() on Stop cancels only its jobs. */
  handlers: ToolHandlers;
  /** The absolute path of the project the viewer shows. Every call is pinned to it. */
  project: string;
  /** Default: systemPrompt() from SKILL.md. */
  systemPrompt?: string;
  /** Milliseconds clock, checked between steps against the turn's time limit. Default Date.now. */
  now?: () => number;
  /** Default STOP_GRACE_MS. */
  stopGraceMs?: number;
}

const REV = /^r_[0-9a-z]+$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const STEP_STATUS = new Set(["ok", "warning", "error", "queued"]);

type Interrupt = "stopped" | "timeout";
type Step = { block: ToolResultBlock; event: Extract<AgentEventBody, { kind: "tool_result" }>; interrupted?: Interrupt };

export function createApiEngine(options: ApiEngineOptions): Engine {
  const { client, handlers, project } = options;
  if (!isAbsolute(project)) throw new Error("createApiEngine needs the absolute path of the pinned project");
  const now = options.now ?? Date.now;
  const graceMs = options.stopGraceMs ?? STOP_GRACE_MS;
  // Built once: the same bytes on every request, so the cache can reuse tools and system.
  const system = [{ type: "text", text: options.systemPrompt ?? defaultSystemPrompt(), cache_control: { type: "ephemeral" } }];
  const tools = apiTools().map((t) => ({ ...t, eager_input_streaming: true }));
  const fixed = JSON.stringify({ tools, system });
  const instructions = { tools: tools.length, bytes: Buffer.byteLength(fixed), hash: createHash("sha256").update(fixed).digest("hex").slice(0, 16) };

  let history: ApiMessage[] = [];
  let lastHead: string | undefined;
  /** Counts reset() calls, so a turn that is still ending cannot touch the new conversation. */
  let generation = 0;
  let totals: TokenUsage = zero();
  let current: AbortController | undefined;
  let running: Promise<TurnEnd> | undefined;
  let closed = false;

  const body = (model: string, maxTokens: number, messages: ApiMessage[]) =>
    JSON.stringify({ model, max_tokens: maxTokens, system, tools, messages, cache_control: { type: "ephemeral" }, stream: true });

  async function turn(req: TurnRequest): Promise<TurnEnd> {
    if (closed) return { reason: "error", message: "the API engine is closed" };
    if (current) return { reason: "error", message: "a turn is already running" };
    const bad = limitsProblem(req.limits);
    if (bad) return { reason: "error", message: bad };
    if (!req.model) return { reason: "error", message: "no model is picked: load the models and pick one" };
    const own = new AbortController();
    current = own;
    const p = runTurn(req, req.model, own).catch((e: unknown): TurnEnd => ({ reason: "error", message: client.redact(errorText(e)) }));
    running = p;
    try {
      return await p;
    } finally {
      if (current === own) current = undefined;
      if (running === p) running = undefined;
    }
  }

  async function runTurn(req: TurnRequest, model: string, own: AbortController): Promise<TurnEnd> {
    const { limits } = req;
    // setTimeout holds at most 2^31 - 1 ms.
    const timer = AbortSignal.timeout(Math.min(limits.timeoutMs, 2_147_483_647));
    const signal = AbortSignal.any([req.signal, own.signal, timer]);
    const deadline = now() + limits.timeoutMs;
    // reset() starts a new array; a turn that is still ending keeps writing to its own.
    const messages = history;
    /** The history before this prompt. Cutting back to it keeps a prefix, so the cache stays valid. */
    const start = messages.length;
    const headAtStart = lastHead;
    const gen = generation;
    const interrupted = (): Interrupt | undefined => {
      if (req.signal.aborted || own.signal.aborted) return "stopped";
      if (timer.aborted || now() >= deadline) return "timeout";
      return undefined;
    };
    const emit = (e: AgentEventBody) => {
      try {
        req.emit(e);
      } catch {
        // A listener that fails never ends the turn.
      }
    };
    const notice = (level: "info" | "warn" | "error", text: string) => emit({ kind: "notice", level, text: client.redact(text) });
    const ended = (why: Interrupt): TurnEnd =>
      why === "stopped" ? { reason: "stopped", message: "stopped by the person" } : { reason: "timeout", message: `the turn reached its time limit of ${seconds(limits.timeoutMs)}` };

    /** Results for calls that do not run: a tool_call and a tool_result event each, one block each. */
    const notRun = (uses: ToolUseBlock[], inputs: Map<string, ToolInput>, text: string): ToolResultBlock[] =>
      uses.map((use) => {
        announce(use, inputs.get(use.id));
        emit({ kind: "tool_result", call: use.id, status: "error", code: "NOT_RUN", summary: text });
        return { type: "tool_result", tool_use_id: use.id, content: [{ type: "text", text }], is_error: true };
      });
    const closeAll = (uses: ToolUseBlock[], inputs: Map<string, ToolInput>, text: string) => {
      if (uses.length > 0) messages.push({ role: "user", content: notRun(uses, inputs, text) });
    };

    const announce = (use: ToolUseBlock, info: ToolInput | undefined) => {
      const raw = info?.raw ?? JSON.stringify(use.input);
      const shown = info?.error ? raw : JSON.stringify(use.input, null, 2);
      emit({ kind: "tool_call", call: use.id, tool: use.name, input_preview: preview(client.redact(shown)), input_bytes: Buffer.byteLength(raw) });
    };

    /** One request, streamed. The reply comes back only when complete; otherwise how the turn ends. */
    const request = async (text: string, maxTokens: number): Promise<{ final: FinalMessage } | { end: TurnEnd }> => {
      const report: RequestReport = { bytes: Buffer.byteLength(text), attempts: 1, outcome: "ok" };
      const acc = new MessageAccumulator();
      let pending = "";
      const show = (delta: string) => {
        pending += delta;
        const at = client.holdFrom(pending);
        if (at > 0) emit({ kind: "text", delta: client.redact(pending.slice(0, at)) });
        pending = pending.slice(at);
      };
      const flush = () => {
        if (pending !== "") emit({ kind: "text", delta: client.redact(pending) });
        pending = "";
      };
      let booked = false;
      const account = () => {
        if (!acc.started || booked) return;
        booked = true;
        const u = acc.usage();
        if (!acc.outputReported && u.output < maxTokens) {
          // The real output count comes only in the final message_delta. A reply that ended
          // without it (Stop, the time limit, an error) may have used up to max_tokens, hidden
          // thinking included, and the streamed part is billed. So the whole limit counts.
          u.output = maxTokens;
          notice("info", `The reply ended before the API reported its output tokens, so this request's whole limit of ${maxTokens} output tokens counts against the session budget.`);
        }
        report.usage = u;
        req.ledger.add(u);
        totals = sum(totals, u);
        emit({ kind: "usage", request: u, session: { ...totals }, remaining: req.ledger.remaining() });
      };
      const onRetry = (r: RetryInfo) => {
        report.attempts = r.attempt;
        notice("info", `The request failed (${r.reason}); trying again in ${seconds(r.waitMs)}, attempt ${r.attempt} of ${r.of}.`);
      };
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await client.stream("/v1/messages", text, { signal, onRetry });
        reader = res.body.getReader();
        const parser = new SseParser();
        const apply = (data: string) => {
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            throw new Error("the API stream sent an event that is not JSON");
          }
          for (const u of acc.apply(event)) {
            if (u.type === "text") show(u.delta);
            else if (u.block.type === "text") flush();
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const e of parser.push(value)) apply(e.data);
        }
        for (const e of parser.end()) apply(e.data);
        const final = acc.finish();
        flush();
        // A declined reply is dropped like a stopped one, before its usage event.
        if (final.stop_reason === "refusal" && final.message.content.length > 0) emit({ kind: "discard", reason: "the model declined this request" });
        account();
        return { final };
      } catch (e) {
        const why = interrupted();
        // What this reply showed so far is dropped; it never joins the conversation.
        if (acc.started) emit({ kind: "discard", reason: why === "stopped" ? "stopped by the person" : why === "timeout" ? "the turn reached its time limit" : "the reply failed" });
        account();
        report.outcome = why ?? "error";
        if (why) return { end: ended(why) };
        const message = client.redact(errorText(e));
        return { end: { reason: "error", message: acc.started ? `${message}. Nothing from that reply was kept.` : message } };
      } finally {
        if (reader) await reader.cancel().catch(() => undefined);
        try {
          req.onRequest?.(report);
        } catch {
          // The egress log reports its own failures.
        }
      }
    };

    /** Run one tool call through callTool, pinned to the project. */
    const runOne = async (use: ToolUseBlock, info: ToolInput | undefined): Promise<Step> => {
      if (info?.error) {
        return invalid(use, `The tool input was ${info.error}, so the tool did not run. Send the call again with one JSON object that matches the tool's input schema.`, JSON.stringify({ INVALID_JSON: client.redact(info.raw).slice(0, ECHO_CHARS) }));
      }
      const pinned = withProject(use.name, use.input, project);
      if (!pinned.ok) return fromCall(use, pinned.result, undefined);
      let input = pinned.input;
      if (use.name === "run" && input.base_rev === undefined && lastHead) {
        input = { ...input, base_rev: lastHead };
        notice("info", `run left out base_rev, so Open3DJ filled in ${lastHead}, the last revision this conversation saw: a change made in between is reported, not overwritten.`);
      }
      if ((TOOL_NAMES as readonly string[]).includes(use.name)) {
        const v = validate(`tool-${use.name}-input`, input);
        if (!v.valid) return invalid(use, `The tool input was invalid, so the tool did not run: ${issues(v.errors)}. Check the ${use.name} tool's input schema and send the call again.`);
      }
      const call = callTool(handlers, use.name, input);
      const first = await settle(call, signal);
      if (first.done) return fromCall(use, first.value, input);
      // Stopped or out of time while the tool ran: cancel the agent's jobs and wait briefly.
      const why = interrupted() ?? "stopped";
      handlers.shutdown();
      const late = await settle(call, AbortSignal.timeout(graceMs));
      const text = why === "stopped" ? "stopped by the person while this call ran." : "the turn reached its time limit while this call ran.";
      if (!late.done) return { ...invalid(use, text, undefined, why === "stopped" ? "STOPPED" : "TIMEOUT"), interrupted: why };
      const step = fromCall(use, late.value, input);
      step.block = { ...step.block, content: [{ type: "text", text }, ...step.block.content], is_error: true };
      return { ...step, interrupted: why };
    };

    const invalid = (use: ToolUseBlock, text: string, echo?: string, code = "BAD_INPUT"): Step => {
      const content: ApiContentBlock[] = [{ type: "text", text }];
      if (echo !== undefined) content.push({ type: "text", text: echo });
      return { block: { type: "tool_result", tool_use_id: use.id, content, is_error: true }, event: { kind: "tool_result", call: use.id, status: "error", code, summary: cut(client.redact(text)) } };
    };

    const fromCall = (use: ToolUseBlock, result: CallResult, input: Record<string, unknown> | undefined): Step => {
      const api = toApiContent(result);
      const sc = result.structuredContent ?? {};
      const step = summarize(use.name, sc, result.isError === true);
      step.summary = cut(client.redact(step.summary));
      const rev = typeof sc.rev === "string" && REV.test(sc.rev) ? sc.rev : undefined;
      if (rev && gen === generation && (use.name === "run" || (["inspect", "render", "export"].includes(use.name) && input?.rev === undefined))) lastHead = rev;
      const block: ToolResultBlock = { type: "tool_result", tool_use_id: use.id, content: api.content };
      if (api.is_error) block.is_error = true;
      return { block, event: { kind: "tool_result", call: use.id, ...step } };
    };

    const finishStep = (use: ToolUseBlock, step: Step) => {
      emit(step.event);
      if (use.name === "run" && step.event.rev) {
        try {
          req.onRevision();
        } catch {
          // The viewer reports its own failures.
        }
      }
    };

    /** The calls of one reply, one after the other; all results go back in one user message. */
    const runTools = async (uses: ToolUseBlock[], inputs: Map<string, ToolInput>): Promise<TurnEnd | undefined> => {
      const results: ToolResultBlock[] = [];
      for (let i = 0; i < uses.length; i++) {
        const why = interrupted();
        if (why) {
          results.push(...notRun(uses.slice(i), inputs, why === "stopped" ? "not run: stopped by the person." : "not run: the turn reached its time limit."));
          messages.push({ role: "user", content: results });
          return ended(why);
        }
        const use = uses[i]!;
        announce(use, inputs.get(use.id));
        const step = await runOne(use, inputs.get(use.id));
        results.push(step.block);
        finishStep(use, step);
        if (step.interrupted) {
          const text = step.interrupted === "stopped" ? "not run: stopped by the person." : "not run: the turn reached its time limit.";
          results.push(...notRun(uses.slice(i + 1), inputs, text));
          messages.push({ role: "user", content: results });
          return ended(step.interrupted);
        }
      }
      messages.push({ role: "user", content: results });
      return undefined;
    };

    let sentPrompt = false;
    let askedShorter = false;
    for (let round = 1; ; round++) {
      const why = interrupted();
      if (why) return ended(why);
      const left = req.ledger.remaining();
      if (left.input <= 0) {
        return { reason: "budget", message: "this session's input token budget is used up. Start open3dj view again with a larger --agent-input-budget to go on." };
      }
      const maxTokens = Math.min(limits.maxOutputTokens, Math.floor(left.output));
      if (maxTokens < MIN_OUTPUT_TOKENS) {
        return { reason: "budget", message: `only ${Math.max(0, Math.floor(left.output))} output tokens are left in this session's budget, fewer than the ${MIN_OUTPUT_TOKENS} a request needs. Start open3dj view again with a larger --agent-output-budget to go on.` };
      }
      if (!sentPrompt) {
        messages.push({ role: "user", content: [{ type: "text", text: req.text }] });
        sentPrompt = true;
      }
      const r = await request(body(model, maxTokens, messages), maxTokens);
      if ("end" in r) {
        // A prompt that got no reply is left out, so sending it again does not send it twice.
        // After a later round the prompt has a reply, and the model's work stays.
        if (round === 1) messages.length = start;
        return r.end;
      }
      const { message, stop_reason: stop, stop_details: details, inputs } = r.final;
      if (stop === "refusal") {
        // The API's guidance: discard the partial reply and do not go on from the turn that was
        // declined. The history goes back to how it was before this prompt (a prefix, so the
        // cache and any thinking signatures stay valid), and nothing of the reply runs or stays.
        messages.length = start;
        // The conversation no longer shows this prompt's revisions: a later run without
        // base_rev reports them as a conflict instead of overwriting them.
        if (gen === generation) lastHead = headAtStart;
        const category = typeof details?.category === "string" ? safe(details.category) : undefined;
        const named = `declined this request${category ? ` (category: ${category})` : ""}`;
        const why = typeof details?.explanation === "string" && details.explanation.trim() !== "" ? ` ${cut(details.explanation)}` : "";
        notice("warn", `The model ${named}.${why} The prompt, the declined reply and any tool steps of this prompt were left out of the conversation; revisions stay in the project. Rephrase the prompt to go on.`);
        return { reason: "refusal", message: `the model ${named}. It was left out of the conversation: rephrase it to go on.` };
      }
      // An empty assistant message would make the next request invalid; it adds nothing.
      if (message.content.length > 0) messages.push(message);
      const uses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      switch (stop) {
        case "tool_use": {
          if (uses.length === 0) return { reason: "end_turn" };
          if (round >= limits.maxRounds) {
            closeAll(uses, inputs, `not run: this prompt's limit of ${limits.maxRounds} tool rounds was reached.`);
            return { reason: "max_rounds", message: `this prompt used its ${limits.maxRounds} rounds, so the last tool calls were not run. Send another prompt to go on.` };
          }
          const end = await runTools(uses, inputs);
          if (end) return end;
          continue;
        }
        case "max_tokens": {
          if (uses.length > 0) {
            closeAll(uses, inputs, "not run: the reply reached its output token limit while writing this call, so its input may be cut off. Make the call again with a shorter input, for example a shorter script or fewer ops.");
            if (!askedShorter && round < limits.maxRounds) {
              askedShorter = true;
              notice("warn", "The reply reached its output token limit inside a tool call, so the call was not run. Open3DJ asks once for a shorter call.");
              continue;
            }
          }
          return { reason: "max_tokens", message: `the reply reached its output token limit of ${maxTokens} tokens` };
        }
        case "model_context_window_exceeded":
          // Not the output limit: the whole conversation filled the context window. The reply
          // stays (the history is valid), but only a new conversation can go on.
          closeAll(uses, inputs, "not run: the conversation reached the model's context window while this call was written.");
          return { reason: "context_window", message: "the conversation reached the model's context window. Press New conversation to go on." };
        case "pause_turn":
          // The API paused its own work; the next request lets it go on.
          if (round >= limits.maxRounds) return { reason: "max_rounds", message: `this prompt used its ${limits.maxRounds} rounds. Send another prompt to go on.` };
          continue;
        case "end_turn":
        case "stop_sequence":
          closeAll(uses, inputs, "not run: the reply ended without waiting for tool results.");
          return { reason: "end_turn" };
        default:
          closeAll(uses, inputs, "not run: the reply ended in a way Open3DJ does not know.");
          return { reason: "error", message: `unsupported stop reason ${safe(stop)}; update Open3DJ` };
      }
    }
  }

  return {
    id: "api",
    async status(): Promise<EngineStatus> {
      const s: EngineStatus = {
        id: "api",
        ready: !closed,
        billing: API_BILLING,
        host: client.host,
        conversation: { messages: history.length, bytes: Buffer.byteLength(JSON.stringify(history)) },
        instructions: { ...instructions },
      };
      if (closed) s.reason = "the API engine is closed";
      return s;
    },
    turn,
    reset() {
      current?.abort();
      generation++;
      history = [];
      lastHead = undefined;
    },
    async close() {
      closed = true;
      current?.abort();
      handlers.shutdown();
      await running?.catch(() => undefined);
    },
  };
}

/** A step's status, revision, error code and one line for the transcript. */
export function summarize(tool: string, sc: Record<string, unknown>, isError: boolean): { status: ToolStepStatus; rev?: string; code?: string; summary: string } {
  const raw = sc.status;
  const status: ToolStepStatus = typeof raw === "string" && STEP_STATUS.has(raw) ? (raw as ToolStepStatus) : isError || sc.error !== undefined ? "error" : "ok";
  const out: { status: ToolStepStatus; rev?: string; code?: string; summary: string } = { status, summary: "" };
  if (typeof sc.rev === "string" && REV.test(sc.rev)) out.rev = sc.rev;
  const err = (sc.error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof err.code === "string" && CODE.test(err.code)) out.code = err.code;
  if (status === "error") out.summary = `${out.code ?? "ERROR"}: ${typeof err.message === "string" ? oneLine(err.message) : "the tool failed"}`;
  else if (status === "queued") out.summary = `queued as ${safe(sc.job_id)}; inspect fields [job] shows when it ends`;
  else {
    const head = [out.rev, status].filter(Boolean).join(" ");
    const parts = (sc.report as { parts?: unknown } | undefined)?.parts;
    if (tool === "run" && Array.isArray(parts)) {
      const valid = parts.filter((p) => (p as { valid?: unknown })?.valid === true).length;
      out.summary = `${head}, ${valid} of ${parts.length} definitions valid`;
    } else out.summary = head;
  }
  return out;
}

function limitsProblem(l: TurnLimits | undefined): string | undefined {
  const ok = (n: unknown, min: number) => typeof n === "number" && Number.isInteger(n) && n >= min;
  if (!l || !ok(l.maxRounds, 1) || !ok(l.maxOutputTokens, 1) || !ok(l.timeoutMs, 1)) {
    return "the turn limits are not valid: maxRounds, maxOutputTokens and timeoutMs must be whole numbers of 1 or more";
  }
  // Checked here, so a low limit is never reported as a budget that is used up.
  if (l.maxOutputTokens < MIN_OUTPUT_TOKENS) {
    return `the turn limits are not valid: maxOutputTokens must be at least ${MIN_OUTPUT_TOKENS}, the smallest max_tokens a request is sent with`;
  }
  return undefined;
}

/** Wait for p, or for the signal; never rejects. */
async function settle<T>(p: Promise<T>, signal: AbortSignal): Promise<{ done: true; value: T } | { done: false }> {
  if (signal.aborted) return { done: false };
  let onAbort: () => void = () => {};
  const aborted = new Promise<{ done: false }>((resolve) => {
    onAbort = () => resolve({ done: false });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([p.then((value) => ({ done: true as const, value })), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** The input preview of a tool_call event: at most INPUT_PREVIEW_BYTES of UTF-8. */
function preview(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= INPUT_PREVIEW_BYTES) return text;
  const note = `\n[cut here: ${bytes.length} bytes in all]`;
  let end = INPUT_PREVIEW_BYTES - Buffer.byteLength(note);
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + note;
}

function issues(list: ValidationIssue[]): string {
  const lines = list.slice(0, 5).map((e) => `${e.path || "/"} ${e.message}`);
  if (list.length > 5) lines.push(`and ${list.length - 5} more`);
  return lines.join("; ");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** One line of at most 300 characters. */
function cut(s: string): string {
  const t = oneLine(s);
  return t.length > 300 ? `${t.slice(0, 297)}...` : t;
}

function seconds(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

function zero(): TokenUsage {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

function sum(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
