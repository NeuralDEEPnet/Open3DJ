// The CPU worker pool: parallel jobs, lanes, the wall-clock watchdog, recycling, cancel and
// crashes. Real workers load occt-wasm; the crash cases use a fake worker (fake-worker.testing.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@open3dj/schemas";
import { BENCH_SCRIPT, ComputeError, createPool } from "./index.ts";
import { installMemoryGuard } from "./memory-guard.ts";
import type { JobRequest, JobResult, Pool, PoolOptions } from "./types.ts";

// QuickJS guest work of a few hundred ms, so jobs overlap.
const BUSY = `let x = 0; for (let i = 0; i < 1500000; i++) x += i % 7;
return box(10, 10, 10 + (x % 3));`;
const FAKE = new URL("./fake-worker.testing.ts", import.meta.url);

const job = (over: Partial<JobRequest> = {}): JobRequest => ({ kind: "run", script: BENCH_SCRIPT, rev: "r_pool", ...over });

async function withPool(options: PoolOptions, fn: (pool: Pool, lines: string[]) => Promise<void>): Promise<void> {
  const lines: string[] = [];
  const pool = createPool({ log: (l) => lines.push(l), ...options });
  try {
    await fn(pool, lines);
  } finally {
    await pool.close();
  }
}

function expectError(r: JobResult, code: string): void {
  assert.equal(r.ok, false, `expected ${code}`);
  if (!r.ok) assert.equal(r.error.code, code, JSON.stringify(r.error));
}

test("runs jobs in parallel on separate workers, each with a schema-valid compute block", async () => {
  await withPool({ size: 2 }, async (pool) => {
    let maxBusy = 0;
    const poll = setInterval(() => (maxBusy = Math.max(maxBusy, pool.stats().busy)), 5);
    const results = await Promise.all([pool.run(job({ script: BUSY })), pool.run(job({ script: BUSY }))]);
    clearInterval(poll);
    for (const r of results) {
      assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
      assert.ok(validate("compute", r.compute).valid);
      assert.equal(r.compute.backend, "cpu.wasm");
      assert.equal(r.compute.device, "cpu x2");
      if (r.ok) assert.deepEqual(r.report.compute, r.compute);
    }
    assert.notEqual(results[0]!.stats.workerId, results[1]!.stats.workerId);
    assert.equal(maxBusy, 2, "both workers ran at the same time");
    assert.equal(pool.stats().completed, 2);
  });
});

test("batch jobs stay off the reserved worker; an interactive job overtakes the batch queue", async () => {
  await withPool({ size: 2, warm: true }, async (pool) => {
    // Wait until both workers are up.
    await Promise.all([pool.run(job(), { lane: "interactive" }), pool.run(job(), { lane: "batch" })]);
    const batch = [0, 1, 2].map(() => pool.run(job({ script: BUSY }), { lane: "batch" }));
    assert.deepEqual(pool.stats().queued, { interactive: 0, batch: 2 }, "only one batch job runs; the reserved worker stays free");
    const order: string[] = [];
    const interactive = pool.run(job(), { lane: "interactive" }).then((r) => (order.push("interactive"), r));
    const batchDone = Promise.all(batch).then((rs) => (order.push("batch"), rs));
    const [i, b] = await Promise.all([interactive, batchDone]);
    assert.equal(new Set(b.map((r) => r.stats.workerId)).size, 1, "all batch jobs ran on the one batch worker");
    assert.notEqual(i.stats.workerId, b[0]!.stats.workerId);
    assert.deepEqual(order, ["interactive", "batch"]);
  });
});

test("export jobs default to the batch lane", async () => {
  await withPool({ size: 2, warm: true }, async (pool) => {
    await Promise.all([pool.run(job(), { lane: "interactive" }), pool.run(job(), { lane: "batch" })]);
    const exports = [0, 1].map(() => pool.run(job({ kind: "export", export: { formats: ["step"] } })));
    assert.equal(pool.stats().queued.batch, 1);
    const [a, b] = (await Promise.all(exports)) as [JobResult, JobResult];
    assert.ok(a.ok && b.ok);
    assert.equal(a.stats.workerId, b.stats.workerId, "both exports ran on the batch worker");
  });
});

