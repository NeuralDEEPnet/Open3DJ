// SDK Client over StdioClientTransport: startup, 50 run calls, 50 mixed calls, full response validation.
// Usage: node bench-client.mjs <deps> <outdir> <backend> <reps> [hook=1] [isolate=1] [guard=1]
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";

const [DEPS, OUT, BACKEND, repsStr, hook = "1", iso = "1", guard = "1"] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const { Client } = await imp("@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const { CallToolResultSchema } = await imp("@modelcontextprotocol/sdk/dist/esm/types.js");
const SERVER = new URL("./server.mjs", import.meta.url).pathname;

const plate = (r) => ({ ops: [
  { id: "b", op: "box", w: 80, d: 60, h: 10 },
  { id: "c", op: "cylinder", r, h: 30 },
  ...[[-30, -20], [30, -20], [-30, 20], [30, 20]].map(([x, y], i) => ({ id: `h${i}`, op: "translate", of: "c", x, y, z: -10 })),
  { id: "p", op: "subtract", of: "b", tools: ["h0", "h1", "h2", "h3"] },
  { id: "f", op: "fillet", of: "p", r: 1.5, atZ: 10 },
], result: "f" });
const bracket = { js: `
  const w = Param.number("w", 60);
  const base = box(w, 40, 6);
  const upright = box(w, 6, 40).translate(0, 17, 0);
  const holes = linearPattern(cylinder(20, 3).translate(-w / 2 + 10, 0, -5), 3, (w - 20) / 2, 0, 0);
  const body = union(base, upright).subtract(holes);
  console.log("bracket width", w);
  return fillet(body, 2, { atZ: 40 });` };

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2); };
const summary = (a) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: +Math.max(...a).toFixed(2), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) });

function check(res, tool) {
  CallToolResultSchema.parse(res); // throws if the envelope is malformed
  if (res.isError) throw new Error(`${tool} isError: ${res.content?.[0]?.text}`);
  if (tool !== "kernel_stats" && !res.structuredContent) throw new Error(`${tool}: no structuredContent`);
  if (tool === "render") {
    const img = res.content.find((c) => c.type === "image");
    const svg = res.content.find((c) => c.type === "resource");
    if (!img || Buffer.from(img.data, "base64").subarray(1, 4).toString() !== "PNG") throw new Error("render: no PNG image content");
    if (!svg?.resource?.text?.startsWith("<svg") && !svg?.resource?.text?.startsWith("<?xml")) throw new Error("render: no SVG resource");
  }
  return res;
}

