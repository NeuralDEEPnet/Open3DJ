// Fit markers from the report: where to put a clash, contact or clearance marker, and how to
// read a fit line. Pure functions on plain arrays, so node:test checks them without a GPU.

/**
 * The anchor point between two world boxes ({min: [x, y, z], max: [x, y, z]}). Per axis it is
 * the middle of [max(minA, minB), min(maxA, maxB)]: the middle of the overlap when the boxes
 * overlap on that axis, and the middle of the gap when they do not.
 */
export function fitAnchor(a, b) {
  const p = [0, 0, 0];
  for (let k = 0; k < 3; k++) p[k] = (Math.max(a.min[k], b.min[k]) + Math.min(a.max[k], b.max[k])) / 2;
  return p;
}

/**
 * Occurrence paths a fit side names. A concise report collapses identical fits into one
 * line, for example "screw#1..4"; this expands such a range to screw#1 ... screw#4.
 */
export function expandSide(side) {
  const m = /^(.*#)(\d+)\.\.(\d+)$/.exec(side);
  if (!m) return [side];
  const from = Number(m[2]);
  const to = Number(m[3]);
  if (!(to >= from) || to - from > 10000) return [side];
  const out = [];
  for (let i = from; i <= to; i++) out.push(`${m[1]}${i}`);
  return out;
}

/** The pairs a fit line stands for: one pair, or n pairs when a side is a range. */
export function fitPairs(fit) {
  const as = expandSide(fit.a);
  const bs = expandSide(fit.b);
  if (as.length === bs.length) return as.map((a, i) => [a, bs[i]]);
  if (as.length === 1) return bs.map((b) => [as[0], b]);
  if (bs.length === 1) return as.map((a) => [a, bs[0]]);
  return [[fit.a, fit.b]];
}

/** Both lines are about the same pair of occurrences, in either order. */
const samePair = (f, g) => (f.a === g.a && f.b === g.b) || (f.a === g.b && f.b === g.a);

/**
 * A line marked extra whose pair has no other line. That happens for a mated pair: its closest
 * relation is a contact, which is not listed, so the extra gap is all the list shows of it.
 */
export function loneExtra(fit, fits = []) {
  // Without the list there is nothing to compare with: a further gap of a pair listed elsewhere.
  return !!fit.extra && fits.length > 0 && !fits.some((g) => !g.extra && samePair(g, fit));
}

/**
 * A short value for a fit: the clash volume, or the distance for contact and clearance. A line
 * marked extra is a further gap of a pair (for example a screw shank's clearance in a lid it
 * touches), so it says so; when it is its pair's only line (a mated lid's lip), it says the
 * pair sits beside a mated seat instead. fits is the whole list, to tell the two apart.
 */
export function fitValue(fit, fits = []) {
  if (!fit.extra) return baseValue(fit);
  return `${baseValue(fit)}, ${loneExtra(fit, fits) ? "beside a mated seat" : "further gap"}`;
}

function baseValue(fit) {
  if (fit.kind === "clash" && typeof fit.volume_mm3 === "number") return `${round(fit.volume_mm3)} mm³ overlap`;
  if (typeof fit.distance_mm === "number") {
    if (fit.kind === "contact") return fit.distance_mm === 0 ? "touching" : `touching, ${round(fit.distance_mm)} mm gap`;
    return `${round(fit.distance_mm)} mm clearance`;
  }
  return fit.kind;
}

/**
 * Pairs per kind, counting each pair once by its closest relation, plus the number of further
 * gaps (lines marked extra). An extra line that is its pair's only line counts as that pair's
 * relation. A concise line that stands for n pairs counts n.
 */
export function fitCounts(fits) {
  const counts = { clash: 0, contact: 0, clearance: 0, extra: 0 };
  for (const f of fits) {
    const n = f.n ?? 1;
    if (f.extra && !loneExtra(f, fits)) counts.extra += n;
    else counts[f.kind] = (counts[f.kind] ?? 0) + n;
  }
  return counts;
}

/**
 * Whether a fit marker for the pair a, b shows: markers are on, and neither part is hidden or
 * left out of the isolated set. Markers draw without a depth test, so a marker of a hidden part
 * would float over the parts still shown.
 */
export function markerVisible(markersOn, a, b, hidden, isolated) {
  const shown = (path) => !hidden.has(path) && (!isolated || isolated.has(path));
  return !!markersOn && shown(a) && shown(b);
}

/** Order for the list: clashes first, then contacts, then clearances. */
export const FIT_ORDER = { clash: 0, contact: 1, clearance: 2 };

export function round(x, digits = 3) {
  if (!Number.isFinite(x)) return String(x);
  const r = Number(x.toFixed(digits)) + 0;
  return Math.abs(r) >= 1e4 ? r.toLocaleString("en-US", { maximumFractionDigits: digits }) : String(r);
}
