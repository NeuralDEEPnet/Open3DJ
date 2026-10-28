// Clash, contact and clearance between part occurrences (ASSEMBLIES.md section 6).
// Tier 0: world AABBs grown by the watch distance drop far pairs. Tier 2: exact OCCT
// common() volume and minimum distance on the remaining pairs, labelled "measured".
import type { FitReport } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import { KernelError } from "@open3dj/kernel";
import type { Assembly, FitOptions } from "./types.ts";
import { bboxesOverlap } from "./math.ts";

export const DEFAULT_FIT_OPTIONS: Readonly<Required<FitOptions>> = Object.freeze({
  watchDistance: 0.5,
  volumeTolerance: 1e-6,
  contactTolerance: 1e-6,
});

/** Occurrence-path pairs joined by a mate, as "a\u0000b" with a < b. */
function matedPairs(asm: Assembly): Set<string> {
  const pairs = new Set<string>();
  const owner = (end: string) => end.slice(0, Math.max(0, end.lastIndexOf(".")));
  for (const m of asm.file.mates ?? []) pairs.add(pairKey(owner(m.a), owner(m.b)));
  return pairs;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Every pair of part occurrences that clash, touch or sit within the watch distance. */
export function computeFits(kernel: KernelAdapter, asm: Assembly, options: FitOptions = {}): FitReport[] {
  const o = { ...DEFAULT_FIT_OPTIONS, ...options };
  const mated = matedPairs(asm);
  const fits: FitReport[] = [];
  const mark = kernel.checkpoint();
  try {
    const placed: ShapeHandle[] = asm.instances.map((i) => kernel.place(asm.shapes.get(i.def)!, i.world));
    const boxes = placed.map((s) => kernel.bbox(s));
    const solid = placed.map((s) => kernel.counts(s).solids > 0);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (!bboxesOverlap(boxes[i]!, boxes[j]!, o.watchDistance)) continue;
        const a = asm.instances[i]!.path;
        const b = asm.instances[j]!.path;
        const inner = kernel.checkpoint();
        try {
          const fit = classify(kernel, placed[i]!, placed[j]!, solid[i]! && solid[j]! && bboxesOverlap(boxes[i]!, boxes[j]!, 0), o);
          if (!fit) continue;
          if (fit.kind === "contact" && mated.has(pairKey(a, b))) continue;
          fits.push({ a, b, ...fit });
        } catch (e) {
          // A failed exact check must not hide a possible clash: report it, labelled inferred.
          const why = e instanceof KernelError ? e.code : "ERROR";
          asm.warnings.push(`fit check ${a} / ${b} failed in the kernel (${why}); reported as a possible clash.`);
          fits.push({ a, b, kind: "clash", confidence: "inferred" });
        } finally {
          kernel.releaseSince(inner);
        }
      }
    }
  } finally {
    kernel.releaseSince(mark);
  }
  return fits;
}

type Fit = Omit<FitReport, "a" | "b">;

function classify(kernel: KernelAdapter, a: ShapeHandle, b: ShapeHandle, mayOverlap: boolean, o: Required<FitOptions>): Fit | undefined {
  // Volume first: the minimum distance of nested solids is not reliably 0.
  if (mayOverlap) {
    const volume = kernel.volume(kernel.common(a, b));
    if (volume > o.volumeTolerance) return { kind: "clash", volume_mm3: volume, confidence: "measured" };
  }
  const distance = Math.max(0, kernel.distance(a, b));
  if (distance <= o.contactTolerance) return { kind: "contact", distance_mm: distance, confidence: "measured" };
  if (distance <= o.watchDistance) return { kind: "clearance", distance_mm: distance, confidence: "measured" };
  return undefined;
}
