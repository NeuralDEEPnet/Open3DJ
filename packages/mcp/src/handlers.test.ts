// Handler tests over the fake compute pool: the project store, revisions and base_rev
// conflicts, provenance, the job model, the path policy, and schema-valid outputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@open3dj/schemas";
import type { AssemblyFile, ToolName } from "@open3dj/schemas";
import { createHandlers } from "./handlers.ts";
import { checkGraphSize, flatten } from "./tree.ts";
import { FAKE_INVENTORY, fakePlace, fakePool } from "./testing.ts";
import type { FakePool } from "./testing.ts";
import type { ToolHandlers } from "./types.ts";

const TWO_PARTS = `const plate = box(60, 40, 8);
return [{ name: "plate", shape: plate }, { name: "pin", shape: cylinder(12, 2.8) }];`;

interface Ctx {
  root: string;
  pool: FakePool;
  h: ToolHandlers;
  done(): void;
}

function setup(options: { interactiveMs?: number; slowMs?: number } = {}): Ctx {
  const root = mkdtempSync(join(tmpdir(), "o3j-handlers-"));
  const pool = fakePool(options.slowMs === undefined ? {} : { slowMs: options.slowMs });
  const deps = { pool, inventory: FAKE_INVENTORY, place: fakePlace, root, now: () => new Date("2026-10-28T12:00:00Z"), interactiveMs: options.interactiveMs ?? 5_000 };
  const h = createHandlers(deps);
  return { root, pool, h, done: () => rmSync(root, { recursive: true, force: true }) };
}

const valid = (tool: ToolName, output: unknown) => {
  const r = validate(`tool-${tool}-output`, output);
  assert.ok(r.valid, `${tool} output: ${JSON.stringify(r.errors)}\n${JSON.stringify(output)}`);
};

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

/** Create a symlink; false where the OS refuses (Windows without the symlink privilege). */
function trySymlink(target: string, path: string, kind: "dir" | "file"): boolean {
  try {
    symlinkSync(target, path, kind === "dir" ? "junction" : "file");
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") return false;
    throw e;
  }
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("run creates the project folder, revision r_0001 and schema-valid files", async () => {
  const c = setup();
  try {
    const out = await c.h.run({ project: "plate.o3j", script: TWO_PARTS });
    valid("run", out);
    assert.equal(out.status, "ok");
    assert.equal(out.rev, "r_0001");
    assert.equal((out.report as { rev?: string } | undefined)?.rev, undefined, "rev is given once, at the top");
    assert.deepEqual(out.compute, { backend: "cpu.wasm", device: "cpu x3", placement_reason: "auto: cpu pool (fake)" });
    const dir = join(c.root, "plate.o3j");
    assert.deepEqual(readdirSync(dir).sort(), [".gitignore", "assembly.o3j.json", "evidence.json", "main.o3j.js", "params.o3j.json", "project.o3j.json", "provenance.jsonl", "revisions"]);
    const manifest = readJson(join(dir, "project.o3j.json"));
    assert.ok(validate("project", manifest).valid);
    assert.deepEqual(manifest, { o3j: "0", name: "plate", units: "mm", up: "Z", engine: { open3dj: "0.0.0", occt_wasm: "5.8.1", brepjs: "20.11.1" }, rev: "r_0001" });
    assert.ok(validate("assembly", readJson(join(dir, "assembly.o3j.json"))).valid);
    assert.ok(validate("geometry-report", readJson(join(dir, "evidence.json"))).valid);
    assert.equal(readFileSync(join(dir, "main.o3j.js"), "utf8"), TWO_PARTS);
    const lines = readFileSync(join(dir, "provenance.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 1);
    assert.ok(validate("provenance", lines[0]).valid, JSON.stringify(lines[0]));
    assert.equal(lines[0]!.tool, "run");
    assert.equal(lines[0]!.rev, "r_0001");
    assert.equal(lines[0]!.ts, "2026-10-28T12:00:00.000Z");
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /out\//);
  } finally {
    c.done();
  }
});

test("revisions grow, unchanged inputs keep the revision, and ids stay stable", async () => {
  const c = setup();
  try {
    const r1 = await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const same = await c.h.run({ project: "p.o3j", script: TWO_PARTS, base_rev: r1.rev! });
    assert.equal(same.rev, "r_0001", "same script and params give the same revision");
    const r2 = await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// changed`, base_rev: "r_0001" });
    assert.equal(r2.rev, "r_0002");
    assert.deepEqual(c.pool.calls.at(-1)?.previous, readJson(join(c.root, "p.o3j", "revisions", "r_0001.json")).assembly, "the previous graph goes to the job");
    const rec = readJson(join(c.root, "p.o3j", "revisions", "r_0002.json"));
    assert.equal(rec.base_rev, "r_0001");
    assert.equal(readdirSync(join(c.root, "p.o3j", "revisions")).length, 2);
    const provenance = readFileSync(join(c.root, "p.o3j", "provenance.jsonl"), "utf8").trim().split("\n");
    assert.equal(provenance.length, 3, "every run call is recorded");
  } finally {
    c.done();
  }
});

test("a stale base_rev is a structured REV_CONFLICT and changes nothing", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}//2`, base_rev: "r_0001" });
    const stale = await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}//3`, base_rev: "r_0001" });
    valid("run", stale);
    assert.equal(stale.status, "error");
    assert.equal(stale.error?.code, "REV_CONFLICT");
    assert.match(stale.error!.message, /p\.o3j is at r_0002, not r_0001/);
    assert.match(stale.error!.hint!, /base_rev "r_0002"/);
    assert.equal(readdirSync(join(c.root, "p.o3j", "revisions")).length, 2);
    assert.ok(readFileSync(join(c.root, "p.o3j", "main.o3j.js"), "utf8").endsWith("//2"));
    const fresh = await c.h.run({ project: "new.o3j", script: TWO_PARTS, base_rev: "r_0001" });
    // A base_rev the project never had is not a race with another writer (review round 2).
    assert.equal(fresh.error?.code, "UNKNOWN_REV", "a base_rev on a new project names no revision");
  } finally {
    c.done();
  }
});