const reps = [];
for (let rep = 0; rep < Number(repsStr); rep++) {
  const exportDir = join(OUT, "bench-exports", `${BACKEND}-${rep}`);
  rmSync(exportDir, { recursive: true, force: true }); mkdirSync(exportDir, { recursive: true });
  const errors = [];
  const t0 = performance.now();
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, "--deps", DEPS, "--backend", BACKEND, "--print-hook", hook, "--isolate", iso, "--guard", guard, "--export-dir", exportDir], stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "open3dj-bench", version: "0.0.1" });
  client.onerror = (e) => errors.push(String(e?.message ?? e).slice(0, 200));
  await client.connect(transport);
  const tConnect = performance.now() - t0;
  const tools = await client.listTools(); // also primes the client's outputSchema validators
  const tList = performance.now() - t0;
  const first = check(await client.callTool({ name: "run", arguments: { script: plate(2) } }), "run");
  const tFirstRun = performance.now() - t0;

  const runLat = [], mixed = { run_js: [], render: [], export: [], run_ops: [] };
  let parsed = 0, failed = [];
  const call = async (bucket, name, args) => {
    const s = performance.now();
    try { const r = check(await client.callTool({ name, arguments: args }), name); bucket.push(performance.now() - s); parsed++; return r; }
    catch (e) { failed.push(`${name}: ${e.message}`.slice(0, 300)); }
  };
  for (let i = 0; i < 50; i++) await call(runLat, "run", { script: plate(2 + (i % 10) * 0.1) });
  let lastId = first.structuredContent.modelId;
  for (let i = 0; i < 50; i++) {
    switch (i % 4) {
      case 0: { const r = await call(mixed.run_js, "run", { script: bracket, params: { w: 50 + (i % 7) * 5 } }); if (r) lastId = r.structuredContent.modelId; break; }
      case 1: await call(mixed.render, "render", { modelId: lastId }); break;
      case 2: await call(mixed.export, "export", { modelId: lastId, path: `parts/p${i}.step` }); break;
      case 3: { const r = await call(mixed.run_ops, "run", { script: plate(2.5 + (i % 5) * 0.2) }); if (r) lastId = r.structuredContent.modelId; break; }
    }
  }
  const stats = JSON.parse((await client.callTool({ name: "kernel_stats", arguments: {} })).content[0].text);
  const sample = first.structuredContent;
  await client.close();
  const r = {
    rep, backend: BACKEND, startup: { connectMs: +tConnect.toFixed(1), listToolsMs: +tList.toFixed(1), firstRunMs: +tFirstRun.toFixed(1), kernelReadyMs: stats.kernelReadyMs, kernelInitMs: stats.kernelInitMs, sdkLoadMs: stats.sdkLoadMs },
    tools: tools.tools.map((t) => ({ name: t.name, hasOutputSchema: !!t.outputSchema })),
    run50: summary(runLat), mixed50: Object.fromEntries(Object.entries(mixed).map(([k, v]) => [k, v.length ? summary(v) : null])),
    allMixed: summary(Object.values(mixed).flat()),
    responsesParsed: parsed, failures: failed, transportErrors: errors.length, transportErrorSample: errors.slice(0, 3),
    sample: { volume: sample.volume, valid: sample.valid, triangles: sample.triangles, bbox: sample.bbox, timingsMs: sample.timingsMs },
    mem: { mainRssMb: stats.mainRssMb, kernelRssMb: stats.kernel.rssMb, liveShapes: stats.kernel.liveShapes, models: stats.kernel.models },
    capturedKernelLines: stats.kernel.printed.outLines, hostCapturedStdoutBytes: stats.hostCapturedStdoutBytes, restarts: stats.restarts,
    exportsWritten: Array.from({ length: 50 }, (_, i) => i).filter((i) => i % 4 === 2).filter((i) => { try { return statSync(join(exportDir, "parts", `p${i}.step`)).size > 1000; } catch { return false; } }).length,
  };
  reps.push(r);
  process.stderr.write(`[${BACKEND} rep ${rep}] connect=${r.startup.connectMs} firstRun=${r.startup.firstRunMs} run p50=${r.run50.p50} p95=${r.run50.p95} mixed p50=${r.allMixed.p50} p95=${r.allMixed.p95} parsed=${parsed}/100 fail=${failed.length} transportErrors=${errors.length}\n`);
}
const med = (f) => { const v = reps.map(f).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const agg = {
  backend: BACKEND, hook, iso, guard, reps: reps.length,
  median: {
    connectMs: med((r) => r.startup.connectMs), firstRunMs: med((r) => r.startup.firstRunMs), kernelReadyMs: med((r) => r.startup.kernelReadyMs), kernelInitMs: med((r) => r.startup.kernelInitMs), sdkLoadMs: med((r) => r.startup.sdkLoadMs),
    run50_p50: med((r) => r.run50.p50), run50_p95: med((r) => r.run50.p95),
    mixed_p50: med((r) => r.allMixed.p50), mixed_p95: med((r) => r.allMixed.p95),
    run_js_p50: med((r) => r.mixed50.run_js.p50), render_p50: med((r) => r.mixed50.render.p50), render_p95: med((r) => r.mixed50.render.p95), export_p50: med((r) => r.mixed50.export.p50), export_p95: med((r) => r.mixed50.export.p95),
    mainRssMb: med((r) => r.mem.mainRssMb), kernelRssMb: med((r) => r.mem.kernelRssMb),
  },
  totals: { responsesParsed: reps.reduce((a, r) => a + r.responsesParsed, 0), calls: reps.length * 100, failures: reps.flatMap((r) => r.failures), transportErrors: reps.reduce((a, r) => a + r.transportErrors, 0), transportErrorSample: reps.flatMap((r) => r.transportErrorSample).slice(0, 3), exportsWritten: reps.reduce((a, r) => a + r.exportsWritten, 0) },
  liveShapesAtEnd: reps.map((r) => r.mem.liveShapes), sample: reps[0].sample, tools: reps[0].tools,
};
writeFileSync(join(OUT, `bench-${BACKEND}-h${hook}i${iso}g${guard}.json`), JSON.stringify({ agg, reps }, null, 1));
console.log(JSON.stringify(agg));
