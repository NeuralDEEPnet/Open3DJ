// Approval cards: the payload and its hash, expiry on an injected clock, the scope rules and
// finality.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validate } from "@open3dj/schemas";
import { APPROVAL_TTL_MS, Approvals, ESTIMATE_BASIS, KEEP_DECIDED, buildPayload, isDecider, payloadHash } from "./approval.ts";
import type { ApprovalPayload, EngineStatus } from "./types.ts";

const status: EngineStatus = {
  id: "api", ready: true, billing: "billed to the API key in ANTHROPIC_API_KEY", host: "api.anthropic.com",
  conversation: { messages: 4, bytes: 4000 }, instructions: { tools: 5, bytes: 20000, hash: "0123456789abcdef" },
};
const limits = { maxRounds: 12, maxOutputTokens: 16000, timeoutMs: 600_000 };
const payload = (prompt = "Make the wall 2 mm thick"): ApprovalPayload =>
  buildPayload({ status, model: "model-a", project: "bracket.o3j", prompt, limits, budget: { input: 3_000_000, output: 150_000 } });

test("the payload names engine, billing, host, model, project, prompt, sizes, limits, budget and an estimate", () => {
  const p = payload();
  assert.deepEqual(p, {
    engine: "api", billing: status.billing, host: "api.anthropic.com", model: "model-a", project: "bracket.o3j", prompt: "Make the wall 2 mm thick",
    conversation: { messages: 4, bytes: 4000 }, instructions: { tools: 5, bytes: 20000, hash: "0123456789abcdef" },
    limits, budget: { input: 3_000_000, output: 150_000 },
    estimate: { input_tokens: Math.ceil((24 + 4000 + 20000) / 4), basis: ESTIMATE_BASIS },
  });
  assert.equal(ESTIMATE_BASIS, "bytes / 4, an estimate");
  const cli = buildPayload({ status: { id: "cli", ready: true, billing: "uses your Claude Code login and plan limits", host: "through Claude Code" }, model: null, project: "p.o3j", prompt: "hi", limits, budget: { input: -5, output: 3 } });
  assert.equal(cli.model, null);
  assert.deepEqual(cli.conversation, { messages: 0, bytes: 0 });
  assert.deepEqual(cli.budget, { input: 0, output: 3 }, "never below 0");
});

test("the payload hash is sha256 of canonical JSON with sorted keys", () => {
  const p = payload();
  const reordered = Object.fromEntries(Object.entries(p).reverse()) as unknown as ApprovalPayload;
  assert.equal(payloadHash(reordered), payloadHash(p));
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
  assert.equal(payloadHash(p), createHash("sha256").update(JSON.stringify(sorted(p))).digest("hex"));
  assert.notEqual(payloadHash(payload("Make it 3 mm")), payloadHash(p), "another prompt is another card");
});

test("a card: an id, the hash, an expiry 10 minutes out, the scopes; it matches the agent-event schema", () => {
  let t = Date.UTC(2026, 10, 8, 12, 0, 0);
  const a = new Approvals({ now: () => t });
  const card = a.create(payload());
  assert.match(card.id, /^a_[0-9a-f]{16}$/);
  assert.equal(card.payload_hash, payloadHash(card.payload));
  assert.equal(card.expires_at, new Date(t + APPROVAL_TTL_MS).toISOString());
  assert.equal(APPROVAL_TTL_MS, 600_000);
  assert.deepEqual(card.scopes, ["prompt", "session"]);
  assert.deepEqual(a.create(payload(), ["prompt", "prompt"]).scopes, ["prompt"]);
  assert.notEqual(a.create(payload()).id, card.id);
  const event = { seq: 1, ts: new Date(t).toISOString(), kind: "approval", ...card };
  assert.ok(validate("agent-event", event).valid, JSON.stringify(validate("agent-event", event).errors));
  card.payload.prompt = "changed";
  assert.equal(a.state(card.id), "pending", "the returned card is a copy");
  t += 1;
});

test("a wrong hash changes nothing; the right one approves", () => {
  const a = new Approvals();
  const card = a.create(payload());
  const wrong = a.decide(card.id, payloadHash(payload("something else")), "approved", "prompt", "computer");
  assert.equal(wrong.status, "refused");
  assert.equal((wrong as { code: string }).code, "HASH_MISMATCH");
  assert.equal(a.decide(card.id, "", "denied", undefined, "computer").status, "refused", "a denial needs the hash too");
  assert.equal(a.state(card.id), "pending");
  const ok = a.decide(card.id, card.payload_hash, "approved", undefined, "computer");
  assert.deepEqual(ok.status === "approved" && [ok.scope, ok.by], ["prompt", "computer"], "the scope defaults to prompt");
});