test("two runs racing from one base_rev: one commits, the other conflicts", async () => {
  const c = setup({ slowMs: 50 });
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const [a, b] = await Promise.all([
      c.h.run({ project: "p.o3j", script: `${TWO_PARTS}// slow a`, base_rev: "r_0001" }),
      c.h.run({ project: "p.o3j", script: `${TWO_PARTS}// slow b`, base_rev: "r_0001" }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["error", "ok"]);
    const loser = a.status === "error" ? a : b;
    assert.equal(loser.error?.code, "REV_CONFLICT");
    assert.equal(readdirSync(join(c.root, "p.o3j", "revisions")).length, 2);
  } finally {
    c.done();
  }
});

test("script errors come back as results with line and hint, without a revision", async () => {
  const c = setup();
  try {
    const out = await c.h.run({ project: "p.o3j", script: "const a = 1;\nthrow new Error('boom');" });
    valid("run", out);
    assert.equal(out.status, "error");
    assert.equal(out.rev, undefined);
    assert.deepEqual(out.error, { code: "SCRIPT_RUNTIME", message: "Error: boom", line: 2, column: 1, hint: "Fix the script at this line." });
    assert.equal(existsSync(join(c.root, "p.o3j", "revisions")), false);
    assert.equal(readFileSync(join(c.root, "p.o3j", "provenance.jsonl"), "utf8").trim().split("\n").length, 1);
  } finally {
    c.done();
  }
});

test("set_param ops re-run the stored script with merged params", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS, params: { width: 40, label: "A" } });
    const out = await c.h.run({ project: "p.o3j", base_rev: "r_0001", ops: [{ op: "set_param", name: "width", value: 60 }] });
    valid("run", out);
    assert.equal(out.rev, "r_0002");
    assert.deepEqual(c.pool.calls.at(-1)?.params, { width: 60, label: "A" });
    assert.equal(c.pool.calls.at(-1)?.script, TWO_PARTS);
    assert.deepEqual(readJson(join(c.root, "p.o3j", "params.o3j.json")), { width: 60, label: "A" });
    const missing = await c.h.run({ project: "none.o3j", ops: [{ op: "set_param", name: "w", value: 1 }] });
    assert.equal(missing.error?.code, "PROJECT_NOT_FOUND");
  } finally {
    c.done();
  }
});

test("ops beyond S1, gpu placement and bad input are structured errors", async () => {
  const c = setup();
  try {
    // S1 publishes only set_param and cancel_job; the S2 ops are refused with a pointer to the script.
    const op = await c.h.run({ project: "p.o3j", ops: [{ op: "remove", target: "pin" }] } as never);
    valid("run", op);
    assert.equal(op.error?.code, "OP_NOT_IMPLEMENTED");
    assert.match(op.error!.hint!, /script/);
    const gpu = await c.h.run({ project: "p.o3j", script: TWO_PARTS, compute: "gpu" });
    valid("run", gpu);
    assert.equal(gpu.error?.code, "NO_BACKEND");
    assert.match(gpu.error!.hint!, /auto/);
    const bad = await c.h.run({ project: "p.o3j" } as never);
    valid("run", bad);
    assert.equal(bad.error?.code, "BAD_INPUT");
    const ins = await c.h.inspect({ fields: ["tree"] });
    valid("inspect", ins);
    assert.equal(ins.error?.code, "PROJECT_REQUIRED");
  } finally {
    c.done();
  }
});

