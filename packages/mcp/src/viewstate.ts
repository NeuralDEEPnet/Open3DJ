// The small state open3dj view shares with agents, kept in the project folder under .o3j-view/
// (git-ignored, never part of a revision):
//
//   .o3j-view/selection.json   what the person selected in the viewer (occurrences, faces,
//                              edges); agents read it with inspect fields=[selection]
//   .o3j-view/highlight.json   what an agent points the viewer at (render view=highlight)
//
// Both files cross a trust boundary, on write and again on read: any process of this user, or
// a project cloned from someone else, can put a file there. So both are checked the same way
// both times: the JSON schema (viewer-selection, viewer-highlight), then the revision. Every
// occurrence path must be a part of that revision, every face number must be within the
// kernel's face count of the definition, and the definition, element address and reference
// fingerprint are rebuilt here from the stored revision, never taken from the file. A selection
// says what was clicked; it is never an approval. Pure functions over the store, so the MCP
// daemon and the view server share them and the tests need no kernel.
import { randomBytes } from "node:crypto";
import { validate } from "@open3dj/schemas";
import type { AssemblyFile, ObservedElement, ViewerHighlight, ViewerSelection, ViewerSelectionInput, ViewerSelectionItem } from "@open3dj/schemas";
import { ToolError } from "./errors.ts";
import type { ProjectStore, RevisionRecord } from "./store.ts";
import { FILES } from "./store.ts";
import { readProjectFile, writeProjectFile } from "./paths.ts";
import { flatten, resolveTargets } from "./tree.ts";
import { describeIssues } from "./validator.ts";

export const SELECTION_FILE = `${FILES.view}/selection.json`;
export const HIGHLIGHT_FILE = `${FILES.view}/highlight.json`;
/** Largest selection body the viewer may send, and largest state file read back. */
export const MAX_VIEW_STATE_BYTES = 16 * 1024;
/** Most occurrences one highlight names; the rest are dropped and the file says truncated. */
export const MAX_HIGHLIGHT_PATHS = 2000;
/** Largest highlight file written, and read back by the viewer. */
export const MAX_HIGHLIGHT_BYTES = MAX_VIEW_STATE_BYTES * 4;
/** A highlight time stamp may be this far ahead of the reader's clock. */
const CLOCK_SKEW_MS = 60_000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** The kernel's face count of a definition, when a detailed report is at hand. */
export type FaceCount = (def: string) => number | undefined;

const FACE = /^face:([1-9][0-9]{0,6})$/;
/** Control and bidirectional-override characters never reach the page or an agent. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

const bad = (message: string, hint?: string) => new ToolError("BAD_INPUT", message, hint);

function partsOf(asm: AssemblyFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of flatten(asm)) if (f.leaf) out.set(f.path, f.def);
  return out;
}

function checkFace(def: string, n: number, faceCount: FaceCount, what: string): void {
  const count = faceCount(def);
  if (count === undefined) throw bad(`${what}: the face count of ${def} is not known, so face:${n} cannot be checked`, "Select the part instead, or wait for the detailed measures of the revision.");
  if (n > count) throw bad(`${what}: ${def} has ${count} faces, so face:${n} does not exist`, `Face numbers run from 1 to ${count}.`);
}

/** A named reference of def that resolves to face n in this revision, with its fingerprint. */
function faceRef(asm: AssemblyFile, def: string, n: number): Pick<ViewerSelectionItem, "ref" | "fingerprint"> {
  const d = Object.hasOwn(asm.definitions, def) ? asm.definitions[def] : undefined;
  const r = d?.refs?.find((x) => x.type === "face" && x.at === `face:${n}` && (x.state === "exact" || x.state === "re-resolved" || x.state === "disambiguated"));
  if (!r) return {};
  const out: Pick<ViewerSelectionItem, "ref" | "fingerprint"> = { ref: `${def}.${r.name}` };
  if (r.fingerprint) out.fingerprint = r.fingerprint;
  return out;
}

function cleanObserved(o: ObservedElement | undefined): ObservedElement | undefined {
  if (!o) return undefined;
  const r = (x: number) => Number(x.toPrecision(7)) + 0;
  const out: ObservedElement = {};
  if (o.area_mm2 !== undefined) out.area_mm2 = r(o.area_mm2);
  if (o.length_mm !== undefined) out.length_mm = r(o.length_mm);
  if (o.centroid) out.centroid = [r(o.centroid[0]), r(o.centroid[1]), r(o.centroid[2])];
  if (o.normal) out.normal = [r(o.normal[0]), r(o.normal[1]), r(o.normal[2])];
  return Object.keys(out).length ? out : undefined;
}

