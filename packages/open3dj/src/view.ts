// open3dj view: a read-only loopback HTTP server for the browser viewer (PLAN.md S2,
// ARCHITECTURE.md sections 12 and 13).
//
// Security, sized for a local single-user tool:
// - It listens on 127.0.0.1 only.
// - Every request must start with the per-session nonce (/<nonce>/...), which is random and
//   printed once. Without it the answer is a plain 404.
// - The Host header must name this loopback port (against DNS rebinding), and a request that
//   carries an Origin must come from this page. Sec-Fetch-Site cross-site and same-site
//   requests are refused too. There are no CORS headers, so other pages cannot read answers.
// - Only GET and HEAD. The routes are a fixed table: the page, the viewer's own assets
//   (@open3dj/viewer), and JSON, GLB and PNG made by the tool handlers from the project. A
//   request path is never joined onto a folder, so it cannot name another file.
//
// It watches the script and runs it again on save (debounced), and polls the project head,
// so a revision made by an agent through open3dj mcp shows up too. New revisions are
// announced on a server-sent-events stream.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FILES, ProjectStore, resolveProject, toScriptError } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
import type { FitReport, ParamValue, PartReport, RunOutput, ScriptError, TreeNode } from "@open3dj/schemas";
import { viewerAssets, viewerPage } from "@open3dj/viewer";

export interface ViewServerOptions {
  handlers: ToolHandlers;
  /** The handlers' root folder; the project must be inside it. */
  root: string;
  /** Absolute path of the project folder (name.o3j). */
  project: string;
  /** The script file to watch and run. Default: the project's main.o3j.js. */
  script?: string;
  /** Parameter values for every run. */
  params?: Record<string, ParamValue>;
  /** false: run with params but keep the project's params.o3j.json (--no-save-params). Default true. */
  saveParams?: boolean;
  /** Port on 127.0.0.1. Default 0: the system picks a free one. */
  port?: number;
  /** The session nonce. Default: 24 random bytes, base64url. Tests pass their own. */
  nonce?: string;
  /** Wait after the last change to the script before running it. Default 200 ms. */
  debounceMs?: number;
  /** How often to check the project head for revisions made elsewhere. Default 1000 ms. */
  pollMs?: number;
  /** Called after every run, for the terminal. */
  onRun?: (run: RunState, out?: RunOutput) => void;
  /** Diagnostics. Default: stderr. */
  log?: (line: string) => void;
}

export interface RunState {
  state: "idle" | "running" | "done" | "error";
  at?: string;
  rev?: string;
  status?: RunOutput["status"];
  error?: ScriptError;
  /** The run's warnings (for example stored parameter values the new script did not use). */
  warnings?: string[];
}

export interface ViewServer {
  /** http://127.0.0.1:<port>/<nonce>/ */
  url: string;
  port: number;
  nonce: string;
  /** Settles after the first run. */
  ready: Promise<void>;
  /** Run the script now (also when it did not change). */
  rerun(): Promise<void>;
  close(): Promise<void>;
}

/** The model JSON the page reads from api/model. */
export interface ViewModel {
  project: string;
  rev: string | null;
  head: string | null;
  run: RunState;
  tree?: TreeNode[];
  definitions?: Record<string, { kind: string; name?: string; color?: [number, number, number] }>;
  report?: unknown;
  parts?: PartReport[];
  fits?: FitReport[];
  glb?: string;
  drawing?: string;
  note?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cache-Control": "no-store",
};

