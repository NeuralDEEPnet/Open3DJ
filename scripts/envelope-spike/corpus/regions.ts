// Certified Envelopes spike: the analytic failure region of each seeded defect, written from
// the geometry of its script before any search ran. A point is inside the region when the
// predicate is true. min_wall fails at 0.8 mm plus the 0.04 mm guard band, so 0.84 is the fail
// line everywhere below. The witness and the further points are inside the region and must
// fail; the outside points sit just past its edge and must pass, as must the nominal values.
// The corpus lint checks all of them; none of them is a search point.
//
// node scripts/envelope-spike/corpus/regions.ts prints each region's share of the declared box
// (pure arithmetic on the predicates, no kernel): an exact sum over integer, choice and bool
// values and a midpoint grid over the continuous ones.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParamValue } from "@open3dj/schemas";
import type { ParamDecl } from "../brief.ts";

type P = Record<string, ParamValue>;
const n = (p: P, k: string) => p[k] as number;
const WALL = 0.84;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Distance from (x, y) to the rectangle [x0, x1] x [y0, y1] (0 inside). */
function rectDist(x: number, y: number, x0: number, x1: number, y0: number, y1: number): number {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
}

/** An arm from the origin along angle deg, length len, half-width hw, against a pin of radius r at radius rp and angle phi: overlap. */
function armHitsPin(deg: number, len: number, hw: number, rp: number, phi: number, r: number): boolean {
  const d = rad(phi - deg);
  return rectDist(rp * Math.cos(d), rp * Math.sin(d), 0, len, -hw, hw) < r;
}

const HEAT_SET: Record<string, { r: number; len: number }> = {
  "M2.5": { r: 1.8, len: 4 }, M3: { r: 2, len: 5.7 }, M4: { r: 2.8, len: 8.1 }, M5: { r: 3.2, len: 9.5 }, M6: { r: 4, len: 12.7 },
};

export interface Region {
  /** Inside the analytic failure region: some assertion of the brief fails there. */
  fails: (p: P) => boolean;
  /** The region in words, with the formula. */
  text: string;
  /** A point well inside the region. */
  witness: P;
  /** Further points inside the region, in another regime of the defect (a breakout, a knife edge). */
  more?: P[];
  /** Points just outside the region: the corpus lint requires that every assertion passes there. */
  outside: P[];
}

