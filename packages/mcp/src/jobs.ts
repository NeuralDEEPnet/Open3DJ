// The minimal job model (S1, COMPUTE.md section 9). A run that misses the interactive
// deadline returns status "queued" with a job_id and keeps going; the agent polls with
// inspect fields=[job] and cancels with run ops=[{op: "cancel_job", job_id}]. Jobs live in
// the daemon's memory only: they are not keyed on MCP sessions and do not survive a restart.
import type { ComputeBlock, JobState, JobStatus, Rev, RunOutput } from "@open3dj/schemas";

interface JobEntry {
  status: JobStatus;
  controller: AbortController;
  done: Promise<void>;
  finishedAt?: number;
}

export interface StartedJob<T> {
  id: string;
  /** Settles with the job's value, or rejects with its error. */
  result: Promise<T>;
  signal: AbortSignal;
}

const KEEP_FINISHED = 200;

export class JobTable {
  #jobs = new Map<string, JobEntry>();
  #seq = 0;

  /**
   * Start work as a job. fn gets the job's abort signal and reports its outcome through
   * the value it returns: the rev it created, or a reason when it failed without throwing,
   * and the full result to keep for inspect fields=[job] (a queued run's report or error).
   */
  start<T>(kind: string, compute: ComputeBlock, fn: (signal: AbortSignal) => Promise<T>, outcome: (value: T) => { ok: boolean; rev?: Rev; reason?: string; result?: RunOutput }): StartedJob<T> {
    const id = `job_${Date.now().toString(36)}_${(++this.#seq).toString(36)}`;
    const controller = new AbortController();
    const status: JobStatus = { job_id: id, kind, state: "running", attempts: [] };
    const result = fn(controller.signal);
    const done = result.then(
      (value) => {
        const o = outcome(value);
        if (status.state === "cancelled") return;
        this.#finish(status, o.ok ? "done" : "failed", compute, o.ok ? "ok" : "failed", o.reason);
        if (o.rev) status.rev = o.rev;
        if (o.result) status.result = o.result;
      },
      (e: unknown) => {
        if (status.state === "cancelled") return;
        this.#finish(status, "failed", compute, "failed", (e as Error)?.message ?? String(e));
      },
    );
    this.#jobs.set(id, { status, controller, done });
    this.#prune();
    return { id, result, signal: controller.signal };
  }

  /** Wait up to ms for the job. True when it finished in time. */
  async waitFor(id: string, ms: number): Promise<boolean> {
    const entry = this.#jobs.get(id);
    if (!entry) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), ms);
    });
    const finished = await Promise.race([entry.done.then(() => true as const), timeout]);
    clearTimeout(timer);
    return finished;
  }

  get(id: string): JobStatus | undefined {
    const s = this.#jobs.get(id)?.status;
    return s ? structuredClone(s) : undefined;
  }

  /** Cancel a job. Returns its status, or undefined when the id is unknown. */
  cancel(id: string): JobStatus | undefined {
    const entry = this.#jobs.get(id);
    if (!entry) return undefined;
    if (entry.status.state === "running" || entry.status.state === "queued") {
      entry.status.state = "cancelled";
      entry.status.reason = "cancelled by run ops=[cancel_job]";
      entry.finishedAt = Date.now();
      entry.controller.abort();
    }
    return structuredClone(entry.status);
  }

  /** Abort every running job (daemon shutdown). */
  cancelAll(): void {
    for (const id of this.#jobs.keys()) this.cancel(id);
  }

  #finish(status: JobStatus, state: JobState, compute: ComputeBlock, outcome: "ok" | "failed", reason?: string): void {
    status.state = state;
    const attempt: NonNullable<JobStatus["attempts"]>[number] = { backend: compute.backend, device: compute.device, outcome };
    if (reason) {
      attempt.reason = reason;
      status.reason = reason;
    }
    status.attempts = [...(status.attempts ?? []), attempt];
    const entry = this.#jobs.get(status.job_id);
    if (entry) entry.finishedAt = Date.now();
  }

  #prune(): void {
    const finished = [...this.#jobs.entries()].filter(([, e]) => e.finishedAt !== undefined);
    if (finished.length <= KEEP_FINISHED) return;
    finished.sort((a, b) => a[1].finishedAt! - b[1].finishedAt!);
    for (const [id] of finished.slice(0, finished.length - KEEP_FINISHED)) this.#jobs.delete(id);
  }
}