// Regression (review round 1): inspect ignored detail, and measure of an occurrence gave only
// the definition's local bbox, not where that occurrence sits.
test("inspect measure honours detail and gives occurrence targets their world bbox", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const detailed = await c.h.inspect({ project: "p.o3j", fields: ["measure"], targets: ["pin"] });
    valid("inspect", detailed);
    // The fake pin's local bbox is x 10..20; its occurrence sits at t = [10, 0, 0].
    assert.deepEqual(detailed.placements, [{ path: "pin", def: "pin", bbox: { min: [20, 0, 0], max: [30, 10, 10] } }]);
    const concise = await c.h.inspect({ project: "p.o3j", fields: ["measure"], targets: ["pin"], detail: "concise" });
    valid("inspect", concise);
    assert.equal(concise.measure?.[0]?.center_of_mass, undefined, "concise measure leaves out the detailed fields");
    assert.equal(concise.measure?.[0]?.area_mm2, undefined);
    assert.ok(detailed.measure?.[0]?.center_of_mass, "detailed (the default) keeps them");
  } finally {
    c.done();
  }
});

// Regression (review round 1): inspect's placement_reason said "run runs only on cpu.wasm".
test("inspect fits names inspect in its placement reason", async () => {
  const c = setup();
  c.h = createHandlers({ pool: c.pool, inventory: FAKE_INVENTORY, place: (mode, kind) => ({ backend: "cpu.wasm", device: "cpu x3", placement_reason: `${mode}: ${kind} runs only on cpu.wasm` }), root: c.root, interactiveMs: 5_000 });
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const out = await c.h.inspect({ project: "p.o3j", fields: ["fits"] });
    assert.equal(out.status, "ok", JSON.stringify(out.error));
    assert.match(out.compute.placement_reason, /^inspect/);
    assert.doesNotMatch(out.compute.placement_reason, /run runs/);
  } finally {
    c.done();
  }
});

test("inspect: devices without a project, tree, measure by target, fits from a detailed job", async () => {
  const c = setup();
  try {
    const devices = await c.h.inspect({ fields: ["devices"] });
    valid("inspect", devices);
    assert.deepEqual(devices.devices, FAKE_INVENTORY);
    assert.equal(devices.compute.backend, "none");
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const out = await c.h.inspect({ project: "p.o3j", fields: ["tree", "measure", "fits", "refs"], targets: ["pin#1"] });
    valid("inspect", out);
    assert.equal(out.rev, "r_0001");
    assert.deepEqual(out.tree?.map((n) => [n.path, n.def, n.kind]), [["plate", "plate", "script"], ["pin", "pin", "script"]]);
    assert.deepEqual(out.measure?.map((p) => p.def), ["pin"]);
    assert.deepEqual(out.fits, [{ a: "plate", b: "pin", kind: "clearance", distance_mm: 0.2, confidence: "measured" }]);
    assert.deepEqual(out.refs, []);
    assert.equal(c.pool.calls.at(-1)?.detail, "detailed");
    const calls = c.pool.calls.length;
    await c.h.inspect({ project: "p.o3j", fields: ["fits"] });
    assert.equal(c.pool.calls.length, calls, "the detailed report is cached");
    const unknown = await c.h.inspect({ project: "p.o3j", fields: ["measure"], targets: ["lid"] });
    valid("inspect", unknown);
    assert.equal(unknown.error?.code, "UNKNOWN_TARGET");
    assert.match(unknown.error!.hint!, /plate, pin/);
    const badRev = await c.h.inspect({ project: "p.o3j", rev: "r_0009", fields: ["tree"] });
    assert.equal(badRev.error?.code, "UNKNOWN_REV");
    assert.match(badRev.error!.hint!, /r_0001/);
  } finally {
    c.done();
  }
});

test("render writes images under out/<rev>/ and returns them", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const png = await c.h.render({ project: "p.o3j", view: "multiview" });
    valid("render", png.output);
    assert.equal(png.output.status, "ok");
    assert.deepEqual(png.images.map((i) => i.format), ["png"], "png is the default format");
    assert.equal(png.output.files?.[0]?.path, "out/r_0001/multiview.png");
    assert.ok(existsSync(join(c.root, "p.o3j", "out", "r_0001", "multiview.png")));
    const both = await c.h.render({ project: "p.o3j", view: "multiview", format: "both", targets: ["pin"] });
    valid("render", both.output);
    assert.deepEqual(both.output.files?.map((f) => f.path), ["out/r_0001/multiview-pin.png", "out/r_0001/multiview-pin.svg"]);
    assert.deepEqual(both.output.targets, ["pin"]);
    const none = await c.h.render({ project: "missing.o3j", view: "multiview" });
    valid("render", none.output);
    assert.equal(none.output.error?.code, "PROJECT_NOT_FOUND");
  } finally {
    c.done();
  }
});