test("expiry on the injected clock: an expired card answers expired, always", () => {
  let t = 1_000_000;
  const a = new Approvals({ now: () => t });
  const card = a.create(payload());
  const other = a.create(payload("other"));
  t += APPROVAL_TTL_MS - 1;
  assert.equal(a.state(card.id), "pending");
  assert.deepEqual(a.expireDue(), []);
  t += 1;
  const first = a.decide(card.id, card.payload_hash, "approved", "prompt", "computer");
  assert.deepEqual(first.status === "expired" && first.first, true);
  const again = a.decide(card.id, card.payload_hash, "denied", undefined, "computer");
  assert.deepEqual(again.status === "expired" && again.first, false);
  assert.deepEqual(a.expireDue().map((c) => c.id), [other.id], "each expired card is reported once");
  assert.deepEqual(a.expireDue(), []);
  assert.equal(a.state(other.id), "expired");
});

test("scope rules: session only on this computer and only when the card offers it", () => {
  const a = new Approvals();
  const device = a.create(payload());
  const r = a.decide(device.id, device.payload_hash, "approved", "session", "device:ipad_1");
  assert.equal(r.status === "refused" && r.code, "SCOPE_REFUSED");
  assert.match((r as { message: string }).message, /a paired device approves one prompt at a time/);
  assert.equal(a.decide(device.id, device.payload_hash, "approved", "prompt", "device:ipad_1").status, "approved");

  const narrow = a.create(payload(), ["prompt"]);
  assert.equal(a.decide(narrow.id, narrow.payload_hash, "approved", "session", "computer").status, "refused");
  assert.equal(a.decide(narrow.id, narrow.payload_hash, "approved", "forever" as never, "computer").status, "refused");
  for (const by of ["anyone", "device:", "device:../x", "Computer", ""]) {
    const x = a.decide(narrow.id, narrow.payload_hash, "approved", "prompt", by);
    assert.equal(x.status === "refused" && x.code, "BAD_DECIDER", by);
  }
  const s = a.create(payload());
  const ok = a.decide(s.id, s.payload_hash, "approved", "session", "computer");
  assert.equal(ok.status === "approved" && ok.scope, "session");
  assert.ok(isDecider("computer") && isDecider("device:ipad_1") && !isDecider("expiry"));
});

test("a decision is final; an unknown id is refused", () => {
  const a = new Approvals();
  const approved = a.create(payload());
  a.decide(approved.id, approved.payload_hash, "approved", "prompt", "computer");
  const denied = a.create(payload());
  a.decide(denied.id, denied.payload_hash, "denied", undefined, "computer");
  for (const [card, was] of [[approved, "approved"], [denied, "denied"]] as const) {
    for (const d of ["approved", "denied"] as const) {
      const r = a.decide(card.id, card.payload_hash, d, "prompt", "computer");
      assert.equal(r.status === "refused" && r.code, "ALREADY_DECIDED");
      assert.match((r as { message: string }).message, new RegExp(`already ${was}; a decision is final`));
    }
    assert.equal(a.state(card.id), was);
  }
  const unknown = a.decide("a_0000000000000000", "x", "approved", "prompt", "computer");
  assert.equal(unknown.status === "refused" && unknown.code, "UNKNOWN_APPROVAL");
  assert.equal(a.state("nope"), undefined);
});

test("the book forgets the oldest decided cards past its limit, never a pending one", () => {
  const a = new Approvals();
  const pending = a.create(payload("waiting"));
  const ids: string[] = [];
  for (let i = 0; i < KEEP_DECIDED + 5; i++) {
    const c = a.create(payload(`p${i}`));
    a.decide(c.id, c.payload_hash, "denied", undefined, "computer");
    ids.push(c.id);
  }
  a.create(payload("one more"));
  assert.equal(a.state(pending.id), "pending");
  assert.equal(a.state(ids[0]!), undefined, "the oldest decided card is forgotten");
  assert.equal(a.state(ids[ids.length - 1]!), "denied");
});
