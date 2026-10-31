// Turning the run's result value (what the prelude's __finish returned) into parts and mates.
import { cleanName } from "@open3dj/schemas";
import type { Connector } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import type { GuestValue } from "@open3dj/sandbox";
import { DslError } from "./errors.ts";
import { parseColor } from "./math.ts";
import type { RunState, SolidEntry } from "./state.ts";
import type { ScriptMate, ScriptPart, ScriptReturn } from "./types.ts";
import { countTwins, elementAddress, judgeReference, signatureCandidates, withTwins } from "./refs.ts";
import type { NamedRef } from "./refs.ts";
import type { DefinitionRef } from "@open3dj/schemas";

interface ReturnedPart {
  id: number;
  name: string | null;
  color: GuestValue;
  key: string | null;
}

function readParts(value: GuestValue): ReturnedPart[] {
  const parts = value && typeof value === "object" && !Array.isArray(value) ? value["parts"] : undefined;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new DslError("DSL_BAD_RETURN", "the script returned no shapes", "Return a shape, an array of shapes, [{ name, shape, color }], or an object of named shapes.");
  }
  return parts.map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p) || typeof p["id"] !== "number") throw new DslError("DSL_BAD_RETURN", "the result is malformed");
    return {
      id: p["id"],
      name: typeof p["name"] === "string" ? p["name"] : null,
      color: p["color"] ?? null,
      key: typeof p["key"] === "string" ? p["key"] : null,
    };
  });
}

function connectorsOf(e: SolidEntry): Connector[] | undefined {
  const list = Object.entries(e.connectors).map(([name, c]) => ({ name, origin: c.origin, z: c.axis, x: c.up, gender: c.kind, type: c.type, anchor: "literal" }));
  return list.length ? list : undefined;
}

/** Most solids in one part that are checked pair by pair for overlap (n^2 booleans). */
const OVERLAP_CHECK_MAX_SOLIDS = 32;

/**
 * The first pair of solids in shape that share volume (1-based indices), or undefined. Solids
 * that only touch share no volume. Pairs whose boxes do not overlap are skipped without a boolean.
 */
export function overlappingSolids(kernel: KernelAdapter, shape: ShapeHandle): { a: number; b: number; volume: number } | undefined {
  const solids = kernel.subShapes(shape, "solid");
  if (solids.length < 2 || solids.length > OVERLAP_CHECK_MAX_SOLIDS) return undefined;
  const boxes = solids.map((s) => kernel.bbox(s));
  const mark = kernel.checkpoint();
  try {
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const [p, q] = [boxes[i]!, boxes[j]!];
        if ([0, 1, 2].some((k) => p.max[k]! <= q.min[k]! || q.max[k]! <= p.min[k]!)) continue;
        const volume = kernel.volume(kernel.common(solids[i]!, solids[j]!));
        // Relative to the smaller solid, so tolerance-sized slivers at touching faces do not count.
        const scale = Math.min(kernel.volume(solids[i]!), kernel.volume(solids[j]!));
        if (volume > 1e-6 * Math.max(1, scale)) return { a: i + 1, b: j + 1, volume };
      }
    }
    return undefined;
  } finally {
    kernel.releaseSince(mark);
  }
}

