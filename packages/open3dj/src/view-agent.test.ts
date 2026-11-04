// End to end: a person and an agent work on the same project at the same time.
//
// The agent is `open3dj mcp` in its own process, driven by the official MCP client; the person
// is the viewer (`open3dj view`, in this process) in headless Chromium. The agent runs
// examples/enclosure and finds nothing selected; the person clicks the lid's top face; the
// agent reads that face's element address with inspect fields=[selection]; then the agent
// points at the face and a screw with render view=highlight, and the viewer shows it. The two
// processes share only the project folder.
//
// It needs Playwright with Chromium and skips without it (CI runners do not have it). Set
// OPEN3DJ_VIEWER_SHOTS to a folder to keep the screenshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createPool, deviceInventory } from "@open3dj/compute";
import type { PoolOptions } from "@open3dj/compute";
import { createHandlers } from "@open3dj/mcp";
import type { ViewerSelection } from "@open3dj/schemas";
import { startViewServer } from "./view.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const ENCLOSURE = fileURLToPath(new URL("../../../examples/enclosure/enclosure.o3j.js", import.meta.url));

// Playwright's types are not installed here; the few calls below are typed by hand. Page
// functions run in the browser, so they name globalThis themselves (no helpers from here).
interface Page {
  goto(url: string): Promise<unknown>;
  waitForFunction<A>(fn: (arg: A) => boolean, arg?: A, options?: { timeout: number }): Promise<unknown>;
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
  click(selector: string): Promise<void>;
  mouse: { click(x: number, y: number): Promise<void> };
  screenshot(options: { path: string }): Promise<unknown>;
  on(event: string, fn: (e: { message?: string }) => void): void;
}
interface Browser { newPage(options: object): Promise<Page>; close(): Promise<void> }
interface FaceFacts { face: number; planar: boolean; normal?: number[]; centre: number[] }
interface AgentState { id: string; rev: string; targets: string[]; note: string | null; shown: boolean; tinted: string[]; faces: number }
interface ViewerWindow {
  document: { documentElement: { dataset: Record<string, string> }; getElementById(id: string): { hidden: boolean; textContent: string } | null };
  open3dj: {
    state(): { rev: string; selected: string[]; elements: Array<{ address: string | null }>; shared: string[] | null; agent: AgentState | null };
    faces(path: string): FaceFacts[];
    pointOnFace(path: string, face: number): { x: number; y: number } | null;
    camera(): { position: number[]; target: number[] };
  };
}
interface Playwright { chromium: { launch(options: { args: string[] }): Promise<Browser> } }
interface CallResult { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ type: string; text?: string }> }

function loadPlaywright(): Playwright | string {
  try {
    return createRequire(import.meta.url)("playwright") as Playwright;
  } catch {
    return "playwright is not installed on this machine (CI runners do not have it); the viewer and agent end-to-end test is skipped";
  }
}

