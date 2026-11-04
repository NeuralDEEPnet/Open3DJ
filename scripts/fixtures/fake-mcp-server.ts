// A fake MCP server for the leak gate's own tests. It answers like the real one; with
// FAKE_LEAK=1 it also prints a stray line to stdout the way OCCT's STEP writer does, and
// with FAKE_FAIL=1 its run tool returns an error result.
import { createInterface } from "node:readline";

const send = (m: object) => process.stdout.write(`${JSON.stringify(m)}\n`);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const m = JSON.parse(line) as { id?: number; method: string; params?: { name?: string } };
  if (m.id === undefined) return;
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: ["run", "inspect", "render", "export", "docs"].map((name) => ({ name, inputSchema: { type: "object" } })) } });
  else if (m.method === "tools/call") {
    if (m.params?.name === "export" && process.env.FAKE_LEAK === "1") process.stdout.write("*** Statistics on Transfer (Write) ***\n");
    const failed = m.params?.name === "run" && process.env.FAKE_FAIL === "1";
    const sc = failed ? { status: "error", error: { code: "SCRIPT_RUNTIME", message: "boom" } } : { status: "ok", rev: "r_1" };
    send({ jsonrpc: "2.0", id: m.id, result: { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }] } });
  } else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "not found" } });
});
