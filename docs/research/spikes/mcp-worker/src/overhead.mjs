// Boundary cost split: kernel work vs worker/child IPC vs MCP stdio, on a trivial model and a render (PNG transfer).
// Usage: node overhead.mjs <deps> <outdir> [reps-per-backend=3]
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [DEPS, OUT, repsStr = "3"] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const { Client } = await imp("@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const exportDir = join(OUT, "overhead-exports"); mkdirSync(exportDir, { recursive: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.ceil(0.95 * s.length) - 1].toFixed(3); };
const res = {};
for (const backend of ["inproc", "thread", "child"]) {
  const ipc = [], stdio = [], kern = [], rIpc = [], rStdio = [];
  for (let rep = 0; rep < Number(repsStr); rep++) {
    const t = new StdioClientTransport({ command: process.execPath, args: [new URL("./server.mjs", import.meta.url).pathname, "--deps", DEPS, "--backend", backend, "--export-dir", exportDir], stderr: "ignore" });
    const c = new Client({ name: "overhead", version: "0" }); await c.connect(t); await c.listTools();
    for (let i = 0; i < 10; i++) await c.callTool({ name: "run", arguments: { script: { js: "return box(10,10,10)" } } }); // warm
    for (let i = 0; i < 50; i++) {
      const s = performance.now();
      const r = await c.callTool({ name: "run", arguments: { script: { js: `return box(${10 + (i % 5)},10,10)` } } });
      const rt = performance.now() - s, tm = r.structuredContent.timingsMs;
      kern.push(tm.total); ipc.push(tm.host - tm.total); stdio.push(rt - tm.host);
    }
    const { structuredContent: m } = await c.callTool({ name: "run", arguments: { script: { js: "return box(40,30,10).subtract(cylinder(30,4).translate(0,0,-5))" } } });
    for (let i = 0; i < 15; i++) {
      const s = performance.now();
      const r = await c.callTool({ name: "render", arguments: { modelId: m.modelId } });
      const rt = performance.now() - s, tm = r.structuredContent.timingsMs;
      rIpc.push(tm.host - tm.total); rStdio.push(rt - tm.host);
    }
    await c.close();
  }
  res[backend] = { n: kern.length, kernel_p50: med(kern), ipc_p50: med(ipc), ipc_p95: p95(ipc), mcpStdio_p50: med(stdio), mcpStdio_p95: p95(stdio), render_ipc_p50: med(rIpc), render_mcpStdio_p50: med(rStdio) };
  process.stderr.write(`${backend} ${JSON.stringify(res[backend])}\n`);
}
writeFileSync(join(OUT, "overhead-results.json"), JSON.stringify(res, null, 1));
