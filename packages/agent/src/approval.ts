// The egress approval of RFC 0001, ahead of the S5 approval service. Nothing leaves the
// machine until the person approves a card that open3dj view made and checks itself. A card
// names the engine, who pays, the host, the model, the project, the prompt, how much of the
// conversation and of Open3DJ's instructions goes with it, the limits and the budget left.
// Approving needs the card's payload hash, a card lasts 10 minutes, and a decision is final.
// The "session" scope (don't ask again until this viewer stops) is for this computer's own
// page only, never for a paired device.
import { randomBytes } from "node:crypto";
import { hashJson } from "@open3dj/mcp";
import type { ApprovalPayload, ApprovalScope, EngineStatus, TurnLimits } from "./types.ts";

/** How long a card can be approved (10 minutes). */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** Who decides on this computer's own page. */
export const COMPUTER = "computer";
/** Who decides when a card runs out of time. */
export const EXPIRY = "expiry";
/** A paired device (RFC 0001, the Wi-Fi link). */
const DEVICE = /^device:[A-Za-z0-9_-]{1,64}$/;
/** The basis of the input estimate, said on the card. */
export const ESTIMATE_BASIS = "bytes / 4, an estimate";
/** Decided cards kept, so a late decision still gets its true answer. Older ones are forgotten. */
export const KEEP_DECIDED = 200;

export interface ApprovalCard {
  id: string;
  payload: ApprovalPayload;
  /** sha256 of the payload as canonical JSON (sorted keys). Approving needs it. */
  payload_hash: string;
  expires_at: string;
  /** The scopes this card offers. */
  scopes: ApprovalScope[];
}

export type ApprovalState = "pending" | "approved" | "denied" | "expired";

export type RefusalCode = "UNKNOWN_APPROVAL" | "ALREADY_DECIDED" | "HASH_MISMATCH" | "SCOPE_REFUSED" | "BAD_DECIDER";

/** What one decide() call did. "refused" changed nothing; the others are final. */
export type DecideResult =
  | { status: "approved"; card: ApprovalCard; scope: ApprovalScope; by: string }
  | { status: "denied"; card: ApprovalCard; by: string }
  | { status: "expired"; card: ApprovalCard; first: boolean }
  | { status: "refused"; code: RefusalCode; message: string };

/** The payload hash: sha256 of canonical JSON with sorted keys. */
export function payloadHash(payload: ApprovalPayload): string {
  return hashJson(payload);
}

/** True for a decider the cards know: this computer, or a paired device. */
export function isDecider(by: unknown): by is string {
  return by === COMPUTER || (typeof by === "string" && DEVICE.test(by));
}

/**
 * The payload of a card. The estimate counts the prompt, the conversation the engine resends
 * and Open3DJ's instructions and tool list, in UTF-8 bytes divided by 4, and says so.
 */
export function buildPayload(p: { status: EngineStatus; model: string | null; project: string; prompt: string; limits: TurnLimits; budget: { input: number; output: number } }): ApprovalPayload {
  const conversation = { messages: p.status.conversation?.messages ?? 0, bytes: p.status.conversation?.bytes ?? 0 };
  const instructions = { tools: p.status.instructions?.tools ?? 0, bytes: p.status.instructions?.bytes ?? 0, hash: p.status.instructions?.hash ?? "0".repeat(16) };
  const bytes = Buffer.byteLength(p.prompt) + conversation.bytes + instructions.bytes;
  return {
    engine: p.status.id,
    billing: p.status.billing,
    host: p.status.host,
    model: p.model,
    project: p.project,
    prompt: p.prompt,
    conversation,
    instructions,
    limits: { maxRounds: p.limits.maxRounds, maxOutputTokens: p.limits.maxOutputTokens, timeoutMs: p.limits.timeoutMs },
    budget: { input: Math.max(0, p.budget.input), output: Math.max(0, p.budget.output) },
    estimate: { input_tokens: Math.ceil(bytes / 4), basis: ESTIMATE_BASIS },
  };
}

