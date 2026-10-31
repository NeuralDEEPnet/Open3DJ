// A short MCP session over stdio, spoken as raw JSON-RPC with no SDK: initialize at
// 2025-06-18, tools/list, then tools/call run on the bracket example. The install smoke
// workflow runs it against an installed copy, the way a client such as Claude Desktop starts
// the server; install.test.ts runs it against this checkout.
//
//   node scripts/install/mcp-smoke.ts --install <prefix>/install.json [--root dir]
//   node scripts/install/mcp-smoke.ts [--root dir] -- <node> <path/to/cli.ts>
//
// It fails if the server writes a stdout line that is not JSON-RPC 2.0, or if a step fails.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL = "2025-06-18";
const BRACKET = fileURLToPath(new URL("../../examples/bracket/bracket.o3j.js", import.meta.url));

export interface SmokeOptions {
  command: string;
  args: string[];
  /** The server's root folder. A temporary folder when not given (removed afterwards). */
  root?: string;
  timeoutMs?: number;
}

export interface SmokeResult {
  protocolVersion: string;
  serverName: string;
  tools: string[];
  run: { status: string; rev: string; volume_mm3: number };
  stdoutLines: number;
}

type Message = { jsonrpc?: string; id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

export async function mcpSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const own = options.root === undefined;
  const root = options.root ?? mkdtempSync(join(tmpdir(), "o3j-mcp-smoke-"));
  const timeoutMs = options.timeoutMs ?? 120_000;
  const server = spawn(options.command, [...options.args, "mcp", "--root", root, "--workers", "1"], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  server.stderr.on("data", (d: Buffer) => void (stderr = (stderr + d.toString("utf8")).slice(-4000)));
  const lines: string[] = [];
  const waiters = new Map<number, (m: Message) => void>();
  let buffer = "";
  server.stdout.on("data", (d: Buffer) => {
    buffer += d.toString("utf8");
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      lines.push(line);
      try {
        const m = JSON.parse(line) as Message;
        if (typeof m.id === "number") waiters.get(m.id)?.(m);
      } catch {
        // Recorded in lines; the check below reports it.
      }
    }
  });
  const exited = new Promise<number | null>((resolve) => server.on("close", (code) => resolve(code)));
  const failed = new Promise<never>((_, reject) => {
    server.on("error", (e) => reject(new Error(`could not start ${options.command}: ${e.message}`)));
    void exited.then((code) => reject(new Error(`the server exited early with code ${code}. stderr:\n${stderr}`)));
  });
  failed.catch(() => {});

  let nextId = 1;
  const send = (m: object) => server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  const request = async (method: string, params: object): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const reply = new Promise<Message>((resolve) => waiters.set(id, resolve));
    send({ id, method, params });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} got no answer in ${timeoutMs} ms. stderr:\n${stderr}`)), timeoutMs);
    });
    try {
      const m = await Promise.race([reply, failed, timeout]);
      if (m.error) throw new Error(`${method} failed: ${m.error.code} ${m.error.message}`);
      return m.result ?? {};
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const init = await request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "open3dj-install-smoke", version: "0.0.0" } });
    if (init.protocolVersion !== PROTOCOL) throw new Error(`the server answered protocol ${String(init.protocolVersion)}, not ${PROTOCOL}`);
    send({ method: "notifications/initialized" });
    const list = await request("tools/list", {});
    const tools = ((list.tools ?? []) as Array<{ name: string }>).map((t) => t.name).sort();
    if (!tools.includes("run")) throw new Error(`tools/list has no run tool: ${tools.join(", ")}`);
    const call = await request("tools/call", { name: "run", arguments: { project: "bracket.o3j", script: readFileSync(BRACKET, "utf8") } });
    const out = call.structuredContent as { status?: string; rev?: string; report?: { parts?: Array<{ valid?: boolean; volume_mm3?: number }> } } | undefined;
    const text = (call.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
    if (call.isError === true || out?.status !== "ok") throw new Error(`run did not return ok: ${text.slice(0, 600)}`);
    const part = out.report?.parts?.[0];
    if (!part?.valid || !(Number(part.volume_mm3) > 0)) throw new Error(`run returned no valid part: ${text.slice(0, 600)}`);

    server.stdin.end();
    const code = await Promise.race([exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 15_000).unref())]);
    if (code === "timeout") server.kill();
    const foreign = lines.filter((l) => {
      try {
        return (JSON.parse(l) as Message).jsonrpc !== "2.0";
      } catch {
        return true;
      }
    });
    if (foreign.length) throw new Error(`stdout carried lines that are not JSON-RPC:\n${foreign.slice(0, 5).map((l) => l.slice(0, 200)).join("\n")}`);
    const info = init.serverInfo as { name?: string } | undefined;
    return { protocolVersion: String(init.protocolVersion), serverName: info?.name ?? "", tools, run: { status: out.status, rev: String(out.rev), volume_mm3: Number(part.volume_mm3) }, stdoutLines: lines.length };
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    if (own) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf("--");
  const flags = dash >= 0 ? argv.slice(0, dash) : argv;
  const flag = (name: string) => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  let command: string | undefined;
  let args: string[] = [];
  const install = flag("--install");
  if (install) {
    const info = JSON.parse(readFileSync(install, "utf8").replace(/^\uFEFF/, "")) as { node: string; cli: string };
    command = info.node;
    args = [info.cli];
  } else if (dash >= 0) {
    // The server starts in its root folder, so relative paths are made absolute here.
    [command, ...args] = argv.slice(dash + 1).map((a) => (existsSync(a) ? resolve(a) : a));
  }
  if (!command) {
    process.stderr.write("usage: node scripts/install/mcp-smoke.ts --install <install.json> | -- <node> <cli.ts>\n");
    process.exit(3);
  }
  const root = flag("--root");
  try {
    const result = await mcpSmoke(root ? { command, args, root } : { command, args });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`mcp smoke failed: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