const REV = /^r_\d{1,7}$/;
const CACHE_REVS = 8;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function startViewServer(o: ViewServerOptions): Promise<ViewServer> {
  const log = o.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const nonce = o.nonce ?? randomBytes(24).toString("base64url");
  if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) throw new Error("the view nonce must be at least 16 URL-safe characters");
  const nonceBytes = Buffer.from(nonce);
  const store = new ProjectStore(resolveProject(o.root, o.project));
  const dir = store.project.dir;
  const scriptFile = o.script ?? join(dir, FILES.script);
  const assets = viewerAssets();
  const page = viewerPage(store.project.name);
  const debounceMs = o.debounceMs ?? 200;

  const clients = new Set<ServerResponse>();
  const models = new Map<string, Promise<ViewModel>>();
  const glbs = new Map<string, Promise<Uint8Array>>();
  const drawings = new Map<string, Promise<Uint8Array>>();
  let run: RunState = { state: "idle" };
  let announced = safeHead();
  let port = 0;
  let allowedHosts = new Set<string>();
  let allowedOrigins = new Set<string>();

  function safeHead(): string | undefined {
    try {
      return store.head();
    } catch {
      return undefined;
    }
  }

  function remember<T>(cache: Map<string, Promise<T>>, rev: string, make: () => Promise<T>): Promise<T> {
    let p = cache.get(rev);
    if (!p) {
      p = make();
      cache.set(rev, p);
      // A failure is not cached, so the next request tries again.
      p.catch(() => cache.get(rev) === p && cache.delete(rev));
      while (cache.size > CACHE_REVS) cache.delete(cache.keys().next().value!);
    }
    return p;
  }

  function modelFor(rev: string): Promise<ViewModel> {
    return remember(models, rev, async () => {
      const rec = store.resolve(rev);
      const project = dir;
      // Detailed measures and fits: from the revision when it was a detailed run, else one job, cached in .o3j-cache.
      let insp = await o.handlers.inspect({ project, rev, fields: ["tree", "fits", "measure"] });
      let note: string | undefined;
      if (insp.status !== "ok") {
        note = `detailed measures are not available (${insp.error?.code ?? "error"}); showing the concise report`;
        insp = await o.handlers.inspect({ project, rev, fields: ["tree"] });
      }
      const definitions: NonNullable<ViewModel["definitions"]> = {};
      for (const [id, d] of Object.entries(rec.assembly.definitions)) {
        const def: { kind: string; name?: string; color?: [number, number, number] } = { kind: d.kind };
        if (d.name !== undefined) def.name = d.name;
        if (d.color !== undefined) def.color = d.color;
        definitions[id] = def;
      }
      const m: ViewModel = {
        project: store.project.name, rev, head: rev, run,
        tree: insp.tree ?? [], definitions, report: rec.report,
        parts: insp.measure ?? rec.report.parts, fits: insp.fits ?? rec.report.fits,
        glb: `api/rev/${rev}/model.glb`, drawing: `api/rev/${rev}/drawing.png`,
      };
      if (note) m.note = note;
      return m;
    });
  }

  function glbFor(rev: string): Promise<Uint8Array> {
    return remember(glbs, rev, async () => {
      store.resolve(rev);
      // The existing export job, through the compute pool; its files land in out/<rev>/.
      const out = await o.handlers.export({ project: dir, rev, format: "gltf" });
      const file = out.status === "ok" ? out.files?.find((f) => f.format === "gltf") : undefined;
      if (!file) throw new HttpError(500, out.error ? `${out.error.code}: ${out.error.message}` : "the export made no GLB");
      return readFileSync(join(dir, ...file.path.split("/")));
    });
  }

  function drawingFor(rev: string): Promise<Uint8Array> {
    return remember(drawings, rev, async () => {
      store.resolve(rev);
      const r = await o.handlers.render({ project: dir, rev, view: "multiview", format: "png" });
      const png = r.images.find((i) => i.format === "png");
      if (r.output.status !== "ok" || !png) throw new HttpError(500, r.output.error ? `${r.output.error.code}: ${r.output.error.message}` : "the render made no PNG");
      return png.bytes;
    });
  }

  // ---- revisions and runs ----------------------------------------------------------------

  function broadcast(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(frame);
  }

  function checkHead(): void {
    const head = safeHead();
    if (!head || head === announced) return;
    announced = head;
    // Start the work the page will ask for next, so it is ready sooner.
    modelFor(head).catch(() => {});
    glbFor(head).catch(() => {});
    broadcast("revision", { rev: head });
  }

  function setRun(next: RunState, out?: RunOutput): void {
    run = next;
    broadcast("run", run);
    if (next.state !== "running") o.onRun?.(run, out);
  }

  let lastScript: string | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let force = false;

  async function runOnce(): Promise<void> {
    let script: string;
    try {
      script = readFileSync(scriptFile, "utf8");
    } catch {
      return; // An editor may remove the file for a moment while it saves.
    }
    if (!force && script === lastScript) return;
    force = false;
    lastScript = script;
    setRun({ state: "running", at: new Date().toISOString() });
    const input: Parameters<ToolHandlers["run"]>[0] = { project: dir, script, detail: "detailed" };
    if (o.params && Object.keys(o.params).length) input.params = o.params;
    if (o.saveParams === false) input.save_params = false;
    let out: RunOutput;
    try {
      out = await o.handlers.run(input);
    } catch (e) {
      out = { status: "error", error: toScriptError(e), compute: { backend: "none", device: "daemon", placement_reason: "the run failed" } };
    }
    const next: RunState = { state: out.error ? "error" : "done", at: new Date().toISOString(), status: out.status };
    if (out.rev) next.rev = out.rev;
    if (out.error) next.error = out.error;
    const warnings = (out.report?.warnings ?? []).filter((w) => !/^mass_g assumes /.test(w));
    if (warnings.length > 0) next.warnings = warnings;
    checkHead();
    setRun(next, out);
  }

  function schedule(forced = false): Promise<void> {
    if (forced) force = true;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          try {
            await runOnce();
          } catch (e) {
            log(`open3dj view: ${(e as Error).message}`);
          }
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dirname(scriptFile), (_event, filename) => {
      if (filename !== null && filename !== basename(scriptFile)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void schedule(), debounceMs);
    });
    watcher.on("error", (e) => log(`open3dj view: stopped watching ${basename(scriptFile)}: ${e.message}`));
  } catch (e) {
    log(`open3dj view: cannot watch ${basename(scriptFile)}: ${(e as Error).message}`);
  }
  const poll = setInterval(checkHead, o.pollMs ?? 1000);
  poll.unref();
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  // ---- HTTP --------------------------------------------------------------------------------

  const send = (res: ServerResponse, req: IncomingMessage, status: number, type: string, body: string | Uint8Array, extra: Record<string, string> = {}) => {
    const bytes = typeof body === "string" ? Buffer.from(body) : body;
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": String(bytes.byteLength), ...extra });
    res.end(req.method === "HEAD" ? undefined : bytes);
  };
  const text = (res: ServerResponse, req: IncomingMessage, status: number, message: string) => send(res, req, status, "text/plain; charset=utf-8", `${message}\n`);
  const json = (res: ServerResponse, req: IncomingMessage, status: number, data: unknown) => send(res, req, status, "application/json; charset=utf-8", JSON.stringify(data));

  const nonceOk = (s: string): boolean => {
    const b = Buffer.from(s);
    return b.length === nonceBytes.length && timingSafeEqual(b, nonceBytes);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedHosts.has(req.headers.host ?? "")) return text(res, req, 403, "refused: the Host header must be this loopback server");
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) return text(res, req, 403, "refused: cross-origin request");
    const site = req.headers["sec-fetch-site"];
    if (site === "cross-site" || site === "same-site") return text(res, req, 403, "refused: cross-site request");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return text(res, req, 405, "refused: the viewer is read-only");
    }
    const raw = (req.url ?? "/").split("?")[0]!;
    if (!raw.startsWith("/")) return text(res, req, 400, "bad request");
    const segments = raw.slice(1).split("/");
    if (!nonceOk(segments.shift() ?? "")) return text(res, req, 404, "not found");
    if (segments.length === 0) {
      res.setHeader("Location", `/${nonce}/`);
      return text(res, req, 308, "moved");
    }
    let parts: string[];
    try {
      parts = segments.map((s) => decodeURIComponent(s));
    } catch {
      return text(res, req, 400, "bad request");
    }
    if (parts.some((p) => p === "." || p === ".." || /[\\/\0]/.test(p) || p.startsWith("."))) return text(res, req, 400, "refused: path");
    const route = parts.join("/");

    if (route === "") return send(res, req, 200, "text/html; charset=utf-8", page.html, { "Content-Security-Policy": page.csp });
    const asset = assets.get(route);
    if (asset) return send(res, req, 200, asset.type, readFileSync(asset.file));
    if (route === "api/model") {
      const head = safeHead();
      if (!head) return json(res, req, 200, { project: store.project.name, rev: null, head: null, run } satisfies ViewModel);
      const m = await modelFor(head);
      return json(res, req, 200, { ...m, head, run });
    }
    if (route === "api/events") return events(req, res);
    const m = /^api\/rev\/([^/]+)\/(model\.glb|drawing\.png)$/.exec(route);
    if (m) {
      const rev = m[1]!;
      if (!REV.test(rev)) return text(res, req, 404, "no such revision");
      if (m[2] === "model.glb") return send(res, req, 200, "model/gltf-binary", await glbFor(rev));
      return send(res, req, 200, "image/png", await drawingFor(rev));
    }
    return text(res, req, 404, "not found");
  }

  function events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write(`retry: 2000\n\nevent: hello\ndata: ${JSON.stringify({ rev: safeHead() ?? null, run })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return text(res, req, e.status, e.message);
      const err = toScriptError(e);
      const status = err.code === "UNKNOWN_REV" || err.code === "NO_REVISION" || err.code === "PROJECT_NOT_FOUND" ? 404 : 500;
      text(res, req, status, `${err.code}: ${err.message}`);
    });
  });
  server.headersTimeout = 10_000;

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  }).catch((e: NodeJS.ErrnoException) => {
    watcher?.close();
    clearInterval(poll);
    clearInterval(heartbeat);
    throw e.code === "EADDRINUSE" ? new Error(`port ${o.port} on 127.0.0.1 is in use; pick another with --port, or leave it out for a free one`) : e;
  });
  port = (server.address() as AddressInfo).port;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  const ready = schedule(true);

  return {
    url: `http://127.0.0.1:${port}/${nonce}/`,
    port,
    nonce,
    ready,
    rerun: () => schedule(true),
    async close() {
      clearTimeout(timer);
      clearInterval(poll);
      clearInterval(heartbeat);
      watcher?.close();
      for (const c of clients) c.end();
      clients.clear();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      await running?.catch(() => {});
    },
  };
}