export function collect(kernel: KernelAdapter, state: RunState, value: GuestValue, tol = 1e-3): ScriptReturn {
  const returned = readParts(value);
  const entries = returned.map((r) => ({ r, e: state.shape(r.id, "returned part") }));

  // Lineages shared by two or more returned parts become clone groups.
  const lineageCount = new Map<string, number>();
  for (const { e } of entries) if (e.lineage) lineageCount.set(e.lineage.id, (lineageCount.get(e.lineage.id) ?? 0) + 1);

  const parts: ScriptPart[] = entries.map(({ r, e }) => {
    // Names are script text: drop control characters once here, so mates, reports and every export agree.
    const part: ScriptPart = { name: cleanName(r.name ?? e.name ?? r.key ?? "part") || "part", shape: e.handle };
    if (r.color !== null) {
      const c = parseColor(r.color);
      if (c) part.color = c;
      else state.warn(`part ${part.name}: color ${JSON.stringify(r.color)} is not "#rrggbb", "#rgb" or [r, g, b]; ignored`);
    }
    if (!part.color && e.color) part.color = e.color;
    if (e.lineage && (lineageCount.get(e.lineage.id) ?? 0) > 1) {
      part.cloneOf = e.lineage.id;
      part.cloneTransform = e.lineage.t;
    }
    if (Object.keys(e.refs).length) part.refs = { ...e.refs };
    if (e.named && Object.keys(e.named).length) part.namedRefs = resolveNamed(kernel, e.handle, e.named, tol);
    const connectors = connectorsOf(e);
    if (connectors) part.connectors = connectors;
    if (e.line !== undefined) part.line = e.line;
    const solidsCount = kernel.counts(e.handle).solids;
    if (solidsCount > 1) {
      const hit = overlappingSolids(kernel, e.handle);
      if (hit) {
        throw new DslError("DSL_OVERLAPPING_SOLIDS", `part ${part.name} has ${solidsCount} solids, and solids ${hit.a} and ${hit.b} overlap by ${hit.volume.toPrecision(4)} mm3; its volume would be counted twice`, "Union the pieces into one solid (a.union(b)), or return them as separate parts.");
      }
    }
    if (solidsCount !== 1) state.warn(`part ${part.name} has ${solidsCount} solids, not 1; check that its pieces touch`);
    return part;
  });

  const names = parts.map((p) => p.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  const mates: ScriptMate[] = [];
  for (const m of state.mates) {
    const moving = entries.flatMap(({ e }, i) => (e.body === m.movingBody ? [parts[i]!.name] : []));
    const target = entries.flatMap(({ e }, i) => (e.body === m.targetBody ? [parts[i]!.name] : []));
    if (moving.length !== 1 || target.length !== 1) {
      const where = m.line === undefined ? "" : ` (line ${m.line})`;
      state.warn(`matchTo${where}: ${moving.length === 0 || target.length === 0 ? "a mated part was not returned" : "a mated part was returned more than once"}; the mate is not recorded`);
      continue;
    }
    if (duplicates.includes(moving[0]!) || duplicates.includes(target[0]!)) state.warn(`matchTo: part names are not unique (${moving[0]}, ${target[0]}); give the parts distinct names`);
    const mate: ScriptMate = { a: `${moving[0]}.${m.movingConnector}`, b: `${target[0]}.${m.targetConnector}`, flip: true };
    if (m.line !== undefined) mate.line = m.line;
    mates.push(mate);
  }

  for (const name of Object.keys(state.overrides)) {
    if (!state.params.has(name)) state.warn(`param ${name} was given but the script does not declare it`);
  }
  const params = Object.fromEntries([...state.params.values()].map((p) => [p.name, p.value]));
  return { parts, mates, params, paramSpecs: [...state.params.values()], warnings: [...state.warnings] };
}

const isIdentity = (t: { t: number[]; q: number[] }) => Math.hypot(...t.t) <= 1e-12 && Math.abs(Math.abs(t.q[3]!) - 1) <= 1e-12;

/**
 * Named faces and edges on the returned part. A name given before later booleans or
 * features is found again on the final shape by its fingerprint; a name given on the final
 * shape matches itself. The fingerprint stored is the final element's.
 */
function resolveNamed(kernel: KernelAdapter, shape: ShapeHandle, named: Record<string, NamedRef>, tol: number): DefinitionRef[] {
  return Object.entries(named).map(([name, r]) => {
    const out: DefinitionRef = { name, type: r.type, state: r.state };
    if (r.frame && !isIdentity(r.frame)) out.frame = r.frame;
    if (r.state !== "exact" || !r.fingerprint) {
      if (r.candidates) out.candidates = r.candidates.map((i) => elementAddress(r.type, i));
      if (r.reason) out.reason = r.reason;
      return out;
    }
    const candidates = signatureCandidates(kernel, shape, r.fingerprint);
    const j = judgeReference(r.fingerprint, candidates.map((c) => c.fp), undefined, tol);
    out.state = j.state;
    if (j.match !== undefined) {
      const fp = candidates[j.match]!.fp;
      out.at = elementAddress(r.type, candidates[j.match]!.index);
      // Twins on the final shape: the next revision compares with this fingerprint.
      out.fingerprint = withTwins(fp, countTwins(fp, candidates.filter((_, i) => i !== j.match).map((c) => c.fp), tol));
    } else {
      // Keep the fingerprint from naming time, so the next run can still compare with it.
      out.fingerprint = r.fingerprint;
      if (j.candidates?.length) out.candidates = j.candidates.map((i) => elementAddress(r.type, candidates[i]!.index));
      out.reason = `named before later changes to the shape, and ${j.reason ?? "it could not be found again"}; name it on the final shape`;
    }
    return out;
  });
}