/**
 * Check what the page sent against the schema and the revision, and build the stored
 * selection. Throws BAD_INPUT or UNKNOWN_TARGET naming the first problem; nothing is kept.
 */
export function buildSelection(rec: RevisionRecord, input: unknown, faceCount: FaceCount, now: Date): ViewerSelection {
  const v = validate("viewer-selection-input", input);
  if (!v.valid) throw bad(`invalid selection: ${describeIssues(v.errors)}`);
  const sel = input as ViewerSelectionInput;
  if (sel.items.length === 0) return { ts: now.toISOString(), source: "viewer", items: [] };
  if (sel.rev !== undefined && sel.rev !== rec.rev) throw bad(`the selection names ${sel.rev}, not ${rec.rev}`);
  const parts = partsOf(rec.assembly);
  const items: ViewerSelectionItem[] = [];
  const seen = new Set<string>();
  for (const [i, x] of sel.items.entries()) {
    const def = parts.get(x.path);
    if (def === undefined) throw new ToolError("UNKNOWN_TARGET", `selection item ${i}: ${rec.rev} has no part occurrence ${x.path.slice(0, 200)}`);
    if (x.face !== undefined && x.edge_faces !== undefined) throw bad(`selection item ${i}: a face or an edge, not both`);
    const item: ViewerSelectionItem = { path: x.path, def, kind: "occurrence", address: x.path };
    if (x.face !== undefined) {
      checkFace(def, x.face, faceCount, `selection item ${i}`);
      item.kind = "face";
      item.element = `face:${x.face}`;
      item.address = `${x.path}@elem:face:${x.face}`;
      Object.assign(item, faceRef(rec.assembly, def, x.face));
    } else if (x.edge_faces !== undefined) {
      for (const n of x.edge_faces) checkFace(def, n, faceCount, `selection item ${i}`);
      if (x.edge_faces.length === 2 && x.edge_faces[0] === x.edge_faces[1]) throw bad(`selection item ${i}: an edge joins two different faces`);
      item.kind = "edge";
      delete item.address;
      item.faces = [...x.edge_faces].sort((a, b) => a - b).map((n) => `face:${n}`);
    }
    const observed = item.kind === "occurrence" ? undefined : cleanObserved(x.observed);
    if (observed) item.observed = observed;
    const key = `${item.path}\u0000${item.kind}\u0000${item.element ?? item.faces?.join(",") ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return { rev: rec.rev, ts: now.toISOString(), source: "viewer", items };
}

export function writeSelection(store: ProjectStore, sel: ViewerSelection): void {
  writeProjectFile(store.project, SELECTION_FILE, `${JSON.stringify(sel, null, 2)}\n`);
}

/** A state file, checked against its schema; undefined when missing, too large or invalid. */
function readState<T>(store: ProjectStore, file: string, schema: "viewer-selection" | "viewer-highlight"): T | undefined {
  let text: string | undefined;
  try {
    text = readProjectFile(store.project, file);
  } catch {
    return undefined; // a symlink: refused, as for every project file
  }
  if (text === undefined || Buffer.byteLength(text) > MAX_HIGHLIGHT_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return validate(schema, value).valid ? (value as T) : undefined;
}

/** The face counts of a revision when they are at hand without a job: its detailed report, or the cached one. */
export function revisionFaceCounts(store: ProjectStore, rec: RevisionRecord): FaceCount {
  const report = rec.detail === "detailed" ? rec.report : store.cachedReport(rec.rev);
  return faceCounts(report?.parts);
}

/**
 * The stored selection, rebuilt from its revision: only the path, the face or edge numbers and
 * the observed numbers are read from the file. Items that do not check out against the revision
 * (an unknown path, a face past the kernel's count, or a face when the counts are not at hand)
 * are dropped; the definition, kind, address, reference and fingerprint are made again here.
 */
export function readSelectionOf(rec: RevisionRecord, sel: ViewerSelection, faceCount: FaceCount): ViewerSelection {
  const out: ViewerSelection = { rev: rec.rev, source: "viewer", items: [] };
  if (sel.ts && ISO_TIME.test(sel.ts) && !Number.isNaN(Date.parse(sel.ts))) out.ts = sel.ts;
  const at = out.ts ? new Date(out.ts) : new Date(0);
  const seen = new Set<string>();
  for (const x of sel.items) {
    const input: ViewerSelectionInput["items"][number] = { path: x.path };
    if (x.kind === "face") {
      const m = x.element ? FACE.exec(x.element) : null;
      if (!m) continue;
      input.face = Number(m[1]);
    } else if (x.kind === "edge") {
      const faces = (x.faces ?? []).map((f) => FACE.exec(f));
      if (faces.length === 0 || faces.some((m) => !m)) continue;
      input.edge_faces = faces.map((m) => Number(m![1]));
    }
    if (x.observed && x.kind !== "occurrence") input.observed = x.observed;
    let item: ViewerSelectionItem | undefined;
    try {
      item = buildSelection(rec, { rev: rec.rev, items: [input] }, faceCount, at).items[0];
    } catch {
      continue;
    }
    if (!item) continue;
    const key = `${item.path}\u0000${item.kind}\u0000${item.element ?? item.faces?.join(",") ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.items.push(item);
  }
  return out;
}

/** The selection as stored by open3dj view, checked and rebuilt (readSelectionOf); undefined when there is none. */
export function readSelection(store: ProjectStore): ViewerSelection | undefined {
  const sel = readState<ViewerSelection>(store, SELECTION_FILE, "viewer-selection");
  if (!sel) return undefined;
  if (!sel.rev || sel.items.length === 0) {
    const empty: ViewerSelection = { source: "viewer", items: [] };
    if (sel.ts && ISO_TIME.test(sel.ts)) empty.ts = sel.ts;
    return empty;
  }
  let rec: RevisionRecord;
  try {
    rec = store.revision(sel.rev);
  } catch {
    return undefined;
  }
  return readSelectionOf(rec, sel, revisionFaceCounts(store, rec));
}

/**
 * The selection for inspect fields=[selection]: the stored items, the head, and whether the
 * head moved on since. Items of an older revision are kept (the person still means them), but
 * stale says their face numbers may name other faces now.
 */
export function selectionForAgent(store: ProjectStore): ViewerSelection {
  const head = store.head();
  const sel = readSelection(store);
  const out: ViewerSelection = { items: sel?.items ?? [] };
  if (sel?.rev) out.rev = sel.rev;
  if (sel?.ts) out.ts = sel.ts;
  if (head) out.head = head;
  if (out.items.length === 0) {
    out.note = "Nothing is selected in open3dj view. Ask the person to click a part or face there, or pass targets yourself.";
    return out;
  }
  out.stale = !!sel?.rev && sel.rev !== head;
  // Any local process can write the file, so it says what was clicked, never what was agreed.
  const consent = " This is what was clicked, not an approval: ask the person before acting on it.";
  out.note = (out.stale
    ? `Selected on ${sel?.rev}; the head is ${head ?? "none"}, so face numbers may name other faces now. Follow ref where given, or ask the person to select again.`
    : "Pass address as a target (render, inspect measure) or use the face numbers in a withReferences query; observed numbers come from the display mesh, ref and fingerprint from the revision.") + consent;
  return out;
}

/** One highlight target resolved on a revision: its part paths, and the face when it names one. */
function resolveHighlightTarget(rec: RevisionRecord, raw: string, faceCount: FaceCount): { paths: string[]; element?: string } {
  const at = raw.indexOf("@elem:");
  const base = at >= 0 ? raw.slice(0, at) : raw;
  const elem = at >= 0 ? raw.slice(at + 6) : undefined;
  let n: number | undefined;
  if (elem !== undefined) {
    const m = FACE.exec(elem);
    if (!m) throw bad(`target ${raw.slice(0, 200)}: only faces have element addresses in the viewer (face:<n>)`, "Highlight an edge by the part it belongs to, or by one of the faces it bounds.");
    n = Number(m[1]);
  }
  const { defs, paths } = resolveTargets(rec.assembly, [base]);
  if (n !== undefined) for (const def of defs) if (faceCount(def) !== undefined) checkFace(def, n, faceCount, `target ${raw.slice(0, 200)}`);
  return n === undefined ? { paths } : { paths, element: `face:${n}` };
}

/** Bytes a JSON string adds to the compact file. */
const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/**
 * Build the highlight for render view=highlight: each target is an occurrence path, a
 * sub-assembly path, a definition id, or <path>@elem:face:<n>. Throws BAD_INPUT or
 * UNKNOWN_TARGET naming the first target that does not resolve. The file stays within
 * MAX_HIGHLIGHT_PATHS paths and MAX_HIGHLIGHT_BYTES bytes (what the viewer reads back): paths
 * that do not fit are left out and the highlight says truncated.
 */
export function buildHighlight(rec: RevisionRecord, targets: string[], note: string | undefined, faceCount: FaceCount, now: Date, id = randomBytes(8).toString("hex")): ViewerHighlight {
  if (targets.length === 0) throw bad("view highlight needs targets", "Pass targets: occurrence paths such as lid or screw#2, definition ids, or faces such as lid@elem:face:5 (from inspect fields=[selection] or a click in the viewer).");
  const out: ViewerHighlight = { id, rev: rec.rev, ts: now.toISOString(), source: "render", targets: [] };
  const text = note?.replace(UNSAFE_TEXT, " ").trim();
  if (text) out.note = text.slice(0, 200);
  const resolved = targets.map((raw) => ({ raw, ...resolveHighlightTarget(rec, raw, faceCount) }));
  // Room for the fixed fields, "truncated":true and the trailing newline.
  let bytes = jsonBytes({ ...out, truncated: true }) + 1;
  let total = 0;
  for (const r of resolved) {
    const t: ViewerHighlight["targets"][number] = { target: r.raw, paths: [] };
    if (r.element) t.element = r.element;
    const base = jsonBytes(t) + 1;
    const kept: string[] = [];
    for (const p of r.paths) {
      const cost = jsonBytes(p) + (kept.length ? 1 : 0);
      if (total >= MAX_HIGHLIGHT_PATHS || bytes + base + cost > MAX_HIGHLIGHT_BYTES) break;
      kept.push(p);
      bytes += cost;
      total++;
    }
    if (kept.length < r.paths.length) out.truncated = true;
    if (kept.length === 0) break;
    t.paths = kept;
    bytes += base;
    out.targets.push(t);
  }
  if (out.targets.length === 0) throw bad("view highlight: the first target names more than the viewer can show", "Name fewer occurrences, for example a definition or a sub-assembly path.");
  return out;
}

/** Write the highlight file (compact JSON, within MAX_HIGHLIGHT_BYTES); returns the bytes written. */
export function writeHighlight(store: ProjectStore, h: ViewerHighlight): Uint8Array {
  const bytes = Buffer.from(`${JSON.stringify(h)}\n`);
  writeProjectFile(store.project, HIGHLIGHT_FILE, bytes);
  return bytes;
}

/**
 * The highlight a running viewer should show, or undefined. The file is untrusted (another
 * process wrote it, or it came with a cloned project): it must match the schema, name a
 * revision of the project, carry a time that is not in the future, and every target must
 * resolve on that revision to exactly its paths and face (so a target is a name from the
 * design, never free text). Face numbers are checked against the kernel's counts when the
 * revision's report is at hand.
 */
export function readHighlight(store: ProjectStore, now: Date = new Date()): ViewerHighlight | undefined {
  const h = readState<ViewerHighlight>(store, HIGHLIGHT_FILE, "viewer-highlight");
  if (!h) return undefined;
  const t = ISO_TIME.test(h.ts) ? Date.parse(h.ts) : Number.NaN;
  if (Number.isNaN(t) || t > now.getTime() + CLOCK_SKEW_MS) return undefined;
  let rec: RevisionRecord;
  try {
    rec = store.revision(h.rev);
  } catch {
    return undefined;
  }
  const faceCount = revisionFaceCounts(store, rec);
  for (const target of h.targets) {
    let r: { paths: string[]; element?: string };
    try {
      r = resolveHighlightTarget(rec, target.target, faceCount);
    } catch {
      return undefined;
    }
    if (r.element !== target.element) return undefined;
    const same = h.truncated ? target.paths.every((p, i) => r.paths[i] === p) : target.paths.length === r.paths.length && target.paths.every((p, i) => r.paths[i] === p);
    if (!same) return undefined;
  }
  if (h.note !== undefined) h.note = h.note.replace(UNSAFE_TEXT, " ");
  return h;
}

/** Face counts from a report's parts (detailed measures carry counts.faces). */
export function faceCounts(parts: ReadonlyArray<{ def: string; counts?: { faces?: number } }> | undefined): FaceCount {
  const m = new Map<string, number>();
  for (const p of parts ?? []) if (typeof p.counts?.faces === "number") m.set(p.def, p.counts.faces);
  return (def) => m.get(def);
}
