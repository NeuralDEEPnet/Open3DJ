// Agent waivers (S3) over the fake compute pool: run ops=[{op: "waive"}], inspect fields=[gates]
// with waived and open failures, and the gate status in every export's evidence sidecar.
// The fake pool fails gates on markers in the script: "thin" fails min_wall (value from the
// param wall_<part>, default 0.6), "overhang" fails overhang and "leaky" fails watertight;
// the param size_<part> changes that part's geometry hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@open3dj/schemas";
import type { GateRun, ToolName } from "@open3dj/schemas";
import type { JobRequest, RunOptions } from "@open3dj/compute";
import { createHandlers } from "./handlers.ts";
import { resolveProject } from "./paths.ts";
import { MAX_WAIVERS, ProjectStore } from "./store.ts";
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

function setup(): Ctx {
  const root = mkdtempSync(join(tmpdir(), "o3j-waivers-"));
  const pool = fakePool();
  const h = createHandlers({ pool, inventory: FAKE_INVENTORY, place: fakePlace, root, now: () => new Date("2026-11-04T12:00:00Z"), interactiveMs: 5_000 });
  return { root, pool, h, done: () => rmSync(root, { recursive: true, force: true }) };
}

const valid = (tool: ToolName, output: unknown) => {
  const r = validate(`tool-${tool}-output`, output);
  assert.ok(r.valid, `${tool} output: ${JSON.stringify(r.errors)}\n${JSON.stringify(output)}`);
};

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

/** gate name -> "open" or the waiver's reason, per part. */
function verdicts(g: GateRun | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const p of g?.parts ?? []) out[p.def] = Object.fromEntries(p.fail.map((f) => [f.gate, f.waiver ? f.waiver.reason : "open"]));
  return out;
}

test("an agent waives an agent-waivable failure with a reason; inspect shows it waived and counts only open failures", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin overhang` });
    const before = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    valid("inspect", before);
    assert.deepEqual([before.gates?.status, before.gates?.open, before.gates?.waived], ["fail", 4, 0]);

    const calls = c.pool.calls.length;
    const out = await c.h.run({ project: "p.o3j", base_rev: "r_0001", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "  a breakaway shim, snapped off after printing  " }] });
    valid("run", out);
    assert.equal(out.status, "ok", JSON.stringify(out.error));
    assert.equal(out.rev, "r_0001", "a waiver creates no revision");
    assert.deepEqual(out.waivers, [{
      def: "plate", gate: "min_wall", profile: "fdm.v1", geometry_hash: "fake:plate:0", shape_hash: "fake:plate:0:0", value: 0.6, limit: 0.8, at: "face:3",
      reason: "a breakaway shim, snapped off after printing", by: "agent", rev: "r_0001", ts: "2026-11-04T12:00:00.000Z",
    }]);
    // The waiver is checked against a fresh gate run of the targeted part, on the batch lane.
    assert.equal(c.pool.calls.length, calls + 1);
    assert.deepEqual(c.pool.calls.at(-1)?.gates, { profile: "fdm.v1", build: [0, 0, 1], defs: ["plate"] });
    assert.equal(c.pool.lanes.at(-1), "batch");
    assert.equal(c.pool.calls.at(-1)?.fits, false);
    assert.match(out.compute.placement_reason, /^run \(waive: fdm\.v1 gates of r_0001\)/);

    const file = readJson(join(c.root, "p.o3j", "waivers.o3j.json"));
    assert.ok(validate("waivers", file).valid, JSON.stringify(validate("waivers", file).errors));
    assert.deepEqual(file, { o3j: "0", waivers: out.waivers });
    assert.deepEqual(readdirRevisions(c.root), ["r_0001.json"]);

    const after = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    valid("inspect", after);
    assert.deepEqual(verdicts(after.gates), {
      plate: { min_wall: "a breakaway shim, snapped off after printing", overhang: "open" },
      pin: { min_wall: "open", overhang: "open" },
    });
    const waived = after.gates!.parts[0]!.fail.find((f) => f.gate === "min_wall")!;
    assert.deepEqual(waived.waiver, { by: "agent", reason: "a breakaway shim, snapped off after printing", rev: "r_0001", ts: "2026-11-04T12:00:00.000Z" });
    assert.deepEqual([after.gates?.status, after.gates?.open, after.gates?.waived], ["fail", 3, 1]);

    // Several waivers in one call; a second waiver of the same gate on the same part replaces the first.
    const rest = await c.h.run({ project: "p.o3j", ops: [
      { op: "waive", gate: "overhang", target: "plate", reason: "printed on its side" },
      { op: "waive", gate: "min_wall", target: "pin", reason: "a locating pin, reamed after printing" },
      { op: "waive", gate: "overhang", target: "pin#1", reason: "the chamfer self-supports" },
      { op: "waive", gate: "min_wall", target: "plate", reason: "a shim, removed after printing" },
    ] });
    valid("run", rest);
    assert.equal(rest.status, "ok", JSON.stringify(rest.error));
    assert.equal(rest.waivers?.length, 4);
    assert.equal((readJson(join(c.root, "p.o3j", "waivers.o3j.json")).waivers as unknown[]).length, 4);
    const all = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    assert.deepEqual([all.gates?.status, all.gates?.open, all.gates?.waived], ["pass", 0, 4]);
    assert.equal(verdicts(all.gates)["plate"]!["min_wall"], "a shim, removed after printing");

    const lines = readFileSync(join(c.root, "p.o3j", "provenance.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { tool: string; rev?: string; base_rev?: string });
    assert.deepEqual(lines.map((l) => [l.tool, l.rev]), [["run", "r_0001"], ["run", "r_0001"], ["run", "r_0001"]]);
    assert.equal(lines[1]!.base_rev, "r_0001");
  } finally {
    c.done();
  }
});

test("human-only gates are refused before any job: a person must waive them, which arrives in S5", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// leaky` });
    const calls = c.pool.calls.length;
    for (const gate of ["watertight", "bed"] as const) {
      const out = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate, target: "plate", reason: "it prints fine" }] });
      valid("run", out);
      assert.equal(out.status, "error");
      assert.equal(out.error?.code, "WAIVER_NEEDS_PERSON", gate);
      assert.match(out.error!.message, new RegExp(`${gate}.*person`));
      assert.match(`${out.error!.message} ${out.error!.hint}`, /S5/);
      assert.match(out.error!.hint!, /min_wall and overhang/);
    }
    // Refused in the same call as an agent-waivable gate: nothing is recorded.
    const mixed = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "x" }, { op: "waive", gate: "watertight", target: "plate", reason: "x" }] });
    assert.equal(mixed.error?.code, "WAIVER_NEEDS_PERSON");
    assert.equal(c.pool.calls.length, calls, "no gate job runs for a refused waiver");
    assert.equal(existsSync(join(c.root, "p.o3j", "waivers.o3j.json")), false);
  } finally {
    c.done();
  }
});

