// Worst case probe: can leaked kernel output be spliced INTO a JSON-RPC message (not just between)?
// Pipelines N render+export calls while the reader is paused so the stdout pipe fills up, then
// counts responses that were lost or corrupted. Usage: node stress-splice.mjs <deps> <outdir> <backend> <hook> <isolate> [n]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [DEPS, OUT, backend, hook, iso, nStr] = process.argv.slice(2);
const N = Number(nStr ?? 40);
const exportDir = join(OUT, "splice-exports", `${backend}-${hook}-${iso}`);
rmSync(exportDir, { recursive: true, force: true }); mkdirSync(exportDir, { recursive: true });
const p = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname, "--deps", DEPS, "--backend", backend, "--print-hook", hook, "--isolate", iso, "--guard", "0", "--export-dir", exportDir], { stdio: ["pipe", "pipe", "ignore"] });
const chunks = [];
p.stdout.on("data", (d) => chunks.push(d));
const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
const script = { js: "return box(40,30,10).subtract(cylinder(30,4).translate(0,0,-5)).add(sphere(6).translate(0,0,10))" };
send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "splice", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
p.stdout.pause(); // let the pipe fill
for (let i = 1; i <= N; i++) {
  if (i % 2) send({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "render", arguments: { script } } });
  else send({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "export", arguments: { script, path: `s${i}.step` } } });
}
setTimeout(() => p.stdout.resume(), 3000);
const deadline = Date.now() + 120_000;
const timer = setInterval(() => {
  const s = Buffer.concat(chunks).toString("utf8");
  const ids = new Set();
  for (const l of s.split("\n")) { try { const m = JSON.parse(l); if (m.id !== undefined) ids.add(m.id); } catch {} }
  if (ids.size >= N + 1 || Date.now() > deadline) {
    clearInterval(timer); p.stdin.end(); setTimeout(() => p.kill("SIGKILL"), 2000);
    const lines = s.split("\n").filter((l) => l.length);
    const parsed = lines.filter((l) => { try { return JSON.parse(l).jsonrpc === "2.0"; } catch { return false; } });
    const corrupted = lines.filter((l) => l.includes('"jsonrpc"') && !parsed.includes(l));
    writeFileSync(join(OUT, `splice-${backend}-${hook}-${iso}.stdout`), s);
    console.log(JSON.stringify({ backend, hook, iso, requests: N + 1, responses: ids.size, missing: N + 1 - ids.size, foreignLines: lines.length - parsed.length - corrupted.length, corruptedMessages: corrupted.length, corruptedSample: corrupted.slice(0, 1).map((l) => l.slice(0, 120) + " ... " + (l.match(/\*{5,}[^"]{0,60}/)?.[0] ?? "")) }));
  }
}, 200);
