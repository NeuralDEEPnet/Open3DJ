// The stream accumulator: every event and block type, usage, stop details, tool input parsing
// and the errors for anything it does not know.
import { test } from "node:test";
import assert from "node:assert/strict";
import { messageEvents } from "./fake-messages-api.testing.ts";
import type { FakeBlock, FakeSse } from "./fake-messages-api.testing.ts";
import { MessageAccumulator, StreamError, parseInput } from "./stream.ts";
import type { StreamUpdate } from "./stream.ts";

/** Apply the data of every event (comments skipped), like the engine does after the SSE parser. */
function run(events: FakeSse[]): { acc: MessageAccumulator; updates: StreamUpdate[] } {
  const acc = new MessageAccumulator();
  const updates: StreamUpdate[] = [];
  for (const e of events) if ("event" in e) updates.push(...acc.apply(e.data));
  return { acc, updates };
}

const start = (usage: Record<string, number> = { input_tokens: 10, output_tokens: 1 }) => ({ type: "message_start", message: { id: "m", role: "assistant", content: [], usage } });

test("text, tool_use, thinking and redacted_thinking become the final message, in order", () => {
  const content: FakeBlock[] = [
    { type: "thinking", thinking: "Plan the plate first.", signature: "sig-123" },
    { type: "redacted_thinking", data: "opaque==" },
    { type: "text", text: "I will run it. Grüße 🙂" },
    { type: "tool_use", id: "toolu_1", name: "run", input: { script: "return box(10, 10, 2);", params: { w: 3 } } },
  ];
  const { acc, updates } = run(messageEvents({ content, stop_reason: "tool_use", usage: { input_tokens: 120, output_tokens: 42, cache_read_input_tokens: 900, cache_creation_input_tokens: 30 } }));
  const f = acc.finish();
  assert.deepEqual(f.message, {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Plan the plate first.", signature: "sig-123" },
      { type: "redacted_thinking", data: "opaque==" },
      { type: "text", text: "I will run it. Grüße 🙂" },
      { type: "tool_use", id: "toolu_1", name: "run", input: { script: "return box(10, 10, 2);", params: { w: 3 } } },
    ],
  });
  assert.equal(f.stop_reason, "tool_use");
  assert.equal(f.stop_details, null);
  assert.deepEqual(f.usage, { input: 120, output: 42, cache_read: 900, cache_write: 30 });
  assert.deepEqual(f.inputs.get("toolu_1"), { raw: JSON.stringify({ script: "return box(10, 10, 2);", params: { w: 3 } }) });
  // Text deltas come out as they arrive; every block reports its stop.
  assert.equal(updates.filter((u) => u.type === "text").map((u) => (u as { delta: string }).delta).join(""), "I will run it. Grüße 🙂");
  assert.deepEqual(updates.filter((u) => u.type === "block_stop").map((u) => u.index), [0, 1, 2, 3]);
});

test("usage: message_start first, then each message_delta's fields replace it", () => {
  const acc = new MessageAccumulator();
  assert.equal(acc.started, false);
  acc.apply(start({ input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 }));
  assert.equal(acc.started, true);
  assert.deepEqual(acc.usage(), { input: 50, output: 1, cache_read: 7, cache_write: 3 });
  assert.equal(acc.outputReported, false, "message_start's output_tokens is not the reply's count");
  acc.apply({ type: "message_delta", delta: {}, usage: { input_tokens: 50 } });
  assert.equal(acc.outputReported, false, "a message_delta without output_tokens");
  acc.apply({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } });
  assert.equal(acc.outputReported, true);
  assert.deepEqual(acc.usage(), { input: 50, output: 9, cache_read: 7, cache_write: 3 });
  acc.apply({ type: "message_delta", delta: {}, usage: { input_tokens: 55, output_tokens: 12, cache_read_input_tokens: null } });
  assert.deepEqual(acc.usage(), { input: 55, output: 12, cache_read: 7, cache_write: 3 });
});

test("refusal keeps stop_details; ping and unknown event types are ignored", () => {
  const events = messageEvents({ content: [{ type: "text", text: "I can't" }], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "x" } });
  events.splice(2, 0, { event: "future_event", data: { type: "future_event", anything: 1 } });
  const f = run(events).acc.finish();
  assert.equal(f.stop_reason, "refusal");
  assert.deepEqual(f.stop_details, { type: "refusal", category: "cyber", explanation: "x" });
  const n = run(messageEvents({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } })).acc.finish();
  assert.deepEqual(n.message.content, [], "a refusal before any output has no content");
  assert.deepEqual(n.stop_details, { type: "refusal", category: null });
});

