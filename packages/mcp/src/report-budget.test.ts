// The concise report contract (ARCHITECTURE.md section 9): 300 tokens or fewer by default.
// Measured on a real run result of examples/enclosure (3 definitions, 6 occurrences, 8 fits),
// exactly as the run tool returns it.
//
// Regression (review round 1): the guard allowed 2400 characters of report alone, while the
// run result repeated status, rev and compute and listed area, centre of mass and edge
// counts per part: 1951 characters, about 500 to 650 tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runJobInline } from "@open3dj/compute";
import { validate } from "@open3dj/schemas";
import { runResult } from "./handlers.ts";

const ENCLOSURE = new URL("../../../examples/enclosure/enclosure.o3j.js", import.meta.url);
/**
 * 300 tokens at about 4 characters a token is 1200 characters; JSON with many short numbers
 * tokenizes worse than that, so the limit keeps a margin. Measured: 908 characters.
 */
const MAX_CHARS = 1000;

test("the concise run result of the enclosure example stays within 300 tokens", async () => {
  const r = await runJobInline({ kind: "run", script: readFileSync(ENCLOSURE, "utf8"), rev: "r_0001" });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  if (!r.ok) return;
  const out = runResult(r.report, "r_0001", r.compute);
  assert.ok(validate("tool-run-output", out).valid, JSON.stringify(validate("tool-run-output", out).errors));
  const text = JSON.stringify(out);
  assert.ok(text.length <= MAX_CHARS, `the concise run result is ${text.length} characters (limit ${MAX_CHARS}):\n${text}`);
  // Status, rev and compute appear once, at the top.
  assert.equal(text.split('"compute"').length - 1, 1, text);
  assert.equal(text.split('"rev"').length - 1, 1, text);
  // Identical fits are collapsed: four screws sit the same way in the base and in the lid.
  // Since fits list each distinct gap of a pair (S1 polish), the lid and a screw give three
  // lines (the head contact, the 0.2 mm shank gap, the 0.5 mm head gap) and the base one.
  assert.ok(out.report!.fits.length <= 4, JSON.stringify(out.report!.fits));
  assert.ok(out.report!.fits.every((f) => (f.n ?? 1) === 4), JSON.stringify(out.report!.fits));
});

// Regression (review round 2): fixed caps (5 parts, 5 fits, 6 target names) let an ordinary
// assembly of 8 named, clashing parts reach 1758 characters. The concise result is now
// trimmed to the budget, lowest-ranked entries first.
const NAMES = ["Left side panel", "Right side panel", "Main circuit board", "Front bezel cover", "Rear access door", "Battery holder bracket", "Top ventilation grille", "Bottom mounting plate", "Display window frame", "Speaker grille insert"];

async function concise(script: string, params: Record<string, number> = {}) {
  const r = await runJobInline({ kind: "run", script, params, rev: "r_0001" });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  if (!r.ok) throw new Error("run failed");
  const out = runResult(r.report, "r_0001", r.compute);
  assert.ok(validate("tool-run-output", out).valid, JSON.stringify(validate("tool-run-output", out).errors));
  return { out, text: JSON.stringify(out) };
}

test("the worst case (10 long-named parts, every neighbour clashing) stays within the budget", async () => {
  const { out, text } = await concise(`const names = ${JSON.stringify(NAMES)};\nreturn names.map((n, i) => ({ name: n, shape: box(20 + i, 20, 10).translate(i * 15, 0, 0) }));`);
  assert.ok(text.length <= MAX_CHARS, `${text.length} characters:\n${text}`);
  assert.equal(out.status, "warning");
  assert.ok(out.report!.fits.length >= 1 && out.report!.fits.every((f) => f.kind === "clash"), JSON.stringify(out.report!.fits));
  assert.ok(out.report!.parts.length >= 1);
  assert.ok(out.report!.warnings!.some((w) => /more fits not listed/.test(w)), JSON.stringify(out.report!.warnings));
  assert.ok(out.report!.next!.some((n) => /^render/.test(n)), JSON.stringify(out.report!.next));
});

test("many long warnings are capped too", async () => {
  const params = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`AVeryLongParameterNameThatTheScriptNeverDeclares${i}`, i]));
  const { text } = await concise("return box(10, 10, 10);", params);
  assert.ok(text.length <= MAX_CHARS, `${text.length} characters:\n${text}`);
  assert.match(text, /more warnings/);
});

