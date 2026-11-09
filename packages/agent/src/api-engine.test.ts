// Engine A against the fake Messages API on 127.0.0.1 and the real tool handlers on the fake
// compute pool: the tool loop, append-only history, prompt caching, every stop reason, the
// limits, Stop, the injected base_rev, invalid tool input, and the key never leaking. Key-like
// strings are built at run time, never written as literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
// The fake compute pool is test data of @open3dj/mcp, not part of its public exports.
import { FAKE_INVENTORY, fakePlace, fakePool } from "../../mcp/src/testing.ts";
import type { FakePool } from "../../mcp/src/testing.ts";
import { API_BILLING, createApiEngine } from "./api-engine.ts";
import { createApiClient } from "./client.ts";
import { errorEvent, errorReply, messageEvents, startFakeMessagesApi, streamReply } from "./fake-messages-api.testing.ts";
import type { FakeMessagesApi } from "./fake-messages-api.testing.ts";
import { systemPrompt } from "./prompt.ts";
import type { AgentEventBody, Engine, RequestReport, TokenUsage, TurnEnd, TurnLimits, TurnRequest } from "./types.ts";

const fakeKey = () => ["sk", "ant", "api03", "M3n5B7v9".repeat(6)].join("-");
const LIMITS: TurnLimits = { maxRounds: 12, maxOutputTokens: 8192, timeoutMs: 30_000 };

interface Ledger {
  added: TokenUsage[];
  add(u: TokenUsage): void;
  remaining(): { input: number; output: number };
}

function ledger(input = 1_000_000, output = 100_000): Ledger {
  const l: Ledger = {
    added: [],
    add: (u) => void l.added.push(u),
    remaining: () => ({
      input: input - l.added.reduce((n, u) => n + u.input + u.cache_read + u.cache_write, 0),
      output: output - l.added.reduce((n, u) => n + u.output, 0),
    }),
  };
  return l;
}

interface Harness {
  api: FakeMessagesApi;
  engine: Engine;
  pool: FakePool;
  handlers: ToolHandlers;
  root: string;
  project: string;
  events: AgentEventBody[];
  reports: RequestReport[];
  revisions: number;
  ledger: Ledger;
  clock: { t: number };
  /** One prompt; options override any field of the request. */
  prompt(text: string, options?: Partial<TurnRequest>): Promise<TurnEnd>;
  /** The messages of request i. */
  messages(i: number): any[];
}

