// Turns command-line arguments into the same tool inputs the MCP tools take (CLI parity).
// Parsing is pure: no file is read here, so every case is testable without a disk.
import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";
import type { DocsInput, ExportFormat, ExportInput, InspectField, InspectInput, ParamValue, RenderFormat, RenderInput, RunInput } from "@open3dj/schemas";

/**
 * Where a command's design comes from: a script file (its project is created or updated
 * next to it, and the script runs first) or a project folder.
 */
export type Source = { kind: "script"; path: string; project: string } | { kind: "project"; project: string };

export type Command =
  | { cmd: "run"; input: RunInput; source: Source }
  | { cmd: "inspect"; input: InspectInput; source?: Source; params: Record<string, ParamValue>; saveParams: boolean }
  | { cmd: "render"; input: RenderInput; source: Source; params: Record<string, ParamValue>; saveParams: boolean; out?: string }
  | { cmd: "export"; input: ExportInput; source: Source; params: Record<string, ParamValue>; saveParams: boolean; out?: string }
  | { cmd: "docs"; input: DocsInput }
  | { cmd: "view"; source: Source; params: Record<string, ParamValue>; saveParams: boolean; port?: number; open: boolean }
  | { cmd: "mcp"; root?: string; workers?: number }
  | { cmd: "doctor"; bench: boolean; report: boolean }
  | { cmd: "new"; name: string; template: "part" | "assembly" }
  | { cmd: "tools" }
  | { cmd: "help"; topic?: string }
  | { cmd: "version" };

