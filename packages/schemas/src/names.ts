// Display names of parts and occurrences come from scripts, so they are untrusted text. One
// cleaning step keeps them safe for every file format: no control characters (they are not
// allowed in XML 1.0 and mean nothing in STEP), no lone surrogates, and a bounded length.

/** The longest name kept, in UTF-16 code units. */
export const MAX_NAME_LENGTH = 200;

// C0 controls (tab and newline included), DEL, C1 controls, and unpaired surrogates.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** The name without control characters or lone surrogates, trimmed, at most max code units long. */
export function cleanName(name: string, max = MAX_NAME_LENGTH): string {
  let s = name.replace(UNSAFE, "").trim();
  if (s.length > max) {
    s = s.slice(0, max);
    // Do not leave half of a surrogate pair at the end.
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
  }
  return s;
}
