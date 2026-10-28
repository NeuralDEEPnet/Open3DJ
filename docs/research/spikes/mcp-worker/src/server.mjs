// Minimal Open3DJ stdio MCP server (spike). The OCCT kernel runs off the main thread.
//
// node server.mjs --deps <deps> [--backend thread|child|inproc] [--print-hook 1|0]
//                 [--isolate 1|0] [--guard 1|0] [--export-dir <dir>] [--timeout-ms 20000]
//
//  --backend    thread = worker_threads, child = child_process + IPC, inproc = main thread (baseline)
//  --print-hook inject Module.print/printErr into the Emscripten factory (fix A, at the source)
//  --isolate    thread: new Worker({stdout:true,stderr:true}) and drain to our stderr
//               child:  stdio pipe instead of inherit                     (fix B, at the boundary)
//  --guard      main-process console.log/info/debug -> stderr                 (fix C, defence in depth)
import { performance } from "node:perf_hooks";
import { parseArgs, format } from "node:util";

const { values: A } = parseArgs({
  options: {
    deps: { type: "string" }, backend: { type: "string", default: "thread" },
    "print-hook": { type: "string", default: "1" }, isolate: { type: "string", default: "1" },
    guard: { type: "string", default: "1" }, "export-dir": { type: "string" },
    "timeout-ms": { type: "string", default: "20000" },
  },
});
const BACKEND = A.backend, PRINT_HOOK = A["print-hook"] === "1", ISOLATE = A.isolate === "1", GUARD = A.guard === "1";
const TIMEOUT_MS = Number(A["timeout-ms"]);
const log = (...a) => process.stderr.write(`[open3dj ${BACKEND}] ${format(...a)}\n`);
if (GUARD) {
  // stdout belongs to the MCP transport. Anything else that writes through console goes to stderr.
  for (const m of ["log", "info", "debug"]) console[m] = (...a) => process.stderr.write(format(...a) + "\n");
}

import { pathToFileURL } from "node:url";
import { join, resolve as resolvePath, relative, dirname, isAbsolute, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, mkdir, open, stat } from "node:fs/promises";
import { constants as FS } from "node:fs";

const DEPS = A.deps;
const EXPORT_DIR = A["export-dir"] ?? join(process.cwd(), "exports");
const t0 = performance.now();
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const [{ McpServer }, { StdioServerTransport }, { z }] = await Promise.all([
  imp("@modelcontextprotocol/sdk/dist/esm/server/mcp.js"),
  imp("@modelcontextprotocol/sdk/dist/esm/server/stdio.js"),
  imp("zod/index.js"),
]);
const sdkLoadMs = +(performance.now() - t0).toFixed(1);

