// The session budget: caps from options only, every input token counted, never below 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetLedger, DEFAULT_INPUT_BUDGET, DEFAULT_OUTPUT_BUDGET } from "./ledger.ts";

test("the RFC defaults: 4,000,000 input and 200,000 output tokens", () => {
  const l = new BudgetLedger();
  assert.equal(DEFAULT_INPUT_BUDGET, 4_000_000);
  assert.equal(DEFAULT_OUTPUT_BUDGET, 200_000);
  assert.deepEqual(l.remaining(), { input: 4_000_000, output: 200_000 });
});

test("input counts uncached, cache reads and cache writes; output counts output", () => {
  const l = new BudgetLedger({ input: 10_000, output: 2_000 });
  l.add({ input: 100, output: 300, cache_read: 5_000, cache_write: 1_000 });
  l.add({ input: 50, output: 200, cache_read: 2_000, cache_write: 0 });
  assert.deepEqual(l.remaining(), { input: 10_000 - 8_150, output: 1_500 });
  const s = l.snapshot();
  assert.deepEqual(s, { caps: { input: 10_000, output: 2_000 }, used: { input: 150, output: 500, cache_read: 7_000, cache_write: 1_000 }, remaining: { input: 1_850, output: 1_500 } });
  s.caps.input = 1e9;
  s.used.output = 0;
  assert.deepEqual(l.remaining(), { input: 1_850, output: 1_500 }, "a snapshot is a copy");
});

test("the remaining budget never goes below 0, and one request may pass the cap", () => {
  const l = new BudgetLedger({ input: 1_000, output: 100 });
  l.add({ input: 900, output: 90, cache_read: 0, cache_write: 0 });
  l.add({ input: 900, output: 90, cache_read: 0, cache_write: 0 });
  assert.deepEqual(l.remaining(), { input: 0, output: 0 });
  assert.deepEqual(l.snapshot().used, { input: 1_800, output: 180, cache_read: 0, cache_write: 0 });
});

test("bad caps and bad usage are refused; nothing can raise a cap", () => {
  for (const caps of [{ input: 0, output: 1 }, { input: 1, output: -1 }, { input: 1.5, output: 1 }, { input: Number.NaN, output: 1 }, { input: "5", output: 1 }]) {
    assert.throws(() => new BudgetLedger(caps as never), /token budget must be a whole number of 1 or more/, JSON.stringify(caps));
  }
  const l = new BudgetLedger({ input: 100, output: 100 });
  for (const u of [{ input: -1, output: 0, cache_read: 0, cache_write: 0 }, { input: 1, output: 0.5, cache_read: 0, cache_write: 0 }, { input: 1, output: 1, cache_read: 0 }]) {
    assert.throws(() => l.add(u as never), /token usage .* must be a whole number of 0 or more/);
  }
  assert.deepEqual(l.remaining(), { input: 100, output: 100 }, "a refused add books nothing");
  const methods = Object.getOwnPropertyNames(BudgetLedger.prototype).sort();
  assert.deepEqual(methods, ["add", "constructor", "remaining", "snapshot"], "no setter for the caps");
});
