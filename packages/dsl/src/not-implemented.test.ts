// Issue #18: an entry that throws DSL_NOT_IMPLEMENTED used to give the same generic hint every
// time, so agents guessed and wasted calls. Every such entry now names a working alternative,
// and every DSL call a hint suggests must exist and be implemented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DSL_ENTRIES } from "./entries.ts";
import { notImplemented } from "./errors.ts";
import { DSL_METHODS, runtimeHint } from "./hints.ts";
import { GENERIC_NOT_IMPLEMENTED_HINT, NOT_IMPLEMENTED_HINTS, notImplementedHint } from "./not-implemented.ts";
import { PRELUDE } from "./prelude.ts";
import { harness } from "./testing.ts";

/** Every entry the prelude stubs with NI(...). */
const GUEST = [...new Set([...PRELUDE.matchAll(/\bNI\("([^"]+)"\)/g)].map((m) => m[1]!))];
/** The host's not-implemented cases: sketch operations on a profile with holes (sketch.ts). */
const HOLES: ReadonlyArray<readonly [string, string]> = [
  ["offset of a profile with holes", "rect(20, 20).subtract(circle2d(3)).offset(1).extrude(5)"],
  ["extrude with twist or scaleTop of a profile with holes", "rect(20, 20).subtract(circle2d(3)).extrude(10, { twist: 30 })"],
  ["extrude with twist or scaleTop of a profile with holes", "rect(20, 20).subtract(circle2d(3)).extrude(10, { scaleTop: 0.5 })"],
  ["loft of a profile with holes", "loft([rect(20, 20).subtract(circle2d(3)), rect(10, 10)], [0, 10])"],
];
const NOT_IMPLEMENTED = new Set([...GUEST, ...HOLES.map(([entry]) => entry)]);

/** A call that reaches the entry from a script. */
function call(entry: string): string {
  if (entry === "hole" || entry === "cutout" || entry === "onFace") return `box(1, 1, 1).${entry}()`;
  if (entry === "shape.face") return "box(1, 1, 1).face()";
  if (entry === "sketch.onFace") return "rect(1, 1).onFace()";
  return `${entry}()`;
}

test("the prelude's NI stubs are all found", () => {
  // Guards the regex above: a sample from every kind of stub (method, global, namespace, lib).
  for (const entry of ["hole", "cutout", "onFace", "shape.face", "sketch.onFace", "group", "tolerance", "minWall", "text2d", "spline2d", "point", "Point2D", "Rectangle2D.from2Corners", "Shape.fromSlices", "lib.snapFit", "lib.tSlotProfile"]) {
    assert.ok(GUEST.includes(entry), entry);
  }
});

test("every not-implemented entry in the prelude gives its own hint", async () => {
  const h = await harness();
  for (const entry of GUEST) {
    assert.ok(Object.hasOwn(NOT_IMPLEMENTED_HINTS, entry), `${entry} needs a hint in not-implemented.ts`);
    const r = await h.run(`const a = 1;\n${call(entry)};\nreturn box(1, 1, 1);`);
    assert.equal(r.ok, false, entry);
    assert.equal(r.error!.code, "DSL_NOT_IMPLEMENTED", entry);
    assert.equal(r.error!.message, `${entry} is not implemented in Open3DJ DSL v1 yet`);
    assert.equal(r.error!.line, 2, entry);
    assert.equal(r.error!.hint, NOT_IMPLEMENTED_HINTS[entry], entry);
  }
});

test("sketch operations on a profile with holes give their own hint", async () => {
  const h = await harness();
  for (const [entry, code] of HOLES) {
    const r = await h.run(`const a = 1;\nreturn ${code};`);
    assert.equal(r.ok, false, code);
    assert.equal(r.error!.code, "DSL_NOT_IMPLEMENTED", code);
    assert.equal(r.error!.message, `${entry} is not implemented in Open3DJ DSL v1 yet`, code);
    assert.equal(r.error!.line, 2, code);
    assert.ok(Object.hasOwn(NOT_IMPLEMENTED_HINTS, entry), `${entry} needs a hint in not-implemented.ts`);
    assert.equal(r.error!.hint, NOT_IMPLEMENTED_HINTS[entry], code);
  }
});

test("lib names without a hint of their own get the lib hint; other names the generic one", () => {
  // host.ts throws notImplemented("lib.<name>") for a lib name it does not know.
  for (const entry of ["lib.gear", "lib.constructor", "lib.__proto__"]) {
    assert.equal(notImplementedHint(entry), NOT_IMPLEMENTED_HINTS["lib.*"], entry);
    assert.equal(notImplemented(entry).hint, NOT_IMPLEMENTED_HINTS["lib.*"], entry);
  }
  assert.equal(notImplementedHint("constructor"), GENERIC_NOT_IMPLEMENTED_HINT);
  assert.equal(notImplementedHint("toString"), GENERIC_NOT_IMPLEMENTED_HINT);
});

test("a script that calls a lib name lib does not have gets the lib hint", async () => {
  // lib is a frozen guest object, so lib.gear() fails as "not a function"; the runtime hint
  // (applied to every run's SCRIPT_RUNTIME error) used to call it an unknown method of shapes.
  const h = await harness();
  for (const code of ["return lib.gear(20);", "const b = box(10, 10, 10);\nreturn b.subtract(lib.clearanceHole('M3', { length: 10 }), lib.gear(20));"]) {
    const script = `const a = 1;\n${code}`;
    const r = await h.run(script);
    assert.equal(r.ok, false, code);
    assert.equal(r.error!.code, "SCRIPT_RUNTIME", code);
    assert.equal(runtimeHint(r.error!, script), `"lib.gear" does not exist: ${NOT_IMPLEMENTED_HINTS["lib.*"]}`, code);
  }
  // A lib member that exists is not the unknown name on the line.
  const script = "const a = 1;\nreturn lib.clearanceHole('M3', { length: 10 }).frobnicate();";
  const r = await h.run(script);
  assert.equal(r.error!.code, "SCRIPT_RUNTIME");
  assert.match(runtimeHint(r.error!, script) ?? "", /^"\.frobnicate\(\)" is not a method/);
});

test("every hint is one sentence of its own, for an entry that is still not implemented", (t) => {
  const implemented = new Set(DSL_ENTRIES.filter((e) => e.step !== "later").map((e) => e.name));
  for (const [entry, hint] of Object.entries(NOT_IMPLEMENTED_HINTS)) {
    if (implemented.has(entry)) {
      // Another change implemented the entry: its hint is never shown. Not a failure, so main
      // stays green whichever of the two changes merges first; delete the line when you see this.
      t.diagnostic(`${entry} is implemented now: delete its hint in not-implemented.ts`);
      continue;
    }
    assert.ok(entry === "lib.*" || NOT_IMPLEMENTED.has(entry), `${entry} is neither a DSL entry nor a not-implemented case: fix its name in not-implemented.ts`);
    assert.notEqual(hint, GENERIC_NOT_IMPLEMENTED_HINT, entry);
    assert.match(hint, /^[A-Za-z].*\.$/, entry);
    assert.doesNotMatch(hint, /[.!?] [A-Z]/, `${entry}: keep the hint to one sentence`);
  }
});

test("every DSL call a hint suggests exists and is implemented", () => {
  const implemented = new Set(DSL_ENTRIES.filter((e) => e.step !== "later").map((e) => e.name));
  const notImplementedMethod = (name: string) => NOT_IMPLEMENTED.has(name) || NOT_IMPLEMENTED.has(`shape.${name}`) || NOT_IMPLEMENTED.has(`sketch.${name}`);
  let calls = 0;
  for (const [entry, hint] of Object.entries(NOT_IMPLEMENTED_HINTS)) {
    // Calls are written name(...), lib.name(...) or .method(...); prose never puts "(" right after a word.
    for (const m of hint.matchAll(/(?<![\w$.])(\.?)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/g)) {
      const [dot, name] = [m[1]!, m[2]!];
      calls++;
      if (dot) {
        assert.ok(DSL_METHODS.has(name), `${entry}: the hint suggests .${name}(), which is not a method of shapes, sketches or paths`);
        assert.ok(!notImplementedMethod(name), `${entry}: the hint suggests .${name}(), which is not implemented either`);
      } else {
        assert.ok(implemented.has(name), `${entry}: the hint suggests ${name}(), which is not an implemented DSL entry`);
      }
    }
  }
  assert.ok(calls > 40, `only ${calls} calls found: is the pattern still right?`);
});

test("the lib hint lists exactly the lib entries that are implemented", () => {
  const listed = /^lib has (.+?):/.exec(NOT_IMPLEMENTED_HINTS["lib.*"]!)![1]!.split(/, | and /).sort();
  const implemented = DSL_ENTRIES.filter((e) => e.step !== "later" && e.name.startsWith("lib.")).map((e) => e.name.slice(4)).sort();
  assert.deepEqual(listed, implemented);
});
