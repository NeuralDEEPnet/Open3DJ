// Main-thread side: one sandbox worker with a wall-clock watchdog. The QuickJS interrupt
// handler cannot fire while a kernel call is running, so the watchdog (worker.terminate())
// is the only thing that bounds a long OCCT operation. Any crash, exit or timeout respawns.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { now } from "./util.mjs";

const ENTRY = fileURLToPath(new URL("./sandbox-worker.mjs", import.meta.url));

export class SandboxHost {
  constructor({ deps, variant = "quickjs", qjsMaxMiB = 128, stackSizeMb = 8, maxOldGenerationSizeMb = 512, graceMs = 3000, captureStdout = true } = {}) {
    Object.assign(this, { deps, variant, qjsMaxMiB, stackSizeMb, maxOldGenerationSizeMb, graceMs, captureStdout });
    this.seq = 0; this.pending = new Map(); this.kernelStdout = []; this.events = []; this.spawns = 0;
  }
  start() {
    const t = now();
    this.spawns++;
    const w = new Worker(ENTRY, {
      workerData: { deps: this.deps, variant: this.variant, qjsMaxMiB: this.qjsMaxMiB },
      resourceLimits: { stackSizeMb: this.stackSizeMb, maxOldGenerationSizeMb: this.maxOldGenerationSizeMb },
      stdout: this.captureStdout, stderr: this.captureStdout, env: {}, // empty env: no secrets visible to the worker
    });
    if (this.captureStdout) {
      w.stdout.on("data", (d) => this.kernelStdout.push(String(d)));
      w.stderr.on("data", (d) => this.kernelStdout.push("[stderr] " + String(d)));
    }
    this.worker = w;
    this.ready = new Promise((resolve, reject) => {
      w.once("message", (m) => { if (m.type === "ready") resolve({ spawn_to_ready_ms: now() - t, worker_init_ms: m.init_ms }); });
      w.once("error", reject);
    });
    w.on("message", (m) => { if (m.type === "result") { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m.res); } } });
    w.on("error", (e) => this.#fail(w, { kind: "worker-error", message: String(e && e.message || e).slice(0, 300) }));
    w.on("exit", (code) => this.#fail(w, { kind: "worker-exit", message: `worker exited with code ${code}` }));
    return this.ready;
  }
  #fail(w, error) {
    if (w !== this.worker) return;
    this.events.push(error);
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ ok: false, error, timings: { total_ms: now() - p.t0 } }); this.pending.delete(id); }
    this.worker = null;
  }
  async run(code, { params, limits = {}, test = false, exportStep = false } = {}) {
    if (!this.worker) await this.start(); else await this.ready;
    const id = ++this.seq; const t0 = now();
    const cpuMs = limits.cpuMs ?? 2000;
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        const w = this.worker; this.pending.delete(id); this.worker = null;
        const tk = now(); await w.terminate(); const killMs = now() - tk;
        this.events.push({ kind: "watchdog-kill", id });
        resolve({ ok: false, error: { kind: "watchdog-killed", message: `no result after ${cpuMs + this.graceMs} ms; worker terminated` }, timings: { total_ms: now() - t0, terminate_ms: killMs } });
      }, cpuMs + this.graceMs);
      this.pending.set(id, { resolve: (res) => { res.roundtrip_ms = now() - t0; resolve(res); }, timer, t0 });
      this.worker.postMessage({ type: "run", id, code, params, limits, test, exportStep });
    });
  }
  async close() { if (this.worker) { const w = this.worker; this.worker = null; await w.terminate(); } }
}
