// npm run viewer:bench: the viewer frame-time benchmark (PLAN.md S2 exit gate).
//
// For each case it starts open3dj view in this process (real compute pool), opens the page in
// headless Chromium with Playwright, and records:
// - load to first frame: page navigation to the first drawn frame, on the first open (for the
//   first renderer of a case this includes the server making the GLB) and on a reload (GLB
//   cached);
// - frame time p50 and p95 while open3dj.probe(ms) orbits the camera (the S2 probe: one step
//   per frame, no mouse), and again during a left-drag mouse orbit, each after a short warm-up
//   of the same motion (a software rasteriser compiles a pipeline on the first use of each draw
//   state, one frame of several hundred milliseconds that is not a steady frame time);
// - draw calls and triangles of the last frame (three.js renderer.info), and the JS heap.
// Every frame is drawn at the stated pixel ratio: the page is opened with adaptive=0 (no half
// resolution while the view moves) and dpr=<--dpr>, and a row whose probe or orbit saw another
// ratio, or any low-resolution frame, is marked invalid and cannot pass the gate. With
// --with-adaptive each case gets a second row with adaptive resolution on, labelled as such; it
// never counts for the gate.
// Cases: examples/enclosure (6 occurrences), and the 145- and 1,025-occurrence reference
// assemblies (corpora/reference-assemblies). Renderers: WebGL2 always, WebGPU when the browser
// gives an adapter that works (the page falls back to WebGL2 by itself otherwise, and the row
// says so).
//
// It prints a Markdown table, the machine it ran on and the JSON. Playwright is not a
// dependency of this repository: without require("playwright") the script says so and exits 0.
//
//   node scripts/viewer-bench.ts                      every case, WebGL2 and WebGPU
//   node scripts/viewer-bench.ts --cases plate-145    one case
//   node scripts/viewer-bench.ts --renderers webgl2 --orbit-ms 5000 --json out.json --shots dir
//   node scripts/viewer-bench.ts --dpr 2 --with-adaptive
//
// The S2 gate: orbiting plate-145 has p95 under 33 ms with WebGPU and under 50 ms with WebGL2,
// on a real GPU. On a software rasteriser (SwiftShader, llvmpipe) the table still prints, but
// the gate column says the numbers cannot judge it.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { createPool, deviceInventory } from "@open3dj/compute";
import type { PoolOptions } from "@open3dj/compute";
import { createHandlers } from "@open3dj/mcp";
import { startViewServer } from "../packages/open3dj/src/view.ts";
import { ROOT } from "./lib.ts";

interface Case { name: string; file: string; occurrences: number }
const CASES: Case[] = [
  { name: "enclosure", file: join(ROOT, "examples", "enclosure", "enclosure.o3j.js"), occurrences: 6 },
  { name: "plate-145", file: join(ROOT, "corpora", "reference-assemblies", "plate-145.o3j.js"), occurrences: 145 },
  { name: "grid-1025", file: join(ROOT, "corpora", "reference-assemblies", "grid-1025.o3j.js"), occurrences: 1025 },
];
/** The S2 gate: p95 frame time while orbiting plate-145 (PLAN.md S2 exit). */
const GATE = { case: "plate-145", WebGPU: 33, WebGL2: 50 } as const;

// ---- Playwright, typed by hand (its types are not installed here) ---------------------------

interface Page {
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  addInitScript(fn: () => void): Promise<void>;
  waitForFunction(fn: () => boolean, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
  locator(selector: string): { first(): { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> } };
  mouse: { move(x: number, y: number): Promise<void>; down(o: { button: "left" }): Promise<void>; up(o: { button: "left" }): Promise<void> };
  screenshot(options: { path: string }): Promise<unknown>;
  on(event: string, fn: (e: { message?: string }) => void): void;
  close(): Promise<void>;
}
interface Browser { newPage(options: object): Promise<Page>; close(): Promise<void>; version(): string }
interface Playwright { chromium: { launch(options: { args: string[] }): Promise<Browser> } }

/** What the page's window.open3dj.perf() returns (packages/viewer/web/main.js). */
interface Perf {
  renderer: string;
  software: boolean;
  pixelRatio: number;
  adaptive: boolean;
  lowResFrames: number;
  frameMs: { p50: number | null; p95: number | null; samples: number };
  drawCalls: number;
  triangles: number;
  scene: { occurrences: number; definitions: number; batched: boolean } | null;
}
interface PageWindow {
  document: { documentElement: { dataset: Record<string, string> }; createElement(tag: "canvas"): { getContext(kind: string): WebGL2Like | null } };
  location: { href: string };
  performance: { now(): number; memory?: { usedJSHeapSize: number } };
  navigator: { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } };
  MutationObserver: new (fn: () => void) => { observe(target: unknown, options: object): void };
  __bench?: { readyAt: number };
  open3dj: { perf(): Perf; probe(ms: number): Promise<Perf | null>; state(): { renderer: string; parts: number } };
}
interface WebGL2Like { getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null; getParameter(p: number): unknown; RENDERER: number }

