// The server-sent-events parser: split chunks, CRLF and CR line ends, comments, multi-line
// data, the end of the stream and the size cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EVENT_BYTES, SseParser, readSse } from "./sse.ts";
import type { SseEvent } from "./sse.ts";

const enc = new TextEncoder();

/** Feed the bytes in pieces of n and collect every event, the end included. */
function feed(bytes: Uint8Array, n: number): SseEvent[] {
  const p = new SseParser();
  const out: SseEvent[] = [];
  for (let i = 0; i < bytes.length; i += n) out.push(...p.push(bytes.subarray(i, i + n)));
  out.push(...p.end());
  return out;
}

const STREAM = "event: message_start\ndata: {\"a\":\"Grüße 🙂\"}\n\n: a comment\nevent: ping\ndata: {}\n\ndata: line one\ndata: line two\n\n";
const EXPECTED: SseEvent[] = [
  { event: "message_start", data: "{\"a\":\"Grüße 🙂\"}" },
  { event: "ping", data: "{}" },
  { event: "message", data: "line one\nline two" },
];

test("events come out the same whatever the chunk size, also mid-line and mid-character", () => {
  const bytes = enc.encode(STREAM);
  for (let n = 1; n <= bytes.length; n++) assert.deepEqual(feed(bytes, n), EXPECTED, `chunks of ${n} bytes`);
});

test("CRLF and lone CR end lines too, also when a CRLF is split between chunks", () => {
  for (const eol of ["\r\n", "\r"]) {
    const bytes = enc.encode(STREAM.replaceAll("\n", eol));
    for (const n of [1, 2, 3, 5, 8, 13, bytes.length]) assert.deepEqual(feed(bytes, n), EXPECTED, `${JSON.stringify(eol)} in chunks of ${n}`);
  }
  // A CR at the end of a chunk and its LF in the next make one line end, not two.
  const p = new SseParser();
  assert.deepEqual(p.push(enc.encode("data: x\r")), []);
  assert.deepEqual(p.push(enc.encode("\n\r")), []);
  assert.deepEqual(p.push(enc.encode("\n")), [{ event: "message", data: "x" }]);
});

test("field rules: one leading space is removed, a field without a colon, id, unknown fields", () => {
  const out = feed(enc.encode("data:no space\ndata:  two spaces\nid: 7\nretry: 100\nfoo: bar\nevent\n\ndata\n\n"), 4);
  assert.deepEqual(out, [
    { event: "message", data: "no space\n two spaces", id: "7" },
    { event: "message", data: "", id: "7" },
  ]);
});

test("a block without data dispatches nothing and resets the event type", () => {
  const out = feed(enc.encode("event: ignored\n\nevent: \ndata: x\n\n: only a comment\n\n"), 3);
  assert.deepEqual(out, [{ event: "message", data: "x" }]);
});

test("a byte order mark at the start is skipped; an unfinished event at the end is dropped", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("data: first\n\ndata: half")]);
  assert.deepEqual(feed(bytes, 2), [{ event: "message", data: "first" }]);
  // A lone CR as the very last byte still ends its line, but no blank line follows.
  assert.deepEqual(feed(enc.encode("data: a\n\r"), 1), [{ event: "message", data: "a" }]);
});

test("an event larger than the cap stops the parser", () => {
  const p = new SseParser({ maxEventBytes: 64 });
  assert.throws(() => p.push(enc.encode(`data: ${"x".repeat(80)}`)), /server-sent event is larger than 64 bytes/);
  const q = new SseParser({ maxEventBytes: 64 });
  assert.throws(() => {
    for (let i = 0; i < 10; i++) q.push(enc.encode("data: 0123456789\n"));
  }, /larger than 64 bytes/);
  assert.equal(MAX_EVENT_BYTES, 32 * 1024 * 1024);
});

test("readSse reads a web stream and an async iterable", async () => {
  const bytes = enc.encode(STREAM);
  const web = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
      c.close();
    },
  });
  const a: SseEvent[] = [];
  for await (const e of readSse(web)) a.push(e);
  assert.deepEqual(a, EXPECTED);
  async function* gen() {
    for (let i = 0; i < bytes.length; i += 9) yield bytes.slice(i, i + 9);
  }
  const b: SseEvent[] = [];
  for await (const e of readSse(gen())) b.push(e);
  assert.deepEqual(b, EXPECTED);
});
