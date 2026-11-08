// open3dj view server: the one-time link and the session cookie, the Host and Origin checks,
// path traversal, the GLB route and the revision stream, on the real compute pool and handlers
// (no browser needed).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, deviceInventory } from "@open3dj/compute";
import type { Pool, PoolOptions } from "@open3dj/compute";
import { createHandlers } from "@open3dj/mcp";
import type { ToolHandlers } from "@open3dj/mcp";
import { parseCommand } from "./args.ts";
import { openBrowser, startViewServer } from "./view.ts";
import type { ViewServer } from "./view.ts";
import { NAVIGATE, login, send, sessionCookie } from "./view-login.testing.ts";
import type { Answer } from "./view-login.testing.ts";

const NONCE = "test-nonce-0123456789abcdef";
const script = (h: number) => `return [
  { name: "block", shape: box(20, 10, ${h}), color: "#3366cc" },
  { name: "tab", shape: box(10, 10, 4).translate(30, 0, 0) },
];
`;

let dir: string;
let pool: Pool;
let handlers: ToolHandlers;
let server: ViewServer;
let scriptFile: string;
/** The session cookie from the printed link, as a Cookie header. */
let cookie: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "o3j-view-"));
  scriptFile = join(dir, "part.o3j.js");
  writeFileSync(scriptFile, script(5));
  const options: PoolOptions = { size: 2, log: () => {} };
  pool = createPool(options);
  handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root: dir, version: "0.0.0", interactiveMs: 120_000 });
  server = await startViewServer({ handlers, root: dir, project: join(dir, "part.o3j"), script: scriptFile, nonce: NONCE, debounceMs: 50, pollMs: 100, log: () => {} });
  await server.ready;
  cookie = await login(server);
});