// ------------------------------------------------------------------ kernel host
class KernelHost {
  constructor(kind) { this.kind = kind; this.pending = new Map(); this.seq = 0; this.restarts = 0; this.capturedStdout = 0; this.capturedStderr = 0; this.lastExit = null; }
  start() {
    const startedAt = performance.now();
    this.ready = new Promise((res, rej) => { this._ready = res; this._readyFail = rej; });
    this.ready.catch(() => {});
    if (this.kind === "inproc") {
      import("./kernel-core.mjs").then(({ createKernelCore }) => createKernelCore({ deps: DEPS, printHook: PRINT_HOOK }))
        .then((core) => { this.core = core; this.readyMs = +(performance.now() - startedAt).toFixed(1); this._ready(); }, this._readyFail);
      return;
    }
    const onMsg = (m) => {
      if (m?.ready) { this.readyMs = +(performance.now() - startedAt).toFixed(1); this.kernelInitMs = m.initMs; this._ready(); return; }
      const p = this.pending.get(m.id); if (!p) return;
      clearTimeout(p.timer); this.pending.delete(m.id);
      if (m.ok) p.res(m.result); else p.rej(Object.assign(new Error(m.error.message), { kernel: true }));
    };
    const drain = (stream, which) => stream?.on("data", (d) => {
      if (which === "out") this.capturedStdout += d.length; else this.capturedStderr += d.length;
      process.stderr.write(`[kernel ${which}] ${d}`);
    });
    if (this.kind === "thread") {
      const w = new Worker(new URL("./worker-thread-entry.mjs", import.meta.url), {
        workerData: { deps: DEPS, printHook: PRINT_HOOK }, stdout: ISOLATE, stderr: ISOLATE,
      });
      if (ISOLATE) { drain(w.stdout, "out"); drain(w.stderr, "err"); }
      w.on("message", onMsg);
      w.on("error", (e) => log("worker error:", e?.message));
      w.on("exit", (code) => this._onExit(w, code));
      this.proc = w; this.post = (m) => w.postMessage(m);
    } else if (this.kind === "child") {
      const c = spawn(process.execPath, [new URL("./child-entry.mjs", import.meta.url).pathname, DEPS, PRINT_HOOK ? "1" : "0"], {
        stdio: ["ignore", ISOLATE ? "pipe" : "inherit", ISOLATE ? "pipe" : "inherit", "ipc"], serialization: "advanced",
      });
      if (ISOLATE) { drain(c.stdout, "out"); drain(c.stderr, "err"); }
      c.on("message", onMsg);
      c.on("exit", (code, sig) => this._onExit(c, code ?? sig));
      this.proc = c; this.post = (m) => c.send(m);
    } else throw new Error(`unknown backend ${this.kind}`);
  }
  _onExit(proc, code) {
    if (proc !== this.proc) return; // an old, already-replaced kernel
    this.lastExit = String(code);
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.rej(new Error(`kernel exited (${code}) during call`)); this.pending.delete(id); }
    if (!this.closing) { log("kernel exited", code, "- restarting"); this.restarts++; this.start(); }
  }
  kill() {
    const p = this.proc; this.proc = null;
    if (!p) return;
    if (this.kind === "thread") p.terminate(); else p.kill("SIGKILL");
  }
  restart(reason) {
    log("restarting kernel:", reason);
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.rej(new Error(`kernel restarted: ${reason}`)); this.pending.delete(id); }
    this.kill(); this.restarts++; this.start();
  }
  async call(method, params, timeoutMs = TIMEOUT_MS) {
    await this.ready;
    if (this.kind === "inproc") return this.core.handle(method, params); // cannot be pre-empted
    return new Promise((res, rej) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(Object.assign(new Error(`kernel call "${method}" exceeded ${timeoutMs} ms; kernel was killed and restarted`), { timeout: true }));
        this.restart("timeout");
      }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      this.post({ id, method, params });
    });
  }
  close() { this.closing = true; this.kill(); }
}

const host = new KernelHost(BACKEND);
host.start(); // eager: the kernel boots while the client runs the MCP handshake

// ------------------------------------------------------------------ export path policy
async function safeExportPath(rel) {
  if (typeof rel !== "string" || !rel || rel.length > 240 || rel.includes("\0")) throw new Error("path must be a short relative path");
  if (isAbsolute(rel)) throw new Error("path must be relative to the export directory");
  if (!/\.(step|stp)$/i.test(rel)) throw new Error("path must end in .step or .stp");
  await mkdir(EXPORT_DIR, { recursive: true });
  const root = await realpath(EXPORT_DIR);
  const target = resolvePath(root, rel);
  const r = relative(root, target);
  if (!r || r.startsWith("..") || isAbsolute(r)) throw new Error("path escapes the export directory");
  // find the deepest existing ancestor and make sure symlinks do not lead outside root
  let anc = dirname(target);
  for (;;) { try { await stat(anc); break; } catch { anc = dirname(anc); } }
  const inside = (p) => p === root || p.startsWith(root + sep);
  if (!inside(await realpath(anc))) throw new Error("path escapes the export directory through a symlink");
  await mkdir(dirname(target), { recursive: true });
  if (!inside(await realpath(dirname(target)))) throw new Error("path escapes the export directory through a symlink");
  return target;
}

// ------------------------------------------------------------------ MCP surface
const Op = z.object({ op: z.string(), id: z.string() }).passthrough();
const Script = z.union([
  z.object({ ops: z.array(Op).min(1), result: z.string().optional() }).describe("JSON op list"),
  z.object({ js: z.string().max(100_000) }).describe("JS body using the 3dj-style facade; must `return` a shape"),
]);
const Params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional();
const Vec3 = z.array(z.number()).length(3);
const errorResult = (e) => ({ isError: true, content: [{ type: "text", text: `${e.timeout ? "TIMEOUT" : e.kernel ? "KERNEL_ERROR" : "ERROR"}: ${e.message}` }] });

const server = new McpServer({ name: "open3dj-spike", version: "0.0.1" }, {
  instructions: "Spike server: run builds a model and returns metrics; render returns a 4-view drawing; export writes STEP inside the export dir.",
});

