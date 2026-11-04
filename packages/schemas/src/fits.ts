// Fit lines for people and agents: identical fits collapsed into one line with n, and the
// closest relation first. Shared by the report (packages/assembly) and the CLI, which lists
// every collapsed line to a person.
import type { FitReport } from "./types.ts";

/** The closest relation first: clash, contact, clearance; a pair's further gaps (extra) last. */
export function rankFits(fits: FitReport[]): FitReport[] {
  const order = { clash: 0, contact: 1, clearance: 2 } as const;
  const rank = (f: FitReport) => (f.extra ? 3 : 0) + order[f.kind];
  return [...fits].sort((a, b) => rank(a) - rank(b));
}

/**
 * Collapse fits that differ only in the #n of their occurrence names (four screws that sit
 * the same way in the base) into one line with n, naming the range: screw#1..4.
 */
export function collapseFits(fits: FitReport[]): FitReport[] {
  const base = (path: string) => /^(.*)#(\d+)$/.exec(path);
  const groups = new Map<string, FitReport[]>();
  for (const f of fits) {
    const key = [f.kind, f.extra ? "extra" : "", f.volume_mm3 ?? "", f.distance_mm ?? "", f.confidence, base(f.a)?.[1] ?? f.a, base(f.b)?.[1] ?? f.b].join("\u0000");
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0]!;
    return { ...g[0]!, a: rangeName(g.map((f) => f.a)), b: rangeName(g.map((f) => f.b)), n: g.length };
  });
}

/** One name for several paths: the path itself when all agree, else stem#first..last or stem#1,3,7. */
function rangeName(paths: string[]): string {
  const unique = [...new Set(paths)];
  if (unique.length === 1) return unique[0]!;
  const parsed = unique.map((p) => /^(.*)#(\d+)$/.exec(p));
  const stem = parsed[0]?.[1];
  if (!stem || parsed.some((m) => !m || m[1] !== stem)) return unique.join(",");
  const nums = parsed.map((m) => Number(m![2])).sort((a, b) => a - b);
  const consecutive = nums.every((x, i) => i === 0 || x === nums[i - 1]! + 1);
  return consecutive ? `${stem}#${nums[0]}..${nums[nums.length - 1]}` : `${stem}#${nums.join(",")}`;
}
