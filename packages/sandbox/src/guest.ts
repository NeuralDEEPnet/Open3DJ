// Guest-side JavaScript evaluated inside QuickJS before the user script, in this order:
// RANDOM, BRIDGE, the host API prelude, SEAL, HARDEN. Each runs under its own internal file
// name so error locations can tell sandbox frames from user frames.

export const FILES = {
  random: "open3dj:random.js",
  bridge: "open3dj:bridge.js",
  prelude: "open3dj:prelude.js",
  seal: "open3dj:seal.js",
  harden: "open3dj:harden.js",
} as const;

/**
 * Deterministic Math.random (Mulberry32 with a fixed seed). A native QuickJS Math.random
 * differs between runs, which would make two runs of the same script disagree.
 */
export const RANDOM = `"use strict";(function () {
  let a = 0x3d1f;
  Object.defineProperty(Math, "random", {
    value: function random() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    writable: false, configurable: false, enumerable: false,
  });
})();`;

/**
 * Builds globalThis.__host from the one native function __hostCall. Arguments cross as one
 * JSON string; results come back as JSON ({ v } or { e }). A host failure becomes a guest
 * Error created here, so its stack carries the user's line. The stack of every call is sent
 * along so the host can name the user line that made a shape.
 */
export const BRIDGE = `"use strict";(function (g) {
  const native = g.__hostCall;
  const names = g.__hostNames;
  delete g.__hostCall;
  delete g.__hostNames;
  const stringify = JSON.stringify, parse = JSON.parse;
  const defineProperty = Object.defineProperty, freeze = Object.freeze, create = Object.create;
  const ErrorCtor = Error;
  const call = (name, args) => {
    const site = new ErrorCtor().stack;
    const json = stringify(args);
    if (typeof json !== "string") throw new TypeError(name + ": arguments must be plain data");
    const out = parse(native(name, json, typeof site === "string" ? site.slice(0, 4000) : ""));
    if (out.e) {
      const e = new ErrorCtor(out.e.message);
      for (const k of ["code", "op", "elements", "hint"]) {
        if (out.e[k] !== undefined) defineProperty(e, k, { value: out.e[k], enumerable: true, configurable: true, writable: true });
      }
      throw e;
    }
    return out.v;
  };
  const host = create(null);
  for (const name of names) {
    defineProperty(host, name, { value: function () { return call(name, Array.prototype.slice.call(arguments)); }, enumerable: true });
  }
  defineProperty(g, "__host", { value: freeze(host), configurable: true, enumerable: false, writable: false });
})(globalThis);`;

/**
 * Runs after the host API prelude. Captures __finish and removes every privileged global, then
 * returns the seal function: the host calls it with the script's return value, and it returns
 * the JSON text of what __finish made of it (or undefined).
 */
export const SEAL = `(function (g) {
  const finish = typeof g.__finish === "function" ? g.__finish : null;
  const stringify = JSON.stringify;
  for (const k of ["__finish", "__host", "__params"]) { try { delete g[k]; } catch (e) {} }
  return function seal(value) {
    const out = finish ? finish(value) : value;
    return out === undefined ? undefined : stringify(out);
  };
})(globalThis)`;

/**
 * Freezes every intrinsic reachable from globalThis, the hidden ones (generator, async and
 * iterator prototypes) and globalThis itself. Without it, Array.prototype.map = () => []
 * silently turned a subtraction into a no-op in the spike (wrong geometry, no error).
 */
export const HARDEN = `"use strict";(function harden(g) {
  const seen = new Set();
  const stack = [];
  const push = (v) => {
    if (((typeof v === "object" && v !== null) || typeof v === "function") && !seen.has(v)) { seen.add(v); stack.push(v); }
  };
  push(g);
  const proto = Object.getPrototypeOf;
  push(proto(function* () {}));
  push(proto(async function () {}));
  push(proto(async function* () {}));
  push(proto(proto(async function* () {}.prototype)));
  push(proto([][Symbol.iterator]()));
  push(proto(proto([][Symbol.iterator]())));
  push(proto(new Map()[Symbol.iterator]()));
  push(proto(new Set()[Symbol.iterator]()));
  push(proto(""[Symbol.iterator]()));
  push(proto(/a/[Symbol.matchAll]("a")));
  push(proto(Int8Array));
  while (stack.length) {
    const o = stack.pop();
    push(proto(o));
    for (const k of Reflect.ownKeys(o)) {
      const d = Reflect.getOwnPropertyDescriptor(o, k);
      if (!d) continue;
      if ("value" in d) push(d.value); else { push(d.get); push(d.set); }
    }
    Object.freeze(o);
  }
})(globalThis);`;

/** The user script becomes the body of a strict function, so top-level return works. */
export function wrapUserSource(source: string): string {
  return `"use strict";(function main() {\n${source}\n})`;
}

/** Lines the wrapper adds before the user's first line. */
export const WRAP_LINE_OFFSET = 1;
