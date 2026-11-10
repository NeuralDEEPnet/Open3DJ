// The agent session with a fake Engine: cards and approvals, one turn at a time, Stop,
// reset, replay and resync, the session approval rules, the egress log, and every event
// against the agent-event schema. One test runs the real Engine A on the fake Messages API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "@open3dj/mcp";
import { validate } from "@open3dj/schemas";
// The fake compute pool is test data of @open3dj/mcp, not part of its public exports.
import { FAKE_INVENTORY, fakePlace, fakePool } from "../../mcp/src/testing.ts";
import { createApiEngine } from "./api-engine.ts";
import { createApiClient } from "./client.ts";
import { EgressLog } from "./egress-log.ts";
import { startFakeMessagesApi, streamReply } from "./fake-messages-api.testing.ts";
import { BudgetLedger } from "./ledger.ts";
import { AgentSession } from "./session.ts";
import type { AgentSessionOptions } from "./session.ts";
import type { AgentEvent, Engine, EngineId, EngineStatus, TurnEnd, TurnRequest } from "./types.ts";

const LIMITS = { maxRounds: 12, maxOutputTokens: 16_000, timeoutMs: 600_000 };
const USAGE = { input: 120, output: 30, cache_read: 4000, cache_write: 0 };

/** A fake engine: by default it streams one text, reports one request and ends end_turn. */
class FakeEngine implements Engine {
  readonly id: EngineId;
  turns: TurnRequest[] = [];
  resets = 0;
  closed = false;
  ready = true;
  run: (req: TurnRequest) => Promise<TurnEnd> = async (req) => {
    req.emit({ kind: "text", delta: "Hel" });
    req.emit({ kind: "text", delta: "lo" });
    req.ledger.add(USAGE);
    req.emit({ kind: "usage", request: USAGE, session: USAGE, remaining: req.ledger.remaining() });
    req.onRequest?.({ bytes: 1234, attempts: 1, usage: USAGE, outcome: "ok" });
    return { reason: "end_turn" };
  };
  constructor(id: EngineId) {
    this.id = id;
  }
  async status(): Promise<EngineStatus> {
    const s: EngineStatus = {
      id: this.id, ready: this.ready, billing: this.id === "api" ? "billed to the API key in ANTHROPIC_API_KEY" : "uses your Claude Code login and plan limits",
      host: this.id === "api" ? "api.anthropic.com" : "through Claude Code", conversation: { messages: this.turns.length * 2, bytes: this.turns.length * 100 },
      instructions: { tools: 5, bytes: 20_000, hash: "0123456789abcdef" },
    };
    if (!this.ready) s.reason = "no key";
    return s;
  }
  turn(req: TurnRequest): Promise<TurnEnd> {
    this.turns.push(req);
    return this.run(req);
  }
  reset(): void {
    this.resets++;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A turn that runs until Stop. */
const untilStopped = (req: TurnRequest): Promise<TurnEnd> =>
  new Promise((resolve) => {
    req.emit({ kind: "text", delta: "working" });
    req.signal.addEventListener("abort", () => resolve({ reason: "stopped", message: "stopped by the person" }), { once: true });
  });

interface H {
  session: AgentSession;
  api: FakeEngine;
  cli: FakeEngine;
  events: AgentEvent[];
  clock: { t: number };
  logPath: string;
  log(): Array<Record<string, any>>;
  ledger: BudgetLedger;
}

async function withSession(fn: (h: H) => Promise<void>, opts: Partial<AgentSessionOptions> = {}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "o3j-session-"));
  const api = new FakeEngine("api");
  const cli = new FakeEngine("cli");
  const clock = { t: Date.UTC(2026, 10, 8, 12, 0, 0) };
  const logPath = join(dir, "state", "egress.jsonl");
  const ledger = new BudgetLedger({ input: 1_000_000, output: 100_000 });
  const session = new AgentSession({ engines: { api, cli }, egressLog: new EgressLog(logPath), ledger, limits: LIMITS, project: "bracket.o3j", now: () => clock.t, ...opts });
  const events: AgentEvent[] = [];
  session.subscribe((e) => void events.push(e));
  const h: H = {
    session, api, cli, events, clock, logPath, ledger,
    log: () => readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
  try {
    await fn(h);
    // Every event the session sent matches the schema, and seq rises by one each time.
    for (const e of events) assert.ok(validate("agent-event", e).valid, `${JSON.stringify(e)}: ${JSON.stringify(validate("agent-event", e).errors)}`);
    events.forEach((e, i) => i > 0 && assert.equal(e.seq, events[i - 1]!.seq + 1));
  } finally {
    await session.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const kinds = (events: AgentEvent[]) => events.map((e) => e.kind);
const card = (r: unknown) => {
  const c = (r as { card?: { id: string; payload_hash: string; payload: Record<string, unknown>; scopes: string[] } }).card;
  assert.ok(c, `expected a card, got ${JSON.stringify(r)}`);
  return c;
};

test("a prompt waits for its card; approving with the hash runs one turn, and both go to the egress log", async () => {
  await withSession(async (h) => {
    const r = await h.session.prompt({ text: "Make the wall 2 mm thick", engine: "api", model: "model-a", by: "computer" });
    const c = card(r);
    assert.equal(h.api.turns.length, 0, "nothing is sent before the approval");
    assert.deepEqual(kinds(h.events), ["approval", "status"]);
    assert.deepEqual(h.events[1], { seq: 2, ts: "2026-11-08T12:00:00.000Z", kind: "status", state: "awaiting_approval", engine: "api", model: "model-a" });
    const snap = await h.session.snapshot();
    assert.equal(snap.state, "awaiting_approval");
    assert.deepEqual(snap.pending, c);

    const a = await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    assert.deepEqual(a, { ok: true, decision: "approved", turn: "t_0001" });
    await h.session.idle();
    assert.equal(h.api.turns.length, 1);
    const req = h.api.turns[0]!;
    assert.equal(req.text, "Make the wall 2 mm thick");
    assert.equal(req.model, "model-a");
    assert.deepEqual(req.limits, LIMITS);
    assert.equal(req.turn, "t_0001");
    assert.deepEqual(kinds(h.events), ["approval", "status", "approval_result", "prompt", "status", "text", "text", "usage", "turn_end", "status"]);
    assert.ok(h.events.slice(3, 9).every((e) => e.turn === "t_0001"), "the turn's events carry its id");
    assert.deepEqual(h.events.at(-1), { seq: 10, ts: "2026-11-08T12:00:00.000Z", kind: "status", state: "idle" });

    const done = await h.session.snapshot();
    assert.equal(done.state, "idle");
    assert.equal(done.pending, null);
    assert.equal(done.seq, 10);
    assert.deepEqual(done.transcript, [
      { kind: "approval", id: c.id, decision: "approved", scope: "prompt", by: "computer" },
      { kind: "prompt", turn: "t_0001", text: "Make the wall 2 mm thick" },
      { kind: "text", turn: "t_0001", text: "Hello" },
      { kind: "turn_end", turn: "t_0001", reason: "end_turn" },
    ]);
    assert.deepEqual(done.totals.used, USAGE);
    assert.deepEqual(done.limits, LIMITS);
    assert.deepEqual(done.engines.map((e) => [e.id, e.ready]), [["api", true], ["cli", true]]);

    const log = h.log();
    assert.deepEqual(log, [
      { ts: "2026-11-08T12:00:00.000Z", approval_id: c.id, payload_hash: c.payload_hash, engine: "api", host: "api.anthropic.com", model: "model-a", kind: "approval", decision: "approved", scope: "prompt", by: "computer" },
      { ts: "2026-11-08T12:00:00.000Z", approval_id: c.id, payload_hash: c.payload_hash, engine: "api", host: "api.anthropic.com", model: "model-a", kind: "request", request_bytes: 1234, attempts: 1, usage: USAGE, outcome: "ok" },
    ]);
    for (const line of log) assert.ok(validate("egress-record", line).valid);
    assert.ok(!readFileSync(h.logPath, "utf8").includes("2 mm thick"), "never the prompt text");
  });
});

test("the card names who pays, where it goes, what is sent, the limits and the budget", async () => {
  await withSession(async (h) => {
    const c = card(await h.session.prompt({ text: "Hello", engine: "cli", by: "computer" }));
    assert.deepEqual(c.payload, {
      engine: "cli", billing: "uses your Claude Code login and plan limits", host: "through Claude Code", model: null, project: "bracket.o3j", prompt: "Hello",
      conversation: { messages: 0, bytes: 0 }, instructions: { tools: 5, bytes: 20_000, hash: "0123456789abcdef" }, limits: LIMITS,
      budget: { input: 1_000_000, output: 100_000 }, estimate: { input_tokens: Math.ceil(20_005 / 4), basis: "bytes / 4, an estimate" },
    });
    assert.deepEqual(c.scopes, ["prompt", "session"]);
  });
});

test("approval refusals: a wrong hash, a device asking for the session, expiry, finality, an unknown card", async () => {
  await withSession(async (h) => {
    const c = card(await h.session.prompt({ text: "One", engine: "api", model: "model-a", by: "computer" }));
    assert.deepEqual(await h.session.approve(c.id, "f".repeat(64), "prompt", "computer"), { ok: false, code: "HASH_MISMATCH", message: "the hash does not match this card: what you approve must be what is sent. Reload the card and decide again." });
    const device = await h.session.approve(c.id, c.payload_hash, "session", "device:ipad_1");
    assert.equal((device as { code: string }).code, "SCOPE_REFUSED");
    assert.equal((await h.session.snapshot()).state, "awaiting_approval", "a refused call changes nothing");
    assert.equal(h.api.turns.length, 0);

    h.clock.t += 10 * 60 * 1000;
    assert.deepEqual(await h.session.approve(c.id, c.payload_hash, "prompt", "computer"), { ok: false, code: "EXPIRED", message: "this card ran out of time; send the prompt again" });
    assert.deepEqual(await h.session.approve(c.id, c.payload_hash, "prompt", "computer"), { ok: false, code: "EXPIRED", message: "this card ran out of time; send the prompt again" }, "an expired card answers expired, always");
    const expired = h.events.filter((e) => e.kind === "approval_result");
    assert.deepEqual(expired.map((e) => [e.kind === "approval_result" && e.decision, e.kind === "approval_result" && e.by]), [["expired", "expiry"]], "one approval_result");
    assert.equal(h.api.turns.length, 0);
    assert.equal((await h.session.snapshot()).state, "idle");

    const d = card(await h.session.prompt({ text: "Two", engine: "api", model: "model-a", by: "computer" }));
    assert.deepEqual(await h.session.deny(d.id, d.payload_hash, "computer"), { ok: true, decision: "denied" });
    const again = await h.session.approve(d.id, d.payload_hash, "prompt", "computer");
    assert.deepEqual(again, { ok: false, code: "ALREADY_DECIDED", message: "this card was already denied; a decision is final" });
    assert.equal((await h.session.approve("a_0000000000000000", "x", "prompt", "computer") as { code: string }).code, "UNKNOWN_APPROVAL");
    assert.equal(h.api.turns.length, 0);
    assert.deepEqual(h.log().map((l) => [l.kind, l.decision, l.by]), [["approval", "expired", "expiry"], ["approval", "denied", "computer"]]);
  });
});

test("one turn at a time: a second prompt while a card waits or a turn runs is refused as busy", async () => {
  await withSession(async (h) => {
    h.api.run = untilStopped;
    const c = card(await h.session.prompt({ text: "One", engine: "api", model: "model-a", by: "computer" }));
    const waiting = await h.session.prompt({ text: "Two", engine: "api", model: "model-a", by: "computer" });
    assert.deepEqual(waiting, { ok: false, code: "BUSY", message: "a prompt is waiting for approval: approve or deny it first" });
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    const running = await h.session.prompt({ text: "Three", engine: "cli", by: "computer" });
    assert.deepEqual(running, { ok: false, code: "BUSY", message: "a turn is running: wait for it to end or press Stop" });
    assert.deepEqual(h.session.reset(), { ok: false, code: "BUSY", message: "a turn is running: press Stop first, then start a new conversation" });
    // Two prompts at the same moment: the second is refused while the first is prepared.
    h.session.stop();
    await h.session.idle();
    const [p1, p2] = await Promise.all([
      h.session.prompt({ text: "Four", engine: "api", model: "model-a", by: "computer" }),
      h.session.prompt({ text: "Five", engine: "api", model: "model-a", by: "computer" }),
    ]);
    assert.ok("card" in p1);
    assert.equal((p2 as { code: string }).code, "BUSY");
    assert.equal(h.api.turns.length, 1);
  });
});

test("Stop: the running engine sees the signal and the turn ends stopped; a waiting card is denied", async () => {
  await withSession(async (h) => {
    h.api.run = untilStopped;
    const c = card(await h.session.prompt({ text: "Long job", engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    assert.deepEqual(h.session.stop(), { ok: true, stopped: "turn" });
    assert.ok(h.api.turns[0]!.signal.aborted);
    await h.session.idle();
    const tail = h.events.slice(-4).map((e) => (e.kind === "status" ? `status:${e.state}` : e.kind));
    assert.deepEqual(tail, ["text", "status:stopping", "turn_end", "status:idle"]);
    const { seq: _seq, ...end } = h.events.find((e) => e.kind === "turn_end")!;
    assert.deepEqual(end, { ts: "2026-11-08T12:00:00.000Z", turn: "t_0001", kind: "turn_end", reason: "stopped", message: "stopped by the person" });

    const d = card(await h.session.prompt({ text: "Another", engine: "api", model: "model-a", by: "computer" }));
    assert.deepEqual(h.session.stop("device:ipad_1"), { ok: true, stopped: "card" });
    const last = h.events.filter((e) => e.kind === "approval_result").at(-1)!;
    assert.deepEqual(last.kind === "approval_result" && [last.id, last.decision, last.by], [d.id, "denied", "device:ipad_1"]);
    assert.equal((await h.session.snapshot()).state, "idle");
    assert.deepEqual(h.session.stop(), { ok: true, stopped: "nothing" });
  });
});

test("reset clears the transcript and every engine's conversation; seq keeps rising", async () => {
  await withSession(async (h) => {
    const c = card(await h.session.prompt({ text: "One", engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    await h.session.idle();
    assert.ok((await h.session.snapshot()).transcript.length > 0);
    const before = (await h.session.snapshot()).seq;
    // A waiting card is denied by the reset.
    card(await h.session.prompt({ text: "Two", engine: "api", model: "model-a", by: "computer" }));
    assert.deepEqual(h.session.reset(), { ok: true });
    assert.deepEqual([h.api.resets, h.cli.resets], [1, 1]);
    const snap = await h.session.snapshot();
    assert.deepEqual(snap.transcript, []);
    assert.equal(snap.state, "idle");
    assert.ok(snap.seq > before);
    assert.equal(h.events.at(-1)!.kind, "reset");
    assert.deepEqual(h.log().map((l) => l.decision ?? l.kind), ["approved", "request", "denied"]);
  });
});

test("replay after a seq, and null (then resync) when the buffer no longer reaches back", async () => {
  await withSession(async (h) => {
    for (let i = 0; i < 3; i++) {
      const c = card(await h.session.prompt({ text: `Prompt ${i}`, engine: "api", model: "model-a", by: "computer" }));
      await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
      await h.session.idle();
    }
    const seq = (await h.session.snapshot()).seq;
    assert.equal(seq, h.events.length);
    assert.deepEqual(h.session.eventsAfter(seq), []);
    assert.deepEqual(h.session.eventsAfter(seq - 3), h.events.slice(-3));
    assert.deepEqual(h.session.eventsAfter(seq - 12), h.events.slice(-12), "the oldest event still held");
    assert.equal(h.session.eventsAfter(seq - 13), null, "one more than the buffer holds");
    assert.equal(h.session.eventsAfter(0), null);
    assert.equal(h.session.eventsAfter(seq + 1), null, "a seq from another process");
    assert.equal(h.session.eventsAfter(-1), null);
    assert.equal(h.session.eventsAfter(1.5), null);
    const resync = h.session.resyncEvent();
    assert.deepEqual(resync, { seq, ts: "2026-11-08T12:00:00.000Z", kind: "resync" });
    assert.ok(validate("agent-event", resync).valid);
    assert.equal(h.events.length, seq, "the resync event is not recorded");
  }, { ringEvents: 12 });

  await withSession(async (h) => {
    const c = card(await h.session.prompt({ text: "x".repeat(3000), engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    await h.session.idle();
    // The approval event is over 3 KB, so a 4 KB buffer drops it after the prompt event.
    const seq = (await h.session.snapshot()).seq;
    assert.equal(h.session.eventsAfter(0), null);
    const held = h.session.eventsAfter(seq - 3)!;
    assert.deepEqual(held.map((e) => e.kind), ["usage", "turn_end", "status"]);
  }, { ringBytes: 4096 });
});

test("a session approval skips the card only for the same engine, model and limits, and only on this computer", async () => {
  await withSession(async (h) => {
    const c = card(await h.session.prompt({ text: "One", engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "session", "computer");
    await h.session.idle();
    assert.deepEqual((await h.session.snapshot()).session_approval, { engine: "api", model: "model-a", limits: LIMITS });

    const same = await h.session.prompt({ text: "Two", engine: "api", model: "model-a", by: "computer" });
    assert.deepEqual(same, { ok: true, turn: "t_0002", grant: c.id });
    await h.session.idle();
    assert.equal(h.api.turns.length, 2);
    const notice = h.events.find((e) => e.kind === "notice");
    assert.equal(notice?.kind === "notice" && notice.text, "Sent without a card: this viewer's session approval covers this engine, model and limits.");
    const covered = h.log().find((l) => l.grant === c.id)!;
    assert.deepEqual([covered.kind, covered.decision, covered.scope, covered.by], ["approval", "approved", "session", "computer"]);
    assert.notEqual(covered.approval_id, c.id, "each prompt has its own id and hash in the log");

    // Another model, lower limits, another engine, or a paired device: a card each time.
    for (const input of [
      { text: "Three", engine: "api" as const, model: "model-b", by: "computer" },
      { text: "Four", engine: "api" as const, model: "model-a", by: "computer", limits: { maxRounds: 3 } },
      { text: "Five", engine: "cli" as const, by: "computer" },
      { text: "Six", engine: "api" as const, model: "model-a", by: "device:ipad_1" },
    ]) {
      const r = await h.session.prompt(input);
      const k = card(r);
      if (input.by === "device:ipad_1") {
        assert.deepEqual(k.scopes, ["prompt"], "a device's card offers one prompt only");
        assert.equal((await h.session.approve(k.id, k.payload_hash, "session", "computer") as { code: string }).code, "SCOPE_REFUSED");
        assert.deepEqual(await h.session.approve(k.id, k.payload_hash, "prompt", "device:ipad_1"), { ok: true, decision: "approved", turn: "t_0003" });
        await h.session.idle();
      } else {
        assert.equal((k.payload.limits as { maxRounds: number }).maxRounds, input.limits?.maxRounds ?? 12);
        await h.session.deny(k.id, k.payload_hash, "computer");
      }
    }
    assert.equal(h.api.turns.length, 3);
    assert.equal(h.api.turns[2]!.text, "Six");
  });
});

test("prompt refusals: empty, too long, unknown decider or engine, no model, a raised limit, an output limit under the floor, no budget, an engine not ready", async () => {
  await withSession(async (h) => {
    const code = async (input: Record<string, unknown>) => ((await h.session.prompt(input as never)) as { code?: string }).code;
    assert.equal(await code({ text: "  ", engine: "api", model: "model-a", by: "computer" }), "BAD_INPUT");
    assert.equal(await code({ text: "x".repeat(32_001), engine: "api", model: "model-a", by: "computer" }), "BAD_INPUT");
    assert.equal(await code({ text: "x", engine: "api", model: "model-a", by: "a web page" }), "BAD_INPUT");
    assert.equal(await code({ text: "x", engine: "gpt", model: "model-a", by: "computer" }), "ENGINE_UNAVAILABLE");
    assert.equal(await code({ text: "x", engine: "api", by: "computer" }), "NO_MODEL");
    assert.equal(await code({ text: "x", engine: "api", model: "model a; rm", by: "computer" }), "BAD_INPUT");
    const raised = await h.session.prompt({ text: "x", engine: "api", model: "model-a", by: "computer", limits: { maxRounds: 13 } });
    assert.deepEqual(raised, { ok: false, code: "BAD_INPUT", message: "the page cannot raise maxRounds above 12, the limit open3dj view was started with" });
    assert.equal(await code({ text: "x", engine: "api", model: "model-a", by: "computer", limits: { rounds: 3 } }), "BAD_INPUT");
    assert.equal(await code({ text: "x", engine: "api", model: "model-a", by: "computer", limits: { timeoutMs: 0 } }), "BAD_INPUT");
    // An output limit under the floor is refused here, before any card, with words that name it,
    // and so is a session started with one.
    assert.throws(() => new AgentSession({ engines: { api: h.api }, egressLog: new EgressLog(h.logPath), ledger: h.ledger, limits: { ...LIMITS, maxOutputTokens: 500 }, project: "bracket.o3j" }),
      /^Error: the session limits must be whole numbers of 1 or more, and maxOutputTokens at least 1024$/);
    assert.deepEqual(await h.session.prompt({ text: "x", engine: "api", model: "model-a", by: "computer", limits: { maxOutputTokens: 500 } }), {
      ok: false, code: "BAD_INPUT", message: "maxOutputTokens must be at least 1024, the smallest max_tokens a request is sent with",
    });
    assert.equal((await h.session.prompt({ text: "x", engine: "api", model: "model-a", by: "computer", limits: { maxOutputTokens: 1024 } })).ok, true, "the floor itself is allowed");
    h.session.stop();
    const sent = h.events.length;
    h.api.ready = false;
    assert.deepEqual(await h.session.prompt({ text: "x", engine: "api", model: "model-a", by: "computer" }), { ok: false, code: "ENGINE_UNAVAILABLE", message: "no key" });
    h.api.ready = true;
    h.ledger.add({ input: 0, output: 99_000, cache_read: 0, cache_write: 0 });
    assert.equal(await code({ text: "x", engine: "api", model: "model-a", by: "computer" }), "BUDGET", "fewer than 1,024 output tokens left");
    assert.equal(h.events.length, sent, "a refused prompt sends no event");
    assert.deepEqual(kinds(h.events), ["approval", "status", "approval_result", "status"], "only the card that was allowed, then denied");
  });
});

test("engine events outside the engine kinds or the schema never reach the page; a key in the prompt is redacted", async () => {
  await withSession(async (h) => {
    const key = ["sk", "ant", "api03", "W1x2Y3z4".repeat(5)].join("-");
    h.api.run = async (req) => {
      req.emit({ kind: "status", state: "idle" });
      req.emit({ kind: "approval_result", id: "a_0123456789abcdef", decision: "approved", by: "computer" });
      req.emit({ kind: "tool_result", call: "toolu_1", status: "bogus" as never, summary: "x" });
      req.emit({ kind: "tool_call", call: "toolu_2", tool: "run", input_preview: "{}", input_bytes: 2 });
      req.emit({ kind: "tool_result", call: "toolu_2", status: "ok", rev: "r_0003", summary: "r_0003 ok, 1 of 1 definitions valid" });
      req.emit({ kind: "text", delta: "partial" });
      req.emit({ kind: "discard", reason: "the reply failed" });
      req.onRevision();
      return { reason: "error", message: `failed with ${key}` };
    };
    const c = card(await h.session.prompt({ text: `my key is ${key}`, engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    await h.session.idle();
    const turnEvents = h.events.filter((e) => e.turn === "t_0001");
    assert.deepEqual(turnEvents.map((e) => (e.kind === "status" ? `status:${e.state}` : e.kind)), ["prompt", "status:running", "notice", "tool_call", "tool_result", "text", "discard", "turn_end"]);
    const notice = turnEvents[2]!;
    assert.equal(notice.kind === "notice" && notice.text, "The engine sent a tool_result event that does not match its schema; it was left out.");
    assert.ok(!JSON.stringify(h.events.filter((e) => e.kind !== "approval")).includes(key.slice(7)), "the key is redacted outside the card");
    const snap = await h.session.snapshot();
    assert.deepEqual(snap.transcript.filter((t) => t.kind !== "approval").map((t) => t.kind), ["prompt", "notice", "tool", "turn_end"], "the discarded text is gone");
    assert.deepEqual(snap.transcript.find((t) => t.kind === "tool"), { kind: "tool", turn: "t_0001", call: "toolu_2", tool: "run", input_preview: "{}", input_bytes: 2, result: { status: "ok", summary: "r_0003 ok, 1 of 1 definitions valid", rev: "r_0003" } });
    const prompt = h.events.find((e) => e.kind === "prompt");
    assert.equal(prompt?.kind === "prompt" && prompt.text, "my key is [redacted key]");
    const end = h.events.find((e) => e.kind === "turn_end");
    assert.equal(end?.kind === "turn_end" && end.message, "failed with [redacted key]");
  });
});

test("onRevision reaches the viewer; a failing egress log sends nothing", async () => {
  let revisions = 0;
  await withSession(async (h) => {
    h.api.run = async (req) => {
      req.onRevision();
      return { reason: "end_turn" };
    };
    const c = card(await h.session.prompt({ text: "Go", engine: "api", model: "model-a", by: "computer" }));
    await h.session.approve(c.id, c.payload_hash, "prompt", "computer");
    await h.session.idle();
    assert.equal(revisions, 1);
  }, { onRevision: () => void revisions++ });

  await withSession(async (h) => {
    const broken = { path: "/nowhere", append: () => { throw new Error("disk full"); } } as unknown as EgressLog;
    const session = new AgentSession({ engines: { api: h.api }, egressLog: broken, ledger: h.ledger, limits: LIMITS, project: "bracket.o3j" });
    const c = card(await session.prompt({ text: "Go", engine: "api", model: "model-a", by: "computer" }));
    const r = await session.approve(c.id, c.payload_hash, "prompt", "computer");
    assert.deepEqual(r, { ok: false, code: "EGRESS_LOG", message: "the egress log could not be written (disk full), so nothing was sent" });
    assert.equal(h.api.turns.length, 0);
    assert.equal((await session.snapshot()).state, "idle");
    await session.close();
  });
});

test("the session with the real Engine A on the fake Messages API", async () => {
  const fake = await startFakeMessagesApi();
  const root = mkdtempSync(join(tmpdir(), "o3j-session-e2e-"));
  try {
    const handlers = createHandlers({ pool: fakePool(), inventory: FAKE_INVENTORY, place: fakePlace, root, interactiveMs: 5_000 });
    const client = createApiClient({ apiKey: ["sk", "ant", "test", "q".repeat(30)].join("-"), baseUrl: fake.url, sleep: async () => {} });
    const engine = createApiEngine({ client, handlers, project: join(root, "plate.o3j") });
    const logPath = join(root, "state", "egress.jsonl");
    const session = new AgentSession({ engines: { api: engine }, egressLog: new EgressLog(logPath), ledger: new BudgetLedger(), limits: LIMITS, project: "plate.o3j" });
    const events: AgentEvent[] = [];
    session.subscribe((e) => void events.push(e));
    fake.reply(
      streamReply({ content: [{ type: "text", text: "Making it." }, { type: "tool_use", id: "toolu_1", name: "run", input: { script: "return box(10, 10, 2);" } }], stop_reason: "tool_use", usage: { input_tokens: 500, output_tokens: 40 } }),
      streamReply({ content: [{ type: "text", text: "Done: r_0001." }], stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 10, cache_read_input_tokens: 5000 } }),
    );
    const c = card(await session.prompt({ text: "Make a plate", engine: "api", model: "model-a", by: "computer" }));
    assert.equal(c.payload.host, new URL(fake.url).host);
    assert.equal((c.payload.instructions as { tools: number }).tools, 5);
    assert.equal(fake.requests.length, 0, "nothing left before the approval");
    await session.approve(c.id, c.payload_hash, "prompt", "computer");
    await session.idle();
    for (const e of events) assert.ok(validate("agent-event", e).valid, JSON.stringify(e));
    assert.deepEqual(events.filter((e) => e.kind === "tool_result").map((e) => e.kind === "tool_result" && e.rev), ["r_0001"]);
    assert.equal(events.filter((e) => e.kind === "turn_end").map((e) => e.kind === "turn_end" && e.reason)[0], "end_turn");
    const log = readFileSync(logPath, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => l.kind), ["approval", "request", "request"]);
    assert.deepEqual(log.slice(1).map((l) => l.request_bytes), fake.requests.map((r) => Buffer.byteLength(r.text)), "each request's real size");
    assert.deepEqual(log[2].usage, { input: 80, output: 10, cache_read: 5000, cache_write: 0 });
    const snap = await session.snapshot();
    assert.deepEqual(snap.totals.used, { input: 580, output: 50, cache_read: 5000, cache_write: 0 });
    assert.equal(snap.engines[0]!.conversation!.messages, 4);
    await session.close();
  } finally {
    await fake.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
