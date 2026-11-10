// The session budget of the agent panel: input and output token caps for one run of
// open3dj view. The caps come from CLI options only and never change while the viewer runs;
// the page cannot raise them. Every input token the API processed counts against the input
// cap, cached or not (input, cache_read and cache_write), because each was sent.
import type { BudgetLedgerView, TokenUsage } from "./types.ts";

/** RFC 0001 defaults: 4,000,000 input tokens and 200,000 output tokens per session. */
export const DEFAULT_INPUT_BUDGET = 4_000_000;
export const DEFAULT_OUTPUT_BUDGET = 200_000;

export interface BudgetCaps {
  input: number;
  output: number;
}

export interface LedgerSnapshot {
  caps: BudgetCaps;
  used: TokenUsage;
  remaining: { input: number; output: number };
}

export class BudgetLedger implements BudgetLedgerView {
  readonly #caps: BudgetCaps;
  #used: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

  constructor(caps: BudgetCaps = { input: DEFAULT_INPUT_BUDGET, output: DEFAULT_OUTPUT_BUDGET }) {
    for (const k of ["input", "output"] as const) {
      const v = caps?.[k];
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new Error(`the ${k} token budget must be a whole number of 1 or more`);
    }
    this.#caps = { input: caps.input, output: caps.output };
  }

  /** Book the usage of one request. Each field must be a whole number of 0 or more. */
  add(u: TokenUsage): void {
    for (const k of ["input", "output", "cache_read", "cache_write"] as const) {
      const v = u?.[k];
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error(`token usage ${k} must be a whole number of 0 or more`);
    }
    this.#used = {
      input: this.#used.input + u.input,
      output: this.#used.output + u.output,
      cache_read: this.#used.cache_read + u.cache_read,
      cache_write: this.#used.cache_write + u.cache_write,
    };
  }

  /** What is left, never below 0. */
  remaining(): { input: number; output: number } {
    const input = this.#used.input + this.#used.cache_read + this.#used.cache_write;
    return { input: Math.max(0, this.#caps.input - input), output: Math.max(0, this.#caps.output - this.#used.output) };
  }

  snapshot(): LedgerSnapshot {
    return { caps: { ...this.#caps }, used: { ...this.#used }, remaining: this.remaining() };
  }
}