// A hole that breaks out through a face leaves a knife edge only when its centre stays far
// enough inside (the gate reads edges of 60 degrees or sharper as thin); past that the
// topology changes instead. So every breakout defect below also asserts its face count, and
// its region is the union: thin wall, knife edge or changed faces.
export const REGIONS: Record<string, Region> = {
  "d01-plate-hole-pitch": {
    text: "end wall W/2 - P/2 - 2.75 <= 0.84, that is Width - Pitch <= 7.18; below 5.5 the holes break out (faces change)",
    fails: (p) => n(p, "Width") / 2 - n(p, "Pitch") / 2 - 2.75 <= WALL,
    witness: { Width: 50, Pitch: 44, Thickness: 4 },
    more: [{ Width: 45, Pitch: 44, Thickness: 4 }],
    outside: [{ Width: 50, Pitch: 42.5, Thickness: 4 }],
  },
  "d02-blind-pocket": {
    text: "floor Height - Pocket depth <= 0.84; at 0 and below the pocket runs through (faces change)",
    fails: (p) => n(p, "Height") - n(p, "Pocket depth") <= WALL,
    witness: { Height: 10, "Pocket depth": 9.5, "Pocket radius": 4 },
    more: [{ Height: 10, "Pocket depth": 11, "Pocket radius": 4 }],
    outside: [{ Height: 10, "Pocket depth": 9, "Pocket radius": 4 }],
  },
  "d03-fillet-corners": {
    text: "2 x Corner radius > Width: the two fillets on the short side overlap",
    fails: (p) => 2 * n(p, "Corner radius") > n(p, "Width"),
    witness: { Width: 10, "Corner radius": 8, Height: 10 },
    outside: [{ Width: 10, "Corner radius": 4.5, Height: 10 }],
  },
  "d04-bolt-circle-count": {
    text: "web 2 R sin(180/n) - 6.6 <= 0.84 between M6 holes; below 0 neighbouring holes merge (faces change)",
    fails: (p) => 2 * n(p, "Bolt circle radius") * Math.sin(Math.PI / n(p, "Holes")) - 6.6 <= WALL,
    witness: { "Bolt circle radius": 16, Holes: 14, Thickness: 6 },
    more: [{ "Bolt circle radius": 15, Holes: 16, Thickness: 6 }],
    outside: [{ "Bolt circle radius": 17.3, Holes: 14, Thickness: 6 }],
  },
  "d05-shuttle-post": {
    text: "the post disc (r 1.5 at (7, Post Y)) overlaps the shuttle (x within 1 of Shuttle X, |y| <= 5)",
    fails: (p) => rectDist(7, n(p, "Post Y"), n(p, "Shuttle X") - 1, n(p, "Shuttle X") + 1, -5, 5) < 1.5,
    witness: { "Shuttle X": 7, "Post Y": 0 },
    outside: [{ "Shuttle X": 9.8, "Post Y": 0 }],
  },
  "d06-slot-near-hole": {
    text: "web between the slot (core segment X +- 3 at Y, radius 2) and the M4 hole (r 2.25 at (10, 0)) <= 0.84, that is the distance from (X, Y) to the segment (7, 0)-(13, 0) <= 5.09; below 4.25 they merge (faces change)",
    fails: (p) => segDist(n(p, "Slot X"), n(p, "Slot Y"), 7, 0, 13, 0) - 2 - 2.25 <= WALL,
    witness: { "Slot X": 10, "Slot Y": 4.5 },
    more: [{ "Slot X": 10, "Slot Y": 3 }],
    outside: [{ "Slot X": 10, "Slot Y": 5.3 }],
  },
  "d07-pin-bushing": {
    text: "running clearance (Bore - Pin) / 2 < 0.05 (a clash when Pin > Bore)",
    fails: (p) => (n(p, "Bore") - n(p, "Pin")) / 2 < 0.05,
    witness: { Bore: 6.4, Pin: 6.6, Length: 20 },
    more: [{ Bore: 6.45, Pin: 6.4, Length: 20 }],
    outside: [{ Bore: 6.6, Pin: 6.45, Length: 20 }],
  },
  "d08-vent-bool": {
    text: "Vents on and Height <= 25.34: the web above the slot (top at z 24.5) Height - 24.5 <= 0.84; below 24.5 the slot opens the rim and its end arcs meet the rim at 37 degrees or less over the declared range (from 24), a knife edge",
    fails: (p) => p["Vents"] === true && n(p, "Height") - 24.5 <= WALL,
    witness: { Height: 25, Width: 70, Vents: true },
    more: [{ Height: 24.2, Width: 70, Vents: true }],
    outside: [{ Height: 25.6, Width: 70, Vents: true }, { Height: 24, Width: 70, Vents: false }],
  },
  "d09-rotor-stop": {
    text: "some arm (angle 360 k / Arms, half-width 1.5) overlaps the stop pin (r 1 at radius 30, Pin angle)",
    fails: (p) => {
      const arms = n(p, "Arms");
      for (let k = 0; k < arms; k++) if (armHitsPin((360 * k) / arms, n(p, "Arm length"), 1.5, 30, n(p, "Pin angle"), 1)) return true;
      return false;
    },
    witness: { Arms: 4, "Pin angle": 90, "Arm length": 36 },
    outside: [{ Arms: 4, "Pin angle": 96, "Arm length": 36 }],
  },
  "d10-screw-boss-choice": {
    text: "boss wall Boss radius - r <= 0.84, or a floor 0 < Boss height + 3 - pocket length <= 0.84, with the heat-set pocket's r and length for the Screw; a pocket that runs through the plate (floor <= 0) fails nothing in this brief",
    fails: (p) => {
      const h = HEAT_SET[p["Screw"] as string]!;
      const floor = n(p, "Boss height") + 3 - h.len;
      return n(p, "Boss radius") - h.r <= WALL || (floor > 0 && floor <= WALL);
    },
    witness: { Screw: "M6", "Boss radius": 4.5, "Boss height": 12 },
    more: [{ Screw: "M6", "Boss radius": 6, "Boss height": 10.2 }],
    outside: [{ Screw: "M6", "Boss radius": 5.2, "Boss height": 12 }, { Screw: "M6", "Boss radius": 6, "Boss height": 9 }],
  },
  "d11-hole-diagonal": {
    text: "web between the hole (r 1.5 at x = 10 + A + B) and the slot (x 61 to 63) <= 0.84, that is A + B in [48.66, 55.34]; inside [49.5, 54.5] they merge (faces change)",
    fails: (p) => {
      const x = 10 + n(p, "Offset A") + n(p, "Offset B");
      return (x <= 61 ? 61 - x - 1.5 : x >= 63 ? x - 63 - 1.5 : -1) <= WALL;
    },
    witness: { "Offset A": 24.5, "Offset B": 24.5 },
    more: [{ "Offset A": 26, "Offset B": 26 }],
    outside: [{ "Offset A": 24, "Offset B": 24.3 }],
  },
  "d12-swing-arm": {
    text: "the arm (half-width 1, length L, at Angle) overlaps the post (r 1 at radius 25, 47 degrees)",
    fails: (p) => armHitsPin(n(p, "Angle"), n(p, "Arm length"), 1, 25, 47, 1),
    witness: { Angle: 47, "Arm length": 30 },
    outside: [{ Angle: 41.5, "Arm length": 30 }],
  },
  "d13-key-drift": {
    text: "side gap Clearance - 0.002 (Length - 60) < 0.15",
    fails: (p) => n(p, "Clearance") - 0.002 * (n(p, "Length") - 60) < 0.15,
    witness: { Length: 120, Clearance: 0.2 },
    outside: [{ Length: 120, Clearance: 0.31 }],
  },
  "d14-side-port": {
    text: "web above the port Height - (Port height + Port diameter / 2) <= 0.84 (0 only at the corner of the box)",
    fails: (p) => n(p, "Height") - (n(p, "Port height") + n(p, "Port diameter") / 2) <= WALL,
    witness: { Height: 20, "Port height": 16, "Port diameter": 7, Width: 60 },
    outside: [{ Height: 20, "Port height": 15, "Port diameter": 8, Width: 60 }],
  },
  "d15-wall-boss": {
    text: "skin under the pocket Boss length + Wall - Pocket depth <= 0.84; at 0 and below the pocket runs through the wall (faces change)",
    fails: (p) => n(p, "Boss length") + n(p, "Wall") - n(p, "Pocket depth") <= WALL,
    witness: { Wall: 2, "Boss length": 4, "Pocket depth": 5.5 },
    more: [{ Wall: 2, "Boss length": 4, "Pocket depth": 8 }],
    outside: [{ Wall: 2, "Boss length": 4, "Pocket depth": 5 }],
  },
};

