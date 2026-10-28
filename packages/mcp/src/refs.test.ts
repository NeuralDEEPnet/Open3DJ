// Fingerprint references (ARCHITECTURE.md section 10, PLAN.md S1): withReferences names a
// face or an edge, the run stores its fingerprint with the definition, and the next run
// with changed params says whether each name still means the same element: exact,
// ambiguous (with candidates, never auto-picked) or broken (with a reason).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runJobInline } from "@open3dj/compute";
import type { JobResult } from "@open3dj/compute";
import { judgeReference } from "@open3dj/dsl";
import { validate } from "@open3dj/schemas";
import type { AssemblyFile, ParamValue, RefFingerprint, RefReport } from "@open3dj/schemas";

/** A plate with a hole that moves (HoleX), an optional second hole and an optional notch. */
const BRACKET = `
const L = Param.number("Length", 60, { min: 30, max: 120, unit: "mm" });
const X = Param.number("HoleX", -15, { min: -40, max: 40, unit: "mm" });
const N = Param.number("Holes", 1, { min: 0, max: 2 });
const notch = Param.number("Notch", 0, { min: 0, max: 10, unit: "mm" });
let plate = box(L, 20, 5);
const cutters = [];
if (N >= 1) cutters.push(cylinder(7, 3).translate(X, 0, -1));
if (N >= 2) cutters.push(cylinder(7, 3).translate(X + 20, 0, -1));
if (notch > 0) cutters.push(box(notch, 4, 10).translate(0, -10, -1));
if (cutters.length) plate = plate.subtract(cutters);
return { name: "bracket", shape: plate.withReferences({
  top: { face: { normal: [0, 0, 1], atZ: 5 } },
  hole: { face: { surface: "cylinder", near: [X, 0, 2.5] } },
  front_top: { edge: { parallel: [1, 0, 0], atY: -10, atZ: 5 } },
  corner: [30, 10, 5],
}) };`;

type Ok = Extract<JobResult, { ok: true }>;

async function run(params: Record<string, ParamValue>, previous?: AssemblyFile, detail: "concise" | "detailed" = "detailed"): Promise<Ok> {
  const job: Parameters<typeof runJobInline>[0] = { kind: "run", script: BRACKET, params, rev: "r_0001", detail };
  if (previous) job.previous = previous;
  const r = await runJobInline(job);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r as Ok;
}

const byName = (refs: RefReport[] | undefined) => new Map((refs ?? []).map((r) => [r.name, r]));

test("named faces and edges get fingerprints; point references stay points", async () => {
  const a = await run({});
  assert.ok(validate("assembly", a.assembly).valid, JSON.stringify(validate("assembly", a.assembly).errors));
  assert.ok(validate("geometry-report", a.report).valid, JSON.stringify(validate("geometry-report", a.report).errors));
  const refs = byName(a.report.refs);
  assert.deepEqual([...refs.keys()], ["bracket.top", "bracket.hole", "bracket.front_top"], "points are not fingerprinted");
  for (const r of refs.values()) {
    assert.equal(r.state, "exact", JSON.stringify(r));
    assert.match(r.at ?? "", /^(face|edge):\d+$/);
  }
  assert.equal(a.report.status, "ok");
  const defs = a.assembly.definitions;
  const stored = Object.values(defs).flatMap((d) => d.refs ?? []);
  const top = stored.find((r) => r.name === "top")!.fingerprint!;
  assert.equal(top.type, "face");
  if (top.type === "face") {
    assert.equal(top.surface, "plane");
    assert.ok(Math.abs(top.area - (60 * 20 - Math.PI * 9)) < 1e-6, String(top.area));
    assert.deepEqual(top.normal?.map((x) => Math.round(x)), [0, 0, 1]);
    assert.ok(top.edges >= 5, "4 outline edges and the hole's circle");
  }
  const hole = stored.find((r) => r.name === "hole")!.fingerprint!;
  assert.ok(hole.type === "face" && hole.surface === "cylinder" && hole.axis && Math.abs(Math.abs(hole.axis[2]) - 1) < 1e-9);
  assert.ok(Math.abs(hole.centroid[0] + 15) < 1e-6 && Math.abs(hole.centroid[2] - 2.5) < 1e-6, JSON.stringify(hole.centroid));
  const edge = stored.find((r) => r.name === "front_top")!.fingerprint!;
  assert.ok(edge.type === "edge" && edge.curve === "line" && edge.faces === 2 && Math.abs(edge.length - 60) < 1e-9, JSON.stringify(edge));
});