test("the watchdog kills a job past its deadline, returns JOB_TIMEOUT and the pool recovers", async () => {
  await withPool({ size: 1 }, async (pool, lines) => {
    const t0 = performance.now();
    const r = await pool.run(job({ script: "for (;;) {}", limits: { cpuMs: 60_000 } }), { timeoutMs: 800 });
    const elapsed = performance.now() - t0;
    expectError(r, "JOB_TIMEOUT");
    if (!r.ok) assert.ok(r.error.hint);
    assert.ok(elapsed < 5000, `stopped after ${elapsed} ms`);
    assert.equal(pool.stats().timedOut, 1);
    assert.ok(lines.some((l) => l.includes("deadline")));
    const next = await pool.run(job());
    assert.ok(next.ok, next.ok ? "" : JSON.stringify(next.error));
    assert.notEqual(next.stats.workerId, r.stats.workerId, "a fresh worker took over");
    assert.equal(next.stats.jobs, 1);
  });
});

test("workers are recycled after maxJobsPerWorker jobs", async () => {
  await withPool({ size: 1, maxJobsPerWorker: 2 }, async (pool) => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await pool.run(job());
      assert.ok(r.ok);
      ids.push(r.stats.workerId);
    }
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[1], ids[2]);
    assert.equal(pool.stats().recycled, 1);
  });
});

test("workers are recycled when kernel memory plus JS heap passes the limit", async () => {
  await withPool({ size: 1, recycleBytes: 64 * 1024 ** 2 }, async (pool, lines) => {
    const a = await pool.run(job());
    const b = await pool.run(job());
    assert.ok(a.stats.memoryBytes > 64 * 1024 ** 2, `a worker reports ${a.stats.memoryBytes} bytes`);
    assert.notEqual(a.stats.workerId, b.stats.workerId);
    assert.ok(pool.stats().recycled >= 1);
    assert.ok(lines.some((l) => /recycling worker \d+: memory/.test(l)));
  });
});

test("a kernel error retires the worker, even when the script catches it", async () => {
  await withPool({ size: 1 }, async (pool) => {
    const failed = await pool.run(job({ script: "return fillet(box(10, 10, 10), 8);" }));
    expectError(failed, "KERNEL_FILLET_FAILED");
    const caught = await pool.run(job({ script: "try { fillet(box(10, 10, 10), 8); } catch (e) {}\nreturn box(1, 1, 1);" }));
    assert.ok(caught.ok, "the script itself succeeds");
    const clean = await pool.run(job());
    assert.ok(clean.ok);
    assert.equal(new Set([failed.stats.workerId, caught.stats.workerId, clean.stats.workerId]).size, 3);
    assert.equal(pool.stats().recycled, 2);
  });
});

test("cancel: a queued job is dropped and a running job stops; the pool goes on", async () => {
  await withPool({ size: 1, cancelGraceMs: 500 }, async (pool) => {
    const running = new AbortController();
    const queued = new AbortController();
    const a = pool.run(job({ script: "for (;;) {}", limits: { cpuMs: 60_000 } }), { signal: running.signal });
    const b = pool.run(job(), { signal: queued.signal });
    await new Promise((r) => setTimeout(r, 300));
    queued.abort();
    expectError(await b, "JOB_CANCELLED");
    const t0 = performance.now();
    running.abort();
    expectError(await a, "JOB_CANCELLED");
    assert.ok(performance.now() - t0 < 100, "cancel answers at once");
    const pre = new AbortController();
    pre.abort();
    expectError(await pool.run(job(), { signal: pre.signal }), "JOB_CANCELLED");
    const next = await pool.run(job());
    assert.ok(next.ok, next.ok ? "" : JSON.stringify(next.error));
  });
});

test("gpu and cloud requests resolve as NO_BACKEND failures with a compute block", async () => {
  await withPool({ size: 1 }, async (pool) => {
    const r = await pool.run(job(), { mode: "gpu" });
    expectError(r, "NO_BACKEND");
    assert.ok(validate("compute", r.compute).valid);
    assert.equal(r.compute.backend, "none");
    assert.equal(pool.stats().workers, 0, "no worker started for a job that cannot be placed");
    assert.throws(() => pool.place("cloud", "export"), (e: unknown) => e instanceof ComputeError && e.code === "NO_BACKEND");
    assert.equal(pool.place("cpu", "render").backend, "cpu.wasm");
  });
});

