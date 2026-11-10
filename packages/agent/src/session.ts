// The agent session of open3dj view (RFC 0001): one conversation per viewer process. A
// prompt becomes an approval card and waits; only an approval with the card's payload hash
// starts a turn, one turn at a time. Every event gets a sequence number and goes into a ring
// buffer (5,000 events or 2 MiB), so a page that reconnects gets what it missed, or a resync
// when the buffer no longer reaches back. Every approval decision and every request goes to
// the egress log. A "session" approval, given on this computer's own page, lets later
// prompts from this computer with the same engine, model and limits skip the card until the
// viewer stops.
import { validate } from "@open3dj/schemas";
import { MIN_OUTPUT_TOKENS } from "./api-engine.ts";
import { Approvals, COMPUTER, EXPIRY, buildPayload, isDecider } from "./approval.ts";
import type { ApprovalCard, DecideResult, RefusalCode } from "./approval.ts";
import { KEY_PATTERN } from "./client.ts";
import type { EgressLog, EgressRecord } from "./egress-log.ts";
import type { BudgetLedger, LedgerSnapshot } from "./ledger.ts";
import type {
  AgentEvent, AgentEventBody, AgentState, ApprovalDecision, ApprovalScope, Engine, EngineId, EngineStatus, NoticeLevel, RequestReport, ToolStepStatus, TurnEnd,
  TurnEndReason, TurnLimits,
} from "./types.ts";

/** The ring buffer holds at most this many events... */
export const RING_EVENTS = 5000;
/** ...and at most this many bytes of event JSON (2 MiB). */
export const RING_BYTES = 2 * 1024 * 1024;
/** The longest prompt, in characters. */
export const MAX_PROMPT_CHARS = 32_000;
/** The snapshot's transcript keeps the newest entries within this many bytes (4 MiB). */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const ENGINE_KINDS = new Set(["text", "discard", "tool_call", "tool_result", "usage", "notice"]);
const LIMIT_KEYS = ["maxRounds", "maxOutputTokens", "timeoutMs"] as const;

export type SessionErrorCode = "BUSY" | "BAD_INPUT" | "ENGINE_UNAVAILABLE" | "NO_MODEL" | "BUDGET" | "EGRESS_LOG" | "EXPIRED" | "CLOSED" | RefusalCode;

export interface SessionError {
  ok: false;
  code: SessionErrorCode;
  message: string;
}

export interface PromptInput {
  text: string;
  engine: EngineId;
  /** A model id from the API's list. Engine A needs one; Engine B may leave it out. */
  model?: string | null;
  /** "computer" or "device:<id>". */
  by: string;
  /** Lower limits for this prompt. The page can lower a limit, never raise one. */
  limits?: Partial<TurnLimits>;
}

export type PromptResult = { ok: true; card: ApprovalCard } | { ok: true; turn: string; grant: string } | SessionError;
export type DecisionResult = { ok: true; decision: "approved"; turn: string } | { ok: true; decision: "denied" } | SessionError;

export type ToolStepResult = { status: ToolStepStatus; rev?: string; code?: string; summary: string };
export type TranscriptEntry =
  | { kind: "prompt"; turn: string; text: string }
  | { kind: "text"; turn: string; text: string }
  | { kind: "tool"; turn: string; call: string; tool: string; input_preview: string; input_bytes: number; result?: ToolStepResult }
  | { kind: "notice"; turn?: string; level: NoticeLevel; text: string }
  | { kind: "approval"; id: string; decision: ApprovalDecision; scope?: ApprovalScope; by: string }
  | { kind: "turn_end"; turn: string; reason: TurnEndReason; message?: string };

export interface AgentSnapshot {
  /** The last event's seq: replay continues after it. */
  seq: number;
  state: AgentState;
  engine?: EngineId;
  model?: string;
  turn?: string;
  pending: ApprovalCard | null;
  /** The conversation since the last reset, compacted: text joined, each tool call with its result. */
  transcript: TranscriptEntry[];
  /** True when older entries were left out to stay within MAX_TRANSCRIPT_BYTES. */
  transcript_trimmed: boolean;
  totals: LedgerSnapshot;
  limits: TurnLimits;
  engines: EngineStatus[];
  /** The session approval in force, if any. */
  session_approval: { engine: EngineId; model: string | null; limits: TurnLimits } | null;
}

