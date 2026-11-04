// Era matrix: v1 (1.32.2) and v2 (2.4.0) clients against the v1 server (server.mjs) and the v2 dual-era server.
// Usage: node v2-test.mjs <deps> <deps-v2> <outdir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [DEPS, DEPS2, OUT] = process.argv.slice(2);
const v1 = {
  Client: (await import(pathToFileURL(join(DEPS, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js")).href)).Client,
  Stdio: (await import(pathToFileURL(join(DEPS, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js")).href)).StdioClientTransport,
};
const cdist = join(DEPS2, "node_modules/@modelcontextprotocol/client/dist");
const v2 = {
  Client: (await import(pathToFileURL(join(cdist, "index.mjs")).href)).Client,
  Stdio: (await import(pathToFileURL(join(cdist, "stdio.mjs")).href)).StdioClientTransport,
};
const exportDir = join(OUT, "v2-exports"); mkdirSync(exportDir, { recursive: true });
const servers = {
  "v1-server(1.32.2)": [new URL("./server.mjs", import.meta.url).pathname, "--deps", DEPS, "--backend", "thread", "--export-dir", exportDir],
  "v2-server(2.4.0,dual-era)": [new URL("./server-v2.mjs", import.meta.url).pathname, "--deps-v2", DEPS2, "--deps", DEPS],
  "v2-server(2.4.0,legacy:reject)": [new URL("./server-v2.mjs", import.meta.url).pathname, "--deps-v2", DEPS2, "--deps", DEPS, "--legacy", "reject"],
};
const clients = [
  ["v1-client", null], ["v2-client legacy(default)", undefined], ["v2-client auto", { mode: "auto" }], ["v2-client pin 2026-07-28", { mode: { pin: "2026-07-28" } }],
];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.ceil((p / 100) * s.length) - 1].toFixed(2); };
const rows = [];
for (const [sName, args] of Object.entries(servers)) {
  for (const [cName, neg] of clients) {
    const lib = neg === null ? v1 : v2;
    const sent = [];
    const t = new lib.Stdio({ command: process.execPath, args, stderr: "ignore" });
    const origSend = t.send.bind(t);
    t.send = (m, o) => { if (m.method) sent.push(m.method); return origSend(m, o); };
    let negotiated;
    if (neg === null) { const os = t.start.bind(t); t.start = async () => { await os(); const on = t.onmessage; t.onmessage = (m) => { if (m.result?.protocolVersion) negotiated = m.result.protocolVersion; on?.(m); }; }; }
    const opts = neg ? { versionNegotiation: neg } : {};
    const c = new lib.Client({ name: "era-test", version: "0" }, opts);
    const row = { server: sName, client: cName };
    const t0 = performance.now();
    try {
      await c.connect(t);
      row.connectMs = +(performance.now() - t0).toFixed(1);
      row.negotiated = neg === null ? negotiated : c.getNegotiatedProtocolVersion?.();
      row.firstMethods = sent.slice(0, 3);
      await c.listTools();
      const lat = []; let ok = 0;
      for (let i = 0; i < 20; i++) {
        const s = performance.now();
        const r = await c.callTool({ name: "run", arguments: { script: { js: `return box(${10 + i},10,10).subtract(cylinder(20,2).translate(0,0,-5))` } } });
        lat.push(performance.now() - s); if (!r.isError && r.structuredContent?.valid) ok++;
      }
      const rr = await c.callTool({ name: "render", arguments: { script: { js: "return sphere(8)" } } });
      row.calls = `${ok}/20 ok`; row.run_p50 = pct(lat, 50); row.run_p95 = pct(lat, 95);
      row.renderImage = rr.content?.some((x) => x.type === "image");
    } catch (e) { row.error = `${e.constructor?.name}: ${String(e.message).slice(0, 220)}`; row.firstMethods = sent.slice(0, 3); }
    await c.close().catch(() => {});
    rows.push(row);
    process.stderr.write(JSON.stringify(row) + "\n");
  }
}
writeFileSync(join(OUT, "v2-era-matrix.json"), JSON.stringify(rows, null, 1));
