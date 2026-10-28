// Behaviour beyond the spike's conformance table: the fixed mirror, error reports with the
// user's line, parameters, return forms, shell fallback, path(), limits and memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { center, harness, near, vecNear } from "./testing.ts";

const PI = Math.PI;

test("sketch mirror takes the NORMAL of the mirror line (the spike used it as the direction)", async () => {
  const h = await harness();
  const r = await h.run([
    "const a = rect(2, 2).translate(5, 0).mirror([1, 0]).extrude(1);",
    "const b = rect(2, 2).translate(0, 5).mirror([0, 1]).extrude(1);",
    "const c = rect(2, 2).translate(5, 0).mirror([1, 1]).extrude(1);",
    "return [a, b, c];",
  ].join("\n"));
  assert.equal(r.ok, true, r.error?.message);
  const [a, b, c] = r.parts.map((p) => center(p.m));
  assert.ok(vecNear(a!, [-5, 0, 0.5]), JSON.stringify(a));
  assert.ok(vecNear(b!, [0, -5, 0.5]), JSON.stringify(b));
  // Reflecting (5, 0) through the line x + y = 0 gives (0, -5).
  assert.ok(vecNear(c!, [0, -5, 0.5]), JSON.stringify(c));
});

test("3D mirror reflects through the plane through the origin with the given normal", async () => {
  const h = await harness();
  const r = await h.run("return [box(2, 2, 2).translate(5, 0, 0).mirror([1, 0, 0]), box(2, 2, 2).translate(0, 0, 4).mirrorThrough([0, 0, 2], [0, 0, 1])];");
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(vecNear(center(r.parts[0]!.m), [-5, 0, 1]));
  assert.ok(vecNear(center(r.parts[1]!.m), [0, 0, -1]));
});

test("a kernel failure becomes a ScriptError with the user's line, faulty edges and a hint", async () => {
  const h = await harness();
  const r = await h.run("const b = box(20, 20, 10);\n// a radius larger than the box\nconst f = fillet(b, 30, { atZ: 10 });\nreturn f;");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "KERNEL_FILLET_FAILED");
  assert.equal(r.error!.line, 3);
  assert.equal(r.error!.op, "fillet");
  assert.match(r.error!.hint ?? "", /smaller radius/);
});

test("a failed chamfer names the faulty edge as an element address", async () => {
  const h = await harness();
  const code = [
    "const t = 10.948;",
    "let flange = cylinder(t, 57.792).subtract(cylinder(t + 2, 39.054).translate(0, 0, -1), circularPattern(cylinder(t + 2, 2.964).translate(42.853, 0, -1), 13));",
    "flange = chamfer(flange, 2.62, { atZ: t, minLength: 57.792 });",
    "return flange;",
  ].join("\n");
  const r = await h.run(code);
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "KERNEL_CHAMFER_FAILED");
  assert.equal(r.error!.line, 3);
  assert.ok((r.error!.elements ?? []).length > 0 && r.error!.elements!.every((e) => /^edge:\d+$/.test(e)), JSON.stringify(r.error!.elements));
  assert.match(r.error!.hint ?? "", /smaller size/);
});

test("an edge query that matches nothing says so", async () => {
  const h = await harness();
  const r = await h.run("return fillet(box(10, 10, 10), 1, { atZ: 11 });");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "DSL_NO_EDGES");
  assert.equal(r.error!.line, 1);
  assert.match(r.error!.hint ?? "", /atZ/);
});

test("a shell that cannot work reports SHELL_FAILED with the shell hint", async () => {
  const h = await harness();
  const r = await h.run("const s = cylinder(10, 10);\n\nreturn s.shell(12);");
  assert.equal(r.ok, false);
  assert.match(r.error!.code, /^KERNEL_(SHELL_FAILED|INVALID_RESULT)$/);
  assert.equal(r.error!.line, 3);
  assert.match(r.error!.hint ?? "", /^shell failed: try a smaller thickness/);
});