test("after a re-run, a moved hole is still exact, a second identical hole makes it ambiguous, and no hole is broken", async () => {
  const a = await run({});
  // The hole moves: still one cylinder, so the name still means it.
  const b = await run({ HoleX: 10 }, a.assembly);
  for (const r of b.report.refs ?? []) assert.equal(r.state, "exact", JSON.stringify(r));
  assert.equal(b.report.status, "ok");

  // A second hole of the same size appears and the first one moves: both match the old
  // fingerprint equally, so the name is ambiguous. The query's pick is never taken on trust.
  const c = await run({ HoleX: -15, Holes: 2 }, b.assembly);
  const hole = byName(c.report.refs).get("bracket.hole")!;
  assert.equal(hole.state, "ambiguous", JSON.stringify(hole));
  assert.equal(hole.candidates?.length, 2);
  assert.ok(hole.candidates!.every((x) => /^face:\d+$/.test(x)));
  assert.match(hole.reason ?? "", /match/);
  assert.equal(byName(c.report.refs).get("bracket.top")!.state, "exact", "the top face changed edges but is still the only top face");
  assert.equal(c.report.status, "warning");
  assert.ok(c.report.next?.some((n) => /inspect fields=\[refs\]/.test(n)), JSON.stringify(c.report.next));

  // The same second hole added while the first one stays put: the first is the only full match.
  const d = await run({ Holes: 2 }, a.assembly);
  assert.equal(byName(d.report.refs).get("bracket.hole")!.state, "exact");

  // No hole at all: broken, with a reason, and the run still succeeds.
  const e = await run({ Holes: 0 }, a.assembly);
  const gone = byName(e.report.refs).get("bracket.hole")!;
  assert.equal(gone.state, "broken");
  assert.match(gone.reason ?? "", /no face matches/);
});

test("an edge split in two by a change that adds edges is ambiguous, with both pieces as candidates", async () => {
  const a = await run({});
  const notched = await run({ Notch: 6 }, a.assembly);
  assert.ok(notched.report.parts[0]!.counts!.edges! > a.report.parts[0]!.counts!.edges!, "the notch adds edges");
  const edge = byName(notched.report.refs).get("bracket.front_top")!;
  assert.equal(edge.state, "ambiguous", JSON.stringify(edge));
  assert.equal(edge.candidates?.length, 2);
  assert.ok(edge.candidates!.every((x) => /^edge:\d+$/.test(x)));
  assert.equal(byName(notched.report.refs).get("bracket.hole")!.state, "exact");
});

test("concise reports list refs without element addresses or fingerprints", async () => {
  const a = await run({}, undefined, "concise");
  assert.deepEqual(a.report.refs, [{ name: "bracket.top", state: "exact" }, { name: "bracket.hole", state: "exact" }, { name: "bracket.front_top", state: "exact" }]);
});

const face = (over: Partial<Extract<RefFingerprint, { type: "face" }>> = {}): RefFingerprint => ({ type: "face", surface: "plane", area: 100, centroid: [0, 0, 5], normal: [0, 0, 1], edges: 4, ...over });

test("judgeReference: the resolver's rules on fingerprints alone", () => {
  const prev = face();
  // The query picks the only face of that kind and orientation, still on the plane z = 5: exact.
  assert.equal(judgeReference(prev, [face({ area: 150, edges: 8, centroid: [3, 0, 5] })], 0, 1e-3).state, "exact");
  // The only face left is on another plane and differs in size and edges: ambiguous, not exact.
  for (const pick of [0, undefined]) {
    const moved = judgeReference(prev, [face({ area: 150, edges: 8, centroid: [3, 0, 9] })], pick, 1e-3);
    assert.equal(moved.state, "ambiguous");
    assert.deepEqual(moved.candidates, [0]);
    assert.match(moved.reason ?? "", /only plane facing \+Z left differs in area, edge count, position/);
  }
  // Same size and edges on another plane: two of three agree, so still exact.
  assert.equal(judgeReference(prev, [face({ centroid: [0, 0, 9] })], 0, 1e-3).state, "exact");
  // A full match elsewhere beats the pick: the query switched to another face.
  const switched = judgeReference(prev, [face({ centroid: [0, 0, 9] }), face()], 0, 1e-3);
  assert.equal(switched.state, "ambiguous");
  assert.deepEqual(switched.candidates, [0, 1]);
  // The pick is the unique full match: exact.
  assert.equal(judgeReference(prev, [face(), face({ centroid: [0, 0, 9] })], 0, 1e-3).state, "exact");
  // The pick is a plane facing -Z now: nothing of the old kind and orientation is left.
  const flipped = judgeReference(prev, [face({ normal: [0, 0, -1] })], 0, 1e-3);
  assert.equal(flipped.state, "broken");
  assert.match(flipped.reason ?? "", /plane facing \+Z/);
  // Two faces tie with the pick and neither is a full match: ambiguous.
  assert.equal(judgeReference(prev, [face({ centroid: [5, 0, 5] }), face({ centroid: [-5, 0, 5] })], 0, 1e-3).state, "ambiguous");
});

