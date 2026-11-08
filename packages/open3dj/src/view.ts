// open3dj view: a loopback HTTP server for the browser viewer (PLAN.md S2, ARCHITECTURE.md
// sections 12 and 13). It never changes the design: GET and HEAD only, plus POST api/selection
// and POST api/link.
//
// Security, sized for a local single-user tool:
// - It listens on 127.0.0.1 only.
// - A one-time link, /<nonce>/ (24 random bytes, printed once), logs a browser in. Its first
//   GET burns the nonce and answers a small page that sets a session cookie, o3j_<port> (32
//   random bytes; HttpOnly, SameSite=Strict, Path=/), and moves to / with a meta refresh. A
//   30x does not work: a Strict cookie set during a cross-site navigation is not sent on a
//   redirect within that navigation. The server keeps only the sha256 of each nonce and cookie.
//   A used or expired link answers 410.
// - Every other route lives at the root path (/, app/..., vendor/..., api/...) and needs the
//   cookie. Without it the answer is a plain 404.
// - The Host header must name this loopback port (against DNS rebinding), and a request that
//   carries an Origin must come from this page. Sec-Fetch-Site cross-site and same-site
//   requests are refused too, except that the one-time link takes a navigation (Sec-Fetch-Mode
//   navigate, Sec-Fetch-Dest document) with Sec-Fetch-Site none or cross-site: the redirect file
//   that openBrowser writes is a file:// page, so the browser sends that navigation as
//   cross-site. There are no CORS headers, so other pages cannot read answers.
// - GET and HEAD, plus two writes. POST api/selection shares the person's selection with
//   agents (.o3j-view/selection.json); the body must match the viewer-selection-input schema
//   and name parts and face numbers of a stored revision. POST api/link makes a new one-time
//   link for another browser (at most 3 unused, each for 10 minutes). Both pass checkWrite():
//   the page's own Origin (a missing Origin is refused too), Content-Type application/json, a
//   capped Content-Length, and a token-bucket rate limit. They can write nothing else.
// - The routes are a fixed table: the page, the viewer's own assets (@open3dj/viewer), and
//   JSON, GLB and PNG made by the tool handlers from the project. A request path is never
//   joined onto a folder, so it cannot name another file.
//
// It watches the script and runs it again on save (debounced), and polls the project head,
// so a revision made by an agent through open3dj mcp shows up too. It also polls
// .o3j-view/highlight.json, which render view=highlight writes from any process, and checks it
// (schema, time and revision) before the page sees it. Both .o3j-view files are rebuilt from the
// revision on every read, because any local process can write them. New revisions, runs, shared selections and
// agent highlights are announced on a server-sent-events stream.
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FILES, HIGHLIGHT_FILE, MAX_HIGHLIGHT_BYTES, MAX_VIEW_STATE_BYTES, ProjectStore, ToolError, buildSelection, faceCounts, readHighlight, readSelection, resolveProject, toScriptError, writeSelection } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
import type { FitReport, ParamValue, PartReport, RunOutput, ScriptError, TreeNode, ViewerHighlight, ViewerSelection } from "@open3dj/schemas";
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
  /** The nonce of the one-time link printed at start. Default: 24 random bytes, base64url. Tests pass their own. */
  nonce?: string;
  /** Wait after the last change to the script before running it. Default 200 ms. */
  debounceMs?: number;
  /** How often to check the project head for revisions made elsewhere. Default 1000 ms. */
  pollMs?: number;
  /** Called after every run, for the terminal. */
  onRun?: (run: RunState, out?: RunOutput) => void;
  /** Diagnostics. Default: stderr. */
  log?: (line: string) => void;
  /** Rate limit of POST api/selection: a bucket of burst requests, refilled at perSecond. Default 20 and 5. */
  selectionRate?: { burst: number; perSecond: number };
  /** Rate limit of POST api/link. Default 5, refilled at 0.1 a second. */
  linkRate?: { burst: number; perSecond: number };
  /** Clock for the shared selection's time stamp and for the expiry of one-time links; tests pin it. */
  now?: () => Date;
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
  /** http://127.0.0.1:<port>/<nonce>/: the one-time link printed at start. It does not expire while the server runs. */
  url: string;
  port: number;
  nonce: string;
  /** http://127.0.0.1:<port>: the page lives at its root once a link set the cookie. */
  origin: string;
  /** The session cookie's name, o3j_<port>, so viewers on two ports keep their own cookies. */
  cookieName: string;
  /** A new one-time link, as "Open in another browser" makes: at most 3 unused, each for 10 minutes. */
  newLink(): string;
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
/** A highlight older than this is not sent to a page that connects later. */
const HIGHLIGHT_FRESH_MS = 15 * 60 * 1000;