async function withEngine(fn: (h: Harness) => Promise<void>, opts: { slowMs?: number; ledger?: Ledger; key?: string; stopGraceMs?: number } = {}): Promise<void> {
  const api = await startFakeMessagesApi();
  const root = mkdtempSync(join(tmpdir(), "o3j-engine-"));
  const pool = fakePool({ slowMs: opts.slowMs ?? 300 });
  const handlers = createHandlers({ pool, inventory: FAKE_INVENTORY, place: fakePlace, root, interactiveMs: 5_000 });
  const client = createApiClient({ apiKey: opts.key ?? fakeKey(), baseUrl: api.url, sleep: async () => {} });
  const clock = { t: 1_000_000 };
  const project = join(root, "plate.o3j");
  const engineOpts: Parameters<typeof createApiEngine>[0] = { client, handlers, project, now: () => clock.t };
  if (opts.stopGraceMs !== undefined) engineOpts.stopGraceMs = opts.stopGraceMs;
  const engine = createApiEngine(engineOpts);
  const h: Harness = {
    api, engine, pool, handlers, root, project, events: [], reports: [], revisions: 0, ledger: opts.ledger ?? ledger(), clock,
    prompt: (text, options = {}) =>
      engine.turn({
        turn: "t_0001", text, model: "model-a", limits: LIMITS, ledger: h.ledger, signal: new AbortController().signal,
        emit: (e) => void h.events.push(e), onRevision: () => void h.revisions++, onRequest: (r) => void h.reports.push(r), ...options,
      }),
    messages: (i) => api.requests[i]!.body.messages,
  };
  try {
    await fn(h);
  } finally {
    await engine.close();
    await api.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const tool = (id: string, name: string, input: string | Record<string, unknown>) => ({ type: "tool_use" as const, id, name, input });
const text = (t: string) => ({ type: "text" as const, text: t });
const toolResults = (msg: any) => (msg.content as any[]).filter((b) => b.type === "tool_result");
const kinds = (events: AgentEventBody[]) => events.map((e) => e.kind);
const of = <K extends AgentEventBody["kind"]>(events: AgentEventBody[], kind: K) => events.filter((e): e is Extract<AgentEventBody, { kind: K }> => e.kind === kind);

test("a turn with two tool rounds on the real handlers: append-only requests, one user message of results per reply", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [text("I'll make the plate."), tool("toolu_1", "run", { script: "return [{ name: \"plate\", shape: box(10, 10, 2) }];" })], stop_reason: "tool_use", usage: { input_tokens: 900, output_tokens: 40, cache_creation_input_tokens: 5000 } }),
      streamReply({ content: [tool("toolu_2", "render", { view: "multiview" }), tool("toolu_3", "inspect", { fields: ["tree"] })], stop_reason: "tool_use", usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 5000 } }),
      streamReply({ content: [text("Done: the plate is r_0001.")], stop_reason: "end_turn", usage: { input_tokens: 60, output_tokens: 12, cache_read_input_tokens: 5200 } }),
    );
    const end = await h.prompt("Make a 10 mm plate");
    assert.deepEqual(end, { reason: "end_turn" });
    assert.equal(h.api.requests.length, 3);

    // Each request repeats the previous one's messages unchanged and adds to the end.
    for (let i = 1; i < 3; i++) assert.deepEqual(h.messages(i).slice(0, h.messages(i - 1).length), h.messages(i - 1), `request ${i} extends request ${i - 1}`);
    const m1 = h.messages(1);
    assert.deepEqual(m1[0], { role: "user", content: [{ type: "text", text: "Make a 10 mm plate" }] });
    assert.deepEqual(m1[1], { role: "assistant", content: [text("I'll make the plate."), { type: "tool_use", id: "toolu_1", name: "run", input: { script: "return [{ name: \"plate\", shape: box(10, 10, 2) }];" } }] });
    assert.equal(m1.length, 3);
    assert.equal(m1[2].role, "user");
    const r1 = toolResults(m1[2]);
    assert.equal(r1.length, 1);
    assert.equal(r1[0].tool_use_id, "toolu_1");
    assert.equal(r1[0].is_error, undefined);
    assert.equal(JSON.parse(r1[0].content[0].text).rev, "r_0001");
    // Both calls of the second reply come back in one user message, in order.
    const m2 = h.messages(2);
    const last = m2[m2.length - 1];
    assert.equal(last.role, "user");
    assert.deepEqual(toolResults(last).map((b) => b.tool_use_id), ["toolu_2", "toolu_3"]);
    assert.equal(last.content.length, 2, "nothing but the two results");
    assert.ok(toolResults(last)[0].content.some((b: any) => b.type === "image" && b.source.media_type === "image/png"), "the render's PNG goes back as an image");

    // Events: text as it streams, a call and a result per tool, usage per request.
    assert.equal(of(h.events, "text").map((e) => e.delta).join(""), "I'll make the plate.Done: the plate is r_0001.");
    assert.deepEqual(of(h.events, "tool_call").map((e) => [e.call, e.tool]), [["toolu_1", "run"], ["toolu_2", "render"], ["toolu_3", "inspect"]]);
    assert.match(of(h.events, "tool_call")[0]!.input_preview, /"script": "return \[\{ name: \\"plate\\"/);
    const results = of(h.events, "tool_result");
    assert.deepEqual(results.map((e) => [e.call, e.status, e.rev]), [["toolu_1", "ok", "r_0001"], ["toolu_2", "ok", "r_0001"], ["toolu_3", "ok", "r_0001"]]);
    assert.equal(results[0]!.summary, "r_0001 ok, 1 of 1 definitions valid");
    assert.equal(h.revisions, 1, "onRevision after the run only");
    const usage = of(h.events, "usage");
    assert.equal(usage.length, 3);
    assert.deepEqual(usage[0]!.request, { input: 900, output: 40, cache_read: 0, cache_write: 5000 });
    assert.deepEqual(usage[2]!.session, { input: 1010, output: 82, cache_read: 10200, cache_write: 5000 });
    assert.deepEqual(usage[2]!.remaining, h.ledger.remaining());
    assert.equal(h.ledger.added.length, 3);
    assert.deepEqual(h.reports.map((r) => [r.outcome, r.attempts, r.usage?.output]), [["ok", 1, 40], ["ok", 1, 30], ["ok", 1, 12]]);
    assert.equal(h.reports[0]!.bytes, Buffer.byteLength(h.api.requests[0]!.text));
    assert.deepEqual(h.pool.calls.map((j) => j.kind).slice(0, 2), ["run", "render"], "the run, then the render; inspect tree reads the store");

    // The history survives into the next prompt, after the final reply.
    h.api.reply(streamReply({ content: [text("Sure.")], stop_reason: "end_turn" }));
    assert.equal((await h.prompt("Thanks")).reason, "end_turn");
    const m3 = h.messages(3);
    assert.deepEqual(m3.slice(0, m2.length), m2);
    assert.deepEqual(m3.slice(m2.length), [{ role: "assistant", content: [text("Done: the plate is r_0001.")] }, { role: "user", content: [{ type: "text", text: "Thanks" }] }]);
    // reset() forgets it.
    h.engine.reset();
    h.api.reply(streamReply({ content: [text("Hello.")], stop_reason: "end_turn" }));
    await h.prompt("New start");
    assert.deepEqual(h.messages(4), [{ role: "user", content: [{ type: "text", text: "New start" }] }]);
  });
});

test("request shape and caching: one breakpoint on the system block, automatic caching on top, stable tools", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [tool("toolu_1", "docs", { query: "fillet" })], stop_reason: "tool_use" }), streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("How do I fillet?");
    const [a, b] = h.api.requests.map((r) => r.body);
    assert.deepEqual(Object.keys(a), ["model", "max_tokens", "system", "tools", "messages", "cache_control", "stream"]);
    for (const k of ["thinking", "effort", "output_config", "temperature", "top_p", "top_k"]) assert.equal(k in a, false, `${k} is never sent`);
    assert.equal(a.model, "model-a");
    assert.equal(a.max_tokens, LIMITS.maxOutputTokens);
    assert.equal(a.stream, true);
    assert.deepEqual(a.cache_control, { type: "ephemeral" });
    assert.deepEqual(a.system, [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(a.tools.map((t: any) => t.name), ["run", "inspect", "render", "export", "docs"]);
    for (const t of a.tools) {
      assert.equal(t.eager_input_streaming, true, t.name);
      assert.equal("cache_control" in t, false, `${t.name}: the system breakpoint covers the tools`);
    }
    assert.ok(!JSON.stringify(a.messages).includes("cache_control") && !JSON.stringify(b.messages).includes("cache_control"), "the conversation uses the automatic breakpoint only");
    // Tools and system are the same bytes in every request.
    const prefix = (t: string) => t.slice(t.indexOf("\"system\""), t.indexOf("\"messages\""));
    assert.equal(prefix(h.api.requests[0]!.text), prefix(h.api.requests[1]!.text));
    assert.equal(h.api.requests[0]!.headers["anthropic-version"], "2026-10-21");
  });
});

