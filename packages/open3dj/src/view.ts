// open3dj view: a loopback HTTP server for the browser viewer (PLAN.md S2, ARCHITECTURE.md
// sections 12 and 13). The page never changes the design: GET and HEAD only, plus POST api/selection.
//
// Security, sized for a local single-user tool:
// - It listens on 127.0.0.1 only.
// - Every request must start with the per-session nonce (/<nonce>/...), which is random and
//   printed once. Without it the answer is a plain 404.
// - The Host header must name this loopback port (against DNS rebinding), and a request that
//   carries an Origin must come from this page. Sec-Fetch-Site cross-site and same-site
//   requests are refused too. There are no CORS headers, so other pages cannot read answers.
// - GET and HEAD, plus one write: POST api/selection, which shares the person's selection with
//   agents (.o3j-view/selection.json). It needs the page's own Origin (a missing Origin is
//   refused too), Content-Type application/json, a Content-Length of 16 KiB or less, and passes
//   a token-bucket rate limit; the body must match the viewer-selection-input schema and name
//   parts and face numbers of a stored revision. It can write nothing else.
// - The routes are a fixed table: the page, the viewer's own assets (@open3dj/viewer), and
//   JSON, GLB and PNG made by the tool handlers from the project. A request path is never
//   joined onto a folder, so it cannot name another file.
//
// It watches the script and runs it again on save (debounced), and polls the project head,
// so a revision made by an agent through open3dj mcp shows up too. A save never replaces an
// agent's revision without saying so: a script equal to the head's is not run again, every
// watcher run passes base_rev, and in script mode an agent's revision is written back to the
// script while the script has no changes that did not run (see "the watched script").
// It also polls .o3j-view/highlight.json, which render view=highlight writes from any process, and checks it
// (schema, time and revision) before the page sees it. Both .o3j-view files are rebuilt from the
// revision on every read, because any local process can write them. New revisions, runs, shared selections and
// agent highlights are announced on a server-sent-events stream.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, watch, writeFileSync, writeSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FILES, HIGHLIGHT_FILE, MAX_HIGHLIGHT_BYTES, MAX_VIEW_STATE_BYTES, ProjectStore, ToolError, buildSelection, faceCounts, readHighlight, readSelection, renameWithRetry, resolveProject,
  toScriptError, writeSelection,
} from "@open3dj/mcp";
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
  /**
   * Start-up parameter values (--param). The watcher's runs pass them until a revision it did
   * not make (an agent's) becomes the head; from then on the project's stored values count.
   */
  params?: Record<string, ParamValue>;
  /** false: run with params but keep the project's params.o3j.json (--no-save-params). Default true. */
  saveParams?: boolean;
  /**
   * Only for a script outside the project: write a revision made elsewhere (an agent's) back to
   * the script, while the script has no changes that did not run. false: never write the script
   * (--no-sync-script); a save that is behind the head is then refused as a conflict. Default true.
   */
  syncScript?: boolean;
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
  /** Rate limit of POST api/selection: a bucket of burst requests, refilled at perSecond. Default 20 and 5. */
  selectionRate?: { burst: number; perSecond: number };
  /** Clock for the shared selection's time stamp; tests pin it. */
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
  /**
   * A save of file was not run, because head was made elsewhere (by an agent) after the
   * revision the save was based on (base; null: no revision). error says the same, with the
   * code REV_CONFLICT and a hint. It ends when a save runs or the script equals the head's.
   */
  conflict?: { file: string; base: string | null; head: string };
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
/** A highlight older than this is not sent to a page that connects later. */
const HIGHLIGHT_FRESH_MS = 15 * 60 * 1000;

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
  const now = o.now ?? (() => new Date());
  const rate = o.selectionRate ?? { burst: 20, perSecond: 5 };
  let tokens = rate.burst;
  let refilled = Date.now();
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

  // ---- the watched script and the head ----------------------------------------------------
  //
  // The watched script is based on one revision (fileRev): the one its text last ran as, or a
  // head it was found equal to; fileScript is that revision's script. Three rules keep the
  // person and an agent from undoing each other's work (RFC 0001):
  // - Echo: a script equal to the head's is adopted, never run again. An agent's run writes the
  //   project's main.o3j.js, and the write-back below writes the script.
  // - base_rev: every watcher run passes fileRev, so a save that is behind the head is refused
  //   (REV_CONFLICT) instead of replacing the newer revision.
  // - Follow: when a revision the watcher did not make becomes the head, the start-up --param
  //   values stop being sent. If that revision kept fileScript (a parameter change), the
  //   script is based on it. In script mode its script is written to the watched file, but
  //   only while the file still holds fileScript, so a change that did not run is never lost.
  //   Otherwise the person sees a conflict.

  const inProject = basename(scriptFile) === FILES.script && realDir(dirname(scriptFile)) === dir;
  /** The script's name in messages: part.o3j.js, or part.o3j/main.o3j.js. */
  const shown = inProject ? `${store.project.label}/${FILES.script}` : basename(scriptFile);
  const writeBack = !inProject && o.syncScript !== false;
  let lastScript: string | undefined;
  let cachedRecord: { rev: string; script: string; status: RunOutput["status"] } | undefined;
  let fileRev = safeHead();
  let fileScript = fileRev === undefined ? undefined : recordOf(fileRev)?.script;
  let paramsOn = o.params !== undefined && Object.keys(o.params).length > 0;
  /** The head a poll already reported a conflict (or a skipped write-back) for. */
  let noticed: string | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let force = false;
  let pending = false;

  function readScript(): string | undefined {
    try {
      return readFileSync(scriptFile, "utf8");
    } catch {
      return undefined; // An editor may remove the file for a moment while it saves.
    }
  }

  /** The script and status of a revision; records never change, so the last one is kept. */
  function recordOf(rev: string): { rev: string; script: string; status: RunOutput["status"] } | undefined {
    if (cachedRecord?.rev === rev) return cachedRecord;
    try {
      const rec = store.revision(rev);
      cachedRecord = { rev, script: rec.script, status: rec.report.status };
      return cachedRecord;
    } catch {
      return undefined;
    }
  }

  /** The run state of a script that holds rev's script: nothing to run, rev is shown. */
  function showRev(rev: string): void {
    setRun({ state: "done", at: new Date().toISOString(), rev, status: recordOf(rev)?.status ?? "ok" });
  }

  /** The file now holds the script of rev. A conflict or error shown for the old text is over. */
  function adopt(rev: string, script: string): void {
    fileRev = rev;
    fileScript = script;
    lastScript = script;
    noticed = undefined;
    if (run.state === "error") showRev(rev);
  }

  type Follow = "same" | "adopted" | "rebased" | "written" | "behind" | "conflict";

  /** Bring fileRev up to a head that the watcher did not make, by the rules above. */
  function follow(head: string, text: string): Follow {
    if (head === fileRev) return "same";
    const rec = recordOf(head);
    if (!rec) return "same"; // An unreadable record: the run's base_rev check decides.
    if (paramsOn) {
      paramsOn = false;
      log(`open3dj view: ${head} was made by an agent, so the start-up --param values (${Object.keys(o.params ?? {}).join(", ")}) are no longer sent; later saves use the project's stored values`);
    }
    if (text === rec.script) {
      adopt(head, text);
      return "adopted";
    }
    if (rec.script === fileScript) {
      // The head kept the script (an agent changed parameters): the file's changes apply on top.
      fileRev = head;
      return "rebased";
    }
    if (text !== fileScript) return "conflict";
    if (!writeBack) return inProject ? "conflict" : "behind";
    try {
      if (!replaceFile(scriptFile, rec.script, text)) return "conflict";
    } catch (e) {
      log(`open3dj view: could not write ${head} to ${shown}: ${(e as Error).message}`);
      return "conflict";
    }
    adopt(head, rec.script);
    log(`open3dj view: wrote ${head} (made by an agent) to ${shown}`);
    return "written";
  }

  /**
   * Say on the run state and in the terminal that a save was not run because the script was
   * behind head. why: "saved" (a save was refused), "found" (a poll found changes that did not
   * run), or "replaced" (head was made while the save ran, and its commit rewrote main.o3j.js).
   */
  function reportConflict(head: string, why: "saved" | "found" | "replaced", base: string | null = fileRev ?? null): void {
    const label = store.project.label;
    const keep = `run "open3dj run ${inProject ? label : shown}" once; it builds on ${head}`;
    let hint: string;
    if (why === "replaced") {
      hint = `Your save was not run: ${head} was made while it ran, and it rewrote ${shown}. To keep your version, save it again; it then builds on ${head}.`;
    } else {
      const what = why === "saved"
        ? "Your save was not run."
        : inProject ? `${shown} changed after ${head} was made.` : `${shown} has changes that did not run, so ${head} was not written to it.`;
      const take = inProject ? `undo your change (its script is in ${label}/${FILES.revisions}/${head}.json)` : `copy ${label}/${FILES.script} over ${shown}`;
      hint = `${what} To take ${head}, ${take}. To keep your version, ${keep}.`;
    }
    setRun({
      state: "error", at: new Date().toISOString(),
      error: { code: "REV_CONFLICT", message: `${shown} is ${base ? `based on ${base}` : "not based on a revision"}; ${head} was made by an agent`, hint },
      conflict: { file: shown, base, head },
    });
  }

  /** The poll's part: follow a new head while no save waits to run (a run follows it itself). */
  function followHead(): void {
    if (running || pending) return;
    const head = safeHead();
    if (head === undefined || head === fileRev) return;
    const text = readScript();
    if (text === undefined) return;
    const f = follow(head, text);
    if ((f !== "behind" && f !== "conflict") || noticed === head) return;
    noticed = head;
    if (f === "conflict") return reportConflict(head, "found");
    log(`open3dj view: ${head} was made by an agent; ${shown} was not updated (--no-sync-script), so a save of it is refused until it holds ${head}'s script (in ${store.project.label}/${FILES.script})`);
  }

  async function runOnce(): Promise<void> {
    const script = readScript();
    if (script === undefined) return;
    if (!force && script === lastScript) return;
    const forced = force;
    force = false;
    lastScript = script;
    const head = safeHead();
    if (head !== undefined && head !== fileRev) {
      const f = follow(head, script);
      if (f === "written") return;
      if (f === "behind" || f === "conflict") return reportConflict(head, "saved");
    }
    // The file holds the script of the revision it is based on: nothing new to run.
    if (!forced && fileRev !== undefined && script === fileScript) return;
    setRun({ state: "running", at: new Date().toISOString() });
    const input: Parameters<ToolHandlers["run"]>[0] = { project: dir, script, detail: "detailed" };
    if (fileRev !== undefined) input.base_rev = fileRev;
    if (paramsOn) input.params = o.params;
    if (o.saveParams === false) input.save_params = false;
    let out: RunOutput;
    try {
      out = await o.handlers.run(input);
    } catch (e) {
      out = { status: "error", error: toScriptError(e), compute: { backend: "none", device: "daemon", placement_reason: "the run failed" } };
    }
    if (out.rev) {
      fileRev = out.rev;
      fileScript = script;
      noticed = undefined;
    } else if (out.error?.code === "REV_CONFLICT") {
      // A revision landed while this one ran. Look again: the file may hold it already (an
      // agent in another process writes main.o3j.js just before it moves the head).
      checkHead();
      const base = fileRev ?? null;
      const now = safeHead();
      const text = readScript();
      const f = now !== undefined && text !== undefined ? follow(now, text) : "same";
      if (f === "rebased") {
        // The new head kept the script: run the save again, on top of it.
        force = true;
        again = true;
        return;
      }
      // In project mode the agent's commit rewrote main.o3j.js over the save that was running.
      if (f === "adopted" && inProject && text !== script) return reportConflict(now!, "replaced", base);
      if (f === "adopted" || f === "written") return showRev(now!);
      if (f === "behind" || f === "conflict") return reportConflict(now!, "saved");
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
      pending = true;
      timer = setTimeout(() => {
        pending = false;
        void schedule();
      }, debounceMs);
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
    try {
      followHead();
    } catch (e) {
      log(`open3dj view: ${(e as Error).message}`);
    }
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
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
      res.setHeader("Allow", "GET, HEAD");
      return text(res, req, 405, "refused: GET and HEAD only, plus POST api/selection");
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

    if (req.method === "POST") {
      if (route !== "api/selection") {
        res.setHeader("Allow", "GET, HEAD");
        return text(res, req, 405, "refused: GET and HEAD only, plus POST api/selection");
      }
      return postSelection(req, res);
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

  // ---- the one write: the person's selection, shared with agents --------------------------

  function takeToken(): boolean {
    const t = Date.now();
    tokens = Math.min(rate.burst, tokens + ((t - refilled) / 1000) * rate.perSecond);
    refilled = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  async function postSelection(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A write needs the page's own Origin: browsers always send it on a POST fetch, so a
    // request without one did not come from the page.
    if (!allowedOrigins.has(req.headers.origin ?? "")) return text(res, req, 403, "refused: a write needs this page's Origin");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return text(res, req, 403, "refused: cross-site request");
    const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return text(res, req, 415, "refused: send application/json");
    if (req.headers["transfer-encoding"] !== undefined || req.headers["content-length"] === undefined) return text(res, req, 411, "refused: a Content-Length is required");
    const length = Number(req.headers["content-length"]);
    if (!Number.isInteger(length) || length < 0) return text(res, req, 400, "bad request");
    if (length > MAX_VIEW_STATE_BYTES) return text(res, req, 413, `refused: the body is over ${MAX_VIEW_STATE_BYTES} bytes`);
    if (!takeToken()) {
      res.setHeader("Retry-After", "1");
      return text(res, req, 429, "refused: too many selection updates; try again in a second");
    }
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

/** The real path of a folder, or the resolved path when it cannot be read. */
function realDir(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Replace file with text the way the project store writes: a new file with a random name in
 * the same folder (O_EXCL, O_NOFOLLOW), synced, then renamed over the file, so an editor
 * never reads half of it. A symlink is refused, never replaced. Returns false, and changes
 * nothing, when the file no longer holds expected: a save made in the meantime wins.
 */
export function replaceFile(file: string, text: string, expected: string): boolean {
  const st = lstatSync(file);
  if (!st.isFile()) throw new Error(`${basename(file)} is not a regular file`);
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), st.mode & 0o777);
  try {
    const buf = Buffer.from(text, "utf8");
    let off = 0;
    while (off < buf.byteLength) off += writeSync(fd, buf, off, buf.byteLength - off);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    // Checked again as late as possible, just before the rename.
    if (readFileSync(file, "utf8") !== expected) {
      rmSync(tmp, { force: true });
      return false;
    }
    renameWithRetry(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return true;
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