test("a waiver needs a reason, one part, a failing gate and the head revision", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin` });
    const cases: Array<[unknown, string, RegExp?]> = [
      [{ op: "waive", gate: "min_wall", target: "plate", reason: "   " }, "BAD_INPUT", /reason/],
      [{ op: "waive", gate: "min_wall", target: "plate" }, "BAD_INPUT"],
      [{ op: "waive", gate: "min_wall", target: "root", reason: "r" }, "BAD_INPUT", /2 part definitions/],
      [{ op: "waive", gate: "min_wall", target: "lid", reason: "r" }, "UNKNOWN_TARGET"],
      [{ op: "waive", gate: "overhang", target: "plate", reason: "r" }, "NOTHING_TO_WAIVE", /overhang passes on plate/],
      [{ op: "waive", gate: "draft", target: "plate", reason: "r" }, "BAD_INPUT"],
    ];
    for (const [op, code, message] of cases) {
      const out = await c.h.run({ project: "p.o3j", ops: [op] } as never);
      valid("run", out);
      assert.equal(out.error?.code, code, JSON.stringify(op));
      if (message) assert.match(out.error!.message, message);
    }
    const withScript = await c.h.run({ project: "p.o3j", script: TWO_PARTS, ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "r" }] });
    assert.equal(withScript.error?.code, "BAD_INPUT");
    const withParam = await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "w", value: 1 }, { op: "waive", gate: "min_wall", target: "plate", reason: "r" }] });
    assert.equal(withParam.error?.code, "BAD_INPUT");
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "size_pin", value: 2 }] });
    const stale = await c.h.run({ project: "p.o3j", base_rev: "r_0001", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "r" }] });
    assert.equal(stale.error?.code, "REV_CONFLICT");
    const none = await c.h.run({ project: "none.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "r" }] });
    assert.equal(none.error?.code, "PROJECT_NOT_FOUND");
    assert.equal(existsSync(join(c.root, "p.o3j", "waivers.o3j.json")), false);
  } finally {
    c.done();
  }
});

test("a waiver is bound to the part's shape and its finding: a change to either reopens it", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin` });
    await c.h.run({ project: "p.o3j", ops: [
      { op: "waive", gate: "min_wall", target: "plate", reason: "a shim" },
      { op: "waive", gate: "min_wall", target: "pin", reason: "a pin" },
    ] });
    // Another part's change keeps this part's waiver; the changed part's reopens, and the notes say why.
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "size_plate", value: 2 }] });
    const changed = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    valid("inspect", changed);
    assert.equal(changed.rev, "r_0002");
    assert.deepEqual(verdicts(changed.gates), { plate: { min_wall: "open" }, pin: { min_wall: "a pin" } });
    assert.deepEqual([changed.gates?.status, changed.gates?.open, changed.gates?.waived], ["fail", 1, 1]);
    assert.match(changed.gates!.notes[0]!, /^1 waiver does not cover the current failure .*: plate min_wall \(made on r_0001\)/);
    // Back to the waived geometry: the waiver holds again, because it is tied to the geometry, not the revision.
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "size_plate", value: 0 }] });
    const back = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    assert.equal(back.rev, "r_0003");
    assert.deepEqual(verdicts(back.gates), { plate: { min_wall: "a shim" }, pin: { min_wall: "a pin" } });
    // Regression (review of the waivers, finding 1): a hole moved inside the plate keeps the
    // geometry hash and the worst finding (value and face), but not the shape: the waiver reopens.
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "shape_plate", value: 1 }] });
    const moved = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    valid("inspect", moved);
    assert.deepEqual(verdicts(moved.gates), { plate: { min_wall: "open" }, pin: { min_wall: "a pin" } });
    assert.match(moved.gates!.notes[0]!, /^1 waiver does not cover the current failure \(the part's shape, .*\): plate min_wall \(made on r_0001\)/);
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "shape_plate", value: 0 }] });
    assert.deepEqual(verdicts((await c.h.inspect({ project: "p.o3j", fields: ["gates"] })).gates), { plate: { min_wall: "a shim" }, pin: { min_wall: "a pin" } });
    // The same shape with a thinner wall (a new version of the check could find one): the finding reopens it.
    await c.h.run({ project: "p.o3j", ops: [{ op: "set_param", name: "wall_plate", value: 0.5 }] });
    const thinner = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    assert.deepEqual(verdicts(thinner.gates), { plate: { min_wall: "open" }, pin: { min_wall: "a pin" } });
  } finally {
    c.done();
  }
});