/** A one-time link: one path segment of 16 or more URL-safe characters, with or without the last slash. No route has that shape. */
const LINK_PATH = /^\/([A-Za-z0-9_-]{16,})\/?$/;
/** A query kept across the move to /, such as ?renderer=webgl. Anything else is dropped. */
const SAFE_QUERY = /^[A-Za-z0-9._~=&%+-]{0,512}$/;
const LINK_TTL_MS = 10 * 60 * 1000;
const MAX_UNUSED_LINKS = 3;
/** Used and expired links remembered, to answer 410 instead of 404. */
const MAX_SPENT_LINKS = 64;
/** Browsers logged in at once; the oldest is dropped first. */
const MAX_SESSIONS = 32;
const MAX_LINK_BODY = 1024;
const LINK_GONE = {
  used: "this one-time link was already used; run open3dj view again or use 'Open in another browser' on the page",
  expired: "this one-time link expired; run open3dj view again or use 'Open in another browser' on the page",
};
/** The page that sets the cookie has no scripts, styles or images. */
const BOUNCE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const sha256 = (s: string): Buffer => createHash("sha256").update(s).digest();

/** Where hash is in list, comparing every entry in constant time. -1 when it is not. */
function indexOfHash(list: readonly Buffer[], hash: Buffer): number {
  let at = -1;
  for (let i = 0; i < list.length; i++) if (timingSafeEqual(list[i]!, hash)) at = i;
  return at;
}

