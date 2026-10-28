// open3dj view server: the nonce, Host and Origin checks, path traversal, the GLB route and the
// revision stream, on the real compute pool and handlers (no browser needed).
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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "o3j-view-"));
  scriptFile = join(dir, "part.o3j.js");
  writeFileSync(scriptFile, script(5));
  const options: PoolOptions = { size: 2, log: () => {} };
  pool = createPool(options);
  handlers = createHandlers({ pool, inventory: deviceInventory({ pool: options }), root: dir, version: "0.0.0", interactiveMs: 120_000 });
  server = await startViewServer({ handlers, root: dir, project: join(dir, "part.o3j"), script: scriptFile, nonce: NONCE, debounceMs: 50, pollMs: 100, log: () => {} });
  await server.ready;
});

after(async () => {
  await server?.close();
  handlers?.shutdown();
  await pool?.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Answer { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

/** A raw request: the path goes out exactly as given (no URL normalisation). */
function get(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, method, headers: { host: `127.0.0.1:${server.port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the URL carries the nonce and the server listens on 127.0.0.1 only", () => {
  assert.equal(server.url, `http://127.0.0.1:${server.port}/${NONCE}/`);
  assert.equal(server.nonce, NONCE);
});

test("every route needs the nonce", async () => {
  for (const path of ["/", "/api/model", "/app/main.js", `/${NONCE.slice(0, -1)}x/`, `/${NONCE}x/api/model`, "/vendor/three.module.js"]) {
    const r = await get(path);
    assert.equal(r.status, 404, path);
    assert.doesNotMatch(r.body.toString(), /enclosure|block|three/i, path);
  }
  const page = await get(`/${NONCE}/`);
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-type"]), /text\/html/);
  assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
  assert.equal(page.headers["access-control-allow-origin"], undefined);
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(page.body.toString(), /<script type="importmap">/);
  const bare = await get(`/${NONCE}`);
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.location, `/${NONCE}/`);
});

test("a wrong Host, a foreign Origin, a cross-site fetch and writes are refused", async () => {
  for (const host of ["evil.example", `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `127.0.0.1.nip.io:${server.port}`]) {
    const r = await get(`/${NONCE}/api/model`, { host });
    assert.equal(r.status, 403, `host ${host}`);
  }
  assert.equal((await get(`/${NONCE}/api/model`, { host: `localhost:${server.port}` })).status, 200);
  for (const origin of ["http://evil.example", `http://127.0.0.1:${server.port + 1}`, "null", `https://127.0.0.1:${server.port}`]) {
    const r = await get(`/${NONCE}/api/model`, { origin });
    assert.equal(r.status, 403, `origin ${origin}`);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
  assert.equal((await get(`/${NONCE}/api/model`, { origin: `http://127.0.0.1:${server.port}` })).status, 200);
  assert.equal((await get(`/${NONCE}/api/model`, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await get(`/${NONCE}/api/model`, { "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await get(`/${NONCE}/api/model`, { "sec-fetch-site": "same-origin" })).status, 200);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const r = await get(`/${NONCE}/api/model`, {}, method);
    assert.equal(r.status, 405, method);
  }
});

test("path traversal never reaches a file outside the viewer assets", async () => {
  const attempts = [
    `/${NONCE}/../package.json`,
    `/${NONCE}/app/../../package.json`,
    `/${NONCE}/app/..%2f..%2fpackage.json`,
    `/${NONCE}/app/%2e%2e/%2e%2e/package.json`,
    `/${NONCE}/vendor/..%2F..%2F..%2Fpackage.json`,
    `/${NONCE}/vendor/three.module.js%00.css`,
    `/${NONCE}/app/..\\..\\package.json`,
    `/${NONCE}/app/index.html`,
    `/${NONCE}/part.o3j.js`,
    `/${NONCE}/part.o3j/project.o3j.json`,
    `/${NONCE}/api/rev/..%2f..%2fpart.o3j.js/model.glb`,
    `/${NONCE}/api/rev/r_0001%2f..%2f..%2fpart.o3j.js/model.glb`,
    `/${NONCE}/%E0%A4%A`,
  ];
  for (const path of attempts) {
    const r = await get(path);
    assert.ok([400, 404].includes(r.status), `${path} answered ${r.status}`);
    assert.doesNotMatch(r.body.toString(), /"name"|box\(|"o3j"/, path);
  }
  const css = await get(`/${NONCE}/app/viewer.css`);
  assert.equal(css.status, 200);
  assert.match(String(css.headers["content-type"]), /text\/css/);
  const three = await get(`/${NONCE}/vendor/three.module.js`);
  assert.equal(three.status, 200);
  assert.match(String(three.headers["content-type"]), /javascript/);
});

test("the model JSON lists the tree and the report, and the GLB route returns binary glTF", async () => {
  const m = await get(`/${NONCE}/api/model`);
  assert.equal(m.status, 200);
  const model = JSON.parse(m.body.toString()) as { rev: string; head: string; tree: Array<{ path: string }>; parts: unknown[]; glb: string; run: { state: string } };
  assert.equal(model.rev, "r_0001");
  assert.equal(model.head, "r_0001");
  assert.deepEqual(model.tree.map((t) => t.path).sort(), ["block", "tab"]);
  assert.equal(model.parts.length, 2);
  assert.equal(model.run.state, "done");
  assert.equal(model.glb, "api/rev/r_0001/model.glb");

  const glb = await get(`/${NONCE}/${model.glb}`);
  assert.equal(glb.status, 200);
  assert.equal(glb.headers["content-type"], "model/gltf-binary");
  assert.equal(glb.body.subarray(0, 4).toString("latin1"), "glTF");
  assert.equal(glb.body.readUInt32LE(4), 2);
  assert.equal(glb.body.readUInt32LE(8), glb.body.length);

  assert.equal((await get(`/${NONCE}/api/rev/r_0099/model.glb`)).status, 404);
  assert.equal((await get(`/${NONCE}/api/rev/latest/model.glb`)).status, 404);
  const head = await get(`/${NONCE}/api/rev/r_0001/model.glb`, {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test("the event stream announces a new revision after the script is saved", async () => {
  const events: string[] = [];
  let resolveRev: (rev: string) => void;
  const announced = new Promise<string>((r) => (resolveRev = r));
  const req = request({ host: "127.0.0.1", port: server.port, path: `/${NONCE}/api/events`, headers: { host: `127.0.0.1:${server.port}` } }, (res) => {
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
  const model = JSON.parse((await get(`/${NONCE}/api/model`)).body.toString()) as { rev: string; parts: Array<{ def: string; bbox: { max: number[] } }> };
  assert.equal(model.rev, "r_0002");
  assert.equal(model.parts.find((p) => p.def === "block")?.bbox.max[2], 9);
});

test("a script error keeps the last revision and is reported on the stream", async () => {
  writeFileSync(scriptFile, "const a = box(1, 1, 1);\nthrow new Error('broken on purpose');\n");
  await server.rerun();
  const model = JSON.parse((await get(`/${NONCE}/api/model`)).body.toString()) as { rev: string; run: { state: string; error?: { code: string; line?: number } } };
  assert.equal(model.rev, "r_0002");
  assert.equal(model.run.state, "error");
  assert.equal(model.run.error?.code, "SCRIPT_RUNTIME");
  assert.equal(model.run.error?.line, 2);
});

test("open3dj view parses its flags", () => {
  const c = parseCommand(["view", "part.o3j.js", "--port", "8123", "--no-open", "--param", "w=3"]).command;
  assert.deepEqual(c, { cmd: "view", source: { kind: "script", path: "part.o3j.js", project: "part.o3j" }, params: { w: 3 }, saveParams: true, open: false, port: 8123 });
  const d = parseCommand(["view", "part.o3j", "--no-save-params"]).command;
  assert.deepEqual(d, { cmd: "view", source: { kind: "project", project: "part.o3j" }, params: {}, saveParams: false, open: true });
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
    const fetchModel = async () => {
      const raw = await new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: s.port, path: `/${NONCE}/api/model`, headers: { host: `127.0.0.1:${s.port}` } }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (body += c));
          res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.end();
      });
      return JSON.parse(raw) as { rev: string; report: { status: string; warnings?: string[] }; parts: Array<{ bbox: { min: number[]; max: number[] } }>; run: { status?: string; warnings?: string[] } };
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
