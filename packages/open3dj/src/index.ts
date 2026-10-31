// open3dj: the CLI and daemon entry (open3dj <command> ..., open3dj mcp).
//
// Every design command calls the same handlers as the MCP tools (@open3dj/mcp), on a compute
// pool whose workers hold the kernel. `open3dj mcp` sends console output to stderr before
// anything else runs and never loads the kernel in its own process.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createPool, deviceInventory, doctor, runtimeVersions } from "@open3dj/compute";
import type { Pool, PoolOptions } from "@open3dj/compute";
import { FILES, ProjectStore, createHandlers, guardStdout, resolveProject, serveStdio, toolList, ToolError } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
import { collapseFits, rankFits, validate } from "@open3dj/schemas";
import type { PackageStatus, ParamValue, RunInput, RunOutput, ScriptError } from "@open3dj/schemas";
import { UsageError, parseCommand } from "./args.ts";
import type { Command, Source } from "./args.ts";
import { formatDocs, formatDoctor, formatError, formatExport, formatInspect, formatRender, formatRun } from "./format.ts";
import { formatHardwareReport, gpuNames, installContext } from "./report.ts";
import { TEMPLATES } from "./templates.ts";
import { openBrowser, startViewServer } from "./view.ts";

export { parseCommand, parseParams, defaultProject, UsageError } from "./args.ts";
export type { Command, Parsed, Source } from "./args.ts";
export { TEMPLATES } from "./templates.ts";
export { HARDWARE_REPORT_URL, formatHardwareReport, gpuNames, installContext } from "./report.ts";
export type { ReportContext } from "./report.ts";
export type { TemplateName } from "./templates.ts";
export { startViewServer, openBrowser } from "./view.ts";
export type { RunState, ViewModel, ViewServer, ViewServerOptions } from "./view.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";

export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Exit codes (ARCHITECTURE.md section 9, CLI parity). */
export const EXIT = Object.freeze({ ok: 0, gate: 1, error: 2, usage: 3 });