/** A token bucket: burst requests, refilled at perSecond. take() is false when it is empty. */
function tokenBucket(rate: { burst: number; perSecond: number }): { take(): boolean; retryAfter: number } {
  let tokens = rate.burst;
  let refilled = Date.now();
  return {
    retryAfter: Math.max(1, Math.ceil(1 / rate.perSecond)),
    take() {
      const t = Date.now();
      tokens = Math.min(rate.burst, tokens + ((t - refilled) / 1000) * rate.perSecond);
      refilled = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

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
  if (!LINK_PATH.test(`/${nonce}/`)) throw new Error("the view nonce must be at least 16 URL-safe characters");
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
  const now = o.now ?? (() => new Date());
  const selectionBucket = tokenBucket(o.selectionRate ?? { burst: 20, perSecond: 5 });
  const linkBucket = tokenBucket(o.linkRate ?? { burst: 5, perSecond: 0.1 });
  // One-time links and sessions, by the sha256 of the nonce or cookie value. The printed link
  // never expires; links made later expire after LINK_TTL_MS.
  const links: Array<{ hash: Buffer; expires: number }> = [{ hash: sha256(nonce), expires: Number.POSITIVE_INFINITY }];
  const spent: Array<{ hash: Buffer; why: keyof typeof LINK_GONE }> = [];
  const sessions: Buffer[] = [];
  let cookieName = "";
  let highlightKey = "";
  let highlight: ViewerHighlight | undefined;

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
  /** Read .o3j-view/highlight.json when its size or time changed; announce a new, valid one. */
  function checkHighlight(): void {
    let key: string;
    try {
      const st = lstatSync(join(dir, ...HIGHLIGHT_FILE.split("/")));
      key = st.isFile() && st.size <= MAX_HIGHLIGHT_BYTES ? `${st.size}:${st.mtimeMs}` : "";
    } catch {
      key = "";
    }
    if (key === highlightKey) return;
    highlightKey = key;
    const h = key ? readHighlight(store) : undefined;
    if (!h || h.id === highlight?.id) return;
    highlight = h;
    broadcast("highlight", h);
  }
  highlightKey = "";
  try {
    // A highlight already there when the viewer starts is shown only while it is fresh.
    checkHighlight();
  } catch {
    // Nothing to show.
  }
  const poll = setInterval(() => {
    checkHead();
    checkHighlight();
  }, o.pollMs ?? 1000);
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

  // ---- one-time links and sessions --------------------------------------------------------

  /** Move links past their time to the spent list. */
  function pruneLinks(): void {
    const t = now().getTime();
    for (let i = links.length - 1; i >= 0; i--) if (links[i]!.expires <= t) spend(links.splice(i, 1)[0]!.hash, "expired");
  }

  function spend(hash: Buffer, why: keyof typeof LINK_GONE): void {
    spent.push({ hash, why });
    while (spent.length > MAX_SPENT_LINKS) spent.shift();
  }

  /** A new one-time link for another browser. The oldest unused one goes when 3 are waiting. */
  function mintLink(): { url: string; expires_at: string } {
    pruneLinks();
    while (links.length >= MAX_UNUSED_LINKS) spend(links.shift()!.hash, "expired");
    const fresh = randomBytes(24).toString("base64url");
    const expires = now().getTime() + LINK_TTL_MS;
    links.push({ hash: sha256(fresh), expires });
    return { url: `http://127.0.0.1:${port}/${fresh}/`, expires_at: new Date(expires).toISOString() };
  }

  /** True when the request carries this server's session cookie with a value it handed out. */
  function hasSession(req: IncomingMessage): boolean {
    const header = req.headers.cookie;
    if (!header) return false;
    let ok = false;
    for (const pair of header.split(";")) {
      const eq = pair.indexOf("=");
      if (eq < 0 || pair.slice(0, eq).trim() !== cookieName) continue;
      if (indexOfHash(sessions, sha256(pair.slice(eq + 1).trim())) >= 0) ok = true;
    }
    return ok;
  }

  /** The small page that moves to / (keeping a safe query), optionally setting the cookie. */
  function bounce(req: IncomingMessage, res: ServerResponse, query: string, cookie?: string): void {
    // SAFE_QUERY has no quotes or angle brackets; & is the one character to escape in an attribute.
    const to = `/${query && SAFE_QUERY.test(query) ? `?${query}` : ""}`.replace(/&/g, "&amp;");
    const extra: Record<string, string> = { "Content-Security-Policy": BOUNCE_CSP };
    if (cookie) extra["Set-Cookie"] = cookie;
    send(res, req, 200, "text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>open3dj view</title><p><a href="${to}">Open the viewer</a></p>\n`, extra);
  }

  /** GET /<nonce>/: trade a one-time link for a session cookie. */
  function exchange(req: IncomingMessage, res: ServerResponse, candidate: string, query: string): void {
    // A navigation only: the link may come from another app, a file:// page or a typed URL
    // (cross-site or none), never from a fetch, an image or a frame of another page.
    const site = req.headers["sec-fetch-site"];
    const mode = req.headers["sec-fetch-mode"];
    const dest = req.headers["sec-fetch-dest"];
    if (site !== undefined && site !== "none" && site !== "cross-site" && site !== "same-origin") return text(res, req, 403, "refused: cross-site request");
    if ((mode !== undefined && mode !== "navigate") || (dest !== undefined && dest !== "document")) return text(res, req, 403, "refused: a one-time link opens only as a page");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return text(res, req, 405, "refused: a one-time link takes GET only");
    }
    const hash = sha256(candidate);
    pruneLinks();
    const at = indexOfHash(links.map((l) => l.hash), hash);
    if (at < 0) {
      const gone = indexOfHash(spent.map((s) => s.hash), hash);
      if (gone < 0) return text(res, req, 404, "not found");
      // The browser that used it is logged in already (a Back button, or the printed link pasted again).
      if (hasSession(req)) return bounce(req, res, query);
      return text(res, req, 410, LINK_GONE[spent[gone]!.why]);
    }
    links.splice(at, 1);
    spend(hash, "used");
    const value = randomBytes(32).toString("base64url");
    sessions.push(sha256(value));
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    bounce(req, res, query, `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedHosts.has(req.headers.host ?? "")) return text(res, req, 403, "refused: the Host header must be this loopback server");
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) return text(res, req, 403, "refused: cross-origin request");
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
      res.setHeader("Allow", "GET, HEAD");
      return text(res, req, 405, "refused: GET and HEAD only, plus POST api/selection and api/link");
    }
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const raw = q < 0 ? url : url.slice(0, q);
    if (!raw.startsWith("/")) return text(res, req, 400, "bad request");
    const link = LINK_PATH.exec(raw);
    if (link) return exchange(req, res, link[1]!, q < 0 ? "" : url.slice(q + 1));
    const site = req.headers["sec-fetch-site"];
    if (site === "cross-site" || site === "same-site") return text(res, req, 403, "refused: cross-site request");
    if (!hasSession(req)) return text(res, req, 404, "not found");
    let parts: string[];
    try {
      parts = raw.slice(1).split("/").map((s) => decodeURIComponent(s));
    } catch {
      return text(res, req, 400, "bad request");
    }
    if (parts.some((p) => p === "." || p === ".." || /[\\/\0]/.test(p) || p.startsWith("."))) return text(res, req, 400, "refused: path");
    const route = parts.join("/");

    if (req.method === "POST") {
      if (route === "api/selection") return postSelection(req, res);
      if (route === "api/link") return postLink(req, res);
      res.setHeader("Allow", "GET, HEAD");
      return text(res, req, 405, "refused: GET and HEAD only, plus POST api/selection and api/link");
    }
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
    if (route === "api/selection") return json(res, req, 200, readSelection(store) ?? { items: [] });
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
    const hello: { rev: string | null; run: RunState; highlight?: ViewerHighlight } = { rev: safeHead() ?? null, run };
    // readHighlight refused a time in the future, so the age is never negative here.
    const age = highlight ? Date.now() - Date.parse(highlight.ts) : Number.POSITIVE_INFINITY;
    if (highlight && age >= 0 && age < HIGHLIGHT_FRESH_MS) hello.highlight = highlight;
    res.write(`retry: 2000\n\nevent: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  // ---- the writes: the person's selection, shared with agents, and new one-time links ------

  /**
   * The guard of every write. It answers a refusal itself and returns false. A write needs the
   * page's own Origin: browsers always send it on a POST fetch, so a request without one did
   * not come from the page. Then Sec-Fetch-Site same-origin when sent, application/json (a
   * cross-site form cannot send it, and a cross-site fetch would need a CORS preflight that is
   * never answered), a Content-Length of at most maxBytes, and a token from the route's bucket.
   */
  function checkWrite(req: IncomingMessage, res: ServerResponse, maxBytes: number, bucket: ReturnType<typeof tokenBucket>, what: string): boolean {
    const refuse = (status: number, message: string) => (text(res, req, status, message), false);
    if (!allowedOrigins.has(req.headers.origin ?? "")) return refuse(403, "refused: a write needs this page's Origin");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return refuse(403, "refused: cross-site request");
    const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return refuse(415, "refused: send application/json");
    if (req.headers["transfer-encoding"] !== undefined || req.headers["content-length"] === undefined) return refuse(411, "refused: a Content-Length is required");
    const length = Number(req.headers["content-length"]);
    if (!Number.isInteger(length) || length < 0) return refuse(400, "bad request");
    if (length > maxBytes) return refuse(413, `refused: the body is over ${maxBytes} bytes`);
    if (!bucket.take()) {
      res.setHeader("Retry-After", String(bucket.retryAfter));
      return refuse(429, `refused: too many ${what}; try again in ${bucket.retryAfter === 1 ? "a second" : `${bucket.retryAfter} seconds`}`);
    }
    return true;
  }

  /** POST api/link: a new one-time link for another browser. The body is {}. */
  async function postLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!checkWrite(req, res, MAX_LINK_BODY, linkBucket, "new links")) return;
    const body = await readBody(req, MAX_LINK_BODY);
    let input: unknown;
    try {
      input = JSON.parse(body.toString("utf8"));
    } catch {
      return json(res, req, 400, { error: { code: "BAD_INPUT", message: "the body is not JSON" } });
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) return json(res, req, 400, { error: { code: "BAD_INPUT", message: "send {}" } });
    return json(res, req, 200, mintLink());
  }

  async function postSelection(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!checkWrite(req, res, MAX_VIEW_STATE_BYTES, selectionBucket, "selection updates")) return;
    const body = await readBody(req, MAX_VIEW_STATE_BYTES);
    let input: unknown;
    try {
      input = JSON.parse(body.toString("utf8"));
    } catch {
      return json(res, req, 400, { error: { code: "BAD_INPUT", message: "the body is not JSON" } });
    }
    const head = safeHead();
    if (!head) return json(res, req, 409, { error: { code: "NO_REVISION", message: "there is no revision to select in yet" } });
    const asked = input && typeof input === "object" ? (input as { rev?: unknown }).rev : undefined;
    const rev = typeof asked === "string" && REV.test(asked) ? asked : head;
    let sel: ViewerSelection;
    try {
      const rec = store.resolve(rev);
      // Face numbers are checked against the kernel's face counts: the detailed measures the page shows.
      const model = await modelFor(rev);
      sel = buildSelection(rec, input, faceCounts(model.parts), now());
    } catch (e) {
      const err = toScriptError(e);
      return json(res, req, e instanceof ToolError && err.code !== "INTERNAL_ERROR" ? 400 : 500, { error: { code: err.code, message: err.message } });
    }
    writeSelection(store, sel);
    broadcast("selection", sel);
    return json(res, req, 200, sel);
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
  server.requestTimeout = 30_000;

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
  // Cookies are kept per host, not per port: the port in the name keeps two viewers apart.
  cookieName = `o3j_${port}`;

  const ready = schedule(true);

  return {
    url: `http://127.0.0.1:${port}/${nonce}/`,
    port,
    nonce,
    origin: `http://127.0.0.1:${port}`,
    cookieName,
    newLink: () => mintLink().url,
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

/** The request body, at most limit bytes (the Content-Length was checked before). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.byteLength;
      if (size > limit) {
        reject(new HttpError(413, `refused: the body is over ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