test("a crashing job fails as WORKER_CRASHED and does not break the pool", async () => {
  await withPool({ size: 1, workerEntry: FAKE }, async (pool, lines) => {
    expectError(await pool.run(job({ script: "crash" })), "WORKER_CRASHED");
    expectError(await pool.run(job({ script: "throw" })), "WORKER_CRASHED");
    expectError(await pool.run(job({ script: "fine" })), "FAKE_DONE");
    assert.equal(pool.stats().crashed, 2);
    assert.ok(lines.some((l) => l.includes("exited with code 3")));
    assert.ok(lines.some((l) => l.includes("fake uncaught error")));
  });
});

test("a job queued behind a crash still runs", async () => {
  await withPool({ size: 1, workerEntry: FAKE }, async (pool) => {
    const [a, b] = await Promise.all([pool.run(job({ script: "crash" })), pool.run(job({ script: "fine" }))]);
    expectError(a, "WORKER_CRASHED");
    expectError(b, "FAKE_DONE");
  });
});

test("worker stdout and stderr go to the log, never to process.stdout", async () => {
  await withPool({ size: 1, workerEntry: FAKE }, async (pool, lines) => {
    await pool.run(job({ script: "print" }));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(lines.some((l) => /^\[worker \d+ stdout\] fake stdout line$/.test(l)), lines.join("\n"));
    assert.ok(lines.some((l) => /^\[worker \d+\] fake stderr line$/.test(l)));
  });
});

test("workers that cannot start fail the queued jobs instead of hanging", async () => {
  const entry = new URL("./fake-fatal-worker.testing.ts", import.meta.url);
  await withPool({ size: 1, workerEntry: entry }, async (pool) => {
    const r = await pool.run(job());
    expectError(r, "WORKER_CRASHED");
    if (!r.ok) assert.match(r.error.message, /fail to start/);
  });
});

test("a hung worker is killed by the watchdog; close() rejects pending jobs", async () => {
  await withPool({ size: 1, workerEntry: FAKE }, async (pool) => {
    const hung = await pool.run(job({ script: "hang" }), { timeoutMs: 200 });
    expectError(hung, "JOB_TIMEOUT");
    // Regression (review round 1): the hint said to raise the deadline, which no input can do.
    if (!hung.ok) assert.doesNotMatch(hung.error.hint ?? "", /deadline/);
    const pending = pool.run(job({ script: "hang" }));
    const queued = pool.run(job({ script: "fine" }));
    const closedError = (e: unknown) => e instanceof ComputeError && e.code === "POOL_CLOSED";
    const checks = [pending, queued].map((p) => assert.rejects(p, closedError));
    await new Promise((r) => setTimeout(r, 100));
    await pool.close();
    await Promise.all(checks);
    await assert.rejects(pool.run(job()), closedError);
    assert.equal(pool.stats().workers, 0);
  });
});

// Regression (review round 1): nothing bounded a worker's memory while a job ran; recycleBytes
// was only compared after the job. A one-line export grew each worker to 2.2 GB before the
// watchdog. Now WebAssembly memory growth past memoryLimitBytes stops the job at once.
test("a job whose WebAssembly memory passes the limit fails as JOB_MEMORY and the worker is replaced", async () => {
  await withPool({ size: 1, workerEntry: FAKE, memoryLimitBytes: 32 * 1024 * 1024 }, async (pool, lines) => {
    const t = performance.now();
    const r = await pool.run(job({ script: "grow" }), { timeoutMs: 20_000 });
    expectError(r, "JOB_MEMORY");
    if (!r.ok) assert.match(r.error.hint ?? "", /smaller|simpler/);
    assert.ok(performance.now() - t < 10_000, "stopped at the limit, not by the watchdog");
    assert.ok(lines.some((l) => /memory limit/.test(l)), lines.join("\n"));
    expectError(await pool.run(job({ script: "fine" })), "FAKE_DONE");
  });
});

test("the memory guard refuses growth past the limit and can be removed", () => {
  const hits: number[] = [];
  const remove = installMemoryGuard(10 * 65536, (bytes) => hits.push(bytes));
  try {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 100 });
    m.grow(5);
    assert.throws(() => m.grow(10), RangeError);
    assert.deepEqual(hits, [16 * 65536]);
    assert.equal(m.buffer.byteLength, 6 * 65536);
  } finally {
    remove();
  }
  const free = new WebAssembly.Memory({ initial: 1, maximum: 100 });
  free.grow(50);
  assert.equal(free.buffer.byteLength, 51 * 65536);
});
