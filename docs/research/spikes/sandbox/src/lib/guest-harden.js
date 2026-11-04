// Minimal "lockdown" inside QuickJS: freeze every intrinsic reachable from globalThis
// (constructors, their prototypes, and hidden intrinsics such as %GeneratorFunction%),
// then freeze globalThis itself. Runs after the prelude, before agent code.
"use strict";
(function harden(g) {
  const seen = new Set();
  const stack = [];
  const push = (v) => { if ((typeof v === "object" && v !== null) || typeof v === "function") { if (!seen.has(v)) { seen.add(v); stack.push(v); } } };
  push(g);
  // hidden intrinsics not reachable by name
  push(Object.getPrototypeOf(function* () {}));
  push(Object.getPrototypeOf(async function () {}));
  push(Object.getPrototypeOf(async function* () {}));
  push(Object.getPrototypeOf([][Symbol.iterator]()));
  push(Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));
  push(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
  push(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
  push(Object.getPrototypeOf(""[Symbol.iterator]()));
  push(Object.getPrototypeOf(Int8Array));
  while (stack.length) {
    const o = stack.pop();
    push(Object.getPrototypeOf(o));
    for (const k of Reflect.ownKeys(o)) {
      const d = Reflect.getOwnPropertyDescriptor(o, k);
      if (!d) continue;
      if ("value" in d) push(d.value); else { push(d.get); push(d.set); }
    }
    Object.freeze(o);
  }
})(globalThis);