test("a face clicked in the viewer reaches the agent over MCP, and the agent's highlight reaches the viewer", { timeout: 300_000 }, async (t) => {
  const pw = loadPlaywright();
  if (typeof pw === "string") return t.skip(pw);
  let browser: Browser;
  try {
    browser = await pw.chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  } catch (e) {
    return t.skip(`playwright is installed but Chromium did not start (${(e as Error).message.split("\n")[0]}); skipped`);
  }
  const root = mkdtempSync(join(tmpdir(), "o3j-view-agent-"));
  const shots = process.env.OPEN3DJ_VIEWER_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = (name: string) => join(shots ?? root, name);
  const scriptFile = join(root, "enclosure.o3j.js");
  copyFileSync(ENCLOSURE, scriptFile);
  const project = "enclosure.o3j";

  // The agent: open3dj mcp as agents start it, in its own process.
  const client = new Client({ name: "view-agent-e2e", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp", "--root", root, "--workers", "2"], cwd: root, stderr: "ignore" }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as CallResult;
    assert.notEqual(r.isError, true, `${name}: ${r.content[0]?.text?.slice(0, 800)}`);
    return r.structuredContent!;
  };
  const options: PoolOptions = { size: 2, log: () => {} };
  const pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root, version: "0.0.0", interactiveMs: 120_000 });
  let server: Awaited<ReturnType<typeof startViewServer>> | undefined;
  try {
    const run = await call("run", { project, script: readFileSync(scriptFile, "utf8"), detail: "detailed" });
    assert.equal(run.rev, "r_0001");
    // Nothing is selected yet.
    const none = await call("inspect", { project, fields: ["selection"] });
    assert.deepEqual((none.selection as ViewerSelection).items, []);
    assert.match(String((none.selection as ViewerSelection).note), /Nothing is selected/);

    // The person: open3dj view on the same project, in another process than the agent.
    server = await startViewServer({ handlers, root, project: join(root, project), script: scriptFile, log: () => {} });
    await server.ready;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message ?? String(e)));
    await page.goto(server.url);
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).document.documentElement.dataset.viewer === "ready", undefined, { timeout: 120_000 });

    // Click the lid's top face.
    const lidFaces = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.faces("lid"));
    const top = lidFaces.filter((f) => f.planar && (f.normal?.[2] ?? 0) > 0.99).sort((a, b) => b.centre[2]! - a.centre[2]!)[0]!;
    assert.ok(top, "the lid has an upward planar face");
    const at = await page.evaluate(([path, face]) => (globalThis as unknown as ViewerWindow).open3dj.pointOnFace(path, face), ["lid", top.face] as [string, number]);
    assert.ok(at, "a visible point on the lid top");
    await page.mouse.click(at.x, at.y);
    const address = `lid@elem:face:${top.face + 1}`;
    await page.waitForFunction((want) => ((globalThis as unknown as ViewerWindow).open3dj.state().shared ?? []).includes(want), address, { timeout: 20_000 });
    await page.screenshot({ path: shot("1-person-selects-lid-top.png") });

    // The agent reads it over MCP.
    const got = (await call("inspect", { project, fields: ["selection"] })).selection as ViewerSelection;
    assert.equal(got.rev, "r_0001");
    assert.equal(got.stale, false);
    const face = got.items.find((i) => i.kind === "face");
    assert.ok(face, JSON.stringify(got));
    assert.equal(face.address, address);
    assert.equal(face.path, "lid");
    assert.equal(face.def, "lid");
    assert.equal(face.element, `face:${top.face + 1}`);
    assert.ok((face.observed?.area_mm2 ?? 0) > 0, "observed area from the display mesh");
    assert.deepEqual(face.observed?.normal, [0, 0, 1]);

    // The agent points at that face and a screw; the viewer shows it and frames them.
    const tree = (await call("inspect", { project, fields: ["tree"] })).tree as Array<{ path: string; def: string }>;
    const screw = tree.find((n) => n.def === "screw")!.path;
    const camera = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.camera());
    const hl = await call("render", { project, view: "highlight", targets: [address, screw], note: "I will fillet this face; the screw stays clear" });
    assert.equal(hl.view, "highlight");
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).open3dj.state().agent?.shown === true, undefined, { timeout: 20_000 });
    // The highlight never moves the person's camera; Frame (or A) does.
    assert.deepEqual(await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.camera()), camera);
    const agent = (await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state())).agent!;
    assert.deepEqual(agent.targets, [address, screw]);
    assert.deepEqual(agent.tinted, [screw], "a face target fills the face and leaves its part untinted");
    assert.equal(agent.faces, 1, "the face is filled in the agent colour");
    assert.equal(agent.note, "I will fillet this face; the screw stays clear");
    const banner = await page.evaluate(() => (globalThis as unknown as ViewerWindow).document.getElementById("agent")?.textContent ?? "");
    assert.match(banner, /Pointed at in this project/);
    // The tree marks the targets' rows (and nothing else takes the banner's look).
    const marked = await page.evaluate(() => {
      const d = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ dataset: { path?: string } }> } }).document;
      return { rows: Array.from(d.querySelectorAll("#tree .agent-target")).map((e) => e.dataset.path).sort(), banners: d.querySelectorAll(".agent").length };
    });
    assert.deepEqual(marked, { rows: ["lid", screw].sort(), banners: 1 });
    assert.ok(banner.includes(address));
    await page.screenshot({ path: shot("2-agent-points-at-face-and-screw.png") });
    // A target in the banner is a button: it selects that part and frames it.
    await page.click(`#agent-targets button[data-target="${screw}"]`);
    await page.waitForFunction((want) => (globalThis as unknown as ViewerWindow).open3dj.state().selected.join() === want, screw, { timeout: 5_000 });
    assert.notDeepEqual(await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.camera()), camera, "the target button frames it");

    // The person dismisses it.
    await page.click("#agent-dismiss");
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).document.getElementById("agent")?.hidden === true, undefined, { timeout: 5_000 });
    assert.equal((await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state())).agent, null);
    await page.screenshot({ path: shot("3-dismissed.png") });

    // Clear: the agent sees nothing selected again.
    await page.click("#share-clear");
    await page.waitForFunction(() => ((globalThis as unknown as ViewerWindow).open3dj.state().shared ?? ["x"]).length === 0, undefined, { timeout: 10_000 });
    assert.deepEqual(((await call("inspect", { project, fields: ["selection"] })).selection as ViewerSelection).items, []);
    assert.deepEqual(errors, []);
  } finally {
    await client.close();
    await browser.close();
    await server?.close();
    handlers.shutdown();
    await pool.close();
    rmSync(root, { recursive: true, force: true });
  }
});
