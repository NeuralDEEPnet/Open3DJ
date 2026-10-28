// Browser smoke test of the viewer on examples/enclosure. It uses Playwright with Chromium when
// require("playwright") resolves on this machine and skips otherwise: CI runners do not have
// it, and the repository does not depend on it. WebGL runs on SwiftShader, which Chromium only
// allows with --enable-unsafe-swiftshader (headless tests only, never for people).
//
// Set OPEN3DJ_VIEWER_SHOTS to a folder to keep the screenshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, deviceInventory } from "@open3dj/compute";
import type { PoolOptions } from "@open3dj/compute";
import { createHandlers } from "@open3dj/mcp";
import { startViewServer } from "./view.ts";

const ENCLOSURE = fileURLToPath(new URL("../../../examples/enclosure/enclosure.o3j.js", import.meta.url));

// Playwright's types are not installed here; the few calls below are typed by hand.
interface Page {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
  locator(selector: string): { count(): Promise<number>; getAttribute(name: string): Promise<string | null> };
  mouse: { click(x: number, y: number): Promise<void> };
  screenshot(options: { path: string }): Promise<unknown>;
  on(event: string, fn: (e: { message?: string }) => void): void;
}
interface Browser { newPage(options: object): Promise<Page>; close(): Promise<void> }
/** What the page functions below touch. They run in the browser (Playwright passes functions, never strings, so the page CSP holds). */
interface ViewerWindow {
  document: { documentElement: { dataset: Record<string, string> }; getElementById(id: string): { textContent: string } | null };
  open3dj: { state(): { rev: string; renderer: string; parts: number; selected: string[] }; projectPath(path: string): { x: number; y: number } | null };
}
interface Playwright { chromium: { launch(options: { args: string[] }): Promise<Browser> } }

function loadPlaywright(): Playwright | string {
  try {
    return createRequire(import.meta.url)("playwright") as Playwright;
  } catch {
    return "playwright is not installed on this machine (CI runners do not have it); the viewer browser smoke test is skipped";
  }
}

test("the viewer shows examples/enclosure: 6 occurrences, and a click selects a screw", { timeout: 180_000 }, async (t) => {
  const pw = loadPlaywright();
  if (typeof pw === "string") return t.skip(pw);
  let browser: Browser;
  try {
    browser = await pw.chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  } catch (e) {
    return t.skip(`playwright is installed but Chromium did not start (${(e as Error).message.split("\n")[0]}); skipped`);
  }
  const dir = mkdtempSync(join(tmpdir(), "o3j-view-browser-"));
  const options: PoolOptions = { size: 2, log: () => {} };
  const pool = createPool(options);
  const handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root: dir, version: "0.0.0", interactiveMs: 120_000 });
  const script = join(dir, "enclosure.o3j.js");
  copyFileSync(ENCLOSURE, script);
  const server = await startViewServer({ handlers, root: dir, project: join(dir, "enclosure.o3j"), script, log: () => {} });
  try {
    await server.ready;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message ?? String(e)));
    await page.goto(server.url);
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).document.documentElement.dataset.viewer === "ready", null, { timeout: 120_000 });
    assert.deepEqual(errors, []);

    const state = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state());
    assert.equal(state.rev, "r_0001");
    assert.match(state.renderer, /^(WebGPU|WebGL2)$/);
    assert.equal(state.parts, 6);
    assert.equal(await page.locator('#tree [role="treeitem"][data-leaf="true"]').count(), 6);

    // Click the top of screw#2 in the 3D view: picking, not the tree, has to find it.
    const at = await page.evaluate((path) => (globalThis as unknown as ViewerWindow).open3dj.projectPath(path), "screw#2");
    assert.ok(at, "screw#2 is in the scene");
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).open3dj.state().selected.length === 1, null, { timeout: 10_000 });
    const picked = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state());
    assert.match(picked.selected[0]!, /^screw#\d$/);
    assert.equal(await page.locator(`#tree [data-path="${picked.selected[0]}"]`).getAttribute("aria-selected"), "true");
    const measure = await page.evaluate(() => (globalThis as unknown as ViewerWindow).document.getElementById("measure")?.textContent ?? "");
    assert.match(measure, /Screw/);
    assert.match(measure, /mm³/);

    const shots = process.env.OPEN3DJ_VIEWER_SHOTS;
    const out = shots ? join(shots, "enclosure-selected.png") : join(dir, "enclosure-selected.png");
    if (shots) mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: out });
  } finally {
    await browser.close();
    await server.close();
    handlers.shutdown();
    await pool.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