test("export writes files and the evidence sidecar; old revisions re-run their own script", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// v2` });
    const step = await c.h.export({ project: "p.o3j", format: "step" });
    valid("export", step);
    assert.equal(step.rev, "r_0002");
    assert.deepEqual(step.files?.map((f) => [f.path, f.format]), [["out/r_0002/p.step", "step"], ["out/r_0002/p.evidence.json", "evidence"]]);
    const old = await c.h.export({ project: "p.o3j", rev: "r_0001", format: "3mf", out_dir: "exports/v1" });
    valid("export", old);
    assert.equal(c.pool.calls.at(-1)?.script, TWO_PARTS);
    assert.deepEqual(old.files?.map((f) => f.path), ["exports/v1/p.3mf", "exports/v1/p.evidence.json"]);
    assert.deepEqual(old.warnings, ["3MF has no per-occurrence colour overrides (fake)"]);
    const glb = await c.h.export({ project: "p.o3j", format: "gltf", scope: "pin" });
    assert.equal(glb.files?.[0]?.path, "out/r_0002/p-pin.glb", "a scoped export names its scope");
    const scope = await c.h.export({ project: "p.o3j", format: "stl", scope: "lid" });
    valid("export", scope);
    assert.equal(scope.error?.code, "UNKNOWN_TARGET");
    const lines = readFileSync(join(c.root, "p.o3j", "provenance.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { tool: string });
    assert.deepEqual(lines.map((l) => l.tool), ["run", "run", "export", "export", "export", "export"]);
  } finally {
    c.done();
  }
});

test("path policy: no escapes, no absolute paths, no symlinks, and no absolute paths in errors", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    for (const out_dir of ["../escape", "/tmp/x", "a/../../b", ".hidden", "C:\\x"]) {
      const r = await c.h.export({ project: "p.o3j", format: "step", out_dir });
      valid("export", r);
      assert.equal(r.error?.code, "PATH_REFUSED", out_dir);
      assert.ok(!r.error!.message.includes(c.root), r.error!.message);
    }
    mkdirSync(join(c.root, "elsewhere"));
    if (trySymlink(join(c.root, "elsewhere"), join(c.root, "p.o3j", "linked"), "dir")) {
      const viaLink = await c.h.export({ project: "p.o3j", format: "step", out_dir: "linked" });
      assert.equal(viaLink.error?.code, "PATH_REFUSED");
      assert.deepEqual(readdirSync(join(c.root, "elsewhere")), []);
    }
    // A planted symlink where an output file will go is refused, never followed.
    mkdirSync(join(c.root, "p.o3j", "out", "r_0001"), { recursive: true });
    writeFileSync(join(c.root, "victim.txt"), "keep");
    if (trySymlink(join(c.root, "victim.txt"), join(c.root, "p.o3j", "out", "r_0001", "p.step"), "file")) {
      const planted = await c.h.export({ project: "p.o3j", format: "step" });
      assert.equal(planted.error?.code, "PATH_REFUSED");
      assert.equal(readFileSync(join(c.root, "victim.txt"), "utf8"), "keep");
    }
    if (trySymlink(join(c.root, "p.o3j"), join(c.root, "alias.o3j"), "dir")) {
      assert.equal((await c.h.inspect({ project: "alias.o3j", fields: ["tree"] })).error?.code, "PATH_REFUSED");
    }
    const outside = await c.h.run({ project: join(tmpdir(), "outside.o3j"), script: TWO_PARTS });
    assert.equal(outside.error?.code, "PATH_REFUSED");
    assert.ok(!outside.error!.message.includes(tmpdir()));
    assert.equal((await c.h.run({ project: "plain-folder", script: TWO_PARTS })).error?.code, "PROJECT_PATH");
    assert.equal((await c.h.run({ project: "no/such/dir/x.o3j", script: TWO_PARTS })).error?.code, "PROJECT_PATH");
  } finally {
    c.done();
  }
});

