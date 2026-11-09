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
// A bare home folder (/home/<name>, /Users/<name>, C:\Users\<name>, or /mnt/c/Users/<name> as
// WSL shows a Windows one), in any letter case because Windows and macOS paths ignore case.
// Its last segment is the user name.
const HOME_ROOT = /^(?:file:\/\/\/?)?(?:[A-Za-z]:)?(?:[\\/]mnt[\\/][A-Za-z])?[\\/](?:home|Users)[\\/][^\\/]+[\\/]*$/i;

/**
 * The message with every absolute path replaced. By default a path becomes "<path>"; pass
 * replace to keep a part of it, for example its last segment. A bare home folder always
 * becomes "~", so a replacement that keeps the last segment never keeps a user name.
 */
export function redactPaths(message: string, replace: (lastSegment: string) => string = () => "<path>"): string {
  const last = (p: string) => p.split(/[\\/]/).filter((s) => s !== "").pop() ?? "";
  const swap = (p: string) => (HOME_ROOT.test(p) ? "~" : replace(last(p)));
  return message.replace(QUOTED, (_m, q: string, p: string) => `${q}${swap(p)}${q}`).replace(UNQUOTED, swap);
}
