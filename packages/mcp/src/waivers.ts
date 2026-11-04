// Agent waivers (S3, PLAN.md): an agent accepts an agent-waivable gate failure with a reason,
// and inspect fields=[gates] and every export's evidence then count it as waived, not open.
//
// A waiver is bound to the part definition's geometry hash, not to the revision, so an edit to
// another part keeps it. The hash (m1, packages/assembly/src/build.ts) is a measure hash:
// volume, area, counts and bounding-box size. It does not change when a hole moves inside a
// plate, which can thin a wall, so a waiver also records the failure it was made for (value,
// limit and face, plus the build direction for overhang) and covers only that same failure.
// Anything else reopens it. Human-only gates (watertight, bed) are never waived here: a
// person waives them through an approval, which arrives in S5.
import type { AssemblyFile, FdmGate, GateFailure, GateRun, GateStatus, Waiver } from "@open3dj/schemas";

/** fdm.v1 gates only a person may waive. */
export const HUMAN_GATES: ReadonlySet<FdmGate> = new Set<FdmGate>(["watertight", "bed"]);

/** Gates whose result depends on the build direction: a waiver holds for one direction. */
const DIRECTIONAL: ReadonlySet<string> = new Set(["overhang"]);

/** How a person fixes a human-only gate, for the refusal's hint. */
export const HUMAN_GATE_FIX: Readonly<Record<string, string>> = {
  watertight: "close the solid: fuse touching solids or return them as separate parts, and remove open faces",
  bed: "make the part fit the bed, split it into parts, or check with bed set to the printer's size",
};

/** Two waivers with the same key cannot both hold: a new one replaces the old one. */
export function waiverKey(w: Pick<Waiver, "def" | "gate" | "profile" | "build">): string {
  return JSON.stringify([w.def, w.gate, w.profile, DIRECTIONAL.has(w.gate) ? w.build ?? null : null]);
}

/** Whether waiver w covers failure f of definition def, in a gate run on a revision whose graph is asm. */
export function covers(w: Waiver, f: GateFailure, def: string, run: Pick<GateRun, "profile" | "build">, asm: AssemblyFile): boolean {
  const hash = asm.definitions[def]?.geometry_hash;
  return f.waivable === "agent" && w.def === def && w.gate === f.gate && w.profile === run.profile
    && hash !== undefined && w.geometry_hash === hash
    && w.value === f.value && w.limit === f.limit && w.at === f.at
    && (!DIRECTIONAL.has(f.gate) || (w.build !== undefined && w.build.every((x, i) => x === run.build[i])));
}

/**
 * The gate run with each failure either waived (it carries its waiver) or open, the overall
 * status counting open failures only, and a note on waivers that no longer cover the failure
 * they were made for, so an agent sees why a waived failure is open again.
 */
export function applyWaivers(run: GateRun, waivers: Waiver[], asm: AssemblyFile): GateRun {
  let open = 0;
  let waived = 0;
  const used = new Set<Waiver>();
  const parts = run.parts.map((p) => ({
    ...p,
    fail: p.fail.map((f) => {
      const w = waivers.find((x) => covers(x, f, p.def, run, asm));
      if (!w) {
        open++;
        return f;
      }
      waived++;
      used.add(w);
      return { ...f, waiver: { by: w.by, reason: w.reason, rev: w.rev, ts: w.ts } };
    }),
  }));
  const stale = waivers.filter((w) => !used.has(w) && parts.some((p) => p.def === w.def && p.fail.some((f) => f.gate === w.gate && !f.waiver)));
  const notes = [...run.notes];
  if (stale.length > 0) {
    const list = stale.slice(0, 8).map((w) => `${w.def} ${w.gate} (made on ${w.rev})`).join(", ") + (stale.length > 8 ? ", ..." : "");
    notes.unshift(`${stale.length} waiver${stale.length === 1 ? " does" : "s do"} not cover the current failure (the part, the measured value or face, or the build direction changed since): ${list}. Fix the part, or waive the failure again with a reason.`);
  }
  return { ...run, parts, notes, status: open > 0 ? "fail" : "pass", open, waived };
}

/** The export's summary of a gate run with waivers applied. */
export function gateStatus(run: GateRun): GateStatus {
  return { profile: run.profile, status: run.status ?? "fail", open: run.open ?? 0, waived: run.waived ?? 0 };
}