test("an overhang waiver holds for the build direction it was made for", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// overhang` });
    const up = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "overhang", target: "plate", reason: "supports under the lip" }] });
    assert.deepEqual(up.waivers?.[0]?.build, [0, 0, 1]);
    const down = await c.h.inspect({ project: "p.o3j", fields: ["gates"], targets: ["plate"], build: [0, 0, -1] });
    assert.deepEqual(verdicts(down.gates), { plate: { overhang: "open" } });
    const flipped = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "overhang", target: "plate", reason: "flipped: the lip bridges", build: [0, 0, -1] }] });
    valid("run", flipped);
    assert.deepEqual(c.pool.calls.at(-1)?.gates?.build, [0, 0, -1]);
    assert.deepEqual(verdicts((await c.h.inspect({ project: "p.o3j", fields: ["gates"], targets: ["plate"], build: [0, 0, -1] })).gates), { plate: { overhang: "flipped: the lip bridges" } });
    assert.deepEqual(verdicts((await c.h.inspect({ project: "p.o3j", fields: ["gates"], targets: ["plate"] })).gates), { plate: { overhang: "supports under the lip" } });
  } finally {
    c.done();
  }
});

test("every export records the gate status of the exported parts, with waivers, and is not blocked", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin` });
    const stl = await c.h.export({ project: "p.o3j", format: "stl" });
    valid("export", stl);
    assert.equal(stl.status, "ok");
    assert.deepEqual(stl.gates, { profile: "fdm.v1", status: "fail", open: 2, waived: 0 });
    const gateJob = c.pool.calls.find((j) => j.kind === "run" && j.gates);
    assert.deepEqual(gateJob?.gates, { profile: "fdm.v1", build: [0, 0, 1] }, "default build and bed, every placed part");
    assert.equal(c.pool.calls.at(-1)?.kind, "export");
    const sidecar = join(c.root, "p.o3j", "out", "r_0001", "p.evidence.json");
    const ev = readJson(sidecar) as { gates: GateRun };
    assert.deepEqual([ev.gates.profile, ev.gates.status, ev.gates.open, ev.gates.waived], ["fdm.v1", "fail", 2, 0]);
    assert.deepEqual(verdicts(ev.gates), { plate: { min_wall: "open" }, pin: { min_wall: "open" } });

    await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "a shim" }] });
    const pin = await c.h.export({ project: "p.o3j", format: "3mf", scope: "pin" });
    assert.deepEqual(pin.gates, { profile: "fdm.v1", status: "fail", open: 1, waived: 0 }, "a scoped export checks its own parts");
    assert.deepEqual(c.pool.calls.findLast((j) => j.kind === "run" && j.gates)?.gates?.defs, ["pin"]);
    const step = await c.h.export({ project: "p.o3j", format: "step" });
    assert.deepEqual(step.gates, { profile: "fdm.v1", status: "fail", open: 1, waived: 1 });
    assert.deepEqual(verdicts((readJson(sidecar) as { gates: GateRun }).gates), { plate: { min_wall: "a shim" }, pin: { min_wall: "open" } });
  } finally {
    c.done();
  }
});

test("a failed gate job leaves the export done and says the gates are unchecked", async () => {
  const c = setup();
  const stats = { workerId: 1, jobs: 1, wallMs: 1, memoryBytes: 1, liveShapes: 0 };
  const failing = { ...c.pool, run: (job: JobRequest, opts?: RunOptions) => job.gates
    ? Promise.resolve({ ok: false as const, kind: job.kind, error: { code: "JOB_TIMEOUT", message: "the job ran past its deadline" }, logs: [], stats, compute: job.compute! })
    : c.pool.run(job, opts) };
  c.h = createHandlers({ pool: failing, inventory: FAKE_INVENTORY, place: fakePlace, root: c.root, interactiveMs: 5_000 });
  try {
    await c.h.run({ project: "p.o3j", script: TWO_PARTS });
    const out = await c.h.export({ project: "p.o3j", format: "stl" });
    valid("export", out);
    assert.equal(out.status, "ok");
    assert.deepEqual(out.gates, { profile: "fdm.v1", status: "unchecked", error: { code: "JOB_TIMEOUT", message: "the job ran past its deadline" } });
    const ev = readJson(join(c.root, "p.o3j", "out", "r_0001", "p.evidence.json")) as { gates: unknown };
    assert.deepEqual(ev.gates, out.gates);
  } finally {
    c.done();
  }
});

// Regression (review of the waivers, findings 2 and 5): waive wrote more than the 1,000
// waivers the schema allows, and then every read refused the file: inspect gates and waive
// failed with PROJECT_CORRUPT and every export said unchecked. Waivers of removed parts were
// never dropped, so they counted toward the cap.
test("a waivers file never grows past 1,000: the waiver past the cap is refused, and the file stays readable", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin overhang` });
    // 999 overhang waivers of plate, each for its own build direction.
    const base = { def: "plate", gate: "overhang", profile: "fdm.v1", geometry_hash: "fake:plate:0", shape_hash: "fake:plate:0:0", value: 60, limit: 45, at: "face:5", reason: "printed on a raft", by: "agent", rev: "r_0001", ts: "2026-11-04T12:00:00.000Z" };
    const planted = Array.from({ length: 999 }, (_, i) => ({ ...base, build: [1, i / 1000, 0] }));
    const file = join(c.root, "p.o3j", "waivers.o3j.json");
    writeFileSync(file, JSON.stringify({ o3j: "0", waivers: planted }));
    const count = () => (readJson(file).waivers as unknown[]).length;

    const at1000 = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "a shim" }] });
    assert.equal(at1000.status, "ok", JSON.stringify(at1000.error));
    assert.equal(count(), 1000);
    const over = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "pin", reason: "a pin" }] });
    valid("run", over);
    assert.equal(over.error?.code, "BAD_INPUT");
    assert.match(over.error!.message, /1001 waivers.*at most 1000/);
    assert.match(over.error!.hint!, /Fix parts/);
    assert.equal(count(), 1000, "nothing written");
    assert.ok(validate("waivers", readJson(file)).valid);
    const gates = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    assert.equal(gates.status, "ok", JSON.stringify(gates.error));
    assert.deepEqual(verdicts(gates.gates)["plate"], { min_wall: "a shim", overhang: "open" });
    // Replacing a waiver at the cap is fine: the count stays the same.
    const again = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "a thinner shim" }] });
    assert.equal(again.status, "ok", JSON.stringify(again.error));
    assert.equal(count(), 1000);
  } finally {
    c.done();
  }
});