test("a shell that OCCT returns valid but wrong is caught (walls not t thick, or no cavity)", async () => {
  const h = await harness();
  // Measured: OCCT returned this unchanged (volume 4000) with isValid true.
  const same = await h.run("return box(20, 20, 10).fillet(1).shell(12);");
  assert.equal(same.error?.code, "KERNEL_INVALID_RESULT");
  // Measured: OCCT removed about 40 mm3 instead of about 1400 mm3, with isValid true.
  const thin = await h.run("const b = fillet(box(20, 20, 10), 1);\nreturn b.shell(3);");
  assert.equal(thin.error?.code, "KERNEL_INVALID_RESULT");
  assert.equal(thin.error?.line, 2);
  assert.match(thin.error?.hint ?? "", /shell before adding fillets/);
  // A correct shell passes the same check.
  const ok = await h.run("return cylinder(10, 10).shell(4);");
  assert.equal(ok.ok, true, ok.error?.message);
  assert.ok(near(ok.parts[0]!.m.volume, PI * 100 * 10 - PI * 36 * 6));
});

test("shell falls back to a profile offset when OCCT's thick-solid fails (wall >= corner radius)", async () => {
  const h = await harness();
  // A rounded box, hollowed with an open top, with a row of slots through both long walls.
  const vented = [
    "const r = Param.number('Corner radius', 4, { min: 0, max: 12 });",
    "const W = 70, D = 50, H = 28, t = 2.4, n = 6;",
    "const shell = roundedRect(W, D, Math.max(r, 0.01)).extrude(H).shell(t);",
    "const pitch = W / (n + 1);",
    "const cutter = box(3, 4 * t, 0.45 * H).translate(-pitch * (n - 1) / 2, D / 2, 0.4 * H);",
    "const row = linearPattern(cutter, n, pitch, 0);",
    "return shell.subtract(row, row.mirror([0, 1, 0]));",
  ].join("\n");
  const slots = 12 * 3 * 2.4 * (28 * 0.45);
  const rr = (w: number, d: number, r: number) => w * d - (4 - PI) * r * r;

  const normal = await h.run(vented);
  assert.equal(normal.ok, true, normal.error?.message);
  // The vented-enclosure starter at its defaults (independent oracle from the spike: 21138.826).
  assert.ok(near(normal.parts[0]!.m.volume, rr(70, 50, 4) * 28 - rr(65.2, 45.2, 1.6) * 25.6 - slots));
  assert.deepEqual(normal.out!.warnings, []);

  const sharp = await h.run(vented, { "Corner radius": 0 });
  assert.equal(sharp.ok, true, sharp.error?.message);
  assert.ok(sharp.parts[0]!.m.valid);
  // Corner 0.01 < wall: the inner corners are sharp after the offset.
  assert.ok(near(sharp.parts[0]!.m.volume, rr(70, 50, 0.01) * 28 - 65.2 * 45.2 * 25.6 - slots));
  assert.match(sharp.out!.warnings.join("\n"), /profile offset/);
});

test("DSL entries not in S1 throw DSL_NOT_IMPLEMENTED naming the entry", async () => {
  const h = await harness();
  for (const [code, entry] of [["text2d('hi')", "text2d"], ["Rectangle2D.fromDimensions(0, 0, 1, 1)", "Rectangle2D.fromDimensions"], ["lib.snapFit({})", "lib.snapFit"], ["box(1, 1, 1).hole('top', {})", "hole"], ["minWall(box(1, 1, 1), 1)", "minWall"]] as const) {
    const r = await h.run(`\n${code};\nreturn box(1, 1, 1);`);
    assert.equal(r.ok, false, code);
    assert.equal(r.error!.code, "DSL_NOT_IMPLEMENTED", code);
    assert.ok(r.error!.message.startsWith(entry), r.error!.message);
    assert.equal(r.error!.line, 2, code);
  }
});