test("job model: a slow run returns queued, then finishes; a cancelled job creates no revision", async () => {
  const c = setup({ interactiveMs: 20, slowMs: 300 });
  try {
    const queued = await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// slow` });
    valid("run", queued);
    assert.equal(queued.status, "queued");
    assert.match(queued.job_id!, /^job_/);
    const running = await c.h.inspect({ fields: ["job"], job_id: queued.job_id! });
    valid("inspect", running);
    assert.equal(running.job?.state, "running");
    const done = await until(() => c.h.inspect({ fields: ["job"], job_id: queued.job_id! }), (o) => o.job?.state !== "running");
    valid("inspect", done);
    assert.equal(done.job?.state, "done");
    assert.equal(done.job?.rev, "r_0001");
    assert.deepEqual(done.job?.attempts, [{ backend: "cpu.wasm", device: "cpu x3", outcome: "ok" }]);

    const second = await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// slow 2` });
    assert.equal(second.status, "queued");
    const cancel = await c.h.run({ project: "p.o3j", ops: [{ op: "cancel_job", job_id: second.job_id! }] });
    valid("run", cancel);
    assert.equal(cancel.status, "ok");
    const cancelled = await c.h.inspect({ fields: ["job"], job_id: second.job_id! });
    assert.equal(cancelled.job?.state, "cancelled");
    await new Promise((r) => setTimeout(r, 350));
    assert.equal((await c.h.inspect({ fields: ["job"], job_id: second.job_id! })).job?.state, "cancelled", "a late result does not revive a cancelled job");
    assert.deepEqual(readdirSync(join(c.root, "p.o3j", "revisions")), ["r_0001.json"]);
    const unknown = await c.h.run({ project: "p.o3j", ops: [{ op: "cancel_job", job_id: "job_nope" }] });
    assert.equal(unknown.error?.code, "JOB_NOT_FOUND");
    const mixed = await c.h.run({ project: "p.o3j", script: TWO_PARTS, ops: [{ op: "cancel_job", job_id: "job_x" }] });
    assert.equal(mixed.error?.code, "BAD_INPUT");
  } finally {
    c.h.shutdown();
    c.done();
  }
});

test("docs search returns paged, schema-valid hits", async () => {
  const c = setup();
  try {
    const fillet = await c.h.docs({ query: "fillet" });
    valid("docs", fillet);
    assert.equal(fillet.hits[0]?.title, "fillet");
    assert.equal(fillet.hits[0]?.kind, "dsl");
    assert.match(fillet.hits[0]!.text, /fillet\(shape, r, edgeQuery\?\)/);
    assert.equal(fillet.hits[0]?.ref, "docs/DSL.md#fillet");
    assert.ok(fillet.pages >= 1 && fillet.hits.length <= 5);
    const conflict = await c.h.docs({ query: "REV_CONFLICT" });
    assert.equal(conflict.hits[0]?.kind, "error");
    const bolt = await c.h.docs({ query: "lib.bolt" });
    assert.equal(bolt.hits[0]?.title, "lib.bolt");
    assert.equal(bolt.hits[0]?.kind, "lib");
    const example = await c.h.docs({ query: "enclosure lid screws" });
    assert.equal(example.hits[0]?.kind, "example");
    const later = await c.h.docs({ query: "text2d" });
    assert.match(later.hits[0]!.text, /DSL_NOT_IMPLEMENTED/);
    const page2 = await c.h.docs({ query: "box", page: 2 });
    valid("docs", page2);
    assert.equal(page2.page, 2);
    const none = await c.h.docs({ query: "zzzqqq" });
    assert.deepEqual(none, { query: "zzzqqq", page: 1, pages: 0, hits: [] });
    // Regression (review round 2): bad docs input looked like "nothing documented".
    for (const bad of [{ query: "" }, { query: "x", bogus: 1 }, {}]) {
      const out = await c.h.docs(bad as never);
      valid("docs", out);
      assert.deepEqual(out.hits, []);
      assert.equal(out.error?.code, "BAD_INPUT", JSON.stringify(out));
      assert.match(out.error!.hint ?? "", /query/);
    }
  } finally {
    c.done();
  }
});

// Regression (review round 1): nothing kept a valid run under the transport's 10 MiB line
// limit, so one large params string wedged the daemon. Oversize inputs are BAD_INPUT now.
test("oversize params and lists are BAD_INPUT before they reach the transport limit", async () => {
  const c = setup();
  try {
    const long = await c.h.run({ project: "p.o3j", script: TWO_PARTS, params: { s: "y".repeat(64 * 1024) } });
    assert.equal(long.error?.code, "BAD_INPUT");
    const many = await c.h.run({ project: "p.o3j", script: TWO_PARTS, params: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`p${i}`, i])) });
    assert.equal(many.error?.code, "BAD_INPUT");
    const name = await c.h.run({ project: "p.o3j", script: TWO_PARTS, params: { ["n".repeat(500)]: 1 } });
    assert.equal(name.error?.code, "BAD_INPUT");
    const targets = await c.h.render({ project: "p.o3j", view: "multiview", targets: Array.from({ length: 2000 }, (_, i) => `t${i}`) });
    assert.equal(targets.output.error?.code, "BAD_INPUT");
    const ok = await c.h.run({ project: "p.o3j", script: TWO_PARTS, params: { label: "y".repeat(4096) } });
    assert.equal(ok.status, "ok", JSON.stringify(ok.error));
  } finally {
    c.done();
  }
});

