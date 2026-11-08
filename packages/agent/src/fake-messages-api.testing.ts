// Scripted Messages API stream events for tests: the events of one assistant message as the
// API streams it (message_start, each block's start, deltas in small pieces and stop,
// message_delta, message_stop), with a ping and a comment mixed in. Text and tool input are
// cut into pieces of a few code points, so a parser sees many small deltas. Not exported
// from the package index.

/** One SSE event (its data is sent as JSON unless it is a string), or a comment line. */
export type FakeSse = { event: string; data: unknown } | { comment: string };

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