test("an injected base_rev turns a save in between into REV_CONFLICT, not an overwrite", async () => {
  await withEngine(async (h) => {
    const person = createHandlers({ pool: h.pool, inventory: FAKE_INVENTORY, place: fakePlace, root: h.root, interactiveMs: 5_000 });
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", { script: "return box(10, 10, 2);" })], stop_reason: "tool_use" }),
      async () => {
        // The person saves a change while the model thinks: the head moves to r_0002.
        const saved = await person.run({ project: h.project, script: "return box(20, 20, 2);" });
        assert.equal(saved.rev, "r_0002");
        return streamReply({ content: [tool("toolu_2", "run", { script: "return box(10, 10, 4);" })], stop_reason: "tool_use" });
      },
      streamReply({ content: [tool("toolu_3", "run", { script: "return box(10, 10, 5);", base_rev: "r_0002" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("Rebased.")], stop_reason: "end_turn" }),
    );
    assert.equal((await h.prompt("Make it thicker")).reason, "end_turn");
    const results = of(h.events, "tool_result");
    assert.deepEqual(results.map((e) => [e.status, e.code, e.rev]), [["ok", undefined, "r_0001"], ["error", "REV_CONFLICT", undefined], ["ok", undefined, "r_0003"]]);
    assert.match(of(h.events, "notice")[0]!.text, /run left out base_rev, so Open3DJ filled in r_0001/);
    assert.equal(of(h.events, "notice").length, 1, "only the call that left base_rev out is filled in");
    // The model's own call stays as it sent it in the history.
    assert.deepEqual(h.messages(2)[3].content[0].input, { script: "return box(10, 10, 4);" });
    assert.equal(h.revisions, 2);
    person.shutdown();
  });
});

test("invalid tool JSON and input that fails the schema are answered with is_error and never run", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", "{\"script\": \"return box(1, 1, \\q"), tool("toolu_2", "docs", { query: 5 }), tool("toolu_3", "inspect", { project: "other.o3j", fields: ["tree"] })], stop_reason: "tool_use" }),
      streamReply({ content: [text("Let me fix that.")], stop_reason: "end_turn" }),
    );
    assert.equal((await h.prompt("Go")).reason, "end_turn");
    assert.equal(h.pool.calls.length, 0, "no job ran");
    const m = h.messages(1);
    assert.deepEqual(m[1].content[0], { type: "tool_use", id: "toolu_1", name: "run", input: {} }, "the unusable input is {} in the history");
    const [bad, schema, refused] = toolResults(m[2]);
    assert.equal(bad.is_error, true);
    assert.match(bad.content[0].text, /^The tool input was not valid JSON .*so the tool did not run/);
    assert.deepEqual(JSON.parse(bad.content[1].text), { INVALID_JSON: "{\"script\": \"return box(1, 1, \\q" });
    assert.equal(schema.is_error, true);
    assert.match(schema.content[0].text, /^The tool input was invalid, so the tool did not run: \/query/);
    assert.equal(refused.is_error, true);
    assert.match(refused.content[0].text, /PATH_REFUSED/);
    assert.deepEqual(of(h.events, "tool_result").map((e) => e.code), ["BAD_INPUT", "BAD_INPUT", "PATH_REFUSED"]);
    assert.equal(of(h.events, "tool_call")[0]!.input_preview, "{\"script\": \"return box(1, 1, \\q", "the raw input is shown as it came");
  });
});

test("maxRounds: no request past the limit, and the last reply's calls get not-run results", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "docs", { query: "box" })], stop_reason: "tool_use" }),
      streamReply({ content: [tool("toolu_2", "docs", { query: "fillet" }), tool("toolu_3", "docs", { query: "shell" })], stop_reason: "tool_use" }),
    );
    const end = await h.prompt("Read the docs", { limits: { ...LIMITS, maxRounds: 2 } });
    assert.equal(end.reason, "max_rounds");
    assert.match(end.message!, /used its 2 rounds/);
    assert.equal(h.api.requests.length, 2);
    assert.deepEqual(of(h.events, "tool_result").map((e) => [e.call, e.code ?? e.status]), [["toolu_1", "ok"], ["toolu_2", "NOT_RUN"], ["toolu_3", "NOT_RUN"]]);
    h.api.reply(streamReply({ content: [text("Going on.")], stop_reason: "end_turn" }));
    await h.prompt("Go on");
    const m = h.messages(2);
    const closing = m[m.length - 2];
    assert.deepEqual(toolResults(closing).map((b) => [b.tool_use_id, b.is_error, b.content[0].text]), [
      ["toolu_2", true, "not run: this prompt's limit of 2 tool rounds was reached."],
      ["toolu_3", true, "not run: this prompt's limit of 2 tool rounds was reached."],
    ]);
    assert.deepEqual(m[m.length - 1], { role: "user", content: [{ type: "text", text: "Go on" }] });
  });
});