export const USAGE = `open3dj ${VERSION}: agent-first CAD. Every design is an assembly.

Usage:
  open3dj run <script.o3j.js|project.o3j> [--param name=value ...] [--no-save-params] [--base-rev r_0001] [--detailed] [--json]
  open3dj render <script|project> [--targets lid,screw#2] [--format png|svg|both] [--out file.png] [--rev r_0001]
  open3dj render <script|project> --view highlight --targets lid@elem:face:5,screw#2 [--note text]
                                                   point a running open3dj view at parts or faces
  open3dj export <script|project> --format step|stl|glb|3mf [--scope path] [--out dir] [--rev r_0001]
  open3dj inspect [<script|project>] [--fields tree,refs,fits,measure,devices,job,selection] [--targets a,b] [--job id]
  open3dj docs <query> [--page n]
  open3dj view <script|project> [--port n] [--no-open] [--param name=value ...]
                                                   browser viewer on 127.0.0.1; re-runs the script on save
  open3dj new <name> [--template part|assembly]   scaffold name.o3j with a starter script
  open3dj mcp [--root dir] [--workers n]           stdio MCP server for agents
  open3dj doctor [--bench] [--json | --report]     what this machine can run; --report prints a
                                                   Markdown hardware report (with the bench) to paste
                                                   into the hardware report issue form
  open3dj tools                                    the tool schemas, as MCP tools/list publishes them

A script path (part.o3j.js) runs first and keeps its project next to it (part.o3j).
--param values are saved to the project's params.o3j.json, and later runs use them;
the CLI prints "saved params" when that file changes. --no-save-params tries values
without saving them (run, render, export, inspect and view take both flags).
Units are mm, Z is up. --json prints the same results the MCP tools return.
Exit codes: 0 ok (warnings included), 1 a part is invalid, 2 script, kernel or tool error, 3 usage error.
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

/** Run the CLI. Returns the process exit code (see EXIT). */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let parsed;
  try {
    parsed = parseCommand(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`open3dj: ${e.message}\n`);
      return EXIT.usage;
    }
    throw e;
  }
  const { command, json } = parsed;
  if (command.cmd === "help") {
    io.out(USAGE);
    return EXIT.ok;
  }
  if (command.cmd === "version") {
    io.out(`${VERSION}\n`);
    return EXIT.ok;
  }
  if ("input" in command && command.cmd !== "run") {
    const r = validate(`tool-${command.cmd}-input`, command.input);
    if (!r.valid) {
      io.err(`open3dj: ${r.errors.slice(0, 3).map((x) => `${x.path || "/"} ${x.message}`).join("; ")}\n`);
      return EXIT.usage;
    }
  }
  try {
    return await execute(command, json, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`open3dj: ${e.message}\n`);
      return EXIT.usage;
    }
    if (e instanceof ToolError) {
      io.err(formatError(e.toScriptError()));
      return EXIT.error;
    }
    throw e;
  }
}

/** Worker output (kernel messages) goes to stderr only when OPEN3DJ_VERBOSE is set. */
function workerLog(): (line: string) => void {
  return process.env.OPEN3DJ_VERBOSE ? (line) => void process.stderr.write(`${line}\n`) : () => {};
}

async function execute(command: Command, json: boolean, io: Io): Promise<number> {
  switch (command.cmd) {
    case "tools":
      io.out(`${JSON.stringify({ tools: toolList() }, null, 2)}\n`);
      return EXIT.ok;
    case "mcp":
      return serve(command.root, command.workers);
    case "view":
      return view(command, io);
    case "doctor": {
      if (command.report) io.err("open3dj doctor --report: measuring this machine, which can take a minute...\n");
      const report = await doctor({ bench: command.bench, pool: { log: workerLog() } });
      if (command.report) io.out(formatHardwareReport(report, { ...installContext(), gpus: gpuNames() }));
      else io.out(json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
      return EXIT.ok;
    }
    case "new":
      return scaffold(command.name, command.template, io);
    case "docs": {
      const out = await withHandlers(process.cwd(), (h) => h.docs(command.input), false);
      io.out(json ? `${JSON.stringify(out, null, 2)}\n` : formatDocs(out));
      return EXIT.ok;
    }
    case "run":
    case "render":
    case "export":
    case "inspect":
      return design(command, json, io);
  }
  return EXIT.usage;
}

type DesignCommand = Extract<Command, { cmd: "run" | "render" | "export" | "inspect" }>;

async function design(command: DesignCommand, json: boolean, io: Io): Promise<number> {
  const source = command.source;
  const projectAbs = source ? resolve(source.project) : undefined;
  const root = projectAbs ? dirname(projectAbs) : process.cwd();
  return withHandlers(root, async (h) => {
    let rev: string | undefined;
    // run always runs; the other commands run a script source first, so the result is current,
    // and a project source too when --param asks for other values (never ignore a flag).
    const hasParams = command.cmd !== "run" && Object.keys(command.params).length > 0;
    if (hasParams && !source) throw new UsageError("--param needs a script or project to run");
    if (source && projectAbs && (command.cmd === "run" || source.kind === "script" || hasParams)) {
      const input: RunInput = command.cmd === "run"
        ? { ...command.input, project: projectAbs, script: readScript(source, projectAbs) }
        : { project: projectAbs, script: readScript(source, projectAbs), params: command.params };
      if (command.cmd !== "run" && !command.saveParams) input.save_params = false;
      const before = storedParams(projectAbs);
      const out = await h.run(input);
      const note = paramsNote(before, storedParams(projectAbs), input, `${source.project}/${FILES.params}`);
      // Said on stderr with --json, so stdout stays one JSON document.
      const say = () => note && (json ? io.err : io.out)(`${note}\n`);
      if (command.cmd === "run") {
        io.out(json ? `${JSON.stringify(out, null, 2)}\n` : formatRun(await complete(h, projectAbs, out), source.kind === "script" ? source.path : undefined));
        say();
        return runExit(out);
      }
      say();
      if (out.status === "error" || !out.rev) {
        io.err(out.error ? formatError(out.error, source.kind === "script" ? source.path : undefined) : formatRun(out));
        return runExit(out);
      }
      rev = out.rev;
    }
    if (command.cmd === "render") {
      const input = { ...command.input, project: projectAbs! };
      if (rev && !input.rev) input.rev = rev;
      const r = await h.render(input);
      const notes = r.images.flatMap((i) => (i.note ? [i.note] : []));
      if (r.output.status === "ok" && command.out) {
        const want = command.out.endsWith(".svg") ? "svg" : "png";
        const img = r.images.find((i) => i.format === want);
        if (!img) throw new UsageError(`--out ${command.out} needs a ${want} render; add --format ${want}`);
        mkdirSync(dirname(resolve(command.out)), { recursive: true });
        writeFileSync(resolve(command.out), img.bytes);
        notes.push(`copied ${want.toUpperCase()} to ${command.out}`);
      }
      io.out(json ? `${JSON.stringify(r.output, null, 2)}\n` : formatRender(r.output, source!.project, notes));
      return r.output.status === "ok" ? EXIT.ok : errorExit(r.output.error);
    }
    if (command.cmd === "export") {
      const input = { ...command.input, project: projectAbs! };
      if (rev && !input.rev) input.rev = rev;
      const out = await h.export(input);
      let text = json ? `${JSON.stringify(out, null, 2)}\n` : formatExport(out, source!.project);
      if (out.status === "ok" && command.out) {
        const dest = resolve(command.out);
        mkdirSync(dest, { recursive: true });
        for (const f of out.files ?? []) copyFileSync(join(projectAbs!, ...f.path.split("/")), join(dest, basename(f.path)));
        if (!json) text += `copied ${out.files?.length ?? 0} files to ${command.out}\n`;
      }
      io.out(text);
      return out.status === "ok" ? EXIT.ok : errorExit(out.error);
    }
    if (command.cmd === "inspect") {
      const input = { ...command.input };
      if (projectAbs) input.project = projectAbs;
      if (rev && !input.rev) input.rev = rev;
      const out = await h.inspect(input);
      io.out(json ? `${JSON.stringify(out, null, 2)}\n` : formatInspect(out));
      return out.status === "ok" ? EXIT.ok : errorExit(out.error);
    }
    return EXIT.usage;
  });
}

/** The project's working-copy params, or undefined when there is none (or it is unreadable). */
function storedParams(projectAbs: string): Record<string, ParamValue> | undefined {
  try {
    const store = new ProjectStore(resolveProject(dirname(projectAbs), projectAbs));
    return store.exists() ? store.params() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * "saved params: Width=90 (was 60) in bracket.o3j/params.o3j.json" when the run changed the
 * working copy, and "params not saved" when --no-save-params kept it. Nothing otherwise.
 */
export function paramsNote(before: Record<string, ParamValue> | undefined, after: Record<string, ParamValue> | undefined, input: RunInput, file: string): string | undefined {
  const show = (v: ParamValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));
  if (input.save_params === false) {
    if (!input.params || Object.keys(input.params).length === 0) return undefined;
    const kept = Object.entries(after ?? {}).map(([k, v]) => `${k}=${show(v)}`);
    return `params not saved (--no-save-params): ${FILES.params} keeps ${kept.length ? kept.join(", ") : "no values"}`;
  }
  if (!after) return undefined;
  const changed: string[] = [];
  for (const [k, v] of Object.entries(after)) {
    const old = before?.[k];
    if (old === v) continue;
    changed.push(old === undefined ? `${k}=${show(v)}` : `${k}=${show(v)} (was ${show(old)})`);
  }
  const removed = Object.keys(before ?? {}).filter((k) => !Object.hasOwn(after, k));
  if (changed.length === 0 && removed.length === 0) return undefined;
  // Values a new script set to its defaults are saved too; name them so the reset is visible.
  const parts = [...changed, ...removed.map((k) => `${k} removed`)];
  return `saved params: ${parts.join(", ")} in ${file}`;
}

function readScript(source: Source, projectAbs: string): string {
  const file = source.kind === "script" ? resolve(source.path) : join(projectAbs, FILES.script);
  if (!existsSync(file)) {
    throw source.kind === "script"
      ? new UsageError(`no such script: ${source.path}`)
      : new UsageError(`${source.project} has no ${FILES.script}; create one with open3dj new, or run a script file`);
  }
  return readFileSync(file, "utf8");
}

function runExit(out: RunOutput): number {
  if (out.error) return errorExit(out.error);
  return out.status === "error" ? EXIT.gate : EXIT.ok;
}

function errorExit(error: ScriptError | undefined): number {
  return error?.code === "BAD_INPUT" ? EXIT.usage : EXIT.error;
}

/** Handlers on a one-worker pool for one CLI command; the pool starts no worker until a job needs one. */
async function withHandlers<T>(root: string, fn: (h: ToolHandlers) => Promise<T>, needsPool = true): Promise<T> {
  const options: PoolOptions = { size: 1, log: workerLog() };
  const pool: Pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory(needsPool ? { pool: options } : {}), root, version: VERSION, interactiveMs: 24 * 3600 * 1000 });
  try {
    return await fn(handlers);
  } finally {
    handlers.shutdown();
    await pool.close();
  }
}

async function serve(rootArg: string | undefined, workers: number | undefined): Promise<number> {
  guardStdout();
  const log = (line: string) => void process.stderr.write(`${line}\n`);
  const options: PoolOptions = { log, warm: true };
  if (workers) options.size = workers;
  const pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root: resolve(rootArg ?? process.cwd()), version: VERSION });
  try {
    await serveStdio(handlers, { version: VERSION, log });
  } finally {
    await pool.close();
  }
  return EXIT.ok;
}

/**
 * The run report for a person: the concise report keeps to an agent's token budget and leaves
 * fits and definitions out; a terminal has no such limit, so the missing ones are read back
 * with inspect (one cached detailed job) and listed, fits collapsed and ranked as usual.
 */
async function complete(h: ToolHandlers, project: string, out: RunOutput): Promise<RunOutput> {
  const report = out.report;
  if (!report || !out.rev || out.status === "error") return out;
  const hidden = (re: RegExp) => (report.warnings ?? []).some((w) => re.test(w));
  const moreFits = hidden(/ more fits not listed;/);
  const moreParts = hidden(/ more definitions not listed;/);
  if (!moreFits && !moreParts) return out;
  const fields: Array<"fits" | "measure"> = [];
  if (moreFits) fields.push("fits");
  if (moreParts) fields.push("measure");
  const insp = await h.inspect({ project, rev: out.rev, fields, detail: "concise" });
  if (insp.status !== "ok") return out;
  const full = { ...report };
  if (moreFits && insp.fits) full.fits = rankFits(collapseFits(insp.fits));
  if (moreParts && insp.measure) full.parts = insp.measure;
  full.warnings = (report.warnings ?? []).filter((w) => !((moreFits && insp.fits && / more fits not listed;/.test(w)) || (moreParts && insp.measure && / more definitions not listed;/.test(w))));
  return { ...out, report: full };
}

/** open3dj view: serve the viewer until Ctrl+C. Exit 0 when stopped, 3 for a missing script. */
async function view(command: Extract<Command, { cmd: "view" }>, io: Io): Promise<number> {
  const { source } = command;
  const projectAbs = resolve(source.project);
  const script = source.kind === "script" ? resolve(source.path) : join(projectAbs, FILES.script);
  if (!existsSync(script)) {
    throw source.kind === "script"
      ? new UsageError(`no such script: ${source.path}`)
      : new UsageError(`${source.project} has no ${FILES.script}; create one with open3dj new, or view a script file`);
  }
  const shown = source.kind === "script" ? source.path : `${source.project}/${FILES.script}`;
  const options: PoolOptions = { size: 2, log: workerLog() };
  const pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root: dirname(projectAbs), version: VERSION, interactiveMs: 24 * 3600 * 1000 });
  let server;
  try {
    server = await startViewServer({
      handlers, root: dirname(projectAbs), project: projectAbs, script, params: command.params, saveParams: command.saveParams,
      ...(command.port !== undefined ? { port: command.port } : {}),
      log: (line) => io.err(`${line}\n`),
      onRun: (run, out) => {
        const time = new Date(run.at ?? Date.now()).toLocaleTimeString();
        if (run.error) io.err(`[${time}] ` + formatError(run.error, source.kind === "script" ? source.path : undefined));
        else {
          io.out(`[${time}] ${run.rev ?? "no revision"} ${out?.status ?? run.status ?? ""}${out?.report ? `: ${out.report.parts.filter((p) => p.valid).length} of ${out.report.parts.length} definitions valid, ${out.report.fits.length} fit line${out.report.fits.length === 1 ? "" : "s"}` : ""}\n`);
          for (const w of run.warnings ?? []) io.out(`  warning: ${w}\n`);
        }
      },
    });
  } catch (e) {
    handlers.shutdown();
    await pool.close();
    throw new UsageError((e as Error).message);
  }
  io.out(`open3dj view: ${server.url}\nwatching ${shown}; save it to update the view. Press Ctrl+C to stop.\n`);
  const opened = command.open ? openBrowser(server.url, (line) => io.err(`${line}\n`)) : undefined;
  await new Promise<void>((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  io.err("open3dj view: stopping\n");
  opened?.cleanup();
  await server.close();
  handlers.shutdown();
  await pool.close();
  return EXIT.ok;
}

async function scaffold(name: string, template: keyof typeof TEMPLATES, io: Io): Promise<number> {
  const folder = /\.o3j$/.test(name) ? name : `${name}.o3j`;
  const abs = resolve(folder);
  const project = resolveProject(dirname(abs), abs);
  if (existsSync(project.dir)) throw new UsageError(`${folder} already exists`);
  const store = new ProjectStore(project);
  const versions = runtimeVersions();
  const engine: { open3dj: string; occt_wasm: string; brepjs?: string } = { open3dj: VERSION, occt_wasm: versions.occt_wasm ?? "unknown" };
  if (versions.brepjs) engine.brepjs = versions.brepjs;
  store.create(engine);
  writeFileSync(join(project.dir, FILES.script), TEMPLATES[template]);
  writeFileSync(join(project.dir, FILES.params), "{}\n");
  io.out(`created ${folder} (${template} template)\nnext:\n  open3dj run ${folder}\n  open3dj render ${folder} --out ${project.name}.png\n  open3dj export ${folder} --format step\n`);
  return EXIT.ok;
}