// ---- options -------------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    cases: { type: "string" },
    renderers: { type: "string", default: "webgl2,webgpu" },
    "orbit-ms": { type: "string", default: "3000" },
    json: { type: "string" },
    shots: { type: "string" },
    dpr: { type: "string", default: "1" },
    "with-adaptive": { type: "boolean", default: false },
  },
});
const wanted = values.cases ? values.cases.split(",").map((s) => s.trim()) : CASES.map((c) => c.name);
const cases = CASES.filter((c) => wanted.includes(c.name));
const renderers = values.renderers!.split(",").map((s) => s.trim().toLowerCase()).filter((r) => r === "webgl2" || r === "webgpu");
const orbitMs = Math.max(500, Number(values["orbit-ms"]) || 3000);
const dpr = Number(values.dpr) || 1;

let pw: Playwright;
try {
  pw = createRequire(import.meta.url)("playwright") as Playwright;
} catch {
  process.stdout.write("viewer-bench: skipped: playwright is not installed on this machine (it is not a dependency of this repository; install it next to the checkout to run the benchmark)\n");
  process.exit(0);
}

// ---- measuring -----------------------------------------------------------------------------

/** Runs in the page before its scripts: when the first frame is drawn (data-viewer=ready). */
function readyHook(): void {
  const w = globalThis as unknown as PageWindow;
  const bench = (w.__bench = { readyAt: 0 });
  new w.MutationObserver(() => {
    if (!bench.readyAt && w.document.documentElement.dataset.viewer === "ready") bench.readyAt = w.performance.now();
  }).observe(w.document, { attributes: true, subtree: true, attributeFilter: ["data-viewer"] });
}

const isReady = () => (globalThis as unknown as PageWindow).document.documentElement.dataset.viewer === "ready";

interface Row {
  case: string;
  occurrences: number;
  asked: string;
  /** "full": every frame at pixelRatio; "adaptive": half resolution while moving (not for the gate). */
  resolution: "full" | "adaptive";
  /** The pixel ratio the probe and the orbit ended at, and whether any frame was drawn lower. */
  pixelRatio: number;
  lowResFrames: number;
  /** A full-resolution row whose frames were not all at the stated ratio. */
  invalid?: string;
  renderer: string;
  software: boolean;
  note?: string;
  loadFirstMs: number | null;
  loadWarmMs: number | null;
  /** WebGPU rows: the adapter the page was given, or why there was none. */
  adapter?: string;
  probe: { p50: number | null; p95: number | null; samples: number };
  mouse: { p50: number | null; p95: number | null; samples: number };
  drawCalls: number;
  triangles: number;
  heapMB: number | null;
  batched: boolean;
  gate: string;
}

async function waitReady(page: Page): Promise<number> {
  await page.waitForFunction(isReady, null, { timeout: 600_000 });
  return Math.round(await page.evaluate(() => (globalThis as unknown as PageWindow).__bench?.readyAt ?? 0));
}

/**
 * Left-drag orbit for ms milliseconds. The page draws only on demand and records the interval
 * between drawn frames while the view moves; a 50 ms probe first empties that record. A short
 * drag first warms up: a software rasteriser compiles a pipeline the first time it meets a new
 * draw state (the hover outline appearing or going), which shows as one frame of 300 to 800 ms.
 */
async function mouseOrbit(page: Page, ms: number): Promise<Perf> {
  const box = await page.locator("canvas").first().boundingBox();
  const drag = async (cx: number, cy: number, length: number) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "left" });
    const start = Date.now();
    for (let i = 0; Date.now() - start < length; i++) await page.mouse.move(cx + Math.cos(i / 10) * 120, cy + Math.sin(i / 10) * 60);
    await page.mouse.up({ button: "left" });
  };
  if (box) await drag(box.x + box.width / 2, box.y + box.height / 2, 800);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
  await page.evaluate(() => (globalThis as unknown as PageWindow).open3dj.probe(50));
  await page.waitForTimeout(400);
  if (box) await drag(box.x + box.width / 2, box.y + box.height / 2, ms);
  const out = await page.evaluate(() => (globalThis as unknown as PageWindow).open3dj.perf());
  // Off the model, so the probe that follows does not start by clearing a hover.
  await page.mouse.move(1, 1);
  return out;
}

