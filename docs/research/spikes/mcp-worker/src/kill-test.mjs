// Can a runaway script or a long kernel op be stopped without killing the MCP server?
// Usage: node kill-test.mjs <deps> <outdir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [DEPS, OUT] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const { Client } = await imp("@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const SERVER = new URL("./server.mjs", import.meta.url).pathname;
const exportDir = join(OUT, "kill-exports"); mkdirSync(exportDir, { recursive: true });
const cases = {
  js_infinite_loop: { js: "while (true) {}" },
  // 400 sequential booleans on a growing shape: seconds of time spent inside wasm, not JS
  wasm_long_op: { js: "let a = box(1,1,1); for (let i = 1; i < 400; i++) a = a.add(box(1,1,1).translate(i*0.9,0,0)); return a" },
};
const rows = [];
for (const backend of ["thread", "child", "inproc"]) {
  for (const [cname, script] of Object.entries(cases)) {
    const t = new StdioClientTransport({ command: process.execPath, args: [SERVER, "--deps", DEPS, "--backend", backend, "--timeout-ms", "2000", "--export-dir", exportDir], stderr: "pipe" });
    let stderr = ""; t.stderr?.on("data", (d) => (stderr += d));
    const c = new Client({ name: "kill-test", version: "0" });
    await c.connect(t);
    await c.callTool({ name: "run", arguments: { script: { js: "return box(5,5,5)" } } }); // warm
    const row = { backend, case: cname };
    let s = performance.now();
    try {
      const r = await c.callTool({ name: "run", arguments: { script } }, undefined, { timeout: 8000 });
      row.result = r.isError ? r.content[0].text.slice(0, 140) : "completed";
    } catch (e) { row.result = `client error: ${String(e.message).slice(0, 140)}`; }
    row.msToAnswer = +(performance.now() - s).toFixed(0);
    s = performance.now();
    try {
      const r = await c.callTool({ name: "run", arguments: { script: { js: "return sphere(4)" } } }, undefined, { timeout: 15000 });
      row.nextCall = r.isError ? `error: ${r.content[0].text.slice(0, 100)}` : `ok volume=${r.structuredContent.volume}`;
    } catch (e) { row.nextCall = `client error: ${String(e.message).slice(0, 120)}`; }
    row.msToNextOk = +(performance.now() - s).toFixed(0);
    try { const st = JSON.parse((await c.callTool({ name: "kernel_stats", arguments: {} }, undefined, { timeout: 15000 })).content[0].text); row.restarts = st.restarts; } catch (e) { row.restarts = "n/a"; }
    await c.close().catch(() => {});
    rows.push(row);
    process.stderr.write(JSON.stringify(row) + "\n");
  }
}
writeFileSync(join(OUT, "kill-results.json"), JSON.stringify(rows, null, 1));
