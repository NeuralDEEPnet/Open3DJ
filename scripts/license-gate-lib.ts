// SPDX licence expressions for the licence gate, kept apart so tests can import it.

/** Evaluate an SPDX expression: OR needs one allowed side, AND needs both, WITH keeps the licence. */
export function spdxAllowed(expr: string, allowed: Set<string>): boolean {
  const tokens = expr.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
  let i = 0;
  const parseOr = (): boolean => {
    let v = parseAnd();
    while (tokens[i] === "OR") {
      i++;
      const r = parseAnd();
      v = v || r;
    }
    return v;
  };
  const parseAnd = (): boolean => {
    let v = parseAtom();
    while (tokens[i] === "AND") {
      i++;
      const r = parseAtom();
      v = v && r;
    }
    return v;
  };
  const parseAtom = (): boolean => {
    const t = tokens[i++];
    if (t === "(") {
      const v = parseOr();
      if (tokens[i++] !== ")") throw new Error(`bad SPDX expression: ${expr}`);
      return v;
    }
    if (t === undefined) throw new Error(`bad SPDX expression: ${expr}`);
    if (tokens[i] === "WITH") i += 2;
    return allowed.has(t.replace(/\+$/, ""));
  };
  const v = parseOr();
  if (i !== tokens.length) throw new Error(`bad SPDX expression: ${expr}`);
  return v;
}