// Regression (review round 1): params.o3j.json values overrode the defaults of a new script
// (a 500 mm part from Param.number("Width", 3)), a clamped value was stored unclamped, and
// names the new script did not declare kept producing warnings.
test("a new script starts from its own defaults; the same script keeps the stored values", async () => {
  const c = setup();
  // The real worker resolves params against the script's declarations: declared names only,
  // clamped to min and max. This pool does the same for a script that declares "Width" in 20..80.
  const run = c.pool.run.bind(c.pool);
  c.pool.run = async (job, o) => {
    const r = await run(job, o);
    if (r.ok) {
      const declared = /Param\.number\("Width"/.test(job.script);
      const w = job.params?.["Width"];
      r.params = declared ? { Width: typeof w === "number" ? Math.min(80, Math.max(20, w)) : 40 } : {};
    }
    return r;
  };
  const A = 'const W = Param.number("Width", 40, { min: 20, max: 80 });\nreturn box(W, 30, 5);';
  const B = "return box(5, 5, 5);";
  const C = 'const x = Param.number("Width", 3);\nreturn box(x, 5, 5);';
  const stored = () => readJson(join(c.root, "p.o3j", "params.o3j.json"));
  try {
    await c.h.run({ project: "p.o3j", script: A });
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "Width", value: 500 }] });
    assert.deepEqual(c.pool.calls.at(-1)?.params, { Width: 500 });
    assert.deepEqual(stored(), { Width: 80 }, "the clamped value is stored");
    // The same script again (as the CLI sends it) keeps the working copy's values.
    await c.h.run({ project: "p.o3j", script: A });
    assert.deepEqual(c.pool.calls.at(-1)?.params, { Width: 80 });
    // A different script starts from its own defaults: nothing stale is passed or stored.
    await c.h.run({ project: "p.o3j", script: B });
    assert.deepEqual(c.pool.calls.at(-1)?.params, {});
    assert.deepEqual(stored(), {});
    await c.h.run({ project: "p.o3j", script: A, params: { Width: 70 } });
    const changed = await c.h.run({ project: "p.o3j", script: C });
    assert.deepEqual(c.pool.calls.at(-1)?.params, {}, "Width = 70 must not override the new script's default 3");
    // Regression (review round 2): dropping the stored values is said, not silent.
    assert.equal(changed.status, "warning");
    assert.ok(changed.report?.warnings?.some((w) => /Width/.test(w) && /script changed/.test(w)), JSON.stringify(changed.report?.warnings));
    const same = await c.h.run({ project: "p.o3j", script: C, params: { Width: 4 } });
    assert.ok(!(same.report?.warnings ?? []).some((w) => /script changed/.test(w)), "the same script keeps its values without a warning");
  } finally {
    c.done();
  }
});

// Regression (review round 1): reads checked only the last path component, so a symlinked
// revisions/ or .o3j-cache/ folder made inspect and render read files from outside the project.
test("reads refuse symlinked folders below the project, not only symlinked files", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const dir = join(c.root, "p.o3j");
    const outside = join(c.root, "outside");
    mkdirSync(outside);
    const rec = readJson(join(dir, "revisions", "r_0001.json"));
    writeFileSync(join(outside, "r_0001.json"), JSON.stringify({ ...rec, script: "SECRET SCRIPT FROM OUTSIDE", report: { ...(rec.report as object), refs: [{ name: "OUTSIDE", state: "exact" }] } }));
    rmSync(join(dir, "revisions"), { recursive: true });
    if (!trySymlink(outside, join(dir, "revisions"), "dir")) return;
    const ins = await c.h.inspect({ project: "p.o3j", fields: ["tree", "refs"] });
    assert.equal(ins.status, "error");
    assert.equal(ins.error?.code, "PATH_REFUSED");
    const calls = c.pool.calls.length;
    const render = await c.h.render({ project: "p.o3j", view: "multiview" });
    assert.equal(render.output.error?.code, "PATH_REFUSED");
    assert.equal(c.pool.calls.length, calls, "no job ran with a script from outside the project");

    // A symlinked cache folder is refused too.
    rmSync(join(dir, "revisions"));
    mkdirSync(join(dir, "revisions"));
    writeFileSync(join(dir, "revisions", "r_0001.json"), JSON.stringify(rec));
    writeFileSync(join(outside, "r_0001.report.json"), JSON.stringify(rec.report));
    if (!trySymlink(outside, join(dir, ".o3j-cache"), "dir")) return;
    const fits = await c.h.inspect({ project: "p.o3j", fields: ["fits"] });
    assert.equal(fits.error?.code, "PATH_REFUSED");
  } finally {
    c.done();
  }
});