test("tool input is parsed at its block stop and never guessed", () => {
  const content: FakeBlock[] = [
    { type: "tool_use", id: "a", name: "run", input: "{\"script\": \"box(" },
    { type: "tool_use", id: "b", name: "docs", input: "[1, 2]" },
    { type: "tool_use", id: "c", name: "docs", input: "" },
    { type: "tool_use", id: "d", name: "docs", input: "{\"query\": \"fillet\"} trailing" },
  ];
  const f = run(messageEvents({ content, stop_reason: "tool_use" })).acc.finish();
  const blocks = f.message.content as Array<{ input: unknown }>;
  assert.deepEqual(blocks.map((b) => b.input), [{}, {}, {}, {}], "an unusable input becomes {} so the history stays valid");
  assert.match(f.inputs.get("a")!.error!, /^not valid JSON/);
  assert.equal(f.inputs.get("a")!.raw, "{\"script\": \"box(");
  assert.equal(f.inputs.get("b")!.error, "not a JSON object");
  assert.deepEqual(f.inputs.get("c"), { raw: "" }, "no input at all is an empty object");
  assert.match(f.inputs.get("d")!.error!, /^not valid JSON/);
  assert.deepEqual(parseInput(" {\"a\": [1]} "), { input: { a: [1] } });
  assert.deepEqual(parseInput("null"), { error: "not a JSON object" });
});

test("an unknown block type or delta type is an unsupported error, never a guess", () => {
  const block = messageEvents({ content: [{ type: "other", block: { type: "server_tool_use", id: "s", name: "web_search", input: {} } }], stop_reason: "end_turn" });
  assert.throws(() => run(block), (e: unknown) => e instanceof StreamError && e.code === "unsupported" && e.message === "unsupported response block server_tool_use; update Open3DJ");
  const acc = new MessageAccumulator();
  acc.apply(start());
  acc.apply({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  assert.throws(() => acc.apply({ type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: {} } }), /^StreamError: unsupported response delta citations_delta; update Open3DJ$/);
  // Odd names are made safe before they reach a message.
  const odd = new MessageAccumulator();
  odd.apply(start());
  assert.throws(() => odd.apply({ type: "content_block_start", index: 0, content_block: { type: "x\n<b>y" } }), /unsupported response block x__b_y; update Open3DJ/);
});

test("an error event stops the reply with the API's error type", () => {
  const acc = new MessageAccumulator();
  acc.apply(start());
  assert.throws(
    () => acc.apply({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
    (e: unknown) => e instanceof StreamError && e.code === "api_error" && e.apiType === "overloaded_error" && /overloaded_error: Overloaded/.test(e.message),
  );
});

test("a broken stream is a protocol error: order, indexes, block kinds and an early end", () => {
  const cases: Array<[string, unknown[], RegExp]> = [
    ["a delta before message_start", [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }], /before message_start/],
    ["message_start twice", [start(), start()], /message_start twice/],
    ["an index out of order", [start(), { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }], /block 1 where 0 was next/],
    ["a delta for a closed block", [start(), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_stop", index: 0 }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } }], /not open/],
    ["a delta of the wrong kind", [start(), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{" } }], /input_json_delta for a text block/],
    ["an event after message_stop", [start(), { type: "message_stop" }, { type: "message_delta", delta: {} }], /after message_stop/],
    ["content in message_start", [{ type: "message_start", message: { content: [{ type: "text", text: "x" }] } }], /message_start carried content/],
    ["not an object", ["text"], /not an object/],
  ];
  for (const [name, events, re] of cases) {
    const acc = new MessageAccumulator();
    assert.throws(() => {
      for (const e of events) acc.apply(e);
    }, re, name);
  }
  const early = new MessageAccumulator();
  assert.throws(() => early.finish(), /before the reply started/);
  early.apply(start());
  early.apply({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  assert.throws(() => early.finish(), /before the reply was complete/);
  early.apply({ type: "message_stop" });
  assert.throws(() => early.finish(), /block 0 still open/);
});
