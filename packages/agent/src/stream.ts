// Messages API stream events to the final assistant message. Text, tool_use, thinking and
// redacted_thinking blocks are kept as the API sent them, so they go back unchanged in the
// next request. A tool_use input is parsed once, at its content_block_stop, and never guessed:
// input that is not a JSON object is kept as raw text with the reason, and the block's input
// becomes {}, so the history stays valid and the engine can answer with an is_error result.
// A block or delta type this code does not know ends the reply with an "unsupported" error.
import type { TokenUsage } from "./types.ts";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ThinkingBlock = { type: "thinking"; thinking: string; signature: string };
export type RedactedThinkingBlock = { type: "redacted_thinking"; data: string };
export type AssistantBlock = TextBlock | ToolUseBlock | ThinkingBlock | RedactedThinkingBlock;

export interface AssistantMessage {
  role: "assistant";
  content: AssistantBlock[];
}

/** stop_details of a refusal. Informational: branch on stop_reason, never on these fields. */
export interface StopDetails {
  type?: string;
  category?: string | null;
  explanation?: string | null;
}

/** The raw input of one tool_use block as streamed, and why it could not be used, if so. */
export interface ToolInput {
  raw: string;
  error?: string;
}

export interface FinalMessage {
  message: AssistantMessage;
  stop_reason: string | null;
  stop_details: StopDetails | null;
  usage: TokenUsage;
  /** Per tool_use id. */
  inputs: Map<string, ToolInput>;
}

/** What one event changed that the page may show at once. */
export type StreamUpdate = { type: "text"; index: number; delta: string } | { type: "block_stop"; index: number; block: AssistantBlock };

export type StreamErrorCode = "unsupported" | "api_error" | "protocol";

/** A reply that cannot be used: an unknown block or delta type, an error event or a broken stream. */
export class StreamError extends Error {
  readonly code: StreamErrorCode;
  /** The API's error type, for code "api_error" (for example overloaded_error). */
  readonly apiType: string | undefined;
  constructor(code: StreamErrorCode, message: string, apiType?: string) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.apiType = apiType;
  }
}

type Open = { block: AssistantBlock; parts: string[]; done: boolean };