after(async () => {
  await server?.close();
  handlers?.shutdown();
  await pool?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A request with the session cookie (unless headers name another cookie). */
const get = (path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> => send(server, path, method, { cookie, ...headers });
/** A request without a cookie. */
const anon = (path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> => send(server, path, method, headers);
const linkPath = (url: string) => new URL(url).pathname;

test("the printed URL is a one-time link, the server listens on 127.0.0.1 only, and the cookie is named after the port", () => {
  assert.equal(server.url, `http://127.0.0.1:${server.port}/${NONCE}/`);
  assert.equal(server.nonce, NONCE);
  assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
  assert.equal(server.cookieName, `o3j_${server.port}`);
});

test("a one-time link answers a page that sets a host-only HttpOnly, SameSite=Strict cookie and moves to / without a redirect", async () => {
  const r = await anon(linkPath(server.newLink()), NAVIGATE);
  assert.equal(r.status, 200, r.body.toString());
  const set = r.headers["set-cookie"];
  assert.ok(Array.isArray(set) && set.length === 1, String(set));
  assert.match(set[0]!, new RegExp(`^o3j_${server.port}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/$`), "32 random bytes; no Domain (host-only), no Max-Age (ends with the browser session), no Secure on plain HTTP");
  assert.equal(r.headers.location, undefined, "no 30x: a Strict cookie set during a cross-site navigation is not sent on its redirect");
  assert.match(String(r.headers["content-type"]), /^text\/html/);
  const html = r.body.toString();
  assert.match(html, /<meta http-equiv="refresh" content="0;url=\/">/);
  assert.doesNotMatch(html, /<script|test-nonce/i, "no script, and the page does not repeat a nonce");
  assert.match(String(r.headers["content-security-policy"]), /^default-src 'none'/);
  assert.equal(r.headers["referrer-policy"], "no-referrer", "the move to / does not send the link as a Referer");
  assert.equal(r.headers["cache-control"], "no-store");
  // The cookie it set opens the page at the root path.
  const page = await anon("/", { cookie: sessionCookie(server, r)! });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /<script type="importmap">/);
  // A safe query (a renderer or quality switch) moves along; anything else is dropped.
  const q = await anon(`${linkPath(server.newLink())}?renderer=webgl&dpr=1.5`, NAVIGATE);
  assert.match(q.body.toString(), /content="0;url=\/\?renderer=webgl&amp;dpr=1\.5"/);
  const bad = await anon(`${linkPath(server.newLink())}?x="><script>alert(1)</script>`, NAVIGATE);
  assert.equal(bad.status, 200);
  assert.match(bad.body.toString(), /content="0;url=\/"/);
  assert.doesNotMatch(bad.body.toString(), /alert/);
  // Without the last slash it is the same link.
  const bare = await anon(linkPath(server.newLink()).slice(0, -1), NAVIGATE);
  assert.equal(bare.status, 200);
  assert.ok(sessionCookie(server, bare));
});

test("a one-time link works once: reuse answers 410, an unknown link 404, and the browser that used it goes back to /", async () => {
  const link = linkPath(server.newLink());
  const mine = await login(server, `${server.origin}${link}`);
  const again = await anon(link, NAVIGATE);
  assert.equal(again.status, 410);
  assert.equal(again.body.toString().trim(), "this one-time link was already used; run open3dj view again or use 'Open in another browser' on the page");
  assert.equal(again.headers["set-cookie"], undefined);
  // The printed link, used in before(), is spent too.
  assert.equal((await anon(`/${NONCE}/`, NAVIGATE)).status, 410);
  // The same browser (it sends its cookie) is sent back to the page, with no new cookie.
  const back = await anon(link, { ...NAVIGATE, cookie: mine });
  assert.equal(back.status, 200);
  assert.equal(back.headers["set-cookie"], undefined);
  assert.match(back.body.toString(), /content="0;url=\/"/);
  // A link the server never made is a plain 404, as is a near miss of a real one.
  for (const path of [`/${NONCE.slice(0, -1)}x/`, "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", `/${link.slice(1, -2)}/`]) {
    const r = await anon(path, NAVIGATE);
    assert.equal(r.status, 404, path);
    assert.equal(r.body.toString().trim(), "not found", path);
  }
});

test("the link takes a navigation only: cross-site or none need Sec-Fetch-Mode navigate, and a refusal does not use it up", async () => {
  const link = linkPath(server.newLink());
  const refused: Array<[string, Record<string, string>, string, number]> = [
    ["a cross-site fetch", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }, "GET", 403],
    ["a cross-site image", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" }, "GET", 403],
    ["a fetch with Sec-Fetch-Site none", { "sec-fetch-site": "none", "sec-fetch-mode": "cors" }, "GET", 403],
    ["a frame", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }, "GET", 403],
    ["a same-site page (another port on 127.0.0.1)", { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }, "GET", 403],
    ["an unknown Sec-Fetch-Site", { "sec-fetch-site": "elsewhere", "sec-fetch-mode": "navigate" }, "GET", 403],
    ["a foreign Origin", { ...NAVIGATE, origin: "http://evil.example" }, "GET", 403],
    ["a foreign Host", { ...NAVIGATE, host: "evil.example" }, "GET", 403],
    ["a rebinding Host", { ...NAVIGATE, host: `127.0.0.1.nip.io:${server.port}` }, "GET", 403],
    ["HEAD", NAVIGATE, "HEAD", 405],
    ["POST", NAVIGATE, "POST", 405],
    ["PUT", NAVIGATE, "PUT", 405],
  ];
  for (const [why, headers, method, status] of refused) {
    const r = await anon(link, headers, method);
    assert.equal(r.status, status, `${why}: ${r.status} ${r.body.toString().trim()}`);
    assert.equal(r.headers["set-cookie"], undefined, why);
  }
  // The same link still works as a cross-site navigation: the redirect file openBrowser writes is a file:// page.
  const ok = await anon(link, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
  assert.equal(ok.status, 200, ok.body.toString());
  assert.ok(sessionCookie(server, ok));
  // A client that sends no Sec-Fetch headers (an older browser) logs in too.
  assert.equal((await anon(linkPath(server.newLink()))).status, 200);
});

test("every route needs the cookie: without it, with another value or under another port's name the answer is a plain 404", async () => {
  const value = cookie.slice(cookie.indexOf("=") + 1);
  const wrong: Array<Record<string, string>> = [
    {},
    { cookie: `${server.cookieName}=${"A".repeat(43)}` },
    { cookie: `o3j_${server.port + 1}=${value}` },
    { cookie: `${server.cookieName}x=${value}` },
    { cookie: `${server.cookieName}=${value}x` },
  ];
  for (const headers of wrong) {
    for (const path of ["/", "/api/model", "/api/events", "/api/selection", "/app/main.js", "/vendor/three.module.js", `/${NONCE}/api/model`, "/api/rev/r_0001/model.glb"]) {
      const r = await anon(path, headers);
      assert.equal(r.status, 404, `${path} ${JSON.stringify(headers)}`);
      assert.equal(r.body.toString().trim(), "not found", path);
    }
  }
  // Other cookies around it (another viewer's, another site's) do not get in the way.
  const page = await anon("/", { cookie: `o3j_${server.port + 1}=other; ${cookie}; theme=dark` });
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-type"]), /text\/html/);
  assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
  assert.equal(page.headers["access-control-allow-origin"], undefined);
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(page.body.toString(), /<script type="importmap">/);
});

test("a wrong Host, a foreign Origin, a cross-site fetch and writes are refused", async () => {
  for (const host of ["evil.example", `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `127.0.0.1.nip.io:${server.port}`]) {
    const r = await get("/api/model", { host });
    assert.equal(r.status, 403, `host ${host}`);
  }
  assert.equal((await get("/api/model", { host: `localhost:${server.port}` })).status, 200);
  for (const origin of ["http://evil.example", `http://127.0.0.1:${server.port + 1}`, "null", `https://127.0.0.1:${server.port}`]) {
    const r = await get("/api/model", { origin });
    assert.equal(r.status, 403, `origin ${origin}`);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
  assert.equal((await get("/api/model", { origin: `http://127.0.0.1:${server.port}` })).status, 200);
  assert.equal((await get("/api/model", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await get("/api/model", { "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await get("/api/model", { "sec-fetch-site": "same-origin" })).status, 200);
  // Only the one-time link takes a cross-site navigation; the page itself does not.
  assert.equal((await get("/", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).status, 403);
  assert.equal((await get("/", NAVIGATE)).status, 200, "a typed or bookmarked URL (Sec-Fetch-Site none) with the cookie");
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const r = await get("/api/model", {}, method);
    assert.equal(r.status, 405, method);
  }
});

test("path traversal never reaches a file outside the viewer assets", async () => {
  const attempts = [
    "/../package.json",
    "/app/../../package.json",
    "/app/..%2f..%2fpackage.json",
    "/app/%2e%2e/%2e%2e/package.json",
    "/vendor/..%2F..%2F..%2Fpackage.json",
    "/vendor/three.module.js%00.css",
    "/app/..\\..\\package.json",
    "/app/index.html",
    "/part.o3j.js",
    "/part.o3j/project.o3j.json",
    "/api/rev/..%2f..%2fpart.o3j.js/model.glb",
    "/api/rev/r_0001%2f..%2f..%2fpart.o3j.js/model.glb",
    "/%E0%A4%A",
    `/${NONCE}/../package.json`,
    "//etc/passwd",
  ];
  for (const path of attempts) {
    const r = await get(path);
    assert.ok([400, 404].includes(r.status), `${path} answered ${r.status}`);
    assert.doesNotMatch(r.body.toString(), /"name"|box\(|"o3j"/, path);
  }
  const css = await get("/app/viewer.css");
  assert.equal(css.status, 200);
  assert.match(String(css.headers["content-type"]), /text\/css/);
  const three = await get("/vendor/three.module.js");
  assert.equal(three.status, 200);
  assert.match(String(three.headers["content-type"]), /javascript/);
});

test("the three.js add-ons are served at their nested paths, with the cookie, and cannot climb out", async () => {
  for (const path of ["vendor/addons/lines/LineSegments2.js", "vendor/addons/lines/webgpu/LineSegments2.js", "vendor/addons/lines/LineSegmentsGeometry.js", "vendor/addons/lines/LineMaterial.js", "vendor/addons/environments/RoomEnvironment.js", "app/faces.js", "app/tools.js"]) {
    const ok = await get(`/${path}`);
    assert.equal(ok.status, 200, path);
    assert.match(String(ok.headers["content-type"]), /javascript/, path);
    assert.equal((await anon(`/${path}`)).status, 404, `${path} without the cookie`);
    assert.equal((await get(`/${path}`, { host: "evil.example" })).status, 403, `${path} with a foreign Host`);
    assert.equal((await get(`/${path}`, { origin: "http://evil.example" })).status, 403, `${path} with a foreign Origin`);
  }
  for (const path of [
    "/vendor/addons/lines/../../../package.json",
    "/vendor/addons/lines/..%2f..%2f..%2fpackage.json",
    "/vendor/addons/lines/webgpu/%2e%2e/%2e%2e/%2e%2e/build/three.cjs",
    "/vendor/addons/lines/Wireframe.js",
    "/vendor/addons/controls/TransformControls.js",
    "/vendor/addons/lines/LineSegments2.js%00.css",
  ]) {
    const r = await get(path);
    assert.ok([400, 404].includes(r.status), `${path} answered ${r.status}`);
  }
});

test("the model JSON carries the kernel's face count per definition, which face addresses depend on", async () => {
  const m = JSON.parse((await get("/api/model")).body.toString()) as { parts: Array<{ def: string; counts?: { faces?: number } }> };
  assert.ok(m.parts.length > 0);
  for (const p of m.parts) assert.equal(typeof p.counts?.faces, "number", `${p.def} has a face count`);
});

test("the model JSON lists the tree and the report, and the GLB route returns binary glTF", async () => {
  const m = await get("/api/model");
  assert.equal(m.status, 200);
  const model = JSON.parse(m.body.toString()) as { rev: string; head: string; tree: Array<{ path: string }>; parts: unknown[]; glb: string; run: { state: string } };
  assert.equal(model.rev, "r_0001");
  assert.equal(model.head, "r_0001");
  assert.deepEqual(model.tree.map((t) => t.path).sort(), ["block", "tab"]);
  assert.equal(model.parts.length, 2);
  assert.equal(model.run.state, "done");
  assert.equal(model.glb, "api/rev/r_0001/model.glb");

  const glb = await get(`/${model.glb}`);
  assert.equal(glb.status, 200);
  assert.equal(glb.headers["content-type"], "model/gltf-binary");
  assert.equal(glb.body.subarray(0, 4).toString("latin1"), "glTF");
  assert.equal(glb.body.readUInt32LE(4), 2);
  assert.equal(glb.body.readUInt32LE(8), glb.body.length);

  assert.equal((await get("/api/rev/r_0099/model.glb")).status, 404);
  assert.equal((await get("/api/rev/latest/model.glb")).status, 404);
  const head = await get("/api/rev/r_0001/model.glb", {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test("the event stream announces a new revision after the script is saved", async () => {
  const events: string[] = [];
  let resolveRev: (rev: string) => void;
  const announced = new Promise<string>((r) => (resolveRev = r));
  const req = request({ host: "127.0.0.1", port: server.port, path: "/api/events", headers: { host: `127.0.0.1:${server.port}`, cookie } }, (res) => {
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /text\/event-stream/);
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buf += chunk;
      let at: number;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!event) continue;
        events.push(event);
        if (event === "hello") {
          assert.equal((JSON.parse(data!) as { rev: string }).rev, "r_0001");
          // Save a change, as an editor would.
          writeFileSync(scriptFile, script(9));
        }
        if (event === "revision") resolveRev((JSON.parse(data!) as { rev: string }).rev);
      }
    });
  });
  req.end();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no revision event; saw ${events.join(", ")}`)), 60_000).unref());
  try {
    assert.equal(await Promise.race([announced, timeout]), "r_0002");
  } finally {
    req.destroy();
  }
  assert.ok(events.indexOf("run") > events.indexOf("hello"), events.join(", "));
  const model = JSON.parse((await get("/api/model")).body.toString()) as { rev: string; parts: Array<{ def: string; bbox: { max: number[] } }> };
  assert.equal(model.rev, "r_0002");
  assert.equal(model.parts.find((p) => p.def === "block")?.bbox.max[2], 9);
});

test("a script error keeps the last revision and is reported on the stream", async () => {
  writeFileSync(scriptFile, "const a = box(1, 1, 1);\nthrow new Error('broken on purpose');\n");
  await server.rerun();
  const model = JSON.parse((await get("/api/model")).body.toString()) as { rev: string; run: { state: string; error?: { code: string; line?: number } } };
  assert.equal(model.rev, "r_0002");
  assert.equal(model.run.state, "error");
  assert.equal(model.run.error?.code, "SCRIPT_RUNTIME");
  assert.equal(model.run.error?.line, 2);
});

test("open3dj view parses its flags", () => {
  const c = parseCommand(["view", "part.o3j.js", "--port", "8123", "--no-open", "--param", "w=3"]).command;
  assert.deepEqual(c, { cmd: "view", source: { kind: "script", path: "part.o3j.js", project: "part.o3j" }, params: { w: 3 }, saveParams: true, syncScript: true, open: false, port: 8123 });
  const d = parseCommand(["view", "part.o3j", "--no-save-params"]).command;
  assert.deepEqual(d, { cmd: "view", source: { kind: "project", project: "part.o3j" }, params: {}, saveParams: false, syncScript: true, open: true });
  const e = parseCommand(["view", "part.o3j.js", "--no-sync-script"]).command;
  assert.ok(e.cmd === "view" && e.syncScript === false);
  assert.throws(() => parseCommand(["view", "part.o3j", "--port", "70000"]), /0 to 65535/);
  assert.throws(() => parseCommand(["view"]), /view needs a script or project/);
});

// Regression (review round 1): the nonce URL went to xdg-open, open or rundll32 as an
// argument, and any local account can read a process's argv (/proc/<pid>/cmdline, mode 444).
// The launcher now gets a private file that redirects to the URL; the nonce is never in argv.
test("openBrowser never puts the nonce in the launcher's argv", () => {
  const nonce = "PQ86anRsAX7w-y0Ustb1BkoA-Eg3nwLr";
  const url = `http://127.0.0.1:47414/${nonce}/`;
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fake = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { on: () => {}, unref: () => {} };
  };
  const opened = openBrowser(url, () => {}, fake);
  try {
    assert.equal(calls.length, 1);
    const argv = [calls[0]!.cmd, ...calls[0]!.args].join(" ");
    assert.ok(!argv.includes(nonce), argv);
    const file = calls[0]!.args.at(-1)!.replace(/^file:\/\//, "");
    assert.ok(existsSync(opened.file) && file.endsWith(opened.file.split(/[\\/]/).at(-1)!), `${argv} / ${opened.file}`);
    assert.ok(readFileSync(opened.file, "utf8").includes(url), "the file redirects to the URL");
    if (process.platform !== "win32") {
      assert.equal(statSync(opened.file).mode & 0o777, 0o600, "only the owner can read the file");
      assert.equal(statSync(join(opened.file, "..")).mode & 0o777, 0o700, "in a private folder");
    }
  } finally {
    opened.cleanup();
  }
  assert.ok(!existsSync(opened.file), "cleanup removes the file");
});

test("an agent's parameter values survive a comment-only save, and a save that drops them is a visible warning", async () => {
  const d = mkdtempSync(join(tmpdir(), "o3j-view-params-"));
  const file = join(d, "box.o3j.js");
  const src = (depth: number, note = "") => `const D = Param.number("Depth", ${depth}, { min: 10, max: 200, unit: "mm" });\nreturn { name: "box", shape: box(40, D, 10) };\n${note}`;
  writeFileSync(file, src(70));
  const h = createHandlers({ pool, inventory: deviceInventory({ pool: { size: 2, log: () => {} } }), root: d, version: "0.0.0", interactiveMs: 120_000 });
  const runs: Array<{ status?: string; warnings?: string[] }> = [];
  const s = await startViewServer({ handlers: h, root: d, project: join(d, "box.o3j"), script: file, nonce: NONCE, debounceMs: 50, pollMs: 100, log: () => {}, onRun: (run) => runs.push(run as { status?: string; warnings?: string[] }) });
  try {
    await s.ready;
    const session = await login(s);
    const fetchModel = async () => {
      const r = await send(s, "/api/model", "GET", { cookie: session });
      return JSON.parse(r.body.toString()) as { rev: string; report: { status: string; warnings?: string[] }; parts: Array<{ bbox: { min: number[]; max: number[] } }>; run: { status?: string; warnings?: string[] } };
    };
    // An agent sets Depth over MCP, in the same project.
    const agent = await h.run({ project: join(d, "box.o3j"), ops: [{ op: "set_param", name: "Depth", value: 110 }] });
    assert.equal(agent.status, "ok", JSON.stringify(agent.error));
    // The designer adds only a comment: the agent's value stays.
    writeFileSync(file, src(70, "// designer note\n"));
    await s.rerun();
    let m = await fetchModel();
    assert.equal(m.parts[0]!.bbox.max[1]! - m.parts[0]!.bbox.min[1]!, 110, "a comment-only change keeps the stored Depth");
    assert.equal(m.report.status, "ok");
    // The designer changes the default: the stored value is dropped, and the page says so.
    writeFileSync(file, src(80, "// designer note\n"));
    await s.rerun();
    m = await fetchModel();
    assert.equal(m.parts[0]!.bbox.max[1]! - m.parts[0]!.bbox.min[1]!, 80);
    assert.equal(m.report.status, "warning", "the stored revision says warning, so inspect and api/model show it later");
    assert.ok(m.report.warnings?.some((w) => /stored values of Depth/.test(w)), JSON.stringify(m.report.warnings));
    assert.equal(m.run.status, "warning");
    assert.ok(m.run.warnings?.some((w) => /stored values of Depth/.test(w)), JSON.stringify(m.run));
    assert.ok(runs.at(-1)?.warnings?.some((w) => /stored values of Depth/.test(w)), "the terminal log gets the warning text");
  } finally {
    await s.close();
    h.shutdown();
    rmSync(d, { recursive: true, force: true });
  }
});
