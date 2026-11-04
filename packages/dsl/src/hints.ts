// Hints for SCRIPT_RUNTIME errors that come from a wrong name. QuickJS says "TypeError: not
// a function" without naming the method, and agents often guess names from CadQuery,
// OpenSCAD or three.js. The hint names the identifier from the script line and suggests the
// nearest DSL entry, so the next try can be right.
import type { ScriptError } from "@open3dj/schemas";
import { PRELUDE } from "./prelude.ts";

/** Names from other CAD tools and the DSL entry that does the same. */
const ALIASES: Readonly<Record<string, string>> = {
  union: "add", fuse: "add", plus: "add", join: "add",
  difference: "subtract", cut: "subtract", minus: "subtract", diff: "subtract",
  intersection: "intersect", common: "intersect",
  cube: "box", cuboid: "box", rectangle: "rect", square: "rect", circle: "circle2d",
  polyline: "polygon", ellipse2d: "ellipse", hexagon: "ngon", regularPolygon: "ngon",
  move: "translate", translateTo: "moveTo", moveBy: "translate", rotateAbout: "rotate",
  revolveAround: "revolve", sweep: "extrude", linearExtrude: "extrude", rotateExtrude: "revolve",
  hollow: "shell", fillets: "fillet", round: "fillet", bevel: "chamfer", mirrorAcross: "mirror",
  setColor: "color", colour: "color", setName: "name", clone: "clone", copy: "clone",
};

const JS_GLOBALS = new Set(["Math", "JSON", "Number", "String", "Array", "Object", "Boolean", "Error", "parseInt", "parseFloat", "isNaN", "isFinite", "console", "Symbol", "Map", "Set", "Infinity", "NaN", "undefined"]);
/** Methods of JavaScript arrays, strings, numbers, Math and friends, which scripts use freely. */
const JS_METHODS = new Set(("map forEach filter reduce push pop shift unshift slice splice concat join flat flatMap find findIndex some every includes indexOf " +
  "keys values entries toFixed toString abs min max sqrt sin cos tan asin acos atan atan2 floor ceil round trunc sign hypot pow log exp random " +
  "apply call bind fill from of isArray assign freeze stringify parse sort reverse at padStart padEnd split replace trim startsWith endsWith " +
  "charAt toUpperCase toLowerCase repeat log warn error has get set add delete clear").split(" "));

/** Global functions the prelude defines (api entries) and shape, sketch and path methods (class bodies). */
const GLOBALS = new Set<string>(["Param", "lib", "connector", ...[...PRELUDE.matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]!)]);
const METHODS = new Set<string>([...PRELUDE.matchAll(/^ {2}(\w+)\([^)]*\) \{/gm)].map((m) => m[1]!));
const KNOWN = new Set<string>([...GLOBALS, ...METHODS]);

/** The hint for a runtime error caused by an unknown name, or undefined when it is something else. */
export function runtimeHint(error: ScriptError, source: string): string | undefined {
  if (error.code !== "SCRIPT_RUNTIME" || error.hint) return undefined;
  const ref = /ReferenceError: '?([A-Za-z_$][\w$]*)'? is not defined/.exec(error.message);
  let name = ref?.[1];
  let method = false;
  if (!name && /TypeError: .*not a function/.test(error.message) && error.line !== undefined) {
    const line = source.split(/\r?\n/)[error.line - 1] ?? "";
    // The first called name on that line that the DSL does not define.
    for (const m of line.matchAll(/(\.?)([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[2]!;
      const unknown = m[1] === "."
        ? !METHODS.has(id) && !JS_METHODS.has(id)
        : !GLOBALS.has(id) && !JS_GLOBALS.has(id) && !/^(if|for|while|switch|function|return|catch)$/.test(id) && !declared(source, id);
      if (unknown) {
        name = id;
        method = m[1] === ".";
        break;
      }
    }
  }
  if (!name) return undefined;
  const near = suggest(name);
  const tail = near ? ` Did you mean ${near}? docs {query: "${near}"} gives its signature.` : "";
  const what = method ? `".${name}()" is not a method of shapes or sketches.` : `"${name}" is not a DSL entry.`;
  return `${what}${tail} docs {query: "entries"} lists every entry.`;
}

function declared(source: string, id: string): boolean {
  return new RegExp(`(?:const|let|var|function)\\s+${id}\\b|\\b${id}\\s*=`).test(source);
}

function suggest(name: string): string | undefined {
  const alias = ALIASES[name] ?? ALIASES[name.toLowerCase()];
  if (alias) return alias;
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of KNOWN) {
    const d = distance(name.toLowerCase(), k.toLowerCase());
    if (d < bestD) [best, bestD] = [k, d];
  }
  return bestD <= Math.max(1, Math.floor(name.length / 4)) ? best : undefined;
}

/** Levenshtein distance. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