/** Run a script once, optionally against a previous assembly. */
async function runScript(script: string, params: Record<string, ParamValue> = {}, previous?: AssemblyFile): Promise<Ok> {
  const job: Parameters<typeof runJobInline>[0] = { kind: "run", script, params, rev: "r_0001", detail: "detailed" };
  if (previous) job.previous = previous;
  const r = await runJobInline(job);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r as Ok;
}
const storedRefs = (r: Ok) => Object.values(r.assembly.definitions).flatMap((d) => d.refs ?? []);

test("a removed bore is never 'exact' on the only other cylinder left (a fillet), across revisions", async () => {
  const script = `
const mode = Param.number("Mode", 0, { min: 0, max: 1 });
let p = box(40, 20, 5);
if (mode === 0) p = p.subtract(cylinder(7, 3).translate(-10, 0, -1));
else p = fillet(p, 4, { parallel: [0, 0, 1], atX: 20, atY: 10 });
return { name: "plate", shape: p.withReferences({ bore: { face: { surface: "cylinder" } } }) };`;
  const a = await runScript(script, { Mode: 0 });
  assert.equal(byName(a.report.refs).get("plate.bore")!.state, "exact");
  const b = await runScript(script, { Mode: 1 }, a.assembly);
  const bore = byName(b.report.refs).get("plate.bore")!;
  assert.notEqual(bore.state, "exact", JSON.stringify(bore));
  assert.match(bore.reason ?? "", /only cylinder/);
  assert.equal(b.report.status, "warning");
});

test("a bore named, plugged and replaced by a fillet in one run is not 'exact' on the fillet", async () => {
  const a = await runScript(`
const plate = box(40, 20, 5).subtract(cylinder(7, 3).translate(-10, 0, -1)).withReferences({ bore: { face: { surface: "cylinder" } } });
const done = fillet(plate.add(cylinder(5, 3).translate(-10, 0, 0)), 4, { parallel: [0, 0, 1], atX: 20, atY: 10 });
return { name: "plate", shape: done };`);
  const bore = byName(a.report.refs).get("plate.bore")!;
  assert.notEqual(bore.state, "exact", JSON.stringify(bore));
  assert.equal(a.report.status, "warning");
});

test("the only face of its kind on the same plane stays exact when holes change its size", async () => {
  const a = await runScript(`return { name: "p", shape: box(40, 20, 5).subtract(cylinder(7, 3).translate(-10, 0, -1)).withReferences({ top: { face: { normal: [0, 0, 1] } } }) };`);
  const b = await runScript(`return { name: "p", shape: box(40, 20, 5).subtract(cylinder(7, 3).translate(-10, 0, -1), cylinder(7, 2).translate(10, 5, -1)).withReferences({ top: { face: { normal: [0, 0, 1] } } }) };`, {}, a.assembly);
  assert.equal(byName(b.report.refs).get("p.top")!.state, "exact");
});

test("cone and torus faces of a Z-axis part fingerprint with axis [0, 0, 1]", async () => {
  const a = await runScript(`
const p = cylinder(10, 10).subtract(cylinder(12, 3).translate(0, 0, -1));
const c = fillet(chamfer(p, 2, { atZ: 10, maxLength: 20 }), 2, { atZ: 0, minLength: 40 });
return { name: "c", shape: c.withReferences({ cone: { face: { surface: "cone" } }, round: { face: { surface: "torus" } } }) };`);
  for (const name of ["cone", "round"]) {
    const fp = storedRefs(a).find((r) => r.name === name)!.fingerprint!;
    assert.ok(fp.type === "face" && fp.axis, JSON.stringify(fp));
    if (fp.type === "face") assert.deepEqual(fp.axis!.map((x) => Math.round(x * 1e6) / 1e6 + 0), [0, 0, 1], `${name}: ${JSON.stringify(fp.axis)}`);
  }
});

test("near measures the distance to the face, so it picks the right one of two coaxial chamfers", async () => {
  const a = await runScript(`
const p = cylinder(10, 10).subtract(cylinder(12, 3).translate(0, 0, -1));
const c = chamfer(p, 2, { atZ: 10 });
return { name: "c", shape: c.withReferences({ ch: { face: { surface: "cone", near: [10, 0, 10] } }, chi: { face: { surface: "cone", near: [3, 0, 10] } } }) };`);
  const refs = byName(a.report.refs);
  assert.equal(refs.get("c.ch")!.state, "exact");
  assert.equal(refs.get("c.chi")!.state, "exact");
  assert.notEqual(refs.get("c.ch")!.at, refs.get("c.chi")!.at);
  const area = (n: string) => {
    const fp = storedRefs(a).find((r) => r.name === n)!.fingerprint!;
    return fp.type === "face" ? fp.area : NaN;
  };
  // Frustum side areas: pi (r1 + r2) slant, slant 2 sqrt(2).
  assert.ok(Math.abs(area("ch") - Math.PI * 18 * 2 * Math.SQRT2) < 1e-6, String(area("ch")));
  assert.ok(Math.abs(area("chi") - Math.PI * 8 * 2 * Math.SQRT2) < 1e-6, String(area("chi")));
});