test("budget: max_tokens is capped by what is left, and too little ends the turn before any request", async () => {
  const small = ledger(1_000_000, 5_000);
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "docs", { query: "box" })], stop_reason: "tool_use", usage: { output_tokens: 4_500 } }),
      streamReply({ content: [text("never sent")], stop_reason: "end_turn" }),
    );
    const end = await h.prompt("Go");
    assert.equal(h.api.requests[0]!.body.max_tokens, 5_000, "capped by the 5,000 output tokens left");
    assert.equal(end.reason, "budget");
    assert.match(end.message!, /only 500 output tokens are left in this session's budget, fewer than the 1024/);
    assert.equal(h.api.requests.length, 1);
    assert.deepEqual(of(h.events, "usage")[0]!.remaining, { input: 1_000_000 - 100, output: 500 });

    const before = h.api.requests.length;
    assert.equal((await h.prompt("Again")).reason, "budget");
    assert.equal(h.api.requests.length, before, "no request");
  }, { ledger: small });

  await withEngine(async (h) => {
    const end = await h.prompt("Go");
    assert.equal(end.reason, "budget");
    assert.match(end.message!, /input token budget is used up/);
    assert.equal(h.api.requests.length, 0);
    assert.equal((await h.engine.status()).conversation!.messages, 0, "a prompt that was never sent is not in the history");
  }, { ledger: ledger(0, 100_000) });
});

test("budget: a reply cut off before the API reports its output tokens counts the request's whole max_tokens", async () => {
  await withEngine(async (h) => {
    // About 5,000 tokens of text stream, then Stop: the final message_delta never comes.
    const events = messageEvents({ content: [text("x".repeat(20_000))], stop_reason: "end_turn", usage: { output_tokens: 5_000 } });
    h.api.reply({ events: events.slice(0, -2), hang: true, chunkBytes: 4096 });
    const stop = new AbortController();
    let shown = 0;
    const end = await h.prompt("Long", {
      signal: stop.signal,
      emit: (e) => {
        h.events.push(e);
        if (e.kind === "text" && (shown += e.delta.length) >= 20_000) stop.abort();
      },
    });
    assert.equal(end.reason, "stopped");
    assert.equal(h.ledger.added.length, 1);
    assert.equal(h.ledger.added[0]!.output, LIMITS.maxOutputTokens, "the request's max_tokens, not the 1 of message_start");
    assert.ok(h.ledger.added[0]!.output >= shown / 4, "at least an estimate from the streamed text");
    assert.equal(h.reports[0]!.usage!.output, LIMITS.maxOutputTokens);
    assert.equal(of(h.events, "usage")[0]!.request.output, LIMITS.maxOutputTokens);
    assert.equal(of(h.events, "notice")[0]!.text, "The reply ended before the API reported its output tokens, so this request's whole limit of 8192 output tokens counts against the session budget.");

    // The connection drops after message_delta: the reported count is booked.
    h.api.reply({ events: messageEvents({ content: [text("short")], stop_reason: "end_turn", usage: { output_tokens: 7 } }).slice(0, -1) });
    assert.equal((await h.prompt("Short")).reason, "error");
    assert.equal(h.ledger.added[1]!.output, 7);
  });

  // A mid-stream error event under a small budget: what is left is the request's max_tokens, so the cap holds.
  await withEngine(async (h) => {
    h.api.reply({ events: [...messageEvents({ content: [text("Half a reply")], stop_reason: "end_turn" }).slice(0, 7), errorEvent("overloaded_error", "Overloaded")] });
    assert.equal((await h.prompt("Go")).reason, "error");
    assert.equal(h.api.requests[0]!.body.max_tokens, 5_000);
    assert.deepEqual(h.ledger.remaining(), { input: 1_000_000 - 100, output: 0 });
    assert.equal((await h.prompt("Again")).reason, "budget");
    assert.equal(h.api.requests.length, 1, "no request past the cap");
  }, { ledger: ledger(1_000_000, 5_000) });
});

test("max_tokens inside a tool call: the call is not run, one more request asks for a shorter one, then the turn ends", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", "{\"script\": \"return box(1, 1,")], stop_reason: "max_tokens" }),
      streamReply({ content: [tool("toolu_2", "run", "{\"script\": \"return box(")], stop_reason: "max_tokens" }),
    );
    const end = await h.prompt("Write a long script");
    assert.equal(end.reason, "max_tokens");
    assert.equal(h.api.requests.length, 2);
    assert.equal(h.pool.calls.length, 0);
    const m = h.messages(1);
    const closing = toolResults(m[m.length - 1]);
    assert.equal(closing[0].tool_use_id, "toolu_1");
    assert.match(closing[0].content[0].text, /^not run: the reply reached its output token limit while writing this call.*shorter input/);
    assert.match(of(h.events, "notice")[0]!.text, /asks once for a shorter call/);

    h.api.reply(streamReply({ content: [text("A long answer that was cut")], stop_reason: "max_tokens" }));
    const plain = await h.prompt("Explain");
    assert.deepEqual(plain, { reason: "max_tokens", message: "the reply reached its output token limit of 8192 tokens" });
  });
});

const LEFT_OUT = "It was left out of the conversation: rephrase it to go on.";