/** The part of child_process.spawn that openBrowser uses; tests pass a fake. */
export type Launcher = (cmd: string, args: string[], options: { stdio: "ignore"; detached: boolean }) => { on(event: "error", fn: () => void): unknown; unref(): void };

/**
 * Open url in the default browser. Failure is not fatal: the URL is printed anyway.
 *
 * The URL holds the session nonce, and any local account can read a process's argv (on
 * Linux, /proc/<pid>/cmdline). So the launcher never gets the URL: it gets a small HTML file,
 * readable by this user only (mode 0600, in a private mkdtemp folder), that redirects to it.
 * cleanup() deletes the file; the caller calls it when the server stops.
 */
export function openBrowser(url: string, log: (line: string) => void, launch: Launcher = spawn as unknown as Launcher): { file: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "open3dj-view-"));
  const file = join(dir, "open.html");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const href = JSON.stringify(url).replace(/</g, "\\u003c");
  const attr = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr}"><title>open3dj view</title><script>location.replace(${href})</script><a href="${attr}">open3dj view</a>\n`, { mode: 0o600 });
  const target = pathToFileURL(file).href;
  const [cmd, args] = process.platform === "darwin"
    ? ["open", [target]]
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", file]]
      : ["xdg-open", [target]];
  try {
    const child = launch(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => log(`open3dj view: could not start a browser (${cmd}); open the URL by hand`));
    child.unref();
  } catch {
    log("open3dj view: could not start a browser; open the URL by hand");
  }
  return { file, cleanup };
}