/** Every value of a discrete parameter, or undefined for a continuous one. */
export function discreteValues(d: ParamDecl): ParamValue[] | undefined {
  if (d.type === "bool") return [false, true];
  if (d.type === "choice") return d.options!;
  if (d.integer) return Array.from({ length: d.max! - d.min! + 1 }, (_, i) => d.min! + i);
  return undefined;
}

/** The region's share of the declared box: exact over discrete values, a midpoint grid of g cells per continuous axis. */
export function regionShare(params: ParamDecl[], fails: (p: P) => boolean, g = 200): number {
  const axes = params.map((d) => discreteValues(d) ?? Array.from({ length: g }, (_, i) => d.min! + ((i + 0.5) / g) * (d.max! - d.min!)));
  let inside = 0, total = 0;
  const p: P = {};
  const walk = (i: number) => {
    if (i === axes.length) {
      total++;
      if (fails(p)) inside++;
      return;
    }
    for (const v of axes[i]!) {
      p[params[i]!.name] = v;
      walk(i + 1);
    }
  };
  walk(0);
  return inside / total;
}

/**
 * How many points of the corner set lie inside the region: every continuous axis at its min
 * or max, crossed with every value of each discrete axis. Zero means no corner reaches the
 * defect, so only sampling or a search inside the box can find it.
 */
export function cornersInside(params: ParamDecl[], fails: (p: P) => boolean): { inside: number; total: number } {
  const axes = params.map((d) => discreteValues(d) ?? [d.min!, d.max!]);
  let inside = 0, total = 0;
  const p: P = {};
  const walk = (i: number) => {
    if (i === axes.length) {
      total++;
      if (fails(p)) inside++;
      return;
    }
    for (const v of axes[i]!) {
      p[params[i]!.name] = v;
      walk(i + 1);
    }
  };
  walk(0);
  return { inside, total };
}

/** The chance that n uniform random points all miss a region of this share. */
export const missChance = (share: number, n: number) => (1 - share) ** n;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  process.stdout.write("defect\tshare of box\tcorner points inside\tP(64 uniform points miss)\n");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".brief.json")).sort()) {
    const brief = JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; params: ParamDecl[] };
    const region = REGIONS[brief.id];
    if (!region) continue;
    // Coarser grids above three continuous axes keep the count of cells reasonable.
    const continuous = brief.params.filter((d) => !discreteValues(d)).length;
    const share = regionShare(brief.params, region.fails, continuous >= 4 ? 40 : continuous === 3 ? 100 : 400);
    const c = cornersInside(brief.params, region.fails);
    process.stdout.write(`${brief.id}\t${(share * 100).toFixed(3)}%\t${c.inside} of ${c.total}\t${missChance(share, 64).toFixed(3)}\n`);
  }
}
