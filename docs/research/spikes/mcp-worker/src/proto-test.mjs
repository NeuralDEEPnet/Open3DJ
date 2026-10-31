// Which MCP protocol versions does SDK 1.32.2 negotiate, and does it know 2026-07-28 / server/discover?
// Usage: node proto-test.mjs <deps> <outdir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [DEPS, OUT] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const types = await imp("@modelcontextprotocol/sdk/dist/esm/types.js");
const { Client } = await imp("@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const SERVER = new URL("./server.mjs", import.meta.url).pathname;
const exportDir = join(OUT, "proto-exports"); mkdirSync(exportDir, { recursive: true });
const serverArgs = [SERVER, "--deps", DEPS, "--backend", "thread", "--export-dir", exportDir];

const out = {
  sdkConstants: { LATEST_PROTOCOL_VERSION: types.LATEST_PROTOCOL_VERSION, DEFAULT_NEGOTIATED_PROTOCOL_VERSION: types.DEFAULT_NEGOTIATED_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS: types.SUPPORTED_PROTOCOL_VERSIONS },
  negotiation: [], raw: {},
};

// A transport that rewrites only the protocolVersion of the outgoing initialize request.
class VersionedTransport extends StdioClientTransport {
  constructor(params, version) { super(params); this.version = version; }
  async send(msg, opts) {
    if (msg.method === "initialize") msg = { ...msg, params: { ...msg.params, protocolVersion: this.version } };
    return super.send(msg, opts);
  }
}
for (const requested of ["2025-06-18", "2025-11-25", "2025-03-26", "2024-11-05", "2026-07-28", "2023-01-01"]) {
  const t = new VersionedTransport({ command: process.execPath, args: serverArgs, stderr: "ignore" }, requested);
  let serverVersion;
  const origStart = t.start.bind(t);
  t.start = async () => { await origStart(); const on = t.onmessage; t.onmessage = (m) => { if (m.result?.protocolVersion) serverVersion = m.result.protocolVersion; on?.(m); }; };
  const c = new Client({ name: "proto-test", version: "0" });
  const row = { requested };
  try {
    await c.connect(t);
    row.serverReturned = serverVersion; row.clientAccepted = true;
    const r = await c.callTool({ name: "run", arguments: { script: { js: "return box(10,10,10)" } } });
    row.runOk = !r.isError; row.structuredContent = !!r.structuredContent; row.volume = r.structuredContent?.volume;
  } catch (e) { row.serverReturned = serverVersion; row.clientAccepted = false; row.error = String(e.message).slice(0, 200); }
  await c.close().catch(() => {});
  out.negotiation.push(row);
  process.stderr.write(JSON.stringify(row) + "\n");
}

// Raw probes: 2026-07-28-style first contact (server/discover, no initialize).
async function raw(messages, waitIds) {
  const p = spawn(process.execPath, serverArgs, { stdio: ["pipe", "pipe", "ignore"] });
  let buf = ""; const got = {};
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id !== undefined) got[m.id] = m; } catch {} } });
  for (const m of messages) p.stdin.write(JSON.stringify(m) + "\n");
  const end = Date.now() + 15000;
  while (waitIds.some((id) => !got[id]) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  p.stdin.end(); setTimeout(() => p.kill("SIGKILL"), 1000);
  return got;
}
const disc = await raw([
  { jsonrpc: "2.0", id: 1, method: "server/discover", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "run", arguments: { script: { js: "return sphere(5)" } } } },
], [1, 2, 3]);
out.raw.serverDiscover = disc[1];
out.raw.toolsListWithoutInitialize = disc[2] ? { ok: !!disc[2].result, tools: disc[2].result?.tools?.map((t) => t.name), error: disc[2].error } : "no response";
out.raw.toolsCallWithoutInitialize = disc[3] ? { ok: !!disc[3].result && !disc[3].result.isError, volume: disc[3].result?.structuredContent?.volume, error: disc[3].error } : "no response";
const twice = await raw([
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } },
  { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "0" } } },
], [1, 2]);
out.raw.secondInitialize = { first: twice[1]?.result?.protocolVersion, second: twice[2]?.result?.protocolVersion ?? twice[2]?.error };
writeFileSync(join(OUT, "proto-results.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
