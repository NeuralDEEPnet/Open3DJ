import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { validate } from "@open3dj/schemas";
import type { FitReport } from "@open3dj/schemas";
import { EXIT, PACKAGE_STATUS, defaultProject, main, parseCommand, parseParams } from "./index.ts";

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) }, out, err, text: () => out.join(""), errText: () => err.join("") };
};

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

test("help and version print to the io, never fail", async () => {
  assert.equal(PACKAGE_STATUS, "ready");
  const c = capture();
  assert.equal(await main(["help"], c.io), 0);
  assert.match(c.text(), /open3dj run <script\.o3j\.js\|project\.o3j>/);
  assert.match(c.text(), /Exit codes: 0 ok/);
  const v = capture();
  assert.equal(await main(["--version"], v.io), 0);
  assert.match(v.text(), /^\d+\.\d+\.\d+/);
});

test("usage errors exit 3 with a message", async () => {
  for (const [argv, msg] of [[["frobnicate"], /unknown command/], [["export", "x.o3j"], /--format/], [["run"], /needs a script/], [["render", "part.step"], /neither a script/], [["inspect", "--fields", "colours"], /fields/], [["inspect", "x.o3j", "--fields", "gates", "--bed", "220,220"], /--bed needs three numbers, for example --bed 220,220,250;/], [["new", "x", "--template", "nope"], /template/]] as const) {
    const c = capture();
    assert.equal(await main([...argv], c.io), EXIT.usage, argv.join(" "));
    assert.match(c.errText(), msg);
  }
});

test("arguments become valid tool inputs (CLI parity)", () => {
  const run = parseCommand(["run", "parts/bracket.o3j.js", "--param", "width=40", "--param", "label=A", "--param", "solid=true"]).command;
  assert.equal(run.cmd, "run");
  if (run.cmd === "run") {
    assert.equal(run.input.project, "parts/bracket.o3j");
    assert.deepEqual(run.source, { kind: "script", path: "parts/bracket.o3j.js", project: "parts/bracket.o3j" });
    assert.deepEqual(run.input.params, { width: 40, label: "A", solid: true });
    assert.ok(validate("tool-run-input", { ...run.input, script: "return box(1,1,1)" }).valid);
  }
  const proj = parseCommand(["run", "parts/bracket.o3j/"]).command;
  assert.ok(proj.cmd === "run" && proj.source.kind === "project" && proj.source.project === "parts/bracket.o3j");
  for (const argv of [["inspect", "--fields", "tree,devices"], ["inspect", "x.o3j", "--fields", "measure", "--targets", "lid,screw#2"], ["inspect", "x.o3j", "--fields", "gates", "--gates", "fdm.v1", "--build", "0,0,-1", "--bed", "250,210,220"], ["render", "x.o3j"], ["export", "-f", "step", "x.o3j"], ["docs", "fillet", "edges"]]) {
    const c = parseCommand(argv).command;
    assert.ok("input" in c);
    if ("input" in c) assert.ok(validate(`tool-${c.cmd}-input`, c.input).valid, argv.join(" "));
  }
  const render = parseCommand(["render", "x.o3j", "--out", "drawing.svg"]).command;
  assert.ok(render.cmd === "render" && render.input.format === "svg" && render.out === "drawing.svg");
  const highlight = parseCommand(["render", "x.o3j", "--view", "highlight", "--targets", "lid@elem:face:5,screw#2", "--note", "check this lip"]).command;
  assert.ok(highlight.cmd === "render" && highlight.input.view === "highlight" && highlight.input.note === "check this lip");
  assert.deepEqual(highlight.input.targets, ["lid@elem:face:5", "screw#2"]);
  assert.ok(validate("tool-render-input", highlight.input).valid);
  const glb = parseCommand(["export", "x.o3j.js", "--format", "glb"]).command;
  assert.ok(glb.cmd === "export" && glb.input.format === "gltf" && glb.source.kind === "script");
  assert.deepEqual(parseCommand(["mcp", "--root", "/work"]).command, { cmd: "mcp", root: "/work" });
  assert.deepEqual(parseCommand(["mcp", "--workers", "2"]).command, { cmd: "mcp", workers: 2 });
  assert.throws(() => parseCommand(["mcp", "--workers", "0"]), /at least 1/);
  assert.deepEqual(parseCommand(["new", "box", "-t", "assembly"]).command, { cmd: "new", name: "box", template: "assembly" });
  assert.deepEqual(parseParams(["n=1e3", "s=", "neg=-2"]), { n: 1000, s: "", neg: -2 });
  assert.equal(defaultProject("C:\\work\\lid.o3j.js"), "C:/work/lid.o3j");
});