/** A tool_use id or tool name as the Messages API documents them. */
const TOOL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class MessageAccumulator {
  #blocks: Open[] = [];
  #started = false;
  #outputReported = false;
  #stopped = false;
  #stopReason: string | null = null;
  #stopDetails: StopDetails | null = null;
  #usage: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  #inputs = new Map<string, ToolInput>();

  /** True once message_start arrived: the API counts input tokens from here. */
  get started(): boolean {
    return this.#started;
  }

  /**
   * True once a message_delta reported output_tokens. Until then usage().output is only
   * message_start's placeholder (usually 1), not what the reply used.
   */
  get outputReported(): boolean {
    return this.#outputReported;
  }

  /** The usage reported so far (message_start, then every message_delta). */
  usage(): TokenUsage {
    return { ...this.#usage };
  }

  /** Apply one parsed event (the data of an SSE event). Throws StreamError for anything it cannot use. */
  apply(event: unknown): StreamUpdate[] {
    const e = obj(event, "event");
    const type = e.type;
    if (this.#stopped && type !== "ping") throw new StreamError("protocol", `the API stream sent ${safe(type)} after message_stop`);
    switch (type) {
      case "ping":
        return [];
      case "error": {
        const err = (e.error ?? {}) as Record<string, unknown>;
        const apiType = typeof err.type === "string" ? safe(err.type) : "error";
        const message = typeof err.message === "string" ? err.message : "no message";
        throw new StreamError("api_error", `the API stopped the reply with ${apiType}: ${message}`, apiType);
      }
      case "message_start": {
        if (this.#started) throw new StreamError("protocol", "the API stream sent message_start twice");
        const m = obj(e.message, "message_start.message");
        if (Array.isArray(m.content) && m.content.length > 0) throw new StreamError("unsupported", "unsupported response: message_start carried content; update Open3DJ");
        this.#started = true;
        this.#takeUsage(m.usage);
        return [];
      }
      case "content_block_start":
        return this.#start(e);
      case "content_block_delta":
        return this.#delta(e);
      case "content_block_stop":
        return this.#stop(e);
      case "message_delta": {
        this.#mustHaveStarted(type);
        const d = (e.delta ?? {}) as Record<string, unknown>;
        if (typeof d.stop_reason === "string") this.#stopReason = d.stop_reason;
        if (d.stop_details && typeof d.stop_details === "object") this.#stopDetails = stopDetails(d.stop_details as Record<string, unknown>);
        if (this.#takeUsage(e.usage)) this.#outputReported = true;
        return [];
      }
      case "message_stop":
        this.#mustHaveStarted(type);
        this.#stopped = true;
        return [];
      default:
        // New event types may appear in later API versions; they carry nothing this code uses.
        return [];
    }
  }

  /** The finished message. Throws when the stream ended before message_stop or with a block open. */
  finish(): FinalMessage {
    if (!this.#started) throw new StreamError("protocol", "the API stream ended before the reply started");
    if (!this.#stopped) throw new StreamError("protocol", "the API stream ended before the reply was complete");
    const open = this.#blocks.findIndex((b) => b && !b.done);
    if (open >= 0) throw new StreamError("protocol", `the API stream ended with content block ${open} still open`);
    return {
      message: { role: "assistant", content: this.#blocks.map((b) => b.block) },
      stop_reason: this.#stopReason,
      stop_details: this.#stopDetails,
      usage: this.usage(),
      inputs: new Map(this.#inputs),
    };
  }

  #mustHaveStarted(type: unknown): void {
    if (!this.#started) throw new StreamError("protocol", `the API stream sent ${safe(type)} before message_start`);
  }

  #start(e: Record<string, unknown>): StreamUpdate[] {
    this.#mustHaveStarted(e.type);
    const index = this.#nextIndex(e.index);
    const cb = obj(e.content_block, "content_block");
    let block: AssistantBlock;
    const updates: StreamUpdate[] = [];
    switch (cb.type) {
      case "text": {
        const text = str(cb.text, "text.text", "");
        block = { type: "text", text };
        if (text !== "") updates.push({ type: "text", index, delta: text });
        break;
      }
      case "tool_use": {
        const id = str(cb.id, "tool_use.id");
        const name = str(cb.name, "tool_use.name");
        // The documented forms; anything else would break the next request or the page.
        if (!TOOL_ID.test(id) || !TOOL_ID.test(name)) throw new StreamError("protocol", "the API stream sent a tool_use id or name in an unexpected form");
        block = { type: "tool_use", id, name, input: {} };
        break;
      }
      case "thinking":
        block = { type: "thinking", thinking: str(cb.thinking, "thinking.thinking", ""), signature: str(cb.signature, "thinking.signature", "") };
        break;
      case "redacted_thinking":
        block = { type: "redacted_thinking", data: str(cb.data, "redacted_thinking.data") };
        break;
      default:
        throw new StreamError("unsupported", `unsupported response block ${safe(cb.type)}; update Open3DJ`);
    }
    this.#blocks[index] = { block, parts: [], done: false };
    return updates;
  }

  #delta(e: Record<string, unknown>): StreamUpdate[] {
    const { index, open } = this.#open(e);
    const d = obj(e.delta, "delta");
    const b = open.block;
    const expect = (blockType: AssistantBlock["type"]) => {
      if (b.type !== blockType) throw new StreamError("protocol", `the API stream sent ${safe(d.type)} for a ${b.type} block`);
    };
    switch (d.type) {
      case "text_delta": {
        expect("text");
        const text = str(d.text, "text_delta.text");
        (b as TextBlock).text += text;
        return text === "" ? [] : [{ type: "text", index, delta: text }];
      }
      case "input_json_delta":
        expect("tool_use");
        open.parts.push(str(d.partial_json, "input_json_delta.partial_json"));
        return [];
      case "thinking_delta":
        expect("thinking");
        (b as ThinkingBlock).thinking += str(d.thinking, "thinking_delta.thinking");
        return [];
      case "signature_delta":
        expect("thinking");
        (b as ThinkingBlock).signature += str(d.signature, "signature_delta.signature");
        return [];
      default:
        throw new StreamError("unsupported", `unsupported response delta ${safe(d.type)}; update Open3DJ`);
    }
  }

  #stop(e: Record<string, unknown>): StreamUpdate[] {
    const { index, open } = this.#open(e);
    open.done = true;
    const b = open.block;
    if (b.type === "tool_use") {
      const raw = open.parts.join("");
      const parsed = parseInput(raw);
      if ("error" in parsed) this.#inputs.set(b.id, { raw, error: parsed.error });
      else {
        b.input = parsed.input;
        this.#inputs.set(b.id, { raw });
      }
    }
    return [{ type: "block_stop", index, block: b }];
  }

  #nextIndex(raw: unknown): number {
    if (!Number.isInteger(raw) || (raw as number) !== this.#blocks.length) {
      throw new StreamError("protocol", `the API stream started content block ${safe(raw)} where ${this.#blocks.length} was next`);
    }
    return raw as number;
  }

  #open(e: Record<string, unknown>): { index: number; open: Open } {
    this.#mustHaveStarted(e.type);
    const index = e.index as number;
    const open = Number.isInteger(index) ? this.#blocks[index] : undefined;
    if (!open || open.done) throw new StreamError("protocol", `the API stream sent ${safe(e.type)} for content block ${safe(index)}, which is not open`);
    return { index, open };
  }

  /** Take the fields that are there. True when output_tokens was one of them. */
  #takeUsage(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const u = raw as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
    const input = n(u.input_tokens);
    const output = n(u.output_tokens);
    const read = n(u.cache_read_input_tokens);
    const write = n(u.cache_creation_input_tokens);
    if (input !== undefined) this.#usage.input = input;
    if (output !== undefined) this.#usage.output = output;
    if (read !== undefined) this.#usage.cache_read = read;
    if (write !== undefined) this.#usage.cache_write = write;
    return output !== undefined;
  }
}

/**
 * A tool input as streamed with eager input streaming: strict JSON, and an object. An empty
 * input is {} (a tool called with no arguments).
 */
export function parseInput(raw: string): { input: Record<string, unknown> } | { error: string } {
  if (raw.trim() === "") return { input: {} };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    return { error: `not valid JSON (${(e as Error).message.slice(0, 200)})` };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { error: "not a JSON object" };
  return { input: v as Record<string, unknown> };
}

function stopDetails(d: Record<string, unknown>): StopDetails {
  const out: StopDetails = {};
  if (typeof d.type === "string") out.type = d.type;
  if (typeof d.category === "string" || d.category === null) out.category = d.category as string | null;
  if (typeof d.explanation === "string" || d.explanation === null) out.explanation = d.explanation as string | null;
  return out;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new StreamError("protocol", `the API stream sent a ${what} that is not an object`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string, fallback?: string): string {
  if (typeof v === "string") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new StreamError("protocol", `the API stream sent ${what} that is not a string`);
}

/** A value safe to name in a message: letters, digits and _ . -, at most 64 characters. */
export function safe(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  return s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "_";
}