export interface AgentSessionOptions {
  engines: Partial<Record<EngineId, Engine>>;
  egressLog: EgressLog;
  ledger: BudgetLedger;
  /** The limits from the CLI options. */
  limits: TurnLimits;
  /** The project folder's name, as the card shows it. */
  project: string;
  now?: () => number;
  approvalTtlMs?: number;
  ringEvents?: number;
  ringBytes?: number;
  /** Called after a tool step made a revision, so the viewer loads it. */
  onRevision?: () => void;
}

interface Prepared {
  engineId: EngineId;
  model: string | null;
  limits: TurnLimits;
  text: string;
  by: string;
  host: string;
}

type OpenText = { e: Extract<TranscriptEntry, { kind: "text" }>; bytes: number };

interface Running {
  turn: string;
  controller: AbortController;
  prepared: Prepared;
  approval: { id: string; hash: string };
  promise: Promise<void>;
}

export class AgentSession {
  #engines: Partial<Record<EngineId, Engine>>;
  #log: EgressLog;
  #ledger: BudgetLedger;
  #limits: TurnLimits;
  #project: string;
  #now: () => number;
  #approvals: Approvals;
  #ttl: number;
  #onRevision: (() => void) | undefined;
  #ringMax: number;
  #ringBytesMax: number;