async function machine(browser: Browser): Promise<Record<string, unknown>> {
  const page = await browser.newPage({});
  const gl = await page.evaluate(() => {
    const w = globalThis as unknown as PageWindow;
    const c = w.document.createElement("canvas").getContext("webgl2");
    if (!c) return null;
    const ext = c.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
  });
  await page.close();
  const c = cpus();
  return {
    date: new Date().toISOString(), os: `${platform()} ${release()} ${arch()}`, cpu: `${c[0]?.model ?? "unknown"} x${c.length}`,
    memoryGB: +(totalmem() / 1024 ** 3).toFixed(1), node: process.version, chromium: browser.version(), webgl2: gl ?? "no WebGL2 context",
    viewport: "1280x800", pixelRatio: dpr, adaptiveResolution: values["with-adaptive"] ? "off, plus one row per case with it on" : "off (every frame at the stated pixel ratio)", orbitMs,
  };
}

async function benchCase(browser: Browser, c: Case): Promise<Row[]> {
  const root = mkdtempSync(join(tmpdir(), "o3j-viewer-bench-"));
  const options: PoolOptions = { size: 2, log: () => {}, jobTimeoutMs: 180_000 };
  const pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root, version: "0.0.0", interactiveMs: 600_000 });
  const script = join(root, basename(c.file));
  copyFileSync(c.file, script);
  const t0 = performance.now();
  const server = await startViewServer({ handlers, root, project: join(root, basename(c.file).replace(/\.o3j\.js$/, ".o3j")), script, log: (l) => process.stderr.write(`${l}\n`) });
  const rows: Row[] = [];
  try {
    await server.ready;
    process.stderr.write(`viewer-bench: ${c.name}: first run ${Math.round(performance.now() - t0)} ms\n`);
    const runs = renderers.flatMap((asked) => (values["with-adaptive"] ? [[asked, "full"], [asked, "adaptive"]] : [[asked, "full"]]) as Array<[string, "full" | "adaptive"]>);
    for (const [asked, resolution] of runs) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message ?? String(e)));
      await page.addInitScript(readyHook);
      try {
        const query = new URLSearchParams({ dpr: String(dpr), adaptive: resolution === "full" ? "0" : "1" });
        if (asked === "webgl2") query.set("renderer", "webgl");
        await page.goto(`${server.url}?${query}`);
        let cold: number | null = await waitReady(page);
        // A WebGPU device that fails after start-up makes the page reload itself on WebGL2.
        await page.waitForTimeout(1500);
        if (!(await page.evaluate(isReady))) cold = null;
        await waitReady(page);
        await page.reload();
        const warm = await waitReady(page);
        await page.waitForTimeout(500);
        const href = await page.evaluate(() => (globalThis as unknown as PageWindow).location.href);
        const mouse = await mouseOrbit(page, orbitMs);
        await page.waitForTimeout(500);
        // A short probe first, for the same warm-up reason as the drag.
        await page.evaluate(() => (globalThis as unknown as PageWindow).open3dj.probe(800));
        await page.waitForTimeout(300);
        const probed = await page.evaluate((ms) => (globalThis as unknown as PageWindow).open3dj.probe(ms), orbitMs);
        const heap = await page.evaluate(() => (globalThis as unknown as PageWindow).performance.memory?.usedJSHeapSize ?? 0);
        const p = probed ?? mouse;
        const renderer = p.renderer;
        const row: Row = {
          case: c.name, occurrences: c.occurrences, asked, resolution, pixelRatio: p.pixelRatio, lowResFrames: Math.max(mouse.lowResFrames ?? 0, probed?.lowResFrames ?? 0), renderer, software: p.software,
          loadFirstMs: cold, loadWarmMs: warm,
          probe: { p50: probed?.frameMs.p50 ?? null, p95: probed?.frameMs.p95 ?? null, samples: probed?.frameMs.samples ?? 0 },
          mouse: { p50: mouse.frameMs.p50, p95: mouse.frameMs.p95, samples: mouse.frameMs.samples },
          drawCalls: p.drawCalls, triangles: p.triangles, heapMB: heap ? +(heap / 1024 ** 2).toFixed(1) : null, batched: !!p.scene?.batched,
          gate: "",
        };
        if (asked === "webgpu") {
          row.adapter = await page.evaluate(async () => {
            const w = globalThis as unknown as PageWindow;
            if (!w.navigator.gpu) return "navigator.gpu is missing";
            try {
              const a = await w.navigator.gpu.requestAdapter();
              // GPUAdapterInfo keeps its fields on the prototype, so JSON.stringify(info) gives {}.
              const info = (a?.info ?? {}) as Record<string, unknown>;
              return a ? ["vendor", "architecture", "device", "description", "isFallbackAdapter"].map((k) => `${k}=${String(info[k] ?? "")}`).join(" ") : "no adapter";
            } catch (e) {
              return `requestAdapter failed: ${(e as Error).message}`;
            }
          });
        }
        if (asked === "webgpu" && renderer !== "WebGPU") row.note = /renderer=webgl/.test(href) ? "WebGPU failed after start-up; the page fell back to WebGL2" : "no WebGPU adapter; WebGL2";
        if (errors.length) row.note = `${row.note ? `${row.note}; ` : ""}page errors: ${errors.slice(0, 2).join(" | ").slice(0, 200)}`;
        if (resolution === "full") {
          const ratios = [mouse.pixelRatio, probed?.pixelRatio ?? dpr];
          if (row.lowResFrames > 0 || ratios.some((r) => r !== dpr)) row.invalid = `frames were not all drawn at pixel ratio ${dpr} (ended at ${ratios.join(" and ")}, ${row.lowResFrames} low-resolution switch${row.lowResFrames === 1 ? "" : "es"})`;
        }
        row.gate = gate(row);
        rows.push(row);
        if (values.shots) {
          mkdirSync(values.shots, { recursive: true });
          await page.screenshot({ path: join(values.shots, `${c.name}-${asked}${resolution === "adaptive" ? "-adaptive" : ""}.png`) });
        }
        process.stderr.write(`viewer-bench: ${c.name} ${asked} ${resolution}: ${renderer}, pixel ratio ${row.pixelRatio}, probe p95 ${row.probe.p95} ms${row.invalid ? ` (INVALID: ${row.invalid})` : ""}\n`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await server.close();
    handlers.shutdown();
    await pool.close();
    rmSync(root, { recursive: true, force: true });
  }
  return rows;
}