// Regression (review of the waivers, finding 4): the op refused a blank reason but a
// hand-written file with one passed, and the op stored control characters, which the CLI then
// printed raw (a reason with "\n    WAIVED ..." forged a line of inspect output).
test("a reason has visible text and no control characters, in the op and in the file", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin` });
    const out = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: " a shim\u0000\u001b[2J\n    WAIVED fake line‮  " }] });
    valid("run", out);
    assert.equal(out.status, "ok", JSON.stringify(out.error));
    assert.equal(out.waivers?.[0]?.reason, "a shim [2J WAIVED fake line");
    const file = join(c.root, "p.o3j", "waivers.o3j.json");
    assert.ok(validate("waivers", readJson(file)).valid);
    const blank = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "pin", reason: "\u0000\u001b‮ \n" }] });
    assert.equal(blank.error?.code, "BAD_INPUT");
    assert.match(blank.error!.message, /reason/);

    // A hand-written waiver with a blank reason is not a waiver.
    const w = (readJson(file).waivers as Array<Record<string, unknown>>)[0]!;
    writeFileSync(file, JSON.stringify({ o3j: "0", waivers: [{ ...w, reason: " " }] }));
    const gates = await c.h.inspect({ project: "p.o3j", fields: ["gates"] });
    assert.equal(gates.error?.code, "PROJECT_CORRUPT");
    assert.match(gates.error!.message, /\/waivers\/0\/reason/);
    const exp = await c.h.export({ project: "p.o3j", format: "stl" });
    assert.equal(exp.gates?.status, "unchecked");
  } finally {
    c.done();
  }
});

test("a waive drops the waivers of part definitions the head revision no longer has", async () => {
  const c = setup();
  try {
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS}\n// thin` });
    await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "plate", reason: "a shim" }, { op: "waive", gate: "min_wall", target: "pin", reason: "a pin" }] });
    // plate is renamed base: its waiver can no longer cover anything.
    await c.h.run({ project: "p.o3j", script: `${TWO_PARTS.replace("\"plate\"", "\"base\"")}\n// thin` });
    const out = await c.h.run({ project: "p.o3j", ops: [{ op: "waive", gate: "min_wall", target: "base", reason: "a base shim" }] });
    assert.equal(out.status, "ok", JSON.stringify(out.error));
    const file = readJson(join(c.root, "p.o3j", "waivers.o3j.json")) as { waivers: Array<{ def: string; reason: string }> };
    assert.deepEqual(file.waivers.map((w) => [w.def, w.reason]), [["pin", "a pin"], ["base", "a base shim"]]);
  } finally {
    c.done();
  }
});

