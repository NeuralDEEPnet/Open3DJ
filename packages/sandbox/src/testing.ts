// A small fake host API for sandbox tests: shapes are host-side records behind integer ids,
// as in the real DSL, but without a kernel. Not exported from the package index.
import type { GuestValue, HostApi } from "./types.ts";

export interface FakeHost {
  hostApi: HostApi;
  /** What scripts passed to report(), for probes. */
  reports: GuestValue[];
  /** Calls seen by beforeCall, with their user lines. */
  sites: { name: string; line?: number }[];
}

class CodedError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly elements: string[] | undefined;
  constructor(code: string, message: string, hint?: string, elements?: string[]) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.elements = elements;
  }
}

export function fakeHost(options: { onCall?: () => void } = {}): FakeHost {
  const volumes = new Map<number, number>();
  let next = 1;
  let maxHandles = Infinity;
  const reports: GuestValue[] = [];
  const sites: { name: string; line?: number }[] = [];
  const add = (v: number) => {
    if (volumes.size >= maxHandles) throw new CodedError("SCRIPT_LIMIT", `handle limit ${maxHandles} reached`);
    volumes.set(next, v);
    return next++;
  };
  const get = (id: GuestValue) => {
    if (typeof id !== "number" || !volumes.has(id)) throw new CodedError("DSL_BAD_HANDLE", `invalid shape handle ${String(id)}`);
    return volumes.get(id)!;
  };
  const size = (x: GuestValue, what: string) => {
    if (typeof x !== "number" || !Number.isFinite(x)) throw new CodedError("DSL_BAD_ARGUMENT", `${what} must be a finite number`);
    if (x <= 0) throw new CodedError("DSL_BAD_ARGUMENT", `${what} must be greater than 0, got ${x}`);
    if (x > 1e6) throw new CodedError("DSL_BAD_ARGUMENT", `${what} is too large (${x} > 1e6 mm)`);
    return x;
  };
  const hostApi: HostApi = {
    functions: {
      box: (w, d, h) => add(size(w ?? null, "width") * size(d ?? null, "depth") * size(h ?? null, "height")),
      translate: (id) => add(get(id ?? null)),
      union: (ids) => {
        if (!Array.isArray(ids)) throw new CodedError("DSL_BAD_ARGUMENT", "union needs a list");
        return add(ids.reduce<number>((s, id) => s + get(id), 0));
      },
      fillet: (id, r) => {
        get(id ?? null);
        throw new CodedError("KERNEL_FILLET_FAILED", `fillet failed: radius ${String(r)} does not fit`, "Use a smaller radius.", ["edge:1", "edge:2"]);
      },
      volume: (id) => get(id ?? null),
      report: (x) => {
        reports.push(x ?? null);
        return null;
      },
      hostThrow: () => {
        throw new Error("simulated host failure at /home/secret/path.ts:1:1");
      },
      poke: () => {
        options.onCall?.();
        return null;
      },
    },
    prelude: PRELUDE,
    beforeCall: (name, site) => sites.push({ name, ...(site.line === undefined ? {} : { line: site.line }) }),
    onStart: (limits) => {
      maxHandles = limits.maxHandles;
    },
  };
  return { hostApi, reports, sites };
}

const PRELUDE = `"use strict";(function (g) {
  const H = g.__host;
  const TOKEN = {};
  const stringify = JSON.stringify;
  class Shape {
    #id; #name;
    constructor(token, id) {
      if (token !== TOKEN) throw new TypeError("Shape cannot be constructed directly; use box()");
      this.#id = id;
    }
    get id() { return this.#id; }
    translate(x = 0, y = 0, z = 0) { return wrap(H.translate(this.#id, x, y, z)); }
    volume() { return H.volume(this.#id); }
    name(n) { const s = wrap(this.#id); s.#name = String(n); return s; }
    get label() { return this.#name; }
  }
  Object.freeze(Shape);
  Object.freeze(Shape.prototype);
  const wrap = (id) => new Shape(TOKEN, id);
  const idOf = (s) => { if (!(s instanceof Shape)) throw new TypeError("expected a Shape"); return s.id; };
  const flat = (xs) => { const out = []; const walk = (x) => { if (Array.isArray(x)) for (const y of x) walk(y); else out.push(x); }; walk(xs); return out; };
  const api = {
    box: (w, d, h) => wrap(H.box(w, d, h)),
    union: (...xs) => wrap(H.union(flat(xs).map(idOf))),
    fillet: (s, r) => wrap(H.fillet(idOf(s), r)),
    report: (x) => H.report(x),
    hostThrow: () => H.hostThrow(),
    poke: () => H.poke(),
  };
  for (const k of Object.keys(api)) Object.defineProperty(g, k, { value: api[k], enumerable: false });
  g.__finish = (ret) => {
    const list = Array.isArray(ret) ? ret : [ret];
    return list.map((item, i) => {
      if (item instanceof Shape) return { id: item.id, name: item.label || "part" };
      if (item && item.shape instanceof Shape) return { id: item.shape.id, name: String(item.name || "part") };
      if (typeof item === "number" || typeof item === "string" || typeof item === "boolean" || item === null) return item;
      throw new TypeError("return a Shape or { name, shape } (item " + i + ")");
    });
  };
})(globalThis);`;

/** Small, fast limits for hostile cases. */
export const FAST_LIMITS = { cpuMs: 300, memoryBytes: 48 * 1024 * 1024 } as const;