function gate(r: Row): string {
  if (r.case !== GATE.case) return "";
  if (r.resolution !== "full") return "not for the gate: half resolution while moving";
  if (r.invalid) return `invalid: ${r.invalid}`;
  const limit = r.renderer === "WebGPU" ? GATE.WebGPU : r.renderer === "WebGL2" ? GATE.WebGL2 : undefined;
  if (limit === undefined || r.probe.p95 === null) return "no frames";
  const verdict = r.probe.p95 < limit ? "under" : "over";
  if (r.software) return `${verdict} ${limit} ms, but software rendering cannot judge the gate`;
  return `${verdict === "under" ? "meets" : "misses"} p95 < ${limit} ms`;
}

const f = (x: number | null) => (x === null ? "n/a" : String(Number(x.toFixed(1))));

function table(rows: Row[]): string {
  const head = "| Case | Occurrences | Renderer | Pixel ratio | Load first / reload (ms) | Probe orbit p50 / p95 (ms) | Mouse orbit p50 / p95 (ms) | Draw calls | Triangles | JS heap (MB) | S2 gate |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((r) => {
    const renderer = `${r.renderer}${r.software ? " (software)" : ""}${r.batched ? ", batched" : ""}${r.note ? ` (asked ${r.asked}: ${r.note})` : ""}`;
    const ratio = r.resolution === "adaptive" ? `${dpr}, half while moving` : r.invalid ? `${r.pixelRatio} (INVALID)` : String(r.pixelRatio);
    return `| ${r.case} | ${r.occurrences.toLocaleString("en-US")} | ${renderer} | ${ratio} | ${f(r.loadFirstMs)} / ${f(r.loadWarmMs)} | ${f(r.probe.p50)} / ${f(r.probe.p95)} | ${f(r.mouse.p50)} / ${f(r.mouse.p95)} | ${r.drawCalls.toLocaleString("en-US")} | ${r.triangles.toLocaleString("en-US")} | ${f(r.heapMB)} | ${r.gate || "-"} |`;
  });
  return [head, sep, ...lines].join("\n");
}

// ---- main ----------------------------------------------------------------------------------

const browser = await pw.chromium.launch({ args: ["--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--enable-precise-memory-info"] });
const rows: Row[] = [];
let host: Record<string, unknown> = {};
try {
  host = await machine(browser);
  for (const c of cases) rows.push(...(await benchCase(browser, c)));
  const adapter = rows.find((r) => r.adapter)?.adapter;
  if (adapter) host.webgpu = adapter;
} finally {
  await browser.close();
}
const result = { machine: host, gate: `PLAN.md S2: orbiting ${GATE.case}, p95 under ${GATE.WebGPU} ms with WebGPU and under ${GATE.WebGL2} ms with WebGL2, on a real GPU`, rows };
const machineLines = Object.entries(host).map(([k, v]) => `- ${k}: ${String(v)}`).join("\n");
const invalid = rows.filter((r) => r.invalid);
if (invalid.length) process.exitCode = 1;
process.stdout.write(`${table(rows)}\n\nMachine:\n${machineLines}\n\nGate: ${result.gate}. Frame times are nearest-rank percentiles of the intervals between drawn frames while the view moves.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
if (values.json) writeFileSync(values.json, `${JSON.stringify(result, null, 2)}\n`);
