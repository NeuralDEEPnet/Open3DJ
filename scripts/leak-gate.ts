// Stdout-leak gate. MCP stdio carries JSON-RPC on stdout, and OCCT's STEP writer prints to
// stdout: one stray line corrupts the stream for strict clients. This gate starts the real
// server (open3dj mcp), drives it like a client through a run, a STEP export and a render,
// captures every stdout byte, and fails if any line is not a JSON-RPC message.
//
// It also fails if the tool calls did not succeed: a run that errors before the STEP writer
// prints would pass vacuously (the spike's first leak run was such a false negative).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib.ts";

// --server <file> runs another server script instead (the gate's own tests use fakes).
const serverArg = process.argv.indexOf("--server");
const serverScript = serverArg > 0 ? process.argv[serverArg + 1]! : join(ROOT, "packages", "open3dj", "src", "cli.ts");
const { PACKAGE_STATUS } = await import("@open3dj/mcp");
if (serverArg < 0 && PACKAGE_STATUS !== "ready") {
  process.stderr.write("SKIP leak gate: @open3dj/mcp is still a stub (PACKAGE_STATUS). It runs once the server is implemented.\n");
  process.exit(0);
}

const TIMEOUT_MS = 120_000;
const SCRIPT = `
const plate = box(60, 40, 8).subtract(cylinder(20, 3).translate(-20, -10, -5), cylinder(20, 3).translate(20, 10, -5));
return [{ name: "plate", shape: plate }, { name: "pin", shape: cylinder(12, 2.8).translate(-20, -10, 8) }];
`;

const work = mkdtempSync(join(tmpdir(), "o3j-leak-"));
const project = join(work, "leak.o3j");
const server = spawn(process.execPath, [serverScript, "mcp"], {
  cwd: work,
  stdio: ["pipe", "pipe", "pipe"],
});

const chunks: Buffer[] = [];
let buffer = "";
let stderr = "";
const waiters = new Map<number, (m: Record<string, unknown>) => void>();
server.stdout.on("data", (d: Buffer) => {
  chunks.push(d);
  buffer += d.toString("utf8");
  let i: number;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    try {
      const m = JSON.parse(line) as Record<string, unknown>;
      const id = m.id;
      if (typeof id === "number" && waiters.has(id)) {
        waiters.get(id)!(m);
        waiters.delete(id);
      }
    } catch {
      // Classified below; a bad line is exactly what this gate looks for.
    }
  }
});
server.stderr.on("data", (d: Buffer) => {
  stderr += d.toString("utf8");
});

const killer = setTimeout(() => {
  process.stderr.write("leak gate: timed out, killing the server\n");
  server.kill("SIGKILL");
}, TIMEOUT_MS * 3);

let nextId = 1;
const send = (m: object) => server.stdin.write(`${JSON.stringify(m)}\n`);
function request(method: string, params: object): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer to ${method} within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    waiters.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
async function call(name: string, args: object): Promise<Record<string, unknown>> {
  const r = await request("tools/call", { name, arguments: args });
  const result = r.result as { isError?: boolean; structuredContent?: Record<string, unknown> } | undefined;
  if (!result || result.isError) throw new Error(`${name} failed: ${JSON.stringify(r).slice(0, 600)}`);
  const status = result.structuredContent?.status;
  if (status !== undefined && status !== "ok" && status !== "warning") throw new Error(`${name} returned status ${String(status)}: ${JSON.stringify(result.structuredContent).slice(0, 600)}`);
  return result.structuredContent ?? {};
}

const failures: string[] = [];
try {
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "leak-gate", version: "0" } });
  if (!init.result) throw new Error(`initialize failed: ${JSON.stringify(init)}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await request("tools/list", {});
  const names = ((list.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name).sort();
  if (names.join(",") !== "docs,export,inspect,render,run") failures.push(`tools/list returned [${names.join(", ")}]`);
  const run = await call("run", { project, script: SCRIPT });
  await call("export", { project, rev: run.rev, format: "step" });
  await call("export", { project, rev: run.rev, format: "step" });
  await call("render", { project, rev: run.rev, view: "multiview", format: "png" });
  await call("inspect", { fields: ["devices"] });
  // Worker output is forwarded asynchronously; give a late leak time to arrive.
  await new Promise((r) => setTimeout(r, 750));
} catch (e) {
  failures.push((e as Error).message);
}
server.stdin.end();
await new Promise<void>((resolve) => {
  const t = setTimeout(() => {
    server.kill("SIGKILL");
    resolve();
  }, 5000);
  server.on("close", () => {
    clearTimeout(t);
    resolve();
  });
});
clearTimeout(killer);
rmSync(work, { recursive: true, force: true });

const lines = Buffer.concat(chunks).toString("utf8").split("\n").filter((l) => l.length > 0);
const foreign = lines.filter((l) => {
  try {
    return (JSON.parse(l) as { jsonrpc?: unknown }).jsonrpc !== "2.0";
  } catch {
    return true;
  }
});
if (foreign.length > 0) {
  failures.push(`${foreign.length} of ${lines.length} stdout lines are not JSON-RPC, first: ${JSON.stringify(foreign[0]!.slice(0, 200))}`);
}
if (failures.length > 0) {
  process.stderr.write(`FAIL leak gate:\n  ${failures.join("\n  ")}\n--- server stderr (tail) ---\n${stderr.slice(-3000)}\n`);
  process.exit(1);
}
process.stderr.write(`PASS leak gate: ${lines.length} stdout lines, all JSON-RPC, after run, 2 STEP exports, a render and inspect\n`);