test("refusal: the partial reply is discarded, the prompt is left out, a notice names the category, nothing runs", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [text("Sure, here is how to"), tool("toolu_1", "run", "{\"scr")], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "Not this one." } }));
    const end = await h.prompt("Something");
    assert.deepEqual(end, { reason: "refusal", message: `the model declined this request (category: cyber). ${LEFT_OUT}` });
    assert.equal(h.pool.calls.length, 0);
    assert.deepEqual(of(h.events, "tool_call"), [], "a call in a declined reply is not shown as a step");
    const discard = h.events.findIndex((e) => e.kind === "discard");
    assert.deepEqual(h.events[discard], { kind: "discard", reason: "the model declined this request" });
    assert.ok(discard > h.events.findLastIndex((e) => e.kind === "text"), "the shown text is discarded...");
    assert.ok(discard < h.events.findIndex((e) => e.kind === "usage"), "...before the usage event, so the page still holds it open");
    const notice = of(h.events, "notice")[0]!;
    assert.equal(notice.level, "warn");
    assert.equal(notice.text, "The model declined this request (category: cyber). Not this one. The prompt, the declined reply and any tool steps of this prompt were left out of the conversation; revisions stay in the project. Rephrase the prompt to go on.");
    assert.equal((await h.engine.status()).conversation!.messages, 0);
    // A refusal before any output: nothing to discard.
    h.api.reply(streamReply({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } }), streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    const n = h.events.length;
    assert.deepEqual(await h.prompt("Again"), { reason: "refusal", message: `the model declined this request. ${LEFT_OUT}` });
    assert.equal(of(h.events.slice(n), "discard").length, 0);
    await h.prompt("Third");
    assert.deepEqual(h.messages(2), [{ role: "user", content: [{ type: "text", text: "Third" }] }], "neither a declined prompt nor the partial reply is sent again");
  });
});

