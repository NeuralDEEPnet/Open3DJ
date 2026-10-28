// Turns command-line arguments into the same tool inputs the MCP tools take (CLI parity).
import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";
import type { DocsInput, ExportFormat, ExportInput, InspectField, InspectInput, ParamValue, RenderFormat, RenderInput, RunInput } from "@open3dj/schemas";

export type Command =
  | { cmd: "run"; input: RunInput; scriptPath: string }
  | { cmd: "inspect"; input: InspectInput }
  | { cmd: "render"; input: RenderInput }
  | { cmd: "export"; input: ExportInput }
  | { cmd: "docs"; input: DocsInput }
  | { cmd: "mcp" }
  | { cmd: "doctor"; bench: boolean }
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

/** Parse argv (without node and the script path). Throws UsageError for bad input. */
export function parseCommand(argv: string[]): Parsed {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") return { command: { cmd: "help", topic: rest[0] }, json: false };
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return { command: { cmd: "version" }, json: false };
  switch (cmd) {
    case "run": {
      const { values, positionals } = parse(rest, { ...COMMON, param: { type: "string", multiple: true }, "base-rev": { type: "string" }, detailed: { type: "boolean", default: false } });
      if (values.help) return help("run");
      const scriptPath = one(positionals, "run needs a script file, for example: open3dj run bracket.o3j.js");
      const input: RunInput = { project: values.project ?? defaultProject(scriptPath), script: "", params: parseParams(values.param ?? []) };
      if (values["base-rev"]) input.base_rev = values["base-rev"];
      if (values.detailed) input.detail = "detailed";
      return { command: { cmd: "run", input, scriptPath }, json: values.json };
    }
    case "inspect": {
      const { values } = parse(rest, { ...COMMON, fields: { type: "string", default: "tree,fits" }, targets: { type: "string" }, job: { type: "string" } });
      if (values.help) return help("inspect");
      const input: InspectInput = { fields: list(values.fields) as InspectField[] };
      if (values.project) input.project = values.project;
      if (values.targets) input.targets = list(values.targets);
      if (values.job) input.job_id = values.job;
      return { command: { cmd: "inspect", input }, json: values.json };
    }
    case "render": {
      const { values } = parse(rest, { ...COMMON, targets: { type: "string" }, format: { type: "string", default: "both" } });
      if (values.help) return help("render");
      const input: RenderInput = { project: values.project ?? ".", view: "multiview", format: values.format as RenderFormat };
      if (values.targets) input.targets = list(values.targets);
      return { command: { cmd: "render", input }, json: values.json };
    }
    case "export": {
      const { values } = parse(rest, { ...COMMON, format: { type: "string", short: "f" }, scope: { type: "string" }, out: { type: "string" } });
      if (values.help) return help("export");
      if (!values.format) throw new UsageError("export needs --format step|stl|gltf|3mf");
      const input: ExportInput = { project: values.project ?? ".", format: values.format as ExportFormat };
      if (values.scope) input.scope = values.scope;
      if (values.out) input.out_dir = values.out;
      return { command: { cmd: "export", input }, json: values.json };
    }
    case "docs": {
      const { values, positionals } = parse(rest, { ...COMMON, page: { type: "string" } });
      if (values.help) return help("docs");
      const input: DocsInput = { query: positionals.join(" ").trim() };
      if (!input.query) throw new UsageError("docs needs a query, for example: open3dj docs fillet");
      if (values.page) input.page = Number(values.page);
      return { command: { cmd: "docs", input }, json: values.json };
    }
    case "mcp":
      return { command: { cmd: "mcp" }, json: false };
    case "doctor": {
      const { values } = parse(rest, { ...COMMON, bench: { type: "boolean", default: false } });
      if (values.help) return help("doctor");
      return { command: { cmd: "doctor", bench: values.bench }, json: values.json };
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

function list(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
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