/** The cards of one viewer process. */
export class Approvals {
  #now: () => number;
  #ttl: number;
  #cards = new Map<string, { card: ApprovalCard; state: ApprovalState; expiresMs: number }>();

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttl = options.ttlMs ?? APPROVAL_TTL_MS;
  }

  /** A new pending card. scopes defaults to both; a prompt from a paired device gets ["prompt"]. */
  create(payload: ApprovalPayload, scopes: ApprovalScope[] = ["prompt", "session"]): ApprovalCard {
    const expiresMs = this.#now() + this.#ttl;
    const card: ApprovalCard = {
      id: `a_${randomBytes(8).toString("hex")}`,
      payload: structuredClone(payload),
      payload_hash: payloadHash(payload),
      expires_at: new Date(expiresMs).toISOString(),
      scopes: [...new Set(scopes)],
    };
    this.#cards.set(card.id, { card, state: "pending", expiresMs });
    this.#prune();
    return structuredClone(card);
  }

  /** The state of a card, after its expiry is applied; undefined for an unknown id. */
  state(id: string): ApprovalState | undefined {
    const entry = this.#cards.get(id);
    if (!entry) return undefined;
    if (entry.state === "pending" && this.#now() >= entry.expiresMs) entry.state = "expired";
    return entry.state;
  }

  /** Cards that ran out of time since the last look. Each is reported once. */
  expireDue(): ApprovalCard[] {
    const out: ApprovalCard[] = [];
    for (const entry of this.#cards.values()) {
      if (entry.state === "pending" && this.#now() >= entry.expiresMs) {
        entry.state = "expired";
        out.push(structuredClone(entry.card));
      }
    }
    return out;
  }

  /**
   * Decide a card. The hash must be the card's own, the card must not have run out of time,
   * and the scope must be one the card offers and the decider may use: "session" only on this
   * computer. A refused call changes nothing; any other answer is final.
   */
  decide(id: string, hash: string, decision: "approved" | "denied", scope: ApprovalScope | undefined, by: string): DecideResult {
    const entry = typeof id === "string" ? this.#cards.get(id) : undefined;
    if (!entry) return refused("UNKNOWN_APPROVAL", "there is no approval card with this id");
    if (entry.state === "pending" && this.#now() >= entry.expiresMs) {
      entry.state = "expired";
      return { status: "expired", card: structuredClone(entry.card), first: true };
    }
    if (entry.state === "expired") return { status: "expired", card: structuredClone(entry.card), first: false };
    if (entry.state !== "pending") return refused("ALREADY_DECIDED", `this card was already ${entry.state}; a decision is final`);
    if (!isDecider(by)) return refused("BAD_DECIDER", "only this computer or a paired device can decide a card");
    if (typeof hash !== "string" || hash !== entry.card.payload_hash) {
      return refused("HASH_MISMATCH", "the hash does not match this card: what you approve must be what is sent. Reload the card and decide again.");
    }
    if (decision === "denied") {
      entry.state = "denied";
      return { status: "denied", card: structuredClone(entry.card), by };
    }
    const s = scope ?? "prompt";
    if (s !== "prompt" && s !== "session") return refused("SCOPE_REFUSED", "the scope must be prompt or session");
    if (!entry.card.scopes.includes(s)) return refused("SCOPE_REFUSED", `this card does not offer the ${s} scope`);
    if (s === "session" && by !== COMPUTER) return refused("SCOPE_REFUSED", "only this computer's own page can approve for the whole session; a paired device approves one prompt at a time");
    entry.state = "approved";
    return { status: "approved", card: structuredClone(entry.card), scope: s, by };
  }

  /** Forget the oldest decided cards past KEEP_DECIDED. Pending cards are always kept. */
  #prune(): void {
    let decided = 0;
    for (const e of this.#cards.values()) if (e.state !== "pending") decided++;
    for (const [id, e] of this.#cards) {
      if (decided <= KEEP_DECIDED) break;
      if (e.state !== "pending") {
        this.#cards.delete(id);
        decided--;
      }
    }
  }
}

function refused(code: RefusalCode, message: string): DecideResult {
  return { status: "refused", code, message };
}
