// Remove absolute file paths from messages that leave the machine (tool results, job errors,
// worker logs). Paths often hold a user name ('C:\Users\John Smith\...'), so a path ends at
// its closing quote, or, unquoted, at the first space that is not followed by more path.

// One path segment: no separators, no whitespace, no quotes, no colon.
const SEG = String.raw`[^\\/\s'"\x60:]+`;
// Unquoted: a drive or file URL prefix, then two or more segments. A segment may hold single
// spaces only when another separator follows, so "/a/b is missing" keeps " is missing".
const UNQUOTED = new RegExp(String.raw`(?<![\w#.-])(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/](?:${SEG}(?: ${SEG})*(?=[\\/])|${SEG})){2,}`, "g");
// Quoted: everything up to the matching quote, when it starts like an absolute path.
const QUOTED = /(['"`])((?:file:\/\/)?(?:[A-Za-z]:)?[\\/][^'"`\n]*)\1/g;

/**
 * The message with every absolute path replaced. By default a path becomes "<path>"; pass
 * replace to keep a part of it, for example its last segment.
 */
export function redactPaths(message: string, replace: (lastSegment: string) => string = () => "<path>"): string {
  const last = (p: string) => p.split(/[\\/]/).filter((s) => s !== "").pop() ?? "";
  return message
    .replace(QUOTED, (_m, q: string, p: string) => `${q}${replace(last(p))}${q}`)
    .replace(UNQUOTED, (p) => replace(last(p)));
}
