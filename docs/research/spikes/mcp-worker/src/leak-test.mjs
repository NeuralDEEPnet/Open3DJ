// Proof harness: does OCCT's stdout printing reach the MCP stdout stream?
// Spawns server.mjs in each configuration, speaks raw JSON-RPC, captures EVERY stdout byte and
// classifies each line as a valid JSON-RPC message or as foreign output.
// Usage: node leak-test.mjs <deps> <outdir>
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [DEPS, OUT] = process.argv.slice(2);
const SERVER = new URL("./server.mjs", import.meta.url).pathname;
const configs = [
  // name, backend, printHook, isolate, guard
  ["inproc  naive", "inproc", 0, 0, 0],
  ["inproc  guard", "inproc", 0, 0, 1],
  ["inproc  hook", "inproc", 1, 0, 0],
  ["thread  naive", "thread", 0, 0, 0],
  ["thread  guard-only", "thread", 0, 0, 1],
  ["thread  isolate", "thread", 0, 1, 0],
  ["thread  hook", "thread", 1, 0, 0],
  ["thread  hook+isolate+guard", "thread", 1, 1, 1],
  ["child   inherit", "child", 0, 0, 0],
  ["child   pipe", "child", 0, 1, 0],
  ["child   hook", "child", 1, 0, 0],
  ["child   hook+pipe+guard", "child", 1, 1, 1],
];
const plate = { ops: [
  { id: "b", op: "box", w: 60, d: 40, h: 8 },
  { id: "c", op: "cylinder", r: 3, h: 20 },
  { id: "c1", op: "translate", of: "c", x: -20, y: -10, z: -5 },
  { id: "c2", op: "translate", of: "c", x: 20, y: 10, z: -5 },
  { id: "p", op: "subtract", of: "b", tools: ["c1", "c2"] },
  { id: "f", op: "fillet", of: "p", r: 1, atZ: 8 },
], result: "f" };

function runOne([name, backend, hook, iso, guard]) {
  return new Promise((resolve) => {
    const exportDir = join(OUT, "leak-exports", name.replace(/\W+/g, "_"));
    rmSync(exportDir, { recursive: true, force: true }); mkdirSync(exportDir, { recursive: true });
    const p = spawn(process.execPath, [SERVER, "--deps", DEPS, "--backend", backend, "--print-hook", String(hook), "--isolate", String(iso), "--guard", String(guard), "--export-dir", exportDir], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; let stderr = ""; let buf = "";
    const waiters = new Map();
    p.stdout.on("data", (d) => {
      chunks.push(d); buf += d.toString("utf8");
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {}
      }
    });
    p.stderr.on("data", (d) => (stderr += d));
    const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
    const req = (id, method, params) => new Promise((res) => { waiters.set(id, res); send({ jsonrpc: "2.0", id, method, params }); });
    const timeout = setTimeout(() => { p.kill("SIGKILL"); }, 60_000);
    (async () => {
      const results = {};
      const init = await req(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "leak-test", version: "0" } });
      results.negotiated = init.result?.protocolVersion;
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const run = await req(2, "tools/call", { name: "run", arguments: { script: plate } });
      results.runOk = !run.result?.isError; results.volume = run.result?.structuredContent?.volume;
      const e1 = await req(3, "tools/call", { name: "export", arguments: { script: plate, path: "a.step" } });
      const e2 = await req(4, "tools/call", { name: "export", arguments: { script: plate, path: "b.step" } });
      results.exportOk = !e1.result?.isError && !e2.result?.isError; results.stepBytes = e1.result?.structuredContent?.bytes;
      // a user script that itself calls console.log must not leak either (facade captures it)
      const js = await req(5, "tools/call", { name: "run", arguments: { script: { js: "console.log('hello from user script'); return box(10,10,10)" } } });
      results.jsLogs = js.result?.structuredContent?.logs;
      await req(6, "tools/call", { name: "render", arguments: { script: plate } });
      const st = await req(7, "tools/call", { name: "kernel_stats", arguments: {} });
      try { const s = JSON.parse(st.result.content[0].text); results.hostCapturedStdoutBytes = s.hostCapturedStdoutBytes; results.kernelPrintedLines = s.kernel.printed.outLines; } catch { results.statsError = JSON.stringify(st).slice(0, 300); }
      await new Promise((r) => setTimeout(r, 750)); // worker stdout is forwarded asynchronously
      p.stdin.end();
      return results;
    })().then((results) => {
      p.on("close", (code) => {
        clearTimeout(timeout);
        const all = Buffer.concat(chunks).toString("utf8");
        const lines = all.split("\n"); if (lines.at(-1) === "") lines.pop();
        const foreign = lines.filter((l) => { try { const m = JSON.parse(l); return m?.jsonrpc !== "2.0"; } catch { return true; } });
        writeFileSync(join(OUT, `leak-${name.replace(/\W+/g, "_")}.stdout`), all);
        resolve({ name, backend, hook, iso, guard, exit: code, stdoutBytes: Buffer.byteLength(all), lines: lines.length,
          jsonRpcLines: lines.length - foreign.length, foreignLines: foreign.length, foreignBytes: foreign.reduce((a, l) => a + Buffer.byteLength(l) + 1, 0),
          foreignSample: foreign.filter((l) => l.trim()).slice(0, 2), ...results, stderrHasKernelText: /Statistics on Transfer/.test(stderr) });
      });
    });
  });
}

const rows = [];
for (const c of configs) { const r = await runOne(c); rows.push(r); process.stderr.write(`${r.name.padEnd(28)} runOk=${r.runOk} exportOk=${r.exportOk} foreignLines=${r.foreignLines} foreignBytes=${r.foreignBytes} jsonrpc=${r.jsonRpcLines} printedInKernel=${r.kernelPrintedLines} hostCaptured=${r.hostCapturedStdoutBytes} stderrHasKernelText=${r.stderrHasKernelText}\n`); }
writeFileSync(join(OUT, "leak-results.json"), JSON.stringify(rows, null, 1));
console.log(JSON.stringify(rows.map(({ foreignSample, ...r }) => r)));