test("refusal after a tool round: the whole prompt is left out, and base_rev goes back to what the conversation saw", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", { script: "return box(10, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("Made r_0001.")], stop_reason: "end_turn" }),
    );
    await h.prompt("One");
    const kept = [...h.messages(1), { role: "assistant", content: [text("Made r_0001.")] }];
    h.api.reply(
      streamReply({ content: [tool("toolu_2", "run", { script: "return box(20, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("I won't")], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
    );
    assert.equal((await h.prompt("Two")).reason, "refusal");
    assert.equal(of(h.events, "tool_result")[1]!.rev, "r_0002", "the revision of that round stays in the project");
    h.api.reply(
      streamReply({ content: [tool("toolu_3", "run", { script: "return box(30, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("The head moved.")], stop_reason: "end_turn" }),
    );
    await h.prompt("Three");
    assert.deepEqual(h.messages(4), [...kept, { role: "user", content: [{ type: "text", text: "Three" }] }], "nothing of Two is sent again");
    assert.match(of(h.events, "notice").at(-1)!.text, /filled in r_0001, the last revision this conversation saw/);
    assert.equal(of(h.events, "tool_result").at(-1)!.code, "REV_CONFLICT", "r_0002, which the conversation no longer shows, is reported, not overwritten");
  });
});

// Regression (review of the refusal fix): when the declined prompt was the first to see a
// revision, the conversation had no head to go back to, so a later run without base_rev got no
// base_rev at all and silently built on a revision the model never saw.
test("refusal on the first prompt: a later run without base_rev is refused until the conversation sees the head", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", { script: "return box(10, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("I won't")], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
    );
    assert.equal((await h.prompt("One")).reason, "refusal");
    assert.equal(of(h.events, "tool_result")[0]!.rev, "r_0001", "the declined prompt's revision stays in the project");
    h.api.reply(
      streamReply({ content: [tool("toolu_2", "run", { script: "return box(99, 99, 99);" })], stop_reason: "tool_use" }),
      streamReply({ content: [tool("toolu_3", "inspect", { fields: ["tree"] })], stop_reason: "tool_use" }),
      streamReply({ content: [tool("toolu_4", "run", { script: "return box(99, 99, 99);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("Built on r_0001.")], stop_reason: "end_turn" }),
    );
    await h.prompt("Two");
    const results = of(h.events, "tool_result");
    const refused = results.find((e) => e.call === "toolu_2")!;
    assert.equal(refused.code, "NOT_RUN", "the run is refused, not built on an unseen head");
    assert.match(refused.summary, /r_0001.*left out of the conversation.*[Ii]nspect/);
    assert.match(of(h.events, "notice").at(-1)!.text, /filled in r_0001/, "after inspect, the conversation has seen r_0001 and the run builds on it");
    assert.equal(results.find((e) => e.call === "toolu_4")!.rev, "r_0002");
  });
});

// The gen guard on the refusal's restore: a reset() while the declined request finishes must not
// carry the old conversation's head, or its unseen-head guard, into the new conversation.
test("reset() while a declined request finishes leaves the new conversation without the old head", async () => {
  await withEngine(async (h) => {
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "run", { script: "return box(10, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("Made r_0001.")], stop_reason: "end_turn" }),
    );
    await h.prompt("One");
    let requests = 0;
    h.api.reply(
      streamReply({ content: [tool("toolu_2", "run", { script: "return box(20, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("I won't")], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
    );
    assert.equal((await h.prompt("Two", { onRequest: () => { if (++requests === 2) h.engine.reset(); } })).reason, "refusal");
    h.api.reply(
      streamReply({ content: [tool("toolu_3", "run", { script: "return box(30, 10, 2);" })], stop_reason: "tool_use" }),
      streamReply({ content: [text("A new start.")], stop_reason: "end_turn" }),
    );
    await h.prompt("Three");
    const last = of(h.events, "tool_result").at(-1)!;
    assert.equal(last.call, "toolu_3");
    assert.notEqual(last.code, "REV_CONFLICT", "no old head was filled in");
    assert.notEqual(last.code, "NOT_RUN", "no old unseen-head guard was carried over");
    assert.ok(!of(h.events, "notice").some((n) => /filled in/.test(n.text) && h.events.indexOf(n) > h.events.indexOf(of(h.events, "tool_result").find((e) => e.call === "toolu_2")!)), "no filled-in notice in the new conversation");
  });
});

test("model_context_window_exceeded: a cut-off call is closed, and the turn asks for a new conversation", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [text("I'll change the"), tool("toolu_1", "run", "{\"script\": \"ret")], stop_reason: "model_context_window_exceeded" }));
    assert.deepEqual(await h.prompt("Change it"), { reason: "context_window", message: "the conversation reached the model's context window. Press New conversation to go on." });
    assert.equal(h.pool.calls.length, 0);
    const closing = "not run: the conversation reached the model's context window while this call was written.";
    assert.deepEqual(of(h.events, "tool_result").map((e) => [e.call, e.code, e.summary]), [["toolu_1", "NOT_RUN", closing]]);
    // The history stays valid: the reply is kept and its call has a result.
    h.api.reply(streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("Next");
    assert.deepEqual(h.messages(1).map((m: any) => [m.role, m.content.map((b: any) => b.type).join(",")]), [["user", "text"], ["assistant", "text,tool_use"], ["user", "tool_result"], ["user", "text"]]);
    assert.equal(toolResults(h.messages(1)[2])[0].content[0].text, closing);
  });
});

test("the other stop reasons: stop_sequence ends, pause_turn goes on, an unknown one is an error", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [text("a")], stop_reason: "stop_sequence" }));
    assert.deepEqual(await h.prompt("1"), { reason: "end_turn" });
    h.api.reply(streamReply({ content: [text("part one")], stop_reason: "pause_turn" }), streamReply({ content: [text("part two")], stop_reason: "end_turn" }));
    assert.deepEqual(await h.prompt("2"), { reason: "end_turn" });
    assert.equal(h.api.requests.length, 3);
    const m = h.messages(2);
    assert.deepEqual(m[m.length - 1], { role: "assistant", content: [text("part one")] }, "the paused reply is sent back as the last message");
    h.api.reply(streamReply({ content: [tool("toolu_9", "docs", { query: "x" })], stop_reason: "something_new" }));
    const end = await h.prompt("3");
    assert.deepEqual(end, { reason: "error", message: "unsupported stop reason something_new; update Open3DJ" });
    assert.equal(h.pool.calls.length, 0);
  });
});

test("Stop mid-stream: the partial reply is discarded and never joins the history", async () => {
  await withEngine(async (h) => {
    const events = messageEvents({ content: [text("This reply will be stopped halfway through.")], stop_reason: "end_turn" });
    h.api.reply({ events: events.slice(0, 8), hang: true });
    const stop = new AbortController();
    const end = await h.prompt("Long answer", {
      signal: stop.signal,
      emit: (e) => {
        h.events.push(e);
        if (e.kind === "text") stop.abort();
      },
    });
    assert.deepEqual(end, { reason: "stopped", message: "stopped by the person" });
    assert.ok(of(h.events, "text").length >= 1);
    const discard = h.events.findIndex((e) => e.kind === "discard");
    assert.ok(discard > 0, "a discard event follows the text");
    assert.deepEqual(h.events[discard], { kind: "discard", reason: "stopped by the person" });
    assert.equal(of(h.events, "usage").length, 1, "the input the API counted is booked");
    assert.equal(h.reports[0]!.outcome, "stopped");
    h.api.reply(streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("Short answer");
    assert.deepEqual(h.messages(1), [{ role: "user", content: [{ type: "text", text: "Short answer" }] }], "a prompt that got no reply is left out");
  });
});

test("a prompt that got no reply is left out, so sending it again sends it once; a later round keeps the work", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [text("Hello.")], stop_reason: "end_turn" }));
    await h.prompt("Hi");
    const before = (await h.engine.status()).conversation;
    h.api.reply(errorReply(404, "not_found_error", "model: model-z"));
    assert.match((await h.prompt("Make a bracket", { model: "model-z" })).message!, /^unknown model/);
    assert.deepEqual((await h.engine.status()).conversation, before, "the history is as it was before the prompt");
    h.api.reply(streamReply({ content: [text("Made.")], stop_reason: "end_turn" }));
    await h.prompt("Make a bracket");
    assert.deepEqual(h.messages(2).map((m: any) => [m.role, m.content[0].text]), [["user", "Hi"], ["assistant", "Hello."], ["user", "Make a bracket"]]);

    // A failure after a tool round keeps the prompt and the round: the model did that work.
    h.api.reply(
      streamReply({ content: [tool("toolu_1", "docs", { query: "box" })], stop_reason: "tool_use" }),
      errorReply(500, "api_error", "boom"), errorReply(500, "api_error", "boom"), errorReply(500, "api_error", "boom"),
    );
    assert.equal((await h.prompt("Read the docs")).reason, "error");
    h.api.reply(streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("Go on");
    const m = h.messages(h.api.requests.length - 1);
    assert.deepEqual(m.slice(4).map((x: any) => [x.role, x.content[0].type]), [["user", "text"], ["assistant", "tool_use"], ["user", "tool_result"], ["user", "text"]]);
    assert.equal(m[4].content[0].text, "Read the docs");
  });
});

