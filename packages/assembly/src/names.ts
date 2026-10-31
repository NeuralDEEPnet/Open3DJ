// Names, ids and file names. Definition ids follow the assembly schema (snake_case); instance
// names add #n when one parent holds several occurrences with the same base name.
import { createHash } from "node:crypto";

/** A snake_case id that matches ^[a-z][a-z0-9_]*$. */
export function toDefId(name: string, fallback = "part"): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "") return fallback;
  return /^[a-z]/.test(s) ? s : `${fallback}_${s}`;
}

/** First id of base, base_2, base_3, ... not in used. Adds it to used. */
export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  used.add(id);
  return id;
}

/**
 * A name-based id in UUID form (version 8, RFC 9562 custom layout) from the root and the
 * occurrence path, so a re-run of the same script yields the same ids and the same bytes.
 * Ids from a previous graph always win, so renames through ops keep their id.
 */
export function nameBasedId(key: string): string {
  const h = createHash("sha256").update(`open3dj-occurrence:${key}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A safe file-name stem: letters, digits, dot, dash and underscore, no leading dot. */
export function toFileStem(name: string): string {
  const s = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "").replace(/\.{2,}/g, ".");
  return s === "" ? "assembly" : s.slice(0, 80);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
