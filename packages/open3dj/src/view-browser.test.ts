// Browser smoke test of the viewer on examples/enclosure. It uses Playwright with Chromium when
// require("playwright") resolves on this machine and skips otherwise: CI runners do not have
// it, and the repository does not depend on it. WebGL runs on SwiftShader, which Chromium only
// allows with --enable-unsafe-swiftshader (headless tests only, never for people).
//
// Set OPEN3DJ_VIEWER_SHOTS to a folder to keep the screenshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPool, deviceInventory } from "@open3dj/compute";
import type { PoolOptions } from "@open3dj/compute";
import { createHandlers } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
import { openBrowser, startViewServer } from "./view.ts";
import { openPage } from "./view-login.testing.ts";

const ENCLOSURE = fileURLToPath(new URL("../../../examples/enclosure/enclosure.o3j.js", import.meta.url));

// Playwright's types are not installed here; the few calls below are typed by hand.
interface Response { url(): string; status(): number; text(): Promise<string>; request(): { allHeaders(): Promise<Record<string, string>> } }
interface Cookie { name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean; sameSite: string; expires: number }
interface Page {
  goto(url: string): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  waitForResponse(fn: (r: Response) => boolean, options?: { timeout: number }): Promise<Response>;
  waitForURL(url: string, options?: { timeout: number }): Promise<void>;
  context(): { cookies(): Promise<Cookie[]> };
  click(selector: string): Promise<void>;
  inputValue(selector: string): Promise<string>;
  close(): Promise<void>;
  waitForFunction(fn: () => boolean, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
  locator(selector: string): { count(): Promise<number>; getAttribute(name: string): Promise<string | null> };
  mouse: { click(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
  focus(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  on(event: string, fn: (e: { message?: string }) => void): void;
}
interface Browser { newPage(options: object): Promise<Page>; close(): Promise<void> }
/** What the page functions below touch. They run in the browser (Playwright passes functions, never strings, so the page CSP holds). */
interface FaceFacts { face: number; address: string | null; area: number; planar: boolean; normal?: number[]; centre: number[] }
interface ViewerWindow {
  document: {
    documentElement: { dataset: Record<string, string> };
    getElementById(id: string): { textContent: string; hidden: boolean; scrollTop: number; querySelector(s: string): { scrollTop: number } | null } | null;
    querySelector(s: string): { getAttribute(name: string): string | null } | null;
    activeElement: { id: string } | null;
    dispatchEvent(e: unknown): boolean;
  };
  KeyboardEvent: new (type: string, init: object) => unknown;
  open3dj: {
    state(): { rev: string; renderer: string; parts: number; selected: string[]; elements: Array<{ address: string | null; text: string }> };
    projectPath(path: string): { x: number; y: number } | null;
    faces(path: string): FaceFacts[];
    pointOnFace(path: string, face: number): { x: number; y: number } | null;
    tools(options: object): { section: { axis: string } | null; explode: number; overlay: Record<string, number> | null };
    perf(): { frames: number; drawCalls: number; scene: { addressedDefinitions: number; definitions: number } };
  };
}
interface Playwright { chromium: { launch(options: { args: string[] }): Promise<Browser> } }

function loadPlaywright(): Playwright | string {
  try {
    return createRequire(import.meta.url)("playwright") as Playwright;
  } catch {
    return "playwright is not installed on this machine (CI runners do not have it); the viewer browser smoke test is skipped";
  }
}

/** Handlers with no kernel: every run fails at once, so the project has no revision. Enough to serve the page. */
function noKernel(): ToolHandlers {
  const failed = async () => ({ status: "error", error: { code: "INTERNAL_ERROR", message: "no kernel in this test" }, compute: { backend: "none", device: "daemon", placement_reason: "test" } });
  return { run: failed, inspect: failed, export: failed, render: failed, docs: failed, shutdown: () => {} } as unknown as ToolHandlers;
}

// Regression (RFC 0001, plan step B1): openBrowser opens a private file:// page that redirects
// to the one-time link. Chromium sends that navigation with Sec-Fetch-Site: cross-site (a file
// page has an opaque origin), and the server refused every cross-site request with 403, so the
// automatic open showed "refused: cross-site request" instead of the viewer. Seen on 2026-11-08
// with Chromium 153 (headless) through Playwright 1.63.
test("the automatic browser open reaches the page: the redirect file's cross-site navigation trades the one-time link for a cookie", { timeout: 60_000 }, async (t) => {
  const pw = loadPlaywright();
  if (typeof pw === "string") return t.skip(pw);
  let browser: Browser;
  try {
    browser = await pw.chromium.launch({ args: [] });
  } catch (e) {
    return t.skip(`playwright is installed but Chromium did not start (${(e as Error).message.split("\n")[0]}); skipped`);
  }
  const dir = mkdtempSync(join(tmpdir(), "o3j-view-open-"));
  const script = join(dir, "open.o3j.js");
  writeFileSync(script, "return { name: \"b\", shape: box(1, 1, 1) };\n");
  const server = await startViewServer({ handlers: noKernel(), root: dir, project: join(dir, "open.o3j"), script, log: () => {} });
  // The launcher is faked: it only records the file it was given, as xdg-open, open or rundll32 would get it.
  let target = "";
  const opened = openBrowser(server.url, () => {}, (_cmd, args) => {
    target = args.at(-1)!;
    return { on: () => {}, unref: () => {} };
  });
  try {
    await server.ready;
    const origin = `http://127.0.0.1:${server.port}`;
    const page = await browser.newPage({});
    const exchange = page.waitForResponse((r) => r.url().startsWith(origin), { timeout: 20_000 });
    await page.goto(target.startsWith("file:") ? target : pathToFileURL(target).href);
    const first = await exchange;
    const sent = await first.request().allHeaders();
    assert.equal(first.url(), server.url);
    // The bounce page is navigated away from at once, so its body is read only on a failure.
    if (first.status() !== 200) assert.fail(`the one-time link answered ${first.status()} (${(await first.text().catch(() => "")).trim()}) to a navigation with Sec-Fetch-Site: ${sent["sec-fetch-site"]}, Sec-Fetch-Mode: ${sent["sec-fetch-mode"]}`);
    // The bounce page moves to the root path, without the nonce, and the viewer loads there.
    await page.waitForURL(`${origin}/`, { timeout: 20_000 });
    assert.equal(await page.title(), "open - Open3DJ viewer");
    const cookies = (await page.context().cookies()).filter((c) => c.name === `o3j_${server.port}`);
    assert.equal(cookies.length, 1, "one session cookie for this port");
    assert.deepEqual({ domain: cookies[0]!.domain, path: cookies[0]!.path, httpOnly: cookies[0]!.httpOnly, sameSite: cookies[0]!.sameSite }, { domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" });
    assert.match(cookies[0]!.value, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  } finally {
    opened.cleanup();
    await browser.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the viewer shows examples/enclosure: 6 occurrences, a click selects a screw, and a click on a face gives its element address", { timeout: 180_000 }, async (t) => {
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
    await openPage(page, server);
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

    // Element addresses: every definition's faces line up with the kernel's face count.
    const perf = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.perf());
    assert.equal(perf.scene.addressedDefinitions, perf.scene.definitions);
    // Click the lid's top face (the highest planar face that looks up) and read its address.
    const lidFaces = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.faces("lid"));
    const top = lidFaces.filter((f) => f.planar && (f.normal?.[2] ?? 0) > 0.99).sort((a, b) => b.centre[2]! - a.centre[2]!)[0];
    assert.ok(top, "the lid has an upward planar face");
    assert.equal(top.centre[2], 36, "the lid top is at z = 36 mm, as in the report's bounding box");
    const onFace = await page.evaluate(([path, face]) => (globalThis as unknown as ViewerWindow).open3dj.pointOnFace(path, face), ["lid", top.face] as [string, number]);
    assert.ok(onFace, "a visible point on the lid top");
    await page.mouse.click(onFace.x, onFace.y);
    await page.waitForFunction(() => (globalThis as unknown as ViewerWindow).open3dj.state().elements.length === 1, null, { timeout: 10_000 });
    const element = (await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state())).elements[0]!;
    assert.equal(element.address, `lid@elem:face:${top.face + 1}`);
    const faceCount = Number(/(\d+) faces/.exec(await page.evaluate(() => (globalThis as unknown as ViewerWindow).document.getElementById("measure")?.textContent ?? ""))?.[1]);
    assert.equal(lidFaces.length, faceCount, "as many faces as the kernel counts for the lid");
    assert.ok(top.face + 1 <= faceCount);

    // The view tools run without errors: section, explode and the overhang preview.
    const applied = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.tools({ section: { axis: "y", t: 0.5 }, explode: 0.6, overlay: { kind: "overhang", limitDeg: 45 } }));
    assert.equal(applied.section?.axis, "y");
    assert.equal(applied.explode, 0.6);
    assert.ok((applied.overlay?.bed ?? 0) > 0, "the base and the screws' undersides rest on the bed");
    assert.deepEqual(errors, []);

    // A click on a section cap selects the part that was cut, not a face hidden behind the cap.
    await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.tools({ section: { axis: "z", at: 30 }, explode: 0, overlay: null }));
    await page.keyboard.press("2");
    await page.waitForTimeout(1200);
    for (const screw of ["screw#1", "screw#3"]) {
      const cap = await page.evaluate((path) => (globalThis as unknown as ViewerWindow).open3dj.projectPath(path), screw);
      assert.ok(cap, `${screw} is in the scene`);
      await page.mouse.click(cap.x, cap.y);
      await page.waitForTimeout(150);
      const s = await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state());
      assert.deepEqual(s.selected, [screw], `a click on the cap of ${screw} selected ${JSON.stringify(s.selected)} ${JSON.stringify(s.elements)}`);
      assert.deepEqual(s.elements.map((e) => e.address), [], "a cap has no face address");
    }

    // Shortcuts work after a slider or a checkbox had focus, and they follow Shift, not the letter case.
    const pressed = (action: string) => page.evaluate((a) => (globalThis as unknown as ViewerWindow).document.querySelector(`[data-action="${a}"]`)?.getAttribute("aria-pressed") ?? null, action);
    await page.focus("#explode");
    await page.keyboard.press("x");
    assert.equal(await pressed("xray"), "true", "X toggles x-ray while the explode slider has focus");
    await page.keyboard.press("x");
    await page.focus("#share-on");
    await page.keyboard.press("Escape");
    assert.deepEqual((await page.evaluate(() => (globalThis as unknown as ViewerWindow).open3dj.state())).selected, [], "Esc clears the selection while a checkbox has focus");
    assert.equal(await pressed("section"), "true");
    // Caps Lock: "S" without Shift is the section key, not the screenshot.
    await page.evaluate(() => {
      const w = globalThis as unknown as ViewerWindow;
      w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "S", shiftKey: false, bubbles: true }));
    });
    assert.equal(await pressed("section"), "false", "S with Caps Lock turns the section off");

    // The help opens at the top, with the focus on its heading.
    await page.keyboard.press("?");
    const help = await page.evaluate(() => {
      const d = (globalThis as unknown as ViewerWindow).document;
      return { hidden: d.getElementById("help")?.hidden, top: d.getElementById("help")?.querySelector(".card")?.scrollTop, focus: d.activeElement?.id };
    });
    assert.deepEqual(help, { hidden: false, top: 0, focus: "help-title" });
    // "Open in another browser", in the help, shows a new one-time link that logs a second browser in.
    await page.click("#link-new");
    await page.waitForFunction(() => /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/$/.test((globalThis as unknown as { document: { getElementById(id: string): { value: string } | null } }).document.getElementById("link-url")?.value ?? ""), undefined, { timeout: 10_000 });
    const link = await page.inputValue("#link-url");
    const other = await browser.newPage({});
    try {
      await other.goto(link);
      await other.waitForURL(`${server.origin}/`, { timeout: 20_000 });
      assert.equal(await other.title(), "enclosure - Open3DJ viewer");
    } finally {
      await other.close();
    }
    await page.focus("#help-title");
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);

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