test("reset() during a turn stops it, and the next prompt starts a new conversation", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [text("first")], stop_reason: "end_turn" }));
    await h.prompt("One");
    h.api.reply({ events: messageEvents({ content: [text("interrupted")], stop_reason: "end_turn" }).slice(0, 6), hang: true });
    const end = await h.prompt("Two", {
      emit: (e) => {
        h.events.push(e);
        if (e.kind === "text" && e.delta.startsWith("int")) h.engine.reset();
      },
    });
    assert.equal(end.reason, "stopped");
    h.api.reply(streamReply({ content: [text("fresh")], stop_reason: "end_turn" }));
    await h.prompt("Three");
    assert.deepEqual(h.messages(2), [{ role: "user", content: [{ type: "text", text: "Three" }] }]);
    assert.deepEqual((await h.engine.status()).conversation!.messages, 2);
  });
});

test("the time limit: a hanging stream ends with timeout, and the clock is checked between steps", async () => {
  await withEngine(async (h) => {
    h.api.reply({ events: messageEvents({ content: [text("slow")], stop_reason: "end_turn" }).slice(0, 5), hang: true });
    const end = await h.prompt("Wait", { limits: { ...LIMITS, timeoutMs: 150 } });
    assert.deepEqual(end, { reason: "timeout", message: "the turn reached its time limit of 0.1 s" });
    assert.equal(of(h.events, "discard")[0]!.reason, "the turn reached its time limit");
    // The injected clock passes the deadline while the reply streams: the calls are not run.
    h.api.reply(() => {
      h.clock.t += 31_000;
      return streamReply({ content: [tool("toolu_1", "docs", { query: "a" })], stop_reason: "tool_use" });
    });
    const late = await h.prompt("Docs");
    assert.equal(late.reason, "timeout");
    assert.deepEqual(of(h.events, "tool_result").map((e) => [e.code, e.summary]), [["NOT_RUN", "not run: the turn reached its time limit."]]);
  });
});