server.registerTool("run", {
  title: "Build a model",
  description: "Evaluate a model script in the kernel worker. Returns volume, bounding box, validity and triangle count.",
  inputSchema: { script: Script, params: Params, deflection: z.number().positive().max(10).optional() },
  outputSchema: {
    modelId: z.string(), valid: z.boolean(), volume: z.number(), area: z.number(),
    bbox: z.object({ min: Vec3, max: Vec3 }), triangles: z.number().int(), vertices: z.number().int(),
    logs: z.array(z.string()), liveShapes: z.number().int(), backend: z.string(),
    timingsMs: z.object({ build: z.number(), checks: z.number(), tessellate: z.number(), total: z.number(), host: z.number() }),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
}, async ({ script, params, deflection }) => {
  const t = performance.now();
  try {
    const r = await host.call("run", { script, params, deflection });
    const sc = { ...r, backend: BACKEND, timingsMs: { ...r.timingsMs, host: +(performance.now() - t).toFixed(2) } };
    return { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }] };
  } catch (e) { return errorResult(e); }
});

const ModelRef = { modelId: z.string().optional(), script: Script.optional(), params: Params };
server.registerTool("render", {
  title: "Render a 4-view drawing",
  description: "Front/top/right/iso hidden-line drawing of a model, as PNG image content plus the SVG as an embedded resource.",
  inputSchema: ModelRef,
  outputSchema: { modelId: z.string(), pngBytes: z.number().int(), svgBytes: z.number().int(), timingsMs: z.record(z.string(), z.number()) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async (p) => {
  const t = performance.now();
  try {
    if (!p.modelId && !p.script) throw new Error("give modelId or script");
    const r = await host.call("render", p);
    const png = Buffer.from(r.png.buffer, r.png.byteOffset, r.png.byteLength);
    const sc = { modelId: r.modelId, pngBytes: png.length, svgBytes: Buffer.byteLength(r.svg), timingsMs: { ...r.timingsMs, host: +(performance.now() - t).toFixed(2) } };
    return {
      structuredContent: sc,
      content: [
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        { type: "resource", resource: { uri: `open3dj://models/${r.modelId}/multiview.svg`, mimeType: "image/svg+xml", text: r.svg } },
        { type: "text", text: JSON.stringify(sc) },
      ],
    };
  } catch (e) { return errorResult(e); }
});

server.registerTool("export", {
  title: "Export STEP",
  description: "Write the model as STEP AP214 to a relative path inside the server's export directory.",
  inputSchema: { ...ModelRef, path: z.string(), overwrite: z.boolean().optional() },
  outputSchema: { modelId: z.string(), path: z.string(), bytes: z.number().int(), sha256: z.string(), timingsMs: z.record(z.string(), z.number()) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (p) => {
  const t = performance.now();
  try {
    if (!p.modelId && !p.script) throw new Error("give modelId or script");
    const target = await safeExportPath(p.path); // validate before spending kernel time
    const r = await host.call("exportStep", { modelId: p.modelId, script: p.script, params: p.params });
    const flags = FS.O_WRONLY | FS.O_CREAT | FS.O_NOFOLLOW | (p.overwrite ? FS.O_TRUNC : FS.O_EXCL);
    const fh = await open(target, flags, 0o644);
    try { await fh.writeFile(r.step); } finally { await fh.close(); }
    const sc = { modelId: r.modelId, path: target, bytes: Buffer.byteLength(r.step), sha256: createHash("sha256").update(r.step).digest("hex"), timingsMs: { ...r.timingsMs, host: +(performance.now() - t).toFixed(2) } };
    return { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }] };
  } catch (e) { return errorResult(e.code === "EEXIST" ? new Error("file exists; pass overwrite:true") : e); }
});

server.registerTool("kernel_stats", {
  description: "Diagnostics: kernel memory, captured kernel output, restarts, startup timings.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  try {
    const k = await host.call("stats", {});
    const s = { backend: BACKEND, printHook: PRINT_HOOK, isolate: ISOLATE, guard: GUARD, sdkLoadMs, kernelReadyMs: host.readyMs, kernelInitMs: host.kernelInitMs ?? k.initMs,
      hostCapturedStdoutBytes: host.capturedStdout, hostCapturedStderrBytes: host.capturedStderr, restarts: host.restarts, lastExit: host.lastExit,
      mainRssMb: Math.round(process.memoryUsage().rss / 1e6), kernel: k };
    return { content: [{ type: "text", text: JSON.stringify(s) }] };
  } catch (e) { return errorResult(e); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready (sdk ${sdkLoadMs} ms, connected ${(performance.now() - t0).toFixed(1)} ms) print-hook=${PRINT_HOOK} isolate=${ISOLATE} guard=${GUARD}`);
const shutdown = () => { host.close(); process.exit(0); };
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