// Regression (review round 1): a scoped export used the root export's file name, so exporting
// one part replaced the assembly STEP and its evidence sidecar.
test("a scoped export gets its own file name and keeps the root export", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "e.o3j", script: TWO_PARTS });
    const root = await c.h.export({ project: "e.o3j", format: "step" });
    const part = await c.h.export({ project: "e.o3j", format: "step", scope: "pin" });
    assert.equal(part.status, "ok", JSON.stringify(part.error));
    assert.deepEqual(root.files?.map((f) => f.path), ["out/r_0001/e.step", "out/r_0001/e.evidence.json"]);
    assert.deepEqual(part.files?.map((f) => f.path), ["out/r_0001/e-pin.step", "out/r_0001/e-pin.evidence.json"]);
    assert.ok(existsSync(join(c.root, "e.o3j", "out", "r_0001", "e.step")));
    assert.equal(readFileSync(join(c.root, "e.o3j", "out", "r_0001", "e.step"), "utf8"), "fake step of plate,pin");
  } finally {
    c.done();
  }
});

// Regression (review round 1): an agent could not find out which entries exist ("overview"
// gave nothing), the gallery examples were not indexed, and the playbook missed codes that
// the daemon and workers return.
test("docs lists every entry, finds the gallery examples and knows every error code", async () => {
  const c = setup();
  try {
    const all = await c.h.docs({ query: "entries" });
    assert.equal(all.hits[0]?.title, "All entries");
    for (const name of ["box", "fillet", "matchTo", "lib.bolt", "sketch.extrude"]) assert.match(all.hits[0]!.text, new RegExp(name.replace(".", "\\.")));
    assert.equal((await c.h.docs({ query: "overview" })).hits[0]?.title, "All entries");
    assert.match((await c.h.docs({ query: "getting started" })).hits[0]?.title ?? "", /Getting started/);
    const hinge = await c.h.docs({ query: "hinge" });
    assert.equal(hinge.hits[0]?.kind, "example");
    assert.match(hinge.hits[0]!.text, /```js/);
    for (const code of ["BAD_PART", "DSL_EMPTY_RESULT", "STEP_ROUNDTRIP_FAILED", "JOB_MEMORY", "PROJECT_BUSY"]) {
      const hit = (await c.h.docs({ query: code })).hits[0];
      assert.equal(hit?.title, code, code);
      assert.equal(hit?.kind, "error");
    }
  } finally {
    c.done();
  }
});

// ---- review round 2 regressions ----------------------------------------------------------

/** A graph where each of `levels` definitions holds `fan` occurrences of the next: fan^levels leaves. */
function dagAssembly(levels: number, fan: number): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  const id = (n: number) => `00000000-0000-8000-8000-${String(n).padStart(12, "0")}`;
  let k = 0;
  for (let i = 0; i < levels; i++) {
    definitions[`d${i}`] = {
      kind: "assembly",
      name: `d${i}`,
      occurrences: Array.from({ length: fan }, (_, j) => ({ id: id(k++), name: `o${j}`, def: i + 1 < levels ? `d${i + 1}` : "leaf", transform: { t: [0, 0, 0], q: [0, 0, 0, 1] } })),
    };
  }
  definitions["leaf"] = { kind: "script", name: "leaf" };
  return { o3j: "0", root: "d0", definitions, mates: [] };
}

test("a revision whose graph expands to millions of occurrences is PROJECT_CORRUPT, fast", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "dag.o3j", script: "return box(10, 10, 10);" });
    const file = join(c.root, "dag.o3j", "revisions", "r_0001.json");
    const rec = readJson(file);
    rec["assembly"] = dagAssembly(20, 4);
    writeFileSync(file, JSON.stringify(rec));
    const t = Date.now();
    for (const fields of [["tree"], ["measure"]] as const) {
      const out = await c.h.inspect({ project: "dag.o3j", fields: [...fields] });
      valid("inspect", out);
      assert.equal(out.error?.code, "PROJECT_CORRUPT", JSON.stringify(out.error));
    }
    const calls = c.pool.calls.length;
    const run = await c.h.run({ project: "dag.o3j", script: "return box(10, 10, 12);" });
    assert.equal(run.error?.code, "PROJECT_CORRUPT", JSON.stringify(run.error));
    assert.equal(c.pool.calls.length, calls, "the graph never reaches a worker");
    assert.ok(Date.now() - t < 5_000, `took ${Date.now() - t} ms`);
  } finally {
    c.done();
  }
});

test("export out_dir may not name the store's own files and folders", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "s.o3j", script: "return box(10, 10, 10);" });
    for (const out_dir of [".o3j-lock", "revisions/r_9999999999999999999999.json", ".o3j-cache/r_0001.report.json", "revisions", ".gitignore", "project.o3j.json", "main.o3j.js"]) {
      const out = await c.h.export({ project: "s.o3j", format: "stl", out_dir });
      valid("export", out);
      assert.equal(out.error?.code, "PATH_REFUSED", `${out_dir}: ${JSON.stringify(out.error ?? out.status)}`);
    }
    const again = await c.h.run({ project: "s.o3j", script: "return box(10, 10, 11);" });
    assert.equal(again.status, "ok", JSON.stringify(again.error));
    assert.equal(again.rev, "r_0002");
  } finally {
    c.done();
  }
});

test("a cloned project with a folder at the lock path or a huge revision name stays usable or says why", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "k.o3j", script: "return box(10, 10, 10);" });
    mkdirSync(join(c.root, "k.o3j", "revisions", "r_9999999999999999999999.json"));
    const next = await c.h.run({ project: "k.o3j", script: "return box(10, 10, 11);" });
    assert.equal(next.status, "ok", JSON.stringify(next.error));
    assert.equal(next.rev, "r_0002");
    mkdirSync(join(c.root, "k.o3j", ".o3j-lock"));
    const t = Date.now();
    const locked = await c.h.run({ project: "k.o3j", script: "return box(10, 10, 12);" });
    assert.equal(locked.error?.code, "PROJECT_CORRUPT", JSON.stringify(locked.error));
    assert.match(locked.error!.hint ?? "", /folder/);
    assert.ok(Date.now() - t < 5_000, `took ${Date.now() - t} ms`);
  } finally {
    c.done();
  }
});

test("a base_rev that never existed is UNKNOWN_REV and names the head", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "b.o3j", script: "return box(10, 10, 10);" });
    const out = await c.h.run({ project: "b.o3j", script: "return box(10, 10, 11);", base_rev: "r_0009" });
    assert.equal(out.error?.code, "UNKNOWN_REV", JSON.stringify(out.error));
    assert.doesNotMatch(out.error!.message, /another change landed first/);
    assert.match(`${out.error!.message} ${out.error!.hint ?? ""}`, /r_0001/);
  } finally {
    c.done();
  }
});

test("a nested project path gets a hint an MCP-only agent can follow", async () => {
  const c = setup();
  try {
    const out = await c.h.run({ project: "designs/nested.o3j", script: "return box(10, 10, 10);" });
    if (out.status === "ok") return; // parent folders are created inside the root
    assert.equal(out.error?.code, "PROJECT_PATH");
    assert.doesNotMatch(out.error!.hint ?? "", /Create the parent folder/);
    assert.match(out.error!.hint ?? "", /nested\.o3j/);
  } finally {
    c.done();
  }
});

test("flatten and checkGraphSize stop a fan-out graph at the occurrence cap", () => {
  const asm = dagAssembly(20, 4) as unknown as AssemblyFile;
  const t = Date.now();
  assert.throws(() => flatten(asm), (e: unknown) => (e as { code?: string }).code === "PROJECT_CORRUPT");
  assert.throws(() => checkGraphSize(asm), (e: unknown) => (e as { code?: string }).code === "PROJECT_CORRUPT");
  assert.equal(checkGraphSize(dagAssembly(3, 4) as unknown as AssemblyFile), 4 + 16 + 64);
  assert.ok(Date.now() - t < 2_000);
});

// Regression (review round 2, issue 11): a queued run lost its report, warnings and its
// error's line and hint; inspect fields=[job] gave only the state and "CODE: message".
test("a queued run keeps its full result: the report on success, the error with line and hint on failure", async () => {
  const c = setup({ interactiveMs: 20, slowMs: 200 });
  try {
    const ok = await c.h.run({ project: "q.o3j", script: `${TWO_PARTS}\n// slow clash` });
    assert.equal(ok.status, "queued");
    const done = await until(() => c.h.inspect({ fields: ["job"], job_id: ok.job_id! }), (o) => o.job?.state !== "running");
    valid("inspect", done);
    assert.equal(done.job?.state, "done");
    const result = done.job?.result;
    assert.ok(result, "the finished run output is kept on the job");
    assert.equal(result.rev, "r_0001");
    assert.equal(result.status, "warning");
    assert.ok(result.report, "the concise report comes back");

    const bad = await c.h.run({ project: "q.o3j", script: "const a = 1;\n// slow\nthrow new Error('boom');" });
    assert.equal(bad.status, "queued");
    const failed = await until(() => c.h.inspect({ fields: ["job"], job_id: bad.job_id! }), (o) => o.job?.state !== "running");
    valid("inspect", failed);
    assert.equal(failed.job?.state, "failed");
    assert.equal(failed.job?.result?.error?.code, "SCRIPT_RUNTIME");
    assert.equal(failed.job?.result?.error?.line, 3);
    assert.equal(failed.job?.result?.error?.hint, "Fix the script at this line.");
  } finally {
    c.h.shutdown();
    c.done();
  }
});