/** A plate with two identical holes at x = -15 and x = +15; hole A is named by near. */
const TWINS = `box(60, 20, 5).subtract(cylinder(7, 3).translate(-15, 0, -1), cylinder(7, 3).translate(15, 0, -1))`;
const NAME_A = `{ holeA: { face: { surface: "cylinder", near: [-15, 0, 2.5] } } }`;
/** The ref never resolves to the twin at x = +15. */
function notOnTwin(r: Ok, name: string): void {
  const ref = byName(r.report.refs).get(name)!;
  const fp = storedRefs(r).find((x) => `plate.${x.name}` === name)!;
  if (ref.state === "exact") assert.ok(fp.fingerprint!.centroid[0] < 0, `exact on the twin: ${JSON.stringify({ ref, fp })}`);
  else assert.equal(r.report.status, "warning");
}

test("a named hole that is counterbored in the same run never moves to its identical twin", async () => {
  const a = await runScript(`let p = ${TWINS}.withReferences(${NAME_A});
p = p.subtract(cylinder(2, 4.5).translate(-15, 0, 4));
return { name: "plate", shape: p };`);
  notOnTwin(a, "plate.holeA");
});

test("a named hole that is plugged in the same run is not 'exact' on its twin", async () => {
  const a = await runScript(`let p = ${TWINS}.withReferences(${NAME_A});
return { name: "plate", shape: p.add(cylinder(5, 3).translate(-15, 0, 0)) };`);
  const ref = byName(a.report.refs).get("plate.holeA")!;
  assert.notEqual(ref.state, "exact", JSON.stringify(ref));
  assert.equal(a.report.status, "warning");
});

test("a named hole removed by a parameter is not 'exact' on its former twin, across revisions", async () => {
  const script = `
const keepA = Param.number("KeepA", 1, { min: 0, max: 1 });
let p = box(60, 20, 5);
if (keepA > 0) p = p.subtract(cylinder(7, 3).translate(-15, 0, -1));
p = p.subtract(cylinder(7, 3).translate(15, 0, -1));
return { name: "plate", shape: p.withReferences(${NAME_A}) };`;
  const a = await runScript(script, { KeepA: 1 });
  assert.equal(byName(a.report.refs).get("plate.holeA")!.state, "exact");
  const b = await runScript(script, { KeepA: 0 }, a.assembly);
  const ref = byName(b.report.refs).get("plate.holeA")!;
  assert.notEqual(ref.state, "exact", JSON.stringify(ref));
  assert.equal(b.report.status, "warning");
});

test("moving or turning a whole part between revisions keeps its named faces exact", async () => {
  const cases: Array<[string, string, Record<string, ParamValue>, Record<string, ParamValue>]> = [
    ["translate", `const d = Param.number("D", 0, { min: 0, max: 200 }); return { name: "plate", shape: p.translate(d, 0, 0) };`, { D: 0 }, { D: 100 }],
    ["rotate 90", `const d = Param.number("D", 0, { min: 0, max: 180 }); return { name: "plate", shape: p.rotate(d, [0, 0, 1]) };`, { D: 0 }, { D: 90 }],
    ["rotate 180 and lift", `const d = Param.number("D", 0, { min: 0, max: 180 }); return { name: "plate", shape: p.rotate(d, [0, 0, 1]).translate(0, 0, 10) };`, { D: 0 }, { D: 180 }],
  ];
  for (const [label, tail, p1, p2] of cases) {
    const script = `const p = ${TWINS}.withReferences({ ...${NAME_A}, top: { face: { normal: [0, 0, 1] } }, side: { face: { normal: [1, 0, 0] } } });\n${tail}`;
    const a = await runScript(script, p1);
    const b = await runScript(script, p2, a.assembly);
    for (const r of b.report.refs ?? []) assert.equal(r.state, "exact", `${label}: ${JSON.stringify(r)}`);
    assert.equal(b.report.status, "ok", label);
    const hole = storedRefs(b).find((x) => x.name === "holeA")!;
    const was = storedRefs(a).find((x) => x.name === "holeA")!;
    // The stored fingerprint follows the part: a moved part stores the moved hole.
    if (label === "translate") assert.ok(Math.abs(hole.fingerprint!.centroid[0] - (was.fingerprint!.centroid[0] + 100)) < 1e-6, JSON.stringify(hole));
  }
});
