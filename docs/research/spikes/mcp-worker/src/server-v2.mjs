// The same kernel worker behind the v2 SDK (@modelcontextprotocol/server 2.4.0) with dual-era stdio:
// serveStdio() answers 2025-era `initialize` AND 2026-07-28 `server/discover` from one factory.
// Usage: node server-v2.mjs --deps-v2 <dir> --deps <dir-with-occt-wasm> [--legacy serve|reject]
import { parseArgs, format } from "node:util";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const { values: A } = parseArgs({ options: { "deps-v2": { type: "string" }, deps: { type: "string" }, legacy: { type: "string", default: "serve" } } });
for (const m of ["log", "info", "debug"]) console[m] = (...a) => process.stderr.write(format(...a) + "\n");
const imp = (p) => import(pathToFileURL(join(A["deps-v2"], "node_modules", p)).href);
const srvPkg = join(A["deps-v2"], "node_modules/@modelcontextprotocol/server/dist");
const [{ McpServer }, { serveStdio }, { z }] = await Promise.all([
  import(pathToFileURL(join(srvPkg, "index.mjs")).href),
  import(pathToFileURL(join(srvPkg, "stdio.mjs")).href),
  imp("zod/index.js"),
]);

// one kernel worker for the process, shared by whichever era instance the factory builds
const worker = new Worker(new URL("./worker-thread-entry.mjs", import.meta.url), { workerData: { deps: A.deps, printHook: true }, stdout: true, stderr: true });
worker.stdout.on("data", (d) => process.stderr.write(`[kernel out] ${d}`));
worker.stderr.on("data", (d) => process.stderr.write(`[kernel err] ${d}`));
let seq = 0; const pending = new Map();
const ready = new Promise((res) => worker.on("message", (m) => { if (m.ready) return res(); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.ok ? p.res(m.result) : p.rej(new Error(m.error.message)); }));
const call = async (method, params) => { await ready; return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ id, method, params }); }); };

const Script = z.union([z.object({ ops: z.array(z.object({ op: z.string(), id: z.string() }).passthrough()), result: z.string().optional() }), z.object({ js: z.string() })]);
const eras = [];
function factory(ctx) {
  eras.push(ctx?.era);
  process.stderr.write(`[v2] factory called for era=${ctx?.era}\n`);
  const server = new McpServer({ name: "open3dj-spike-v2", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.registerTool("run", {
    description: "Evaluate a model script in the kernel worker; returns volume, bbox, validity, triangle count.",
    inputSchema: z.object({ script: Script }),
    outputSchema: z.object({ modelId: z.string(), valid: z.boolean(), volume: z.number(), triangles: z.number().int(), bbox: z.object({ min: z.array(z.number()), max: z.array(z.number()) }) }),
  }, async ({ script }) => {
    try {
      const r = await call("run", { script });
      const sc = { modelId: r.modelId, valid: r.valid, volume: r.volume, triangles: r.triangles, bbox: r.bbox };
      return { structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }] };
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  });
  server.registerTool("render", {
    description: "4-view drawing as PNG image content plus the SVG as an embedded resource.",
    inputSchema: z.object({ script: Script }),
  }, async ({ script }) => {
    const r = await call("render", { script });
    const png = Buffer.from(r.png.buffer, r.png.byteOffset, r.png.byteLength);
    return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "resource", resource: { uri: `open3dj://models/${r.modelId}/multiview.svg`, mimeType: "image/svg+xml", text: r.svg } }] };
  });
  server.registerTool("export_step", {
    description: "Return STEP byte count (spike: proves the STEP writer's stdout text stays off the wire).",
    inputSchema: z.object({ script: Script }),
  }, async ({ script }) => { const r = await call("exportStep", { script }); return { content: [{ type: "text", text: String(r.step.length) }] }; });
  return server;
}
serveStdio(factory, { legacy: A.legacy });
process.stdin.on("end", () => { worker.terminate(); setTimeout(() => process.exit(0), 50); });