test("the store refuses to write a waivers file it could not read back", () => {
  const root = mkdtempSync(join(tmpdir(), "o3j-waivers-store-"));
  try {
    mkdirSync(join(root, "p.o3j"));
    const store = new ProjectStore(resolveProject(root, "p.o3j"));
    const w = { def: "plate", gate: "min_wall" as const, profile: "fdm.v1" as const, geometry_hash: "m1:0", shape_hash: "s1:0", reason: "r", by: "agent" as const, rev: "r_0001", ts: "t" };
    const schema = JSON.parse(readFileSync(new URL("../../schemas/json/waivers.schema.json", import.meta.url), "utf8")) as { properties: { waivers: { maxItems: number } } };
    assert.equal(MAX_WAIVERS, schema.properties.waivers.maxItems);
    assert.throws(() => store.saveWaivers(Array.from({ length: 1001 }, () => w)), (e: Error & { code?: string }) => e.code === "BAD_INPUT" && /at most 1000/.test(e.message));
    assert.throws(() => store.saveWaivers([{ ...w, reason: "" }]), (e: Error & { code?: string }) => e.code === "INTERNAL_ERROR");
    assert.equal(existsSync(join(root, "p.o3j", "waivers.o3j.json")), false);
    store.saveWaivers([w]);
    assert.deepEqual(store.waivers(), [w]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readdirRevisions(root: string): string[] {
  return readdirSync(join(root, "p.o3j", "revisions")).sort();
}
