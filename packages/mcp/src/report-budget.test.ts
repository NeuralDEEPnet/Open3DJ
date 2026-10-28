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
  assert.ok(out.report!.fits.length <= 2, JSON.stringify(out.report!.fits));
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