export interface Parsed {
  command: Command;
  json: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMON = {
  project: { type: "string", short: "p" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;
// --param values are saved to the project's working copy (params.o3j.json) unless
// --no-save-params is given.
const PARAMS = { param: { type: "string", multiple: true }, "no-save-params": { type: "boolean", default: false } } as const;
const REV = { rev: { type: "string" } } as const;

/** Parse argv (without node and the script path). Throws UsageError for bad input. */
export function parseCommand(argv: string[]): Parsed {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") return { command: { cmd: "help", topic: rest[0] }, json: false };
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return { command: { cmd: "version" }, json: false };
  switch (cmd) {
    case "run": {
      const { values, positionals } = parse(rest, { ...COMMON, ...PARAMS, "base-rev": { type: "string" }, detailed: { type: "boolean", default: false }, compute: { type: "string" } });
      if (values.help) return help("run");
      const source = sourceOf(positionals, values.project, "run needs a script or project, for example: open3dj run bracket.o3j.js");
      const input: RunInput = { project: source.project, params: parseParams(values.param ?? []) };
      if (values["base-rev"]) input.base_rev = values["base-rev"];
      if (values.detailed) input.detail = "detailed";
      if (values.compute) input.compute = values.compute as RunInput["compute"];
      if (values["no-save-params"]) input.save_params = false;
      return { command: { cmd: "run", input, source }, json: values.json };
    }
    case "inspect": {
      const { values, positionals } = parse(rest, { ...COMMON, ...PARAMS, ...REV, fields: { type: "string", default: "tree,fits" }, targets: { type: "string" }, job: { type: "string" }, detailed: { type: "boolean", default: false } });
      if (values.help) return help("inspect");
      const input: InspectInput = { fields: list(values.fields) as InspectField[] };
      const source = positionals.length || values.project ? sourceOf(positionals, values.project, "inspect takes one script or project") : undefined;
      if (source) input.project = source.project;
      if (values.rev) input.rev = values.rev;
      if (values.targets) input.targets = list(values.targets);
      if (values.job) input.job_id = values.job;
      if (values.detailed) input.detail = "detailed";
      const command: Command = { cmd: "inspect", input, params: parseParams(values.param ?? []), saveParams: !values["no-save-params"] };
      if (source) command.source = source;
      return { command, json: values.json };
    }
    case "render": {
      const { values, positionals } = parse(rest, { ...COMMON, ...PARAMS, ...REV, targets: { type: "string" }, format: { type: "string" }, view: { type: "string", default: "multiview" }, out: { type: "string", short: "o" }, width: { type: "string" }, height: { type: "string" } });
      if (values.help) return help("render");
      const source = sourceOf(positionals, values.project, "render needs a script or project, for example: open3dj render bracket.o3j");
      const format = (values.format ?? (values.out?.endsWith(".svg") ? "svg" : values.out?.endsWith(".png") ? "png" : "both")) as RenderFormat;
      const input: RenderInput = { project: source.project, view: values.view as RenderInput["view"], format };
      if (values.rev) input.rev = values.rev;
      if (values.targets) input.targets = list(values.targets);
      if (values.width) input.width = int(values.width, "--width");
      if (values.height) input.height = int(values.height, "--height");
      const command: Command = { cmd: "render", input, source, params: parseParams(values.param ?? []), saveParams: !values["no-save-params"] };
      if (values.out) command.out = values.out;
      return { command, json: values.json };
    }
    case "export": {
      const { values, positionals } = parse(rest, { ...COMMON, ...PARAMS, ...REV, format: { type: "string", short: "f" }, scope: { type: "string" }, out: { type: "string", short: "o" } });
      if (values.help) return help("export");
      if (!values.format) throw new UsageError("export needs --format step|stl|glb|3mf");
      const source = sourceOf(positionals, values.project, "export needs a script or project, for example: open3dj export bracket.o3j --format step");
      const format = (values.format === "glb" ? "gltf" : values.format) as ExportFormat;
      const input: ExportInput = { project: source.project, format };
      if (values.rev) input.rev = values.rev;
      if (values.scope) input.scope = values.scope;
      const command: Command = { cmd: "export", input, source, params: parseParams(values.param ?? []), saveParams: !values["no-save-params"] };
      if (values.out) command.out = values.out;
      return { command, json: values.json };
    }
    case "docs": {
      const { values, positionals } = parse(rest, { ...COMMON, page: { type: "string" } });
      if (values.help) return help("docs");
      const input: DocsInput = { query: positionals.join(" ").trim() };
      if (!input.query) throw new UsageError("docs needs a query, for example: open3dj docs fillet");
      if (values.page) input.page = int(values.page, "--page");
      return { command: { cmd: "docs", input }, json: values.json };
    }
    case "view": {
      const { values, positionals } = parse(rest, { ...COMMON, ...PARAMS, port: { type: "string" }, "no-open": { type: "boolean", default: false } });
      if (values.help) return help("view");
      const source = sourceOf(positionals, values.project, "view needs a script or project, for example: open3dj view bracket.o3j.js");
      const command: Command = { cmd: "view", source, params: parseParams(values.param ?? []), saveParams: !values["no-save-params"], open: !values["no-open"] };
      if (values.port !== undefined) {
        command.port = int(values.port, "--port");
        if (command.port < 0 || command.port > 65535) throw new UsageError(`--port is 0 to 65535, got ${command.port}`);
      }
      return { command, json: false };
    }
    case "mcp": {
      const { values } = parse(rest, { root: { type: "string" }, workers: { type: "string" }, help: { type: "boolean", short: "h", default: false } });
      if (values.help) return help("mcp");
      const command: Command = { cmd: "mcp" };
      if (values.root) command.root = values.root;
      if (values.workers) {
        command.workers = int(values.workers, "--workers");
        if (command.workers < 1) throw new UsageError(`--workers needs at least 1, got ${command.workers}`);
      }
      return { command, json: false };
    }
    case "doctor": {
      const { values } = parse(rest, { ...COMMON, bench: { type: "boolean", default: false }, report: { type: "boolean", default: false } });
      if (values.help) return help("doctor");
      if (values.report && values.json) throw new UsageError("doctor takes --json or --report, not both");
      // The report always holds the bench: it is what the hardware report form asks for.
      return { command: { cmd: "doctor", bench: values.bench || values.report, report: values.report }, json: values.json };
    }
    case "new": {
      const { values, positionals } = parse(rest, { ...COMMON, template: { type: "string", short: "t", default: "part" } });
      if (values.help) return help("new");
      const name = one(positionals, "new needs a name, for example: open3dj new bracket");
      if (values.template !== "part" && values.template !== "assembly") throw new UsageError(`--template is part or assembly, got "${values.template}"`);
      return { command: { cmd: "new", name, template: values.template }, json: values.json };
    }
    case "tools": {
      const { values } = parse(rest, { ...COMMON });
      if (values.help) return help("tools");
      return { command: { cmd: "tools" }, json: true };
    }
    default:
      throw new UsageError(`unknown command "${cmd}". Run open3dj help.`);
  }
}

function parse<const O extends ParseArgsOptionsConfig>(args: string[], options: O) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
}

function help(topic: string): Parsed {
  return { command: { cmd: "help", topic }, json: false };
}

function one(positionals: string[], message: string): string {
  if (positionals.length !== 1) throw new UsageError(message);
  return positionals[0]!;
}

function int(s: string, flag: string): number {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new UsageError(`${flag} needs a whole number, got "${s}"`);
  return n;
}

function list(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** A positional script or project, or --project. */
function sourceOf(positionals: string[], project: string | undefined, message: string): Source {
  if (positionals.length > 1) throw new UsageError(message);
  const arg = positionals[0];
  if (arg === undefined) {
    if (!project) throw new UsageError(message);
    return { kind: "project", project: trimSlash(project) };
  }
  const p = trimSlash(arg);
  if (/\.o3j$/.test(p)) return { kind: "project", project: project ?? p };
  if (/\.js$/.test(p)) return { kind: "script", path: p, project: project ?? defaultProject(p) };
  throw new UsageError(`"${arg}" is neither a script (.js) nor a project folder (.o3j)`);
}

function trimSlash(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/** --param width=40 --param label=A --param solid=true */
export function parseParams(items: string[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const item of items) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new UsageError(`--param needs name=value, got "${item}"`);
    const name = item.slice(0, eq);
    const raw = item.slice(eq + 1);
    out[name] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return out;
}

/** bracket.o3j.js -> bracket.o3j (the project folder next to the script). */
export function defaultProject(scriptPath: string): string {
  const base = scriptPath.replace(/\\/g, "/").replace(/\.o3j\.js$|\.js$/, "");
  return `${base}.o3j`;
}
