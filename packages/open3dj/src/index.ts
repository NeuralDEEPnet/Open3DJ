// open3dj: the CLI and daemon entry (npx open3dj <tool> ..., npx -y open3dj mcp).
//
// Intended implementation of the commands: create a pool (@open3dj/compute) and the shared
// handlers (@open3dj/mcp createHandlers), then call the handler for the command with the
// input from args.ts, validated against its tool-*-input schema. run reads the script file;
// render and export write under the project's out/<rev>/ and print the paths. mcp calls
// guardStdout() first, then serveStdio(). doctor prints the DeviceInventory (and with
// --bench, kernel micro-benchmarks and worker scaling).
import { readFileSync } from "node:fs";
import { NotImplementedError, validate } from "@open3dj/schemas";
import type { PackageStatus } from "@open3dj/schemas";
import { UsageError, parseCommand } from "./args.ts";
import type { Command } from "./args.ts";

export { parseCommand, parseParams, defaultProject, UsageError } from "./args.ts";
export type { Command, Parsed } from "./args.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const USAGE = `open3dj ${VERSION}: agent-first CAD. Every design is an assembly.

Usage:
  open3dj run <script.o3j.js> [--project dir] [--param name=value ...] [--base-rev r_x] [--json]
  open3dj inspect [--project dir] [--fields tree,refs,fits,measure,devices,job] [--targets a#1,b#2] [--job id]
  open3dj render [--project dir] [--targets a#1] [--format png|svg|both]
  open3dj export --format step|stl|gltf|3mf [--project dir] [--scope path] [--out dir]
  open3dj docs <query> [--page n]
  open3dj mcp                       stdio MCP server for agents
  open3dj doctor [--bench] [--json] what this machine can run

Units are mm, Z is up. Results are the same as the MCP tools return.
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

/** Run the CLI. Returns the process exit code: 0 ok, 1 tool error, 2 usage error. */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv).command;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`open3dj: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  if (command.cmd === "help") {
    io.out(USAGE);
    return 0;
  }
  if (command.cmd === "version") {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if ("input" in command && command.cmd !== "run") {
    const r = validate(`tool-${command.cmd}-input`, command.input);
    if (!r.valid) {
      io.err(`open3dj: ${r.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ")}\n`);
      return 2;
    }
  }
  try {
    return await execute(command, io);
  } catch (e) {
    if (e instanceof NotImplementedError) {
      io.err(`open3dj: ${command.cmd}: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function execute(command: Command, io: Io): Promise<number> {
  void io;
  throw new NotImplementedError(`the ${command.cmd} command`);
}