test("the CLI tool schema dump equals tools/list of the MCP server", async () => {
  const c = capture();
  assert.equal(await main(["tools"], c.io), 0);
  const dumped = (JSON.parse(c.text()) as { tools: unknown[] }).tools;
  const root = tmp("o3j-parity-");
  const server = fileURLToPath(new URL("../../mcp/src/testing-server.ts", import.meta.url));
  const client = new Client({ name: "parity", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, root], cwd: root, stderr: "ignore" }));
  try {
    const listed = (await client.listTools()).tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations }));
    assert.deepEqual(JSON.parse(JSON.stringify(listed)), dumped);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("docs prints hits for people", async () => {
  const c = capture();
  assert.equal(await main(["docs", "shell"], c.io), 0);
  assert.match(c.text(), /## shell {2}\[dsl\]/);
  const j = capture();
  assert.equal(await main(["docs", "REV_CONFLICT", "--json"], j.io), 0);
  assert.equal((JSON.parse(j.text()) as { hits: Array<{ kind: string }> }).hits[0]?.kind, "error");
});

test("end to end on the real pool: new, run, render, export, inspect, and the exit codes", async () => {
  const dir = tmp("o3j-cli-");
  try {
    const project = join(dir, "bracket.o3j");
    const c0 = capture();
    assert.equal(await main(["new", project], c0.io), 0, c0.errText());
    assert.ok(existsSync(join(project, "main.o3j.js")));
    assert.equal(await main(["new", project], capture().io), EXIT.usage, "new refuses an existing project");

    const run = capture();
    assert.equal(await main(["run", project, "--json"], run.io), 0, run.errText() + run.text());
    const out = JSON.parse(run.text()) as { status: string; rev: string; report: { parts: Array<{ def: string; valid: boolean }> } };
    assert.equal(out.status, "ok");
    assert.equal(out.rev, "r_0001");
    assert.deepEqual(out.report.parts.map((p) => [p.def, p.valid]), [["bracket", true]]);

    const wider = capture();
    assert.equal(await main(["run", project, "--param", "Width=80", "--base-rev", "r_0001"], wider.io), 0, wider.errText());
    assert.match(wider.text(), /^ok {2}r_0002/);
    assert.match(wider.text(), /bracket +valid/);

    const stale = capture();
    assert.equal(await main(["run", project, "--base-rev", "r_0001", "--param", "Width=90"], stale.io), EXIT.error);
    assert.match(stale.text(), /error REV_CONFLICT/);

    const png = join(dir, "bracket.png");
    const render = capture();
    assert.equal(await main(["render", project, "--out", png], render.io), 0, render.errText());
    assert.equal(readFileSync(png).subarray(1, 4).toString(), "PNG");
    assert.match(render.text(), /out\/r_0002\/multiview\.png/);

    const exp = capture();
    assert.equal(await main(["export", project, "--format", "3mf", "--out", join(dir, "exports")], exp.io), 0, exp.errText());
    assert.ok(existsSync(join(dir, "exports", "bracket.3mf")));
    assert.ok(existsSync(join(dir, "exports", "bracket.evidence.json")));

    // Regression (review round 1): --param on a project source was ignored and the old
    // revision was exported. It now runs the project with the values first.
    const param = capture();
    assert.equal(await main(["export", project, "--format", "step", "--param", "Width=60", "--json"], param.io), 0, param.errText());
    assert.equal((JSON.parse(param.text()) as { rev: string }).rev, "r_0003");
    assert.ok(existsSync(join(project, "revisions", "r_0003.json")));
    assert.equal((JSON.parse(readFileSync(join(project, "revisions", "r_0003.json"), "utf8")) as { params: { Width: number } }).params.Width, 60);

    const ins = capture();
    assert.equal(await main(["inspect", project, "--fields", "tree,measure", "--json"], ins.io), 0, ins.errText());
    const inspected = JSON.parse(ins.text()) as { rev: string; tree: Array<{ path: string }>; measure: Array<{ volume_mm3: number }> };
    assert.equal(inspected.rev, "r_0003");
    assert.deepEqual(inspected.tree.map((t) => t.path), ["bracket"]);
    assert.ok(inspected.measure[0]!.volume_mm3 > 0);

    // A script file keeps its project next to it; a broken script exits 2 with file and line.
    const script = join(dir, "broken.o3j.js");
    writeFileSync(script, "const a = box(10, 10, 10);\nreturn a.fillett(1);\n");
    const broken = capture();
    assert.equal(await main(["run", script], broken.io), EXIT.error);
    assert.match(broken.text(), /error SCRIPT_RUNTIME at .*broken\.o3j\.js:2/);

    const asm = join(dir, "enclosure.o3j");
    assert.equal(await main(["new", asm, "--template", "assembly"], capture().io), 0);
    const asmRun = capture();
    assert.equal(await main(["run", asm, "--json"], asmRun.io), 0, asmRun.errText());
    const asmOut = JSON.parse(asmRun.text()) as { status: string; report: { assembly: { occurrences: number; definitions: number }; fits: Array<{ kind: string }> } };
    assert.equal(asmOut.status, "ok");
    assert.equal(asmOut.report.assembly.occurrences, 6);
    assert.equal(asmOut.report.assembly.definitions, 3, "four screw clones share one definition");
    assert.ok(!asmOut.report.fits.some((f) => f.kind === "clash"), "the template has no clashes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression (S1 polish): --param silently rewrote params.o3j.json, so the next plain run
// used the new value and people did not know why. The CLI now says when it saved the
// values, and --no-save-params tries values without touching the working copy.
test("--param says when it saved the working copy, and --no-save-params leaves it alone", async () => {
  const dir = tmp("o3j-params-");
  try {
    const script = join(dir, "plate.o3j.js");
    writeFileSync(script, "const W = Param.number(\"Width\", 10, { min: 1, max: 100 });\nreturn box(W, 5, 2);\n");
    const paramsFile = join(dir, "plate.o3j", "params.o3j.json");
    const stored = () => JSON.parse(readFileSync(paramsFile, "utf8")) as Record<string, unknown>;

    const first = capture();
    assert.equal(await main(["run", script, "--param", "Width=20"], first.io), 0, first.errText());
    assert.match(first.text(), /\nsaved params: Width=20 in .*plate\.o3j[\\/]params\.o3j\.json\n$/);
    assert.deepEqual(stored(), { Width: 20 });

    // The same values again change nothing, so nothing is said.
    const again = capture();
    assert.equal(await main(["run", script], again.io), 0, again.errText());
    assert.doesNotMatch(again.text() + again.errText(), /saved params/);

    // --no-save-params: the run uses 30, the working copy keeps 20.
    const trial = capture();
    assert.equal(await main(["run", script, "--param", "Width=30", "--no-save-params", "--json"], trial.io), 0, trial.errText());
    const out = JSON.parse(trial.text()) as { rev: string; report: { parts: Array<{ bbox: { max: number[]; min: number[] } }> } };
    assert.equal(out.report.parts[0]!.bbox.max[0]! - out.report.parts[0]!.bbox.min[0]!, 30);
    assert.deepEqual(stored(), { Width: 20 });
    assert.match(trial.errText(), /params not saved \(--no-save-params\): params\.o3j\.json keeps Width=20/);

    // With --json the note goes to stderr, so stdout stays one JSON document.
    const json = capture();
    assert.equal(await main(["export", script, "--format", "step", "--param", "Width=40", "--json"], json.io), 0, json.errText());
    assert.doesNotThrow(() => JSON.parse(json.text()));
    assert.match(json.errText(), /saved params: Width=40 \(was 20\)/);
    assert.deepEqual(stored(), { Width: 40 });

    const parsed = parseCommand(["run", "x.o3j.js", "--param", "a=1", "--no-save-params"]).command;
    assert.ok(parsed.cmd === "run" && parsed.input.save_params === false);
    assert.ok(validate("tool-run-input", { ...(parsed.cmd === "run" ? parsed.input : {}), script: "return box(1,1,1)" }).valid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inspect --fields refs lists named faces and edges with element addresses and fingerprints", async () => {
  const dir = tmp("o3j-refs-");
  try {
    const script = join(dir, "plate.o3j.js");
    writeFileSync(script, "const X = Param.number(\"HoleX\", 0, { min: -10, max: 10 });\nconst p = box(40, 20, 5).subtract(cylinder(7, 3).translate(X, 0, -1));\nreturn p.withReferences({ top: { face: { normal: [0, 0, 1], atZ: 5 } }, hole: { face: { surface: \"cylinder\" } } });\n");
    const run = capture();
    assert.equal(await main(["run", script], run.io), 0, run.errText());
    assert.match(run.text(), /refs:\n {2}part\.top {2}exact\n {2}part\.hole {2}exact\n/);
    const ins = capture();
    assert.equal(await main(["inspect", join(dir, "plate.o3j"), "--fields", "refs", "--json"], ins.io), 0, ins.errText());
    const out = JSON.parse(ins.text()) as { refs: Array<{ name: string; state: string; at: string; fingerprint: { type: string; surface?: string } }> };
    assert.ok(validate("tool-inspect-output", out).valid, JSON.stringify(validate("tool-inspect-output", out).errors));
    assert.deepEqual(out.refs.map((r) => [r.name, r.state, r.fingerprint.type, r.fingerprint.surface]), [["part.top", "exact", "face", "plane"], ["part.hole", "exact", "face", "cylinder"]]);
    assert.ok(out.refs.every((r) => /^face:\d+$/.test(r.at)));
    // Moving the hole keeps both names exact; the text view shows the element addresses.
    const moved = capture();
    assert.equal(await main(["run", script, "--param", "HoleX=8"], moved.io), 0, moved.errText());
    const text = capture();
    assert.equal(await main(["inspect", join(dir, "plate.o3j"), "--fields", "refs"], text.io), 0);
    assert.match(text.text(), /part\.hole {2}exact {2}face:\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inspect --fields gates runs the fdm.v1 print checks in a worker: a 0.6 mm tray fails min_wall", async () => {
  const dir = tmp("o3j-gates-");
  try {
    const script = join(dir, "tray.o3j.js");
    writeFileSync(script, "return box(30, 20, 15).subtract(box(28.8, 18.8, 15).translateZ(0.6));\n");
    const ins = capture();
    assert.equal(await main(["inspect", script, "--fields", "gates", "--json"], ins.io), 0, ins.errText());
    const out = JSON.parse(ins.text()) as { gates: { parts: Array<{ pass: string[]; fail: Array<{ gate: string; value: number; waivable: string }> }> }; compute: { backend: string } };
    assert.ok(validate("tool-inspect-output", out).valid, JSON.stringify(validate("tool-inspect-output", out).errors));
    assert.deepEqual(out.gates.parts[0]!.pass, ["watertight", "overhang", "bed"]);
    assert.deepEqual(out.gates.parts[0]!.fail.map((f) => [f.gate, f.value, f.waivable]), [["min_wall", 0.6, "agent"]]);
    assert.equal(out.compute.backend, "cpu.wasm");
    const text = capture();
    assert.equal(await main(["inspect", join(dir, "tray.o3j"), "--fields", "gates", "--build", "0,0,-1"], text.io), 0, text.errText());
    assert.match(text.text(), /gates fdm\.v1 \(build 0, 0, -1; bed 220 x 220 x 250 mm\):/);
    assert.match(text.text(), /FAIL min_wall {2}0\.6 against 0\.8 at face:\d+ {2}waivable by an agent/);
    assert.match(text.text(), /FAIL overhang/, "upside down, the floor hangs over the open top");
    assert.match(text.text(), /not a print simulation/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression (review round 1): inspect --fields fits printed extra lines like primary lines,
// and run said "another gap" where the viewer and docs say "further gap".
test("run and inspect label further gaps the same way, and a lone extra line says why", async () => {
  const { formatInspect, formatReport } = await import("./format.ts");
  const fits: FitReport[] = [
    { a: "lid", b: "screw#1", kind: "contact" as const, distance_mm: 0, confidence: "measured" as const },
    { a: "lid", b: "screw#1", kind: "clearance" as const, distance_mm: 0.2, confidence: "measured" as const, extra: true },
    { a: "base", b: "lid", kind: "clearance" as const, distance_mm: 0.25, confidence: "measured" as const, extra: true },
  ];
  const inspect = formatInspect({ status: "ok", rev: "r_0001", fits, compute: { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" } });
  assert.match(inspect, /clearance {2}lid \/ screw#1 {2}0\.2 mm \(measured\) further gap\n/);
  assert.match(inspect, /clearance {2}base \/ lid {2}0\.25 mm \(measured\) beside a mated seat\n/);
  assert.match(inspect, /contact {4}lid \/ screw#1 {2}0 mm \(measured\)\n/);
  const run = formatReport({ status: "ok", rev: "r_0001", assembly: { occurrences: 3, definitions: 3 }, parts: [], fits, compute: { backend: "cpu.wasm", device: "cpu x1", placement_reason: "test" } });
  assert.match(run, /0\.2 mm \(measured\) further gap\n/);
  assert.doesNotMatch(run, /another gap/);
});

// Regression (review round 2 of increment 2): the CLI printed the token-budgeted report to a
// person, so a fresh run of the enclosure listed one clearance line and "12 more fits not listed".
test("open3dj run prints every collapsed fit line to a person, contacts first", async () => {
  const dir = tmp("o3j-cli-fits-");
  try {
    const file = join(dir, "enclosure.o3j.js");
    writeFileSync(file, readFileSync(fileURLToPath(new URL("../../../examples/enclosure/enclosure.o3j.js", import.meta.url)), "utf8"));
    const c = capture();
    assert.equal(await main(["run", file], c.io), EXIT.ok, c.errText());
    const text = c.text();
    assert.doesNotMatch(text, /more fits not listed/, text);
    assert.match(text, /contact {4}lid \/ screw#1\.\.4 .* x4\n/, text);
    const kinds = [...text.matchAll(/^ {2}(clash|contact|clearance) /gm)].map((m) => m[1]);
    assert.ok(kinds.indexOf("contact") < kinds.indexOf("clearance"), kinds.join(","));
    // Ten blocks in a row: nine contacts with distinct names, more than the concise report keeps.
    const row = join(dir, "row.o3j.js");
    writeFileSync(row, `return Array.from({ length: 10 }, (_, i) => ({ name: "block" + String.fromCharCode(65 + i), shape: box(10, 10, 10).translate(i * 10, 0, 0) }));\n`);
    const r = capture();
    assert.equal(await main(["run", row], r.io), EXIT.ok, r.errText());
    assert.equal([...r.text().matchAll(/^ {2}contact {4}block/gm)].length, 9, r.text());
    assert.doesNotMatch(r.text(), /more fits not listed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run --waive becomes a waive op (CLI parity) and checks its flags", () => {
  const w = parseCommand(["run", "tray.o3j", "--waive", "overhang", "--target", "tray", "--reason", "printed on its side", "--build", "1,0,0", "--base-rev", "r_0002"]).command;
  assert.equal(w.cmd, "run");
  if (w.cmd === "run") {
    assert.deepEqual(w.input, { project: "tray.o3j", base_rev: "r_0002", ops: [{ op: "waive", gate: "overhang", target: "tray", reason: "printed on its side", build: [1, 0, 0] }] });
    assert.ok(validate("tool-run-input", w.input).valid, JSON.stringify(validate("tool-run-input", w.input).errors));
  }
  const cases: Array<[string[], RegExp]> = [
    [["run", "t.o3j", "--waive", "min_wall", "--reason", "r"], /--waive needs --target/],
    [["run", "t.o3j", "--waive", "min_wall", "--target", "t"], /--waive needs --reason/],
    [["run", "t.o3j", "--target", "t"], /--target, --reason and --build go with --waive/],
    [["run", "t.o3j", "--waive", "min_wall", "--target", "t", "--reason", "r", "--param", "a=1"], /--waive takes no --param/],
  ];
  for (const [argv, msg] of cases) assert.throws(() => parseCommand(argv), msg, argv.join(" "));
});

test("waivers on the real pool: a waived min_wall passes inspect and the export evidence until the part changes", async () => {
  const dir = tmp("o3j-waive-");
  try {
    const script = join(dir, "tray.o3j.js");
    writeFileSync(script, "const F = Param.number(\"Floor\", 0.6, { min: 0.2, max: 3 });\nreturn [{ name: \"tray\", shape: box(30, 20, 15).subtract(box(28.8, 18.8, 15).translateZ(F)) }];\n");
    const project = join(dir, "tray.o3j");
    assert.equal(await main(["run", script], capture().io), 0);

    const person = capture();
    assert.equal(await main(["run", project, "--waive", "watertight", "--target", "tray", "--reason", "it is fine"], person.io), EXIT.error);
    assert.match(person.text(), /error WAIVER_NEEDS_PERSON: .*person/);

    const waive = capture();
    assert.equal(await main(["run", project, "--waive", "min_wall", "--target", "tray", "--reason", "a drain tray: 0.6 mm walls print as two perimeters"], waive.io), 0, waive.errText() + waive.text());
    assert.match(waive.text(), /^ok {2}r_0001 {2}waived min_wall on tray \(0\.6 against 0\.8 at face:\d+\): a drain tray/);

    const ins = capture();
    assert.equal(await main(["inspect", project, "--fields", "gates", "--json"], ins.io), 0, ins.errText());
    const out = JSON.parse(ins.text()) as { gates: { status: string; open: number; waived: number; parts: Array<{ fail: Array<{ gate: string; waiver?: { by: string; reason: string } }> }> } };
    assert.ok(validate("tool-inspect-output", out).valid, JSON.stringify(validate("tool-inspect-output", out).errors));
    assert.deepEqual([out.gates.status, out.gates.open, out.gates.waived], ["pass", 0, 1]);
    assert.equal(out.gates.parts[0]!.fail[0]!.waiver?.by, "agent");
    const text = capture();
    assert.equal(await main(["inspect", project, "--fields", "gates"], text.io), 0);
    assert.match(text.text(), /gates fdm\.v1 \(build 0, 0, 1; bed 220 x 220 x 250 mm\): pass, 0 open, 1 waived/);
    assert.match(text.text(), /WAIVED min_wall {2}0\.6 against 0\.8 at face:\d+ {2}by an agent on r_0001: a drain tray/);

    const exp = capture();
    assert.equal(await main(["export", project, "--format", "stl", "--json"], exp.io), 0, exp.errText());
    const exported = JSON.parse(exp.text()) as { gates: { status: string; waived: number } };
    assert.deepEqual([exported.gates.status, exported.gates.waived], ["pass", 1]);
    const evidence = JSON.parse(readFileSync(join(project, "out", "r_0001", "tray.evidence.json"), "utf8")) as { gates: { status: string; parts: Array<{ fail: Array<{ waiver?: { reason: string } }> }> } };
    assert.equal(evidence.gates.status, "pass");
    assert.match(evidence.gates.parts[0]!.fail[0]!.waiver!.reason, /drain tray/);

    // A thicker floor changes the part's geometry hash: the waiver no longer covers it.
    assert.equal(await main(["run", script, "--param", "Floor=1"], capture().io), 0);
    const again = capture();
    assert.equal(await main(["export", project, "--format", "3mf"], again.io), 0, again.errText());
    assert.match(again.text(), /gates fdm\.v1: fail, 1 open, 0 waived/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression (review of the waivers, finding 1): moving a hole inside a plate keeps the
// geometry hash (a hash of the measures), and gates reported only the thinnest wall, so a
// waiver made for the wall at hole A also hid a new 0.7 mm wall at hole B, and the export
// evidence said pass. A waiver is now bound to the part's shape (shape_hash, from the gate
// mesh), and min_wall lists every failing face.
test("waivers on the real pool: a moved hole that thins a new wall reopens the waiver, though the geometry hash is the same", async () => {
  const dir = tmp("o3j-waive-moved-");
  try {
    const script = join(dir, "plate.o3j.js");
    writeFileSync(script, [
      "const BY = Param.number(\"HoleB_Y\", 0, { min: -6.4, max: 6.4, unit: \"mm\" });",
      "const holeA = cylinder(5, 3).translate(-16.4, 0, 0);",
      "const holeB = cylinder(5, 3).translate(8, BY, 0);",
      "return [{ name: \"plate\", shape: box(40, 20, 5).subtract(holeA, holeB) }];",
      "",
    ].join("\n"));
    const project = join(dir, "plate.o3j");
    type Gates = { status: string; open: number; waived: number; notes: string[]; parts: Array<{ shape_hash: string; fail: Array<{ gate: string; value: number; at: string; faces?: Array<{ at: string; value: number }>; waiver?: unknown }> }> };
    const gates = async () => {
      const c = capture();
      assert.equal(await main(["inspect", project, "--fields", "gates", "--json"], c.io), 0, c.errText());
      const out = JSON.parse(c.text()) as { rev: string; gates: Gates };
      assert.ok(validate("tool-inspect-output", out).valid, JSON.stringify(validate("tool-inspect-output", out).errors));
      return out;
    };
    const hash = () => (JSON.parse(readFileSync(join(project, "assembly.o3j.json"), "utf8")) as { definitions: Record<string, { geometry_hash: string }> }).definitions["plate"]!.geometry_hash;

    assert.equal(await main(["run", script], capture().io), 0);
    const first = await gates();
    const wall = first.gates.parts[0]!.fail.find((f) => f.gate === "min_wall")!;
    assert.ok(Math.abs(wall.value - 0.6) < 0.02, JSON.stringify(wall));
    // Only hole A is thin: its own face and the plate's end face.
    assert.deepEqual(wall.faces?.map((f) => f.value < 0.62), [true, true], JSON.stringify(wall.faces));
    const waive = capture();
    assert.equal(await main(["run", project, "--waive", "min_wall", "--target", "plate", "--reason", "breakaway lug at hole A, cut off after printing"], waive.io), 0, waive.errText() + waive.text());
    const waived = await gates();
    assert.deepEqual([waived.gates.status, waived.gates.open, waived.gates.waived], ["pass", 0, 1]);
    const hashBefore = hash();
    const shapeBefore = waived.gates.parts[0]!.shape_hash;
    assert.equal(shapeBefore, first.gates.parts[0]!.shape_hash, "the same shape gives the same shape_hash in another gate job");

    // Hole B moves to 0.7 mm from the side: the measures, and so the geometry hash, stay the same.
    assert.equal(await main(["run", script, "--param", "HoleB_Y=6.3"], capture().io), 0);
    assert.equal(hash(), hashBefore, "the geometry hash misses a hole moved inside the plate");
    const moved = await gates();
    assert.equal(moved.rev, "r_0002");
    assert.notEqual(moved.gates.parts[0]!.shape_hash, shapeBefore);
    assert.deepEqual([moved.gates.status, moved.gates.open, moved.gates.waived], ["fail", 1, 0]);
    const now = moved.gates.parts[0]!.fail.find((f) => f.gate === "min_wall")!;
    assert.ok(now.faces!.some((f) => f.value > 0.65 && f.value < 0.75), `the 0.7 mm wall at hole B is listed: ${JSON.stringify(now.faces)}`);
    assert.match(moved.gates.notes[0]!, /^1 waiver does not cover the current failure .*plate min_wall \(made on r_0001\)/);
    const exp = capture();
    assert.equal(await main(["export", project, "--format", "3mf"], exp.io), 0, exp.errText());
    assert.match(exp.text(), /gates fdm\.v1: fail, 1 open, 0 waived/);

    // Back to the waived shape, rebuilt from the script: the waiver holds again.
    assert.equal(await main(["run", script, "--param", "HoleB_Y=0"], capture().io), 0);
    const back = await gates();
    assert.equal(back.rev, "r_0003");
    assert.deepEqual([back.gates.status, back.gates.open, back.gates.waived], ["pass", 0, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