test("bad arguments are refused with DSL_BAD_ARGUMENT at the user's line", async () => {
  const h = await harness();
  for (const code of ["box(-1, 1, 1)", "box(NaN, 1, 1)", "box('10', 1, 1)", "box(1e300, 1, 1)", "cylinder(10)", "torus(3, 5)", "roundedRect(10, 10, 6)", "box(1, 1, 1).translate('a')", "box(1, 1, 1).add(rect(1, 1))"]) {
    const r = await h.run(`const a = 1;\nreturn ${code};`);
    assert.equal(r.ok, false, code);
    assert.equal(r.error!.code, "DSL_BAD_ARGUMENT", `${code}: ${r.error!.code} ${r.error!.message}`);
    assert.equal(r.error!.line, 2, code);
  }
});

test("a syntax error points at the user's line", async () => {
  const h = await harness();
  const r = await h.run("const a = box(1, 1, 1);\nconst b = a.translate(1, 0, 0;\nreturn b;");
  assert.equal(r.ok, false);
  assert.equal(r.error!.code, "SCRIPT_SYNTAX");
  assert.equal(r.error!.line, 2);
});

test("Param values: defaults, caller overrides, clamping with a warning, choices", async () => {
  const h = await harness();
  const code = [
    "const w = Param.number('Width', 20, { min: 10, max: 50, unit: 'mm' });",
    "const n = Param.number('Count', 2, { min: 1, max: 5, integer: true });",
    "const round = Param.bool('Round', false);",
    "const size = Param.choice('Size', 'M3', ['M3', 'M4']);",
    "const label = Param.string('Label', 'abc', { maxLength: 2 });",
    "return linearPattern(round ? cylinder(5, w / 2) : box(w, w, 5), n, w * 2, 0);",
  ].join("\n");
  const d = await h.run(code);
  assert.equal(d.ok, true, d.error?.message);
  assert.deepEqual(d.out!.params, { Width: 20, Count: 2, Round: false, Size: "M3", Label: "ab" });
  assert.ok(near(d.parts[0]!.m.volume, 2 * 20 * 20 * 5));
  const spec = d.out!.paramSpecs!.find((p) => p.name === "Width")!;
  assert.deepEqual([spec.min, spec.max, spec.unit, spec.default], [10, 50, "mm", 20]);

  const o = await h.run(code, { Width: 80, Count: 2.6, Round: true, Size: "M4", Extra: 1 });
  assert.equal(o.ok, true, o.error?.message);
  assert.deepEqual(o.out!.params, { Width: 50, Count: 3, Round: true, Size: "M4", Label: "ab" });
  assert.ok(near(o.parts[0]!.m.volume, 3 * PI * 25 * 25 * 5));
  assert.match(o.out!.warnings.join("\n"), /Width = 80 is above its maximum 50/);
  assert.match(o.out!.warnings.join("\n"), /Extra was given but the script does not declare it/);

  const bad = await h.run(code, { Size: "M5" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error!.code, "DSL_BAD_PARAM");
  assert.equal(bad.error!.line, 4);
});

test("return forms: a shape, descriptors, an object of named shapes, falsy entries skipped", async () => {
  const h = await harness();
  const one = await h.run("return box(1, 1, 1).name('Cube').color('#ff0000');");
  assert.deepEqual(one.parts.map((p) => [p.name, p.color]), [["Cube", [1, 0, 0]]]);

  const list = await h.run("return [box(1, 1, 1), { name: 'Big', shape: box(2, 2, 2), color: '#00f' }, false && box(1, 1, 1), null];");
  assert.deepEqual(list.parts.map((p) => [p.name, p.color]), [["part", undefined], ["Big", [0, 0, 1]]]);

  const named = await h.run("return { lid: box(1, 1, 1), base: box(2, 2, 2).color([0, 128, 255]) };");
  assert.deepEqual(named.parts.map((p) => [p.name, p.color]), [["lid", undefined], ["base", [0, 0.502, 1]]]);

  const sketch = await h.run("return rect(1, 1);");
  assert.equal(sketch.error?.code, "DSL_BAD_RETURN");
  const none = await h.run("const a = box(1, 1, 1);");
  assert.equal(none.error?.code, "DSL_BAD_RETURN");
  const junk = await h.run("return 42;");
  assert.equal(junk.error?.code, "DSL_BAD_RETURN");
});

test("path() draws lines and arcs; positive arcTo radius bulges to the left", async () => {
  const h = await harness();
  // A 20 x 10 rectangle whose top edge is a half circle of radius 10 bulging up
  // (travelling from (-10, 10) to (10, 10), left is +Y).
  const r = await h.run("return path().moveTo(-10, 10).arcTo(10, 10, 10).lineV(-10).lineH(-20).close().extrude(2);");
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(near(r.parts[0]!.m.volume, (200 + (PI * 100) / 2) * 2, 1e-6));
  assert.ok(Math.abs(r.parts[0]!.m.bbox.max[1] - 20) < 1e-6);
  const angled = await h.run("return path().moveTo(0, 0).lineAngled(10, 0).lineAngled(10, 90).lineTo(0, 10).close().extrude(1);");
  assert.ok(near(angled.parts[0]!.m.volume, 100));
});

test("clone() then moving gives rigid copies that share a clone group", async () => {
  const h = await harness();
  const r = await h.run([
    "const base = cylinder(5, 8).subtract(cylinder(7, 3).translate(0, 0, -1));",
    "const planets = [];",
    "for (let i = 0; i < 3; i++) {",
    "  const a = (i * 2 * Math.PI) / 3;",
    "  planets.push({ name: 'Planet ' + (i + 1), shape: base.clone().rotate([0, 0, 1], 30 * i).translate(20 * Math.cos(a), 20 * Math.sin(a), 0) });",
    "}",
    "return [...planets, { name: 'Sun', shape: cylinder(5, 10) }];",
  ].join("\n"));
  assert.equal(r.ok, true, r.error?.message);
  const [p1, p2, p3, sun] = r.parts;
  assert.ok(p1!.cloneOf && p1!.cloneOf === p2!.cloneOf && p2!.cloneOf === p3!.cloneOf);
  assert.equal(sun!.cloneOf, undefined);
  // cloneTransform maps the source to each copy: its translation is the copy's centre here.
  const t = p2!.cloneTransform!;
  assert.ok(vecNear(t.t, [20 * Math.cos((2 * PI) / 3), 20 * Math.sin((2 * PI) / 3), 0]));
  assert.ok(vecNear(t.q, [0, 0, Math.sin((30 * PI) / 360), Math.cos((30 * PI) / 360)]));
  for (const p of [p1, p2, p3]) assert.ok(near(p!.m.volume, PI * (64 - 9) * 5));
});

test("host-call, handle and batch limits end the run with SCRIPT_LIMIT", async () => {
  const h = await harness();
  const calls = await h.run("for (let i = 0; i < 100000; i++) box(1, 1, 1);", {}, { maxHostCalls: 200 });
  assert.equal(calls.error?.code, "SCRIPT_LIMIT");
  const handles = await h.run("const a = []; for (let i = 0; i < 300; i++) a.push(box(1, 1, 1)); return a[0];", {}, { maxHandles: 100 });
  assert.equal(handles.error?.code, "SCRIPT_LIMIT");
  const batch = await h.run("return union(Array.from({ length: 50 }, (_, i) => box(1, 1, 1).translate(i * 2, 0, 0)));", {}, { maxBatch: 20 });
  assert.equal(batch.error?.code, "SCRIPT_LIMIT");
});

test("prototype poisoning cannot change geometry (intrinsics are frozen)", async () => {
  const h = await harness();
  const r = await h.run("try { Array.prototype.map = function () { return []; }; } catch (e) {}\nreturn box(10, 10, 10).subtract([cylinder(20, 2).translate(0, 0, -5)]);");
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(near(r.parts[0]!.m.volume, 1000 - PI * 4 * 10));
});

test("checkpoint/releaseSince around each run keeps the kernel's live shapes flat", async () => {
  const h = await harness();
  const code = "const b = fillet(box(20, 20, 10), 1, { atZ: 10 });\nreturn b.subtract(circularPattern(cylinder(12, 2).translate(6, 0, -1), 6));";
  await h.run(code);
  const before = h.kernel.stats().liveShapes;
  for (let i = 0; i < 10; i++) {
    const r = await h.run(code);
    assert.equal(r.ok, true);
  }
  assert.equal(h.kernel.stats().liveShapes, before);
});

// Regression (review round 1): ellipse() was two brepjs B-splines, so OCCT's volume and area
// integration was off by about 1.5e-4 relative. The kernel's exact ellipse edge is exact.
test("ellipse profiles are exact: extrude, tall ellipse, revolve and area", async () => {
  const h = await harness();
  const r = await h.run([
    "console.log(ellipse(60, 20).area());",
    "return [ellipse(60, 20).extrude(10), ellipse(20, 60).extrude(10), ellipse(3, 2).translate(10, 5).revolve(), ellipse(6, 3).rotate(30).translate(1, 2).extrude(2)];",
  ].join("\n"));
  assert.equal(r.ok, true, r.error?.message);
  const [wide, tall, ring, moved] = r.parts.map((p) => p.m);
  assert.ok(near(r.logs[0] as number, 1200 * Math.PI, 1e-9), String(r.logs[0]));
  assert.ok(near(wide!.volume, 12000 * Math.PI, 1e-9), String(wide!.volume));
  assert.ok(near(tall!.volume, 12000 * Math.PI, 1e-9), String(tall!.volume));
  assert.ok(Math.abs(tall!.bbox.max[1] - 60) < 1e-6 && Math.abs(tall!.bbox.max[0] - 20) < 1e-6, JSON.stringify(tall!.bbox));
  assert.ok(near(ring!.volume, 2 * Math.PI * 10 * Math.PI * 6, 1e-9), String(ring!.volume));
  assert.ok(near(moved!.volume, 36 * Math.PI, 1e-9), String(moved!.volume));
});

// Regression (review round 1): rotate() dropped the extrusion record, so the profile-offset
// fallback of shell() worked after translate() but not after rotateZ(), for the same solid.
test("shell's profile-offset fallback survives rotations about Z and translations", async () => {
  const h = await harness();
  // Wall 3 is thicker than the corner radius 2, so OCCT's thick-solid fails and the fallback runs.
  const cavity = 40 * 30 * 20 - 34 * 24 * 17 - (4 - PI) * 4 * 20; // outer rounded box minus a sharp-cornered cavity
  for (const [what, code] of [
    ["plain", "return roundedRect(40, 30, 2).extrude(20).shell(3);"],
    ["rotated about Z", "return roundedRect(40, 30, 2).extrude(20).rotateZ(30).shell(3);"],
    ["rotated about Z with a pivot, then moved", "return roundedRect(40, 30, 2).extrude(20).rotate([0, 0, -1], 50, [5, 5, 0]).translate(3, 4, 5).shell(3);"],
  ] as const) {
    const r = await h.run(code);
    assert.equal(r.ok, true, `${what}: ${r.error?.code} ${r.error?.message}`);
    const m = r.parts[0]!.m;
    assert.ok(m.valid, what);
    assert.ok(near(m.volume, cavity, 1e-6), `${what}: volume ${m.volume} != ${cavity}`);
  }
  // A rotation that tips the extrusion off Z cannot use the fallback; the error says why.
  const tipped = await h.run("return roundedRect(40, 30, 2).extrude(20).rotateX(90).shell(3);");
  assert.equal(tipped.ok, false);
  assert.match(tipped.error?.hint ?? "", /shell before rotating/);
});