test("Stop during a tool run: its job is cancelled and every open call gets a stopped result", async () => {
  await withEngine(async (h) => {
    h.api.reply(streamReply({ content: [tool("toolu_1", "run", { script: "// slow\nreturn box(1, 1, 1);" }), tool("toolu_2", "docs", { query: "box" })], stop_reason: "tool_use" }));
    const stop = new AbortController();
    const t0 = Date.now();
    const end = await h.prompt("Run the slow one", {
      signal: stop.signal,
      emit: (e) => {
        h.events.push(e);
        if (e.kind === "tool_call" && e.tool === "run") setTimeout(() => stop.abort(), 30);
      },
    });
    assert.deepEqual(end, { reason: "stopped", message: "stopped by the person" });
    assert.ok(Date.now() - t0 < 5_000, "the 60 s job did not hold the turn");
    assert.equal(h.pool.calls.length, 1);
    assert.equal(h.revisions, 0, "no revision");
    assert.deepEqual(of(h.events, "tool_result").map((e) => [e.call, e.status]), [["toolu_1", "error"], ["toolu_2", "error"]]);
    h.api.reply(streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("What happened?");
    const m = h.messages(1);
    const results = toolResults(m[2]);
    assert.deepEqual(results.map((b) => [b.tool_use_id, b.is_error]), [["toolu_1", true], ["toolu_2", true]]);
    assert.equal(results[0].content[0].text, "stopped by the person while this call ran.");
    assert.match(results[0].content[1].text, /JOB_CANCELLED/, "the cancelled job's own result follows");
    assert.equal(results[1].content[0].text, "not run: stopped by the person.");
    assert.deepEqual(m[3], { role: "user", content: [{ type: "text", text: "What happened?" }] });
  }, { slowMs: 60_000 });
});

test("thinking and redacted_thinking blocks go back unchanged", async () => {
  await withEngine(async (h) => {
    const thinking = { type: "thinking" as const, thinking: "Check the docs first.", signature: "c2lnbmF0dXJl" };
    const redacted = { type: "redacted_thinking" as const, data: "b3BhcXVl" };
    h.api.reply(streamReply({ content: [thinking, redacted, tool("toolu_1", "docs", { query: "box" })], stop_reason: "tool_use" }), streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("Docs please");
    assert.deepEqual(h.messages(1)[1], { role: "assistant", content: [thinking, redacted, { type: "tool_use", id: "toolu_1", name: "docs", input: { query: "box" } }] });
    assert.equal(of(h.events, "text").map((e) => e.delta).join(""), "ok", "thinking is not shown as text");
  });
});

test("errors end the turn with plain words: 401, unknown model, a mid-stream error event, an unknown block", async () => {
  await withEngine(async (h) => {
    h.api.reply(errorReply(401, "authentication_error", "invalid x-api-key"));
    const a = await h.prompt("1");
    assert.equal(a.reason, "error");
    assert.match(a.message!, /^the API key was refused/);
    h.api.reply(errorReply(404, "not_found_error", "model: model-z"));
    assert.match((await h.prompt("2", { model: "model-z" })).message!, /^unknown model/);
    const events = messageEvents({ content: [text("Half a reply")], stop_reason: "end_turn" }).slice(0, 7);
    h.api.reply({ events: [...events, errorEvent("overloaded_error", "Overloaded")] });
    const c = await h.prompt("3");
    assert.equal(c.reason, "error");
    assert.equal(c.message, "the API stopped the reply with overloaded_error: Overloaded. Nothing from that reply was kept.");
    assert.equal(of(h.events, "discard")[0]!.reason, "the reply failed");
    h.api.reply(streamReply({ content: [{ type: "other", block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } }], stop_reason: "end_turn" }));
    const d = await h.prompt("4");
    assert.equal(d.message, "unsupported response block server_tool_use; update Open3DJ. Nothing from that reply was kept.");
    assert.deepEqual(h.reports.map((r) => r.outcome), ["error", "error", "error", "error"]);
  });
});

test("a retry shows a notice and the request report counts the attempts", async () => {
  await withEngine(async (h) => {
    h.api.reply(errorReply(429, "rate_limit_error", "slow down", { "retry-after": "1" }), streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    assert.equal((await h.prompt("Hi")).reason, "end_turn");
    assert.equal(of(h.events, "notice")[0]!.text, "The request failed (HTTP 429); trying again in 1 s, attempt 2 of 3.");
    assert.equal(h.reports[0]!.attempts, 2);
  });
});

test("the key never appears in anything the engine emits, returns or reports", async () => {
  const key = fakeKey();
  await withEngine(async (h) => {
    const ends: TurnEnd[] = [];
    // The model repeats the key in text (split across deltas) and in a tool input.
    h.api.reply(
      streamReply({ content: [text(`Your key is ${key} and again ${key}`), tool("toolu_1", "docs", { query: key })], stop_reason: "tool_use" }),
      streamReply({ content: [text(`still ${key.slice(0, 20)}`)], stop_reason: "refusal", stop_details: { type: "refusal", category: "x", explanation: `no ${key}` } }),
    );
    ends.push(await h.prompt(`Here is my key ${key}`));
    // Errors that echo it.
    h.api.reply(errorReply(400, "invalid_request_error", `bad ${key}`));
    ends.push(await h.prompt("again"));
    h.api.reply({ events: [...messageEvents({ content: [text("x")], stop_reason: "end_turn" }).slice(0, 4), errorEvent("api_error", `oops ${key}`)] });
    ends.push(await h.prompt("again"));
    h.api.reply(errorReply(429, "rate_limit_error", `wait ${key}`), streamReply({ content: [text("fine")], stop_reason: "end_turn" }));
    ends.push(await h.prompt("again"));
    const all = JSON.stringify({ events: h.events, ends, reports: h.reports, status: await h.engine.status() });
    for (const part of [key, key.slice(-24), key.slice(7, 31)]) assert.ok(!all.includes(part), `found ${part.length} characters of the key`);
    const shown = of(h.events, "text").map((e) => e.delta).join("");
    assert.match(shown, /^Your key is \[redacted key\] and again \[redacted key\]still \[redacted key\]/);
    assert.equal(shown.includes("sk-ant-"), false);
    // What goes to the API is untouched: the person's own prompt is sent as typed.
    assert.ok(h.api.requests[0]!.text.includes(key));
  }, { key });
});

test("refusals before a turn: no model, bad limits, a second turn at once, a closed engine; and status", async () => {
  await withEngine(async (h) => {
    assert.deepEqual(await h.prompt("x", { model: "" }), { reason: "error", message: "no model is picked: load the models and pick one" });
    assert.match((await h.prompt("x", { limits: { ...LIMITS, maxRounds: 0 } })).message!, /turn limits are not valid/);
    // A per-request limit under the floor is the limit's fault, not the budget's.
    assert.deepEqual(await h.prompt("x", { limits: { ...LIMITS, maxOutputTokens: 500 } }), {
      reason: "error", message: "the turn limits are not valid: maxOutputTokens must be at least 1024, the smallest max_tokens a request is sent with",
    });
    assert.equal(h.api.requests.length, 0);
    assert.deepEqual(h.ledger.remaining(), { input: 1_000_000, output: 100_000 });
    const s0 = await h.engine.status();
    assert.equal(s0.id, "api");
    assert.equal(s0.ready, true);
    assert.equal(s0.billing, API_BILLING);
    assert.equal(s0.host, new URL(h.api.url).host);
    assert.deepEqual(s0.conversation, { messages: 0, bytes: 2 });
    assert.equal(s0.instructions!.tools, 5);
    assert.match(s0.instructions!.hash, /^[0-9a-f]{16}$/);
    assert.deepEqual((await h.engine.status()).instructions, s0.instructions, "the same instructions every time");

    const events = messageEvents({ content: [text("slow")], stop_reason: "end_turn" });
    h.api.reply({ events, pauseMs: 5 });
    const first = h.prompt("one");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await h.prompt("two"), { reason: "error", message: "a turn is already running" });
    assert.equal((await first).reason, "end_turn");
    const s1 = await h.engine.status();
    assert.equal(s1.conversation!.messages, 2);
    assert.ok(s1.conversation!.bytes > 20);
    await h.engine.close();
    assert.deepEqual(await h.prompt("x"), { reason: "error", message: "the API engine is closed" });
    assert.equal((await h.engine.status()).ready, false);
  });
  assert.throws(() => createApiEngine({ client: createApiClient({ apiKey: fakeKey() }), handlers: {} as ToolHandlers, project: "relative/plate.o3j" }), /absolute path/);
});

test("a long input is cut in its preview, with the size of the whole", async () => {
  await withEngine(async (h) => {
    const script = `// ${"é".repeat(40_000)}\nreturn box(1, 1, 1);`;
    h.api.reply(streamReply({ content: [tool("toolu_1", "docs", { query: script })], stop_reason: "tool_use" }, { chunkBytes: 4096 }), streamReply({ content: [text("ok")], stop_reason: "end_turn" }));
    await h.prompt("Long");
    const call = of(h.events, "tool_call")[0]!;
    assert.ok(Buffer.byteLength(call.input_preview) <= 32 * 1024);
    assert.match(call.input_preview, /\[cut here: \d+ bytes in all\]$/);
    assert.equal(call.input_bytes, Buffer.byteLength(JSON.stringify({ query: script })));
    assert.ok(!call.input_preview.includes("�"), "never cut inside a character");
  });
});