  #seq = 0;
  #ring: Array<{ event: AgentEvent; bytes: number }> = [];
  #ringBytes = 0;
  #subs = new Set<(e: AgentEvent) => void>();
  #state: AgentState = "idle";
  #status: { engine?: EngineId; model?: string; turn?: string } = {};
  #pending: (Prepared & { card: ApprovalCard }) | undefined;
  #running: Running | undefined;
  #grant: { id: string; engine: EngineId; model: string | null; limits: TurnLimits } | undefined;
  #preparing = false;
  #turns = 0;
  #transcript: Array<{ e: TranscriptEntry; bytes: number }> = [];
  #transcriptBytes = 0;
  #trimmed = false;
  #openText: OpenText | undefined;
  #timer: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(o: AgentSessionOptions) {
    const bad = limitsProblem(o.limits);
    if (bad) throw new Error(bad);
    if (typeof o.project !== "string" || o.project.trim() === "" || o.project.length > 255) throw new Error("the session needs the project folder's name");
    this.#engines = { ...o.engines };
    this.#log = o.egressLog;
    this.#ledger = o.ledger;
    this.#limits = { maxRounds: o.limits.maxRounds, maxOutputTokens: o.limits.maxOutputTokens, timeoutMs: o.limits.timeoutMs };
    this.#project = o.project;
    this.#now = o.now ?? Date.now;
    this.#ttl = o.approvalTtlMs ?? 10 * 60 * 1000;
    this.#approvals = new Approvals({ now: this.#now, ttlMs: this.#ttl });
    this.#onRevision = o.onRevision;
    this.#ringMax = o.ringEvents ?? RING_EVENTS;
    this.#ringBytesMax = o.ringBytes ?? RING_BYTES;
  }

  /** Everything the page needs after a load or a resync. */
  async snapshot(): Promise<AgentSnapshot> {
    this.#expireDue();
    const engines = await Promise.all(
      Object.values(this.#engines).filter((e): e is Engine => e !== undefined).map((e) =>
        e.status().catch((): EngineStatus => ({ id: e.id, ready: false, reason: "the engine did not answer", billing: "", host: "" }))),
    );
    const s: AgentSnapshot = {
      seq: this.#seq,
      state: this.#state,
      pending: this.#pending ? structuredClone(this.#pending.card) : null,
      transcript: this.#transcript.map((x) => structuredClone(x.e)),
      transcript_trimmed: this.#trimmed,
      totals: this.#ledger.snapshot(),
      limits: { ...this.#limits },
      engines,
      session_approval: this.#grant ? { engine: this.#grant.engine, model: this.#grant.model, limits: { ...this.#grant.limits } } : null,
    };
    if (this.#status.engine) s.engine = this.#status.engine;
    if (this.#status.model) s.model = this.#status.model;
    if (this.#status.turn) s.turn = this.#status.turn;
    return s;
  }

  /** Every new event, in order. Returns the function that ends the subscription. */
  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.#subs.add(fn);
    return () => void this.#subs.delete(fn);
  }

  /**
   * The events after seq, oldest first, or null when the buffer no longer reaches back that
   * far (or seq is from another process): then the caller sends resyncEvent() and the page
   * loads the snapshot again.
   */
  eventsAfter(seq: number): AgentEvent[] | null {
    if (!Number.isInteger(seq) || seq < 0 || seq > this.#seq) return null;
    if (seq === this.#seq) return [];
    const first = this.#ring[0]?.event.seq;
    if (first === undefined || seq < first - 1) return null;
    return this.#ring.filter((x) => x.event.seq > seq).map((x) => x.event);
  }

  /** The resync event for one page. It is not recorded: it carries the current seq. */
  resyncEvent(): AgentEvent {
    return { seq: Math.max(1, this.#seq), ts: this.#ts(), kind: "resync" };
  }

  /** A prompt: refused, sent at once under a session approval, or an approval card that waits. */
  async prompt(input: PromptInput): Promise<PromptResult> {
    if (this.#closed) return fail("CLOSED", "the agent panel is closed");
    this.#expireDue();
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim() === "") return fail("BAD_INPUT", "the prompt is empty");
    if (text.length > MAX_PROMPT_CHARS) return fail("BAD_INPUT", `the prompt is longer than ${MAX_PROMPT_CHARS} characters`);
    if (!isDecider(input.by)) return fail("BAD_INPUT", "a prompt comes from this computer or a paired device");
    const busy = this.#busy();
    if (busy) return busy;
    const engineId = input.engine;
    const engine = engineId === "api" || engineId === "cli" ? this.#engines[engineId] : undefined;
    if (!engine) return fail("ENGINE_UNAVAILABLE", "this engine is not available in this viewer");
    let model: string | null = null;
    if (input.model !== undefined && input.model !== null && input.model !== "") {
      if (typeof input.model !== "string" || !MODEL_ID.test(input.model)) return fail("BAD_INPUT", "the model id is not in the form the API uses");
      model = input.model;
    }
    if (engineId === "api" && model === null) return fail("NO_MODEL", "pick a model first: load the models and choose one");
    const limits = this.#effectiveLimits(input.limits);
    if ("ok" in limits) return limits;
    const left = this.#ledger.remaining();
    if (left.input <= 0 || left.output < MIN_OUTPUT_TOKENS) return fail("BUDGET", "this session's token budget is used up. Start open3dj view again with a larger budget to go on.");

    this.#preparing = true;
    let status: EngineStatus;
    try {
      status = await engine.status();
    } catch {
      return fail("ENGINE_UNAVAILABLE", "the engine did not answer");
    } finally {
      this.#preparing = false;
    }
    if (this.#closed) return fail("CLOSED", "the agent panel is closed");
    if (!status.ready) return fail("ENGINE_UNAVAILABLE", status.reason ?? "the engine is not ready");
    const payload = buildPayload({ status, model, project: this.#project, prompt: text, limits, budget: left });
    const prepared: Prepared = { engineId, model, limits, text, by: input.by, host: status.host };

    const grant = this.#grant;
    if (input.by === COMPUTER && grant && grant.engine === engineId && grant.model === model && sameLimits(grant.limits, limits)) {
      const card = this.#approvals.create(payload, ["prompt"]);
      this.#approvals.decide(card.id, card.payload_hash, "approved", "prompt", input.by);
      try {
        this.#append({ ...this.#base(card.id, card.payload_hash, prepared), kind: "approval", decision: "approved", scope: "session", by: input.by, grant: grant.id });
      } catch (e) {
        return this.#logFailed(e);
      }
      this.#emit({ kind: "notice", level: "info", text: "Sent without a card: this viewer's session approval covers this engine, model and limits." });
      return { ok: true, turn: this.#start(prepared, card), grant: grant.id };
    }

    const card = this.#approvals.create(payload, input.by === COMPUTER ? ["prompt", "session"] : ["prompt"]);
    this.#pending = { ...prepared, card };
    this.#emit({ kind: "approval", id: card.id, payload: card.payload, payload_hash: card.payload_hash, expires_at: card.expires_at, scopes: card.scopes });
    this.#setState("awaiting_approval", prepared.engineId, prepared.model);
    this.#armTimer();
    return { ok: true, card: structuredClone(card) };
  }

  /** Approve the waiting card with its hash. The turn starts at once; the result names it. */
  async approve(id: string, hash: string, scope: ApprovalScope | undefined, by: string): Promise<DecisionResult> {
    if (this.#closed) return fail("CLOSED", "the agent panel is closed");
    const waiting = this.#waiting(id);
    if (waiting) return waiting;
    const r = this.#approvals.decide(id, hash, "approved", scope, by);
    if (r.status === "refused") return fail(r.code, r.message);
    if (r.status !== "approved") return fail("ALREADY_DECIDED", "this card was already decided");
    const pending = this.#pending!;
    this.#pending = undefined;
    this.#clearTimer();
    try {
      this.#append({ ...this.#base(r.card.id, r.card.payload_hash, pending), kind: "approval", decision: "approved", scope: r.scope, by: r.by });
    } catch (e) {
      this.#emit({ kind: "approval_result", id: r.card.id, decision: "approved", scope: r.scope, by: r.by });
      this.#setState("idle");
      return this.#logFailed(e);
    }
    this.#emit({ kind: "approval_result", id: r.card.id, decision: "approved", scope: r.scope, by: r.by });
    if (r.scope === "session") this.#grant = { id: r.card.id, engine: pending.engineId, model: pending.model, limits: { ...pending.limits } };
    return { ok: true, decision: "approved", turn: this.#start(pending, r.card) };
  }

  /** Deny the waiting card. Nothing is sent. */
  async deny(id: string, hash: string, by: string): Promise<DecisionResult> {
    if (this.#closed) return fail("CLOSED", "the agent panel is closed");
    const waiting = this.#waiting(id);
    if (waiting) return waiting;
    const r = this.#approvals.decide(id, hash, "denied", undefined, by);
    if (r.status === "refused") return fail(r.code, r.message);
    if (r.status !== "denied") return fail("ALREADY_DECIDED", "this card was already decided");
    this.#denied(r);
    return { ok: true, decision: "denied" };
  }

  /** Stop the running turn, or deny the waiting card. */
  stop(by: string = COMPUTER): { ok: true; stopped: "turn" | "card" | "nothing" } {
    if (this.#running) {
      if (!this.#running.controller.signal.aborted) {
        this.#running.controller.abort();
        this.#setState("stopping", this.#running.prepared.engineId, this.#running.prepared.model, this.#running.turn);
      }
      return { ok: true, stopped: "turn" };
    }
    if (this.#pending) {
      const card = this.#pending.card;
      const r = this.#approvals.decide(card.id, card.payload_hash, "denied", undefined, isDecider(by) ? by : COMPUTER);
      if (r.status === "denied") this.#denied(r);
      else if (r.status === "expired") this.#expired(card);
      return { ok: true, stopped: "card" };
    }
    return { ok: true, stopped: "nothing" };
  }

  /** Start a new conversation. A waiting card is denied; a running turn must be stopped first. */
  reset(by: string = COMPUTER): { ok: true } | SessionError {
    if (this.#closed) return fail("CLOSED", "the agent panel is closed");
    if (this.#running || this.#preparing) return fail("BUSY", "a turn is running: press Stop first, then start a new conversation");
    if (this.#pending) this.stop(by);
    for (const e of Object.values(this.#engines)) e?.reset();
    this.#emit({ kind: "reset" });
    return { ok: true };
  }

  /** Resolves when no turn is running. */
  idle(): Promise<void> {
    return this.#running?.promise ?? Promise.resolve();
  }

  /** Stop everything and close the engines. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.stop(COMPUTER);
    this.#closed = true;
    this.#clearTimer();
    await this.idle();
    for (const e of Object.values(this.#engines)) await e?.close();
  }

  #busy(): SessionError | undefined {
    if (this.#running) return fail("BUSY", "a turn is running: wait for it to end or press Stop");
    if (this.#pending) return fail("BUSY", "a prompt is waiting for approval: approve or deny it first");
    if (this.#preparing) return fail("BUSY", "another prompt is being prepared");
    return undefined;
  }

  #effectiveLimits(partial: Partial<TurnLimits> | undefined): TurnLimits | SessionError {
    const out = { ...this.#limits };
    if (partial === undefined) return out;
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) return fail("BAD_INPUT", "limits must be an object");
    for (const k of Object.keys(partial)) if (!(LIMIT_KEYS as readonly string[]).includes(k)) return fail("BAD_INPUT", `there is no limit called ${k.replace(/[^A-Za-z]/g, "_").slice(0, 32)}`);
    for (const k of LIMIT_KEYS) {
      const v = partial[k];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return fail("BAD_INPUT", `${k} must be a whole number of 1 or more`);
      if (k === "maxOutputTokens" && v < MIN_OUTPUT_TOKENS) return fail("BAD_INPUT", `maxOutputTokens must be at least ${MIN_OUTPUT_TOKENS}, the smallest max_tokens a request is sent with`);
      if (v > this.#limits[k]) return fail("BAD_INPUT", `the page cannot raise ${k} above ${this.#limits[k]}, the limit open3dj view was started with`);
      out[k] = v;
    }
    return out;
  }

  /** undefined when id is the card that waits; otherwise why it cannot be decided. Applies expiry first. */
  #waiting(id: string): SessionError | undefined {
    this.#expireDue();
    const state = typeof id === "string" ? this.#approvals.state(id) : undefined;
    if (state === undefined) return fail("UNKNOWN_APPROVAL", "there is no approval card with this id");
    if (state === "expired") return fail("EXPIRED", "this card ran out of time; send the prompt again");
    if (state !== "pending" || this.#pending?.card.id !== id) return fail("ALREADY_DECIDED", `this card was already ${state}; a decision is final`);
    return undefined;
  }

  #denied(r: Extract<DecideResult, { status: "denied" }>): void {
    const pending = this.#pending;
    this.#pending = undefined;
    this.#clearTimer();
    if (pending) this.#tryAppend({ ...this.#base(r.card.id, r.card.payload_hash, pending), kind: "approval", decision: "denied", by: r.by });
    this.#emit({ kind: "approval_result", id: r.card.id, decision: "denied", by: r.by });
    this.#setState("idle");
  }

  #expired(card: ApprovalCard): void {
    const pending = this.#pending;
    if (!pending || pending.card.id !== card.id) return;
    this.#pending = undefined;
    this.#clearTimer();
    this.#tryAppend({ ...this.#base(card.id, card.payload_hash, pending), kind: "approval", decision: "expired", by: EXPIRY });
    this.#emit({ kind: "approval_result", id: card.id, decision: "expired", by: EXPIRY });
    this.#setState("idle");
  }

  #expireDue(): void {
    for (const card of this.#approvals.expireDue()) this.#expired(card);
  }

  #armTimer(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => this.#expireDue(), this.#ttl + 50);
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Run an approved prompt. Returns the turn id; the turn ends with a turn_end event. */
  #start(prepared: Prepared, card: ApprovalCard): string {
    const turn = `t_${String(++this.#turns).padStart(4, "0")}`;
    const engine = this.#engines[prepared.engineId]!;
    const controller = new AbortController();
    const run: Running = { turn, controller, prepared, approval: { id: card.id, hash: card.payload_hash }, promise: Promise.resolve() };
    this.#running = run;
    this.#emit({ kind: "prompt", text: prepared.text.replace(KEY_PATTERN, "[redacted key]") }, turn);
    this.#setState("running", prepared.engineId, prepared.model, turn);
    run.promise = (async () => {
      let end: TurnEnd;
      try {
        end = await engine.turn({
          turn,
          text: prepared.text,
          ...(prepared.model ? { model: prepared.model } : {}),
          limits: { ...prepared.limits },
          ledger: this.#ledger,
          signal: controller.signal,
          emit: (e) => this.#fromEngine(e, turn),
          onRevision: () => {
            try {
              this.#onRevision?.();
            } catch {
              // The viewer reports its own failures.
            }
          },
          onRequest: (r) => this.#logRequest(run, r),
        });
      } catch (e) {
        end = { reason: "error", message: e instanceof Error ? e.message : String(e) };
      }
      const body: AgentEventBody = { kind: "turn_end", reason: end.reason };
      if (end.message) body.message = clip(end.message.replace(KEY_PATTERN, "[redacted key]"), 2000);
      this.#emit(body, turn);
      this.#running = undefined;
      this.#setState("idle");
    })();
    return turn;
  }

  /** Engine events pass when they are of an engine's kinds and match the schema. */
  #fromEngine(e: AgentEventBody, turn: string): void {
    if (!e || !ENGINE_KINDS.has(e.kind)) return;
    const candidate = { seq: this.#seq + 1, ts: this.#ts(), turn, ...e };
    if (!validate("agent-event", candidate).valid) {
      this.#emit({ kind: "notice", level: "error", text: `The engine sent a ${e.kind.replace(/[^a-z_]/g, "_")} event that does not match its schema; it was left out.` }, turn);
      return;
    }
    this.#emit(e, turn);
  }

  #logRequest(run: Running, r: RequestReport): void {
    try {
      this.#append({
        ...this.#base(run.approval.id, run.approval.hash, run.prepared),
        kind: "request",
        request_bytes: r.bytes,
        attempts: Math.min(10, Math.max(1, Math.floor(r.attempts))),
        usage: r.usage ?? null,
        outcome: r.outcome,
      });
    } catch (e) {
      this.#emit({ kind: "notice", level: "error", text: `The egress log could not be written (${errorText(e)}), so the turn was stopped.` }, run.turn);
      run.controller.abort();
    }
  }

  #base(id: string, hash: string, p: Prepared) {
    return { ts: this.#ts(), approval_id: id, payload_hash: hash, engine: p.engineId, host: p.host, model: p.model };
  }

  #append(record: EgressRecord): void {
    this.#log.append(record);
  }

  #tryAppend(record: EgressRecord): void {
    try {
      this.#log.append(record);
    } catch (e) {
      this.#emit({ kind: "notice", level: "error", text: `The egress log could not be written (${errorText(e)}).` });
    }
  }

  #logFailed(e: unknown): SessionError {
    const message = `the egress log could not be written (${errorText(e)}), so nothing was sent`;
    this.#emit({ kind: "notice", level: "error", text: `The ${message}.` });
    return fail("EGRESS_LOG", message);
  }

  #setState(state: AgentState, engine?: EngineId, model?: string | null, turn?: string): void {
    this.#state = state;
    this.#status = {};
    const body: AgentEventBody = { kind: "status", state };
    if (engine) {
      body.engine = engine;
      this.#status.engine = engine;
    }
    if (model) {
      body.model = model;
      this.#status.model = model;
    }
    if (turn) this.#status.turn = turn;
    this.#emit(body, turn);
  }

  #ts(): string {
    return new Date(this.#now()).toISOString();
  }

  #emit(body: AgentEventBody, turn?: string): AgentEvent {
    const event = { seq: ++this.#seq, ts: this.#ts(), ...(turn ? { turn } : {}), ...body } as AgentEvent;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    this.#ring.push({ event, bytes });
    this.#ringBytes += bytes;
    while (this.#ring.length > 1 && (this.#ring.length > this.#ringMax || this.#ringBytes > this.#ringBytesMax)) {
      this.#ringBytes -= this.#ring.shift()!.bytes;
    }
    this.#record(event);
    for (const fn of [...this.#subs]) {
      try {
        fn(event);
      } catch {
        // A subscriber that fails never stops the session.
      }
    }
    return event;
  }

  /** Keep the compacted transcript the snapshot returns. */
  #record(e: AgentEvent): void {
    const turn = e.turn ?? "";
    const push = (entry: TranscriptEntry) => {
      const item = { e: entry, bytes: Buffer.byteLength(JSON.stringify(entry)) };
      this.#transcript.push(item);
      this.#transcriptBytes += item.bytes;
      return item;
    };
    switch (e.kind) {
      case "text":
        if (this.#openText && this.#openText.e.turn === turn) {
          this.#openText.e.text += e.delta;
          const n = Buffer.byteLength(e.delta);
          this.#openText.bytes += n;
          this.#transcriptBytes += n;
        } else {
          this.#openText = push({ kind: "text", turn, text: e.delta }) as OpenText;
        }
        break;
      case "discard": {
        const open = this.#openText;
        if (open && this.#transcript[this.#transcript.length - 1] === open) {
          this.#transcript.pop();
          this.#transcriptBytes -= open.bytes;
        }
        break;
      }
      case "prompt":
        push({ kind: "prompt", turn, text: e.text });
        break;
      case "tool_call":
        push({ kind: "tool", turn, call: e.call, tool: e.tool, input_preview: e.input_preview, input_bytes: e.input_bytes });
        break;
      case "tool_result": {
        const result: ToolStepResult = { status: e.status, summary: e.summary };
        if (e.rev) result.rev = e.rev;
        if (e.code) result.code = e.code;
        const item = [...this.#transcript].reverse().find((x) => x.e.kind === "tool" && x.e.call === e.call && x.e.result === undefined);
        if (item && item.e.kind === "tool") {
          item.e.result = result;
          const n = Buffer.byteLength(JSON.stringify(result));
          item.bytes += n;
          this.#transcriptBytes += n;
        }
        break;
      }
      case "notice": {
        const entry: TranscriptEntry = { kind: "notice", level: e.level, text: e.text };
        if (e.turn) entry.turn = e.turn;
        push(entry);
        break;
      }
      case "approval_result": {
        const entry: TranscriptEntry = { kind: "approval", id: e.id, decision: e.decision, by: e.by };
        if (e.scope) entry.scope = e.scope;
        push(entry);
        break;
      }
      case "turn_end": {
        const entry: TranscriptEntry = { kind: "turn_end", turn, reason: e.reason };
        if (e.message) entry.message = e.message;
        push(entry);
        break;
      }
      case "reset":
        this.#transcript = [];
        this.#transcriptBytes = 0;
        this.#trimmed = false;
        break;
      default:
        break;
    }
    if (e.kind !== "text") this.#openText = undefined;
    while (this.#transcriptBytes > MAX_TRANSCRIPT_BYTES && this.#transcript.length > 1) {
      const dropped = this.#transcript.shift()!;
      this.#transcriptBytes -= dropped.bytes;
      this.#trimmed = true;
    }
  }
}

function limitsProblem(l: TurnLimits | undefined): string | undefined {
  const ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1;
  if (!l || !ok(l.maxRounds) || !ok(l.maxOutputTokens) || !ok(l.timeoutMs) || l.maxOutputTokens < MIN_OUTPUT_TOKENS) {
    return `the session limits must be whole numbers of 1 or more, and maxOutputTokens at least ${MIN_OUTPUT_TOKENS}`;
  }
  return undefined;
}

function sameLimits(a: TurnLimits, b: TurnLimits): boolean {
  return LIMIT_KEYS.every((k) => a[k] === b[k]);
}

function fail(code: SessionErrorCode, message: string): SessionError {
  return { ok: false, code, message };
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

function errorText(e: unknown): string {
  return clip((e instanceof Error ? e.message : String(e)).replace(KEY_PATTERN, "[redacted key]"), 300);
}
