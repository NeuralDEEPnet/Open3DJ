// A fake Messages API for tests: an HTTP server on 127.0.0.1 that answers each request with
// the next scripted reply, records every request (method, path, headers, body), and streams
// server-sent events in deliberately small chunks, so lines and UTF-8 characters are split
// between chunks. It can answer with any status (401, 404, 429 with retry-after, 500), stop
// a stream with an error event, end a reply with max_tokens or refusal, and keep a stream
// open until the client goes away. No test talks to the network. Not exported from the
// package index.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  /** Path and query, for example /v1/models?limit=100. */
  path: string;
  /** Lower-case header names. */
  headers: Record<string, string>;
  text: string;
  /** The body parsed as JSON, or undefined. */
  body: any;
}

/** One SSE event (its data is sent as JSON unless it is a string), or a comment line. */
export type FakeSse = { event: string; data: unknown } | { comment: string };

export interface FakeReply {
  /** Default 200. */
  status?: number;
  headers?: Record<string, string>;
  /** A JSON body (errors, model pages). */
  json?: unknown;
  /** A stream of events (content-type text/event-stream). */
  events?: FakeSse[];
  /** Bytes per chunk of the stream. Default 7. */
  chunkBytes?: number;
  /** End lines with CRLF instead of LF. */
  crlf?: boolean;
  /** Milliseconds between chunks. Default 0 (the next turn of the event loop). */
  pauseMs?: number;
  /** Keep the stream open after the events until the client goes away. */
  hang?: boolean;
}

export type ReplySource = FakeReply | ((req: RecordedRequest) => FakeReply | Promise<FakeReply>);

export interface FakeMessagesApi {
  /** The base URL, http://127.0.0.1:<port>. */
  url: string;
  requests: RecordedRequest[];
  /** Queue replies; each request takes the next one. With none left the fake answers 500. */
  reply(...replies: ReplySource[]): void;
  /** Replies not used yet. */
  pending(): number;
  /** Resolves when the client went away from a hanging or unfinished stream. */
  clientGone(): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeMessagesApi(): Promise<FakeMessagesApi> {
  const queue: ReplySource[] = [];
  const requests: RecordedRequest[] = [];
  let gone: () => void = () => {};
  let gonePromise = new Promise<void>((r) => (gone = r));
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    const recorded: RecordedRequest = { method: req.method ?? "", path: req.url ?? "", headers, text, body };
    requests.push(recorded);
    const next = queue.shift();
    const r: FakeReply = next === undefined
      ? { status: 500, json: { type: "error", error: { type: "api_error", message: "the fake Messages API has no scripted reply left" } } }
      : typeof next === "function" ? await next(recorded) : next;
    if (r.events) return stream(res, r);
    res.writeHead(r.status ?? 200, { "content-type": "application/json", ...r.headers });
    res.end(JSON.stringify(r.json ?? {}));
  }

  async function stream(res: ServerResponse, r: FakeReply): Promise<void> {
    let closed = false;
    res.on("close", () => {
      closed = true;
      gone();
    });
    res.writeHead(r.status ?? 200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...r.headers });
    const eol = r.crlf ? "\r\n" : "\n";
    const text = (r.events ?? []).map((e) => ("comment" in e ? `: ${e.comment}${eol}` : `event: ${e.event}${eol}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}${eol}${eol}`)).join("");
    const bytes = Buffer.from(text, "utf8");
    const n = Math.max(1, r.chunkBytes ?? 7);
    for (let i = 0; i < bytes.length && !closed; i += n) {
      res.write(bytes.subarray(i, i + n));
      await pause(r.pauseMs ?? 0);
    }
    if (r.hang) return; // the client's abort closes it
    if (!closed) res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply: (...r) => {
      queue.push(...r);
    },
    pending: () => queue.length,
    clientGone: () => {
      const p = gonePromise;
      gonePromise = new Promise<void>((r) => (gone = r));
      return p;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => (ms > 0 ? setTimeout(r, ms) : setImmediate(r)));
}

/** A content block of a scripted reply. A tool_use input given as a string is streamed as is, valid JSON or not. */
export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string | Record<string, unknown> }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "other"; block: Record<string, unknown> };

export interface FakeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Split text into pieces of up to n code points, so no piece ends inside a surrogate pair. */
export function pieces(text: string, n: number): string[] {
  const cps = [...text];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i += n) out.push(cps.slice(i, i + n).join(""));
  return out;
}

/**
 * The events of one assistant message, as the Messages API streams it: message_start, each
 * block (start, deltas in small pieces, stop), message_delta with the stop reason and usage,
 * then message_stop. A ping and a comment are mixed in.
 */
export function messageEvents(opts: { content: FakeBlock[]; stop_reason: string | null; stop_details?: unknown; usage?: FakeUsage; model?: string; id?: string }): FakeSse[] {
  const usage = { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...opts.usage };
  const events: FakeSse[] = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: { id: opts.id ?? "msg_fake", type: "message", role: "assistant", model: opts.model ?? "model-a", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } },
      },
    },
    { event: "ping", data: { type: "ping" } },
    { comment: "keep-alive" },
  ];
  opts.content.forEach((b, index) => {
    const delta = (d: Record<string, unknown>) => events.push({ event: "content_block_delta", data: { type: "content_block_delta", index, delta: d } });
    if (b.type === "text") {
      events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "text", text: "" } } });
      for (const p of pieces(b.text, 5)) delta({ type: "text_delta", text: p });
    } else if (b.type === "tool_use") {
      events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } } });
      const raw = typeof b.input === "string" ? b.input : JSON.stringify(b.input);
      for (const p of pieces(raw, 6)) delta({ type: "input_json_delta", partial_json: p });
    } else if (b.type === "thinking") {
      events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } } });
      for (const p of pieces(b.thinking, 8)) delta({ type: "thinking_delta", thinking: p });
      delta({ type: "signature_delta", signature: b.signature });
    } else if (b.type === "redacted_thinking") {
      events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "redacted_thinking", data: b.data } } });
    } else {
      events.push({ event: "content_block_start", data: { type: "content_block_start", index, content_block: b.block } });
    }
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index } });
  });
  const delta: Record<string, unknown> = { stop_reason: opts.stop_reason, stop_sequence: null };
  if (opts.stop_details !== undefined) delta.stop_details = opts.stop_details;
  events.push({ event: "message_delta", data: { type: "message_delta", delta, usage: { output_tokens: usage.output_tokens } } });
  events.push({ event: "message_stop", data: { type: "message_stop" } });
  return events;
}

/** A streamed reply of one message. */
export function streamReply(opts: Parameters<typeof messageEvents>[0], extra: Omit<FakeReply, "events"> = {}): FakeReply {
  return { ...extra, events: messageEvents(opts) };
}

/** An error reply as the API sends it: {type: "error", error: {type, message}}. */
export function errorReply(status: number, type: string, message: string, headers?: Record<string, string>): FakeReply {
  const r: FakeReply = { status, json: { type: "error", error: { type, message }, request_id: "req_fake" } };
  if (headers) r.headers = headers;
  return r;
}

/** The SSE error event the API sends when it stops a stream. */
export function errorEvent(type: string, message: string): FakeSse {
  return { event: "error", data: { type: "error", error: { type, message } } };
}