// Regression (S1 polish): the trim loop stopped at one part, one fit and one render target,
// so long names, many warnings and the new refs list could still pass the budget: 30 parts
// named with 120 characters gave over 1200 characters. Now names are shortened and every
// list can shrink to nothing, with counts of what was left out.
test("many parts, long names, many distinct fits, warnings and refs stay within 300 tokens", async () => {
  const long = (i: number) => `Part ${i} ${"with a very long descriptive name for the supplier drawing ".repeat(2)}`.slice(0, 120);
  const names = Array.from({ length: 30 }, (_, i) => long(i));
  // Boxes of different heights in a row, each overlapping the next by a different amount:
  // every fit is distinct, so nothing collapses into n.
  const script = [
    `const names = ${JSON.stringify(names)};`,
    "return names.map((n, i) => ({ name: n, shape: box(10, 10, 5 + i * 0.37).translate(i * (9.5 - i * 0.01), 0, 0).withReferences({",
    "  [\"top_face_of_a_part_with_a_long_reference_name_\" + i]: { face: { normal: [0, 0, 1] } },",
    "  [\"side_\" + i]: { face: { normal: [1, 0, 0], minArea: 1e5 } },",
    "}) }));",
  ].join("\n");
  const params = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`AVeryLongParameterNameThatTheScriptNeverDeclares${i}`, i]));
  const { out, text } = await concise(script, params);
  const tokens = text.length / 4;
  assert.ok(tokens <= 300, `${text.length} characters, about ${tokens} tokens:\n${text}`);
  assert.ok(text.length <= MAX_CHARS, `${text.length} characters:\n${text}`);
  assert.equal(out.status, "warning");
  // What was left out is counted, so an agent knows to ask for more.
  const notes = out.report!.warnings!.join("\n");
  assert.match(notes, /more definitions not listed/);
  assert.match(notes, /more fits not listed/);
  assert.match(text, /refs not listed|"refs"/);
  // Problems stay first: a clash is shown before any contact, and a broken ref before exact ones.
  if (out.report!.fits.length > 0) assert.equal(out.report!.fits[0]!.kind, "clash");
  if (out.report!.refs?.length) assert.equal(out.report!.refs[0]!.state, "broken");
});

// Regression (review round 2 of increment 2): rankFits put clearance before contact and did not
// put extra lines last, and fits were trimmed second, so the contact that fastens the parts was
// the line dropped. The order is now clash, contact, clearance, with extra lines last.
const SKILL_ASSEMBLY = `const base = box(50, 30, 10).subtract(lib.clearanceHole("M3", { length: 8 }).translate(15, 0, 10))
  .withConnectors({ rim: connector.female("lid", { origin: [0, 0, 10], axis: [0, 0, 1], up: [1, 0, 0] }) });
const lid = box(50, 30, 3).subtract(lib.clearanceHole("M3", { length: 4 }).translate(15, 0, 3))
  .withConnectors({ seat: connector.male("lid", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(base, "seat", "rim");
const screw = lib.bolt("M3", 10).translate(15, 0, 13);
return [{ name: "Base", shape: base, color: "#5b6b7a" }, { name: "Lid", shape: lid }, { name: "Screw", shape: screw }];`;

function assertFitOrder(fits: Array<{ kind: string; extra?: true }>): void {
  const rank = (f: { kind: string; extra?: true }) => (f.extra ? 3 : 0) + ({ clash: 0, contact: 1, clearance: 2 } as Record<string, number>)[f.kind]!;
  for (let i = 1; i < fits.length; i++) assert.ok(rank(fits[i - 1]!) <= rank(fits[i]!), `out of order: ${JSON.stringify(fits)}`);
}

test("concise fits list contacts before clearances and extra gaps last, and keep the contact that fastens", async () => {
  const { out } = await concise(SKILL_ASSEMBLY);
  const fits = out.report!.fits;
  assertFitOrder(fits);
  assert.ok(fits.some((f) => f.kind === "contact"), `the lid / screw contact is listed: ${JSON.stringify(out.report)}`);
  const enc = await runJobInline({ kind: "run", script: readFileSync(ENCLOSURE, "utf8"), rev: "r_0001" });
  assert.ok(enc.ok);
  if (!enc.ok) return;
  assertFitOrder(enc.report.fits);
  assert.ok(enc.report.fits.some((f) => f.kind === "contact"), JSON.stringify(enc.report.fits));
});

// Regression (review round 2 of increment 2): the concise reason was cut to 128 characters,
// just before "the first candidate is the query's pick", and next said "check its query" although
// the query was already unique.
test("a twin pattern moved by a parameter: the concise reason keeps its ending and next names candidates[0]", async () => {
  const script = `const W = Param.number("Width", 80, { min: 40, max: 120 });
const p = box(W, 20, 6).subtract(cylinder(8, 2).translate(W / 2 - 8, 0, -1), cylinder(8, 2).translate(-(W / 2 - 8), 0, -1));
return { name: "part", shape: p.withReferences({ hole: { face: { surface: "cylinder", near: [W / 2 - 8, 0, 3] } } }) };`;
  const a = await runJobInline({ kind: "run", script, params: { Width: 80 }, rev: "r_0001" });
  assert.ok(a.ok);
  if (!a.ok) return;
  const b = await runJobInline({ kind: "run", script, params: { Width: 90 }, rev: "r_0002", previous: a.assembly });
  assert.ok(b.ok);
  if (!b.ok) return;
  const ref = b.report.refs!.find((r) => r.name === "part.hole")!;
  assert.equal(ref.state, "ambiguous", JSON.stringify(ref));
  assert.match(ref.reason ?? "", /query's pick/, `the concise reason keeps its ending: ${ref.reason}`);
  assert.ok(b.report.next!.some((n) => /candidates\[0\]/.test(n)), JSON.stringify(b.report.next));
});
