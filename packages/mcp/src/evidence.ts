// One evidence sidecar per revision and export folder. Each export job returns a sidecar
// that lists only the files of that job; the daemon merges it with the sidecar already in
// the folder, so exporting STEP, then STL, then GLB leaves one <name>.evidence.json that
// lists all three. An earlier entry is kept only while its file is still on disk with the
// recorded hash: the sidecar never vouches for a file that changed after its export.
import { sha256Hex } from "./hash.ts";
import { readProjectBytes, readProjectFile, safeSegments } from "./paths.ts";
import type { ProjectDir } from "./paths.ts";

export interface OutputFile {
  name: string;
  format: string;
  bytes: Uint8Array;
}

export interface EvidenceEntry {
  name: string;
  format: string;
  bytes: number;
  sha256: string;
}

/**
 * The files to write, with the job's evidence sidecar (format "evidence") replaced by the
 * merged one. Files without a sidecar pass through unchanged.
 */
export function mergeEvidence(project: ProjectDir, relDir: string, files: OutputFile[]): OutputFile[] {
  const sidecar = files.find((f) => f.format === "evidence");
  if (!sidecar) return files;
  let doc: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(sidecar.bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return files;
    doc = parsed as Record<string, unknown>;
  } catch {
    return files;
  }
  const dir = safeSegments(relDir);
  const current: EvidenceEntry[] = files.filter((f) => f !== sidecar).map((f) => ({ name: f.name, format: f.format, bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) }));
  const names = new Set(current.map((f) => f.name));
  const previous = readPrevious(project, [...dir, sidecar.name].join("/"));
  const kept: EvidenceEntry[] = [];
  const warnings = new Set<string>(Array.isArray(doc["warnings"]) ? (doc["warnings"] as unknown[]).filter((w): w is string => typeof w === "string") : []);
  if (previous && previous["o3j_evidence"] === doc["o3j_evidence"] && previous["rev"] === doc["rev"] && previous["scope"] === doc["scope"]) {
    for (const e of entries(previous["files"])) {
      if (names.has(e.name) || e.name === sidecar.name) continue;
      if (onDisk(project, [...dir, e.name].join("/")) === e.sha256) kept.push(e);
    }
    if (kept.length > 0 && Array.isArray(previous["warnings"])) for (const w of previous["warnings"] as unknown[]) if (typeof w === "string") warnings.add(w);
  }
  const merged: Record<string, unknown> = { ...doc, files: [...kept, ...current] };
  if ("warnings" in doc || warnings.size > 0) merged["warnings"] = [...warnings];
  const bytes = new TextEncoder().encode(`${JSON.stringify(merged, null, 2)}\n`);
  return files.map((f) => (f === sidecar ? { ...f, bytes } : f));
}

function readPrevious(project: ProjectDir, rel: string): Record<string, unknown> | undefined {
  try {
    const text = readProjectFile(project, rel);
    if (text === undefined) return undefined;
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    // An unreadable or refused sidecar (a symlink, broken JSON) is replaced, not merged.
    return undefined;
  }
}

function entries(v: unknown): EvidenceEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is EvidenceEntry => !!e && typeof e === "object"
    && typeof (e as EvidenceEntry).name === "string" && typeof (e as EvidenceEntry).format === "string"
    && typeof (e as EvidenceEntry).bytes === "number" && typeof (e as EvidenceEntry).sha256 === "string"
    && safeName((e as EvidenceEntry).name));
}

function safeName(name: string): boolean {
  try {
    return safeSegments(name).length === 1;
  } catch {
    return false;
  }
}

/** The sha256 of a file in the project, or undefined when it is missing or refused. */
function onDisk(project: ProjectDir, rel: string): string | undefined {
  try {
    const bytes = readProjectBytes(project, rel);
    return bytes === undefined ? undefined : sha256Hex(bytes);
  } catch {
    return undefined;
  }
}
