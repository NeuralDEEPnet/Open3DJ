// runScript: one agent script in one fresh QuickJS instance.
//
// Order of a run: fresh capped instance -> runtime limits -> host bridge -> host API prelude
// -> seal (captures __finish, deletes privileged globals) -> harden (freeze intrinsics)
// -> user script as a function body -> seal(result) -> JSON text -> host value.
import { performance } from "node:perf_hooks";
import { DefaultIntrinsics } from "quickjs-emscripten-core";
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten-core";
import type { ScriptError } from "@open3dj/schemas";
import { BRIDGE, FILES, HARDEN, RANDOM, SEAL, wrapUserSource } from "./guest.ts";
import { cap, hostError, scriptErrorFromGuest, StickyFault, userSite } from "./errors.ts";
import { freshQuickJS, MIN_MEMORY_BYTES } from "./quickjs.ts";
import type { GuestValue, RunScriptOptions, RunScriptResult, SandboxLimits, SandboxStats, ScriptLog } from "./types.ts";

export const DEFAULT_LIMITS: Readonly<Required<SandboxLimits>> = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  stackBytes: 256 * 1024,
  cpuMs: 2000,
  maxHostCalls: 5000,
  maxHandles: 20000,
  maxBatch: 1000,
  maxStringArg: 4096,
  maxResultBytes: 64 * 1024,
});

/** Largest JSON text of one host call's arguments. */
const MAX_ARGS_BYTES = 1024 * 1024;
/** Deepest nesting of one host call's arguments. */
const MAX_ARGS_DEPTH = 16;
const MAX_LOGS = 200;
const MAX_LOG_CHARS = 2000;
const CODE = /^[A-Z][A-Z0-9_]*$/;

/** Check and complete the limits. Bad limits are a host bug, so this throws. */
export function resolveLimits(limits: SandboxLimits = {}): Required<SandboxLimits> {
  const L = { ...DEFAULT_LIMITS, ...dropUndefined(limits) };
  const int = (k: keyof SandboxLimits, min: number, max: number) => {
    const v = L[k];
    if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`sandbox limit ${k} must be an integer from ${min} to ${max}, got ${v}`);
  };
  int("memoryBytes", MIN_MEMORY_BYTES, 4 * 1024 ** 3 - 65536);
  // 0 would disable QuickJS's own stack check, and the host stack would overflow instead.
  int("stackBytes", 16 * 1024, 8 * 1024 * 1024);
  int("cpuMs", 1, 3_600_000);
  int("maxHostCalls", 0, 10_000_000);
  int("maxHandles", 0, 10_000_000);
  int("maxBatch", 1, 1_000_000);
  int("maxStringArg", 1, 16 * 1024 * 1024);
  int("maxResultBytes", 2, 256 * 1024 * 1024);
  return L;
}

/** Replace absolute file paths and file URLs in a host message. */
export function redactPaths(message: string): string {
  return message.replace(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}/g, "<path>");
}

function dropUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Run one script in a fresh QuickJS instance. Never throws for script faults: syntax
 * errors, runtime errors, limits and host-call failures come back as { ok: false, error }
 * with the user's line and column. It throws only for host bugs (for example a missing
 * hostApi, bad limits or a prelude that does not evaluate).
 */
export async function runScript(source: string, options: RunScriptOptions): Promise<RunScriptResult> {
  if (typeof source !== "string") throw new TypeError("runScript: source must be a string");
  const hostApi = options?.hostApi;
  if (!hostApi || typeof hostApi.prelude !== "string" || typeof hostApi.functions !== "object" || hostApi.functions === null) {
    throw new TypeError("runScript: options.hostApi with functions and prelude is required");
  }
  const filename = options.filename ?? "part.o3j.js";
  if (filename.length === 0 || filename.startsWith("open3dj:") || /[\n()]/.test(filename)) {
    throw new RangeError(`runScript: invalid filename ${JSON.stringify(filename)}`);
  }
  const L = resolveLimits(options.limits);
  hostApi.onStart?.(L);

  const t0 = performance.now();
  const fresh = await freshQuickJS(L.memoryBytes);
  const instantiateMs = performance.now() - t0;
  const run = new Run(source, options, L, filename, fresh.module.newRuntime());
  try {
    return run.execute((): SandboxStats => ({
      cpuMs: round(run.guestMs()),
      hostCalls: run.hostCalls,
      memoryBytes: fresh.memory.buffer.byteLength,
      instantiateMs: round(instantiateMs),
    }));
  } finally {
    run.dispose();
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;

type Outcome = { ok: true; value: GuestValue } | { ok: false; error: ScriptError };

class Run {
  readonly source: string;
  readonly options: RunScriptOptions;
  readonly L: Required<SandboxLimits>;
  readonly filename: string;
  readonly rt: QuickJSRuntime;
  readonly ctx: QuickJSContext;
  readonly logs: ScriptLog[] = [];
  readonly owned: QuickJSHandle[] = [];
  hostCalls = 0;
  hostMs = 0;
  execStart = 0;
  execEnd = 0;
  deadline = Infinity;
  armed = false;
  interrupted = false;
  cancelled = false;
  sticky: { error: StickyFault; line?: number; column?: number } | undefined;
  /** Set when the wasm instance may be corrupt; we then drop it without disposing. */
  poisoned = false;

  constructor(source: string, options: RunScriptOptions, L: Required<SandboxLimits>, filename: string, rt: QuickJSRuntime) {
    this.source = source;
    this.options = options;
    this.L = L;
    this.filename = filename;
    this.rt = rt;
    rt.setMemoryLimit(L.memoryBytes);
    rt.setMaxStackSize(L.stackBytes);
    rt.setInterruptHandler(() => {
      if (!this.armed) return false; // setup code is trusted and short
      if (options.signal?.aborted) {
        this.cancelled = true;
        return true;
      }
      if (Date.now() > this.deadline) {
        this.interrupted = true;
        return true;
      }
      return false;
    });
    // No Date: scripts must be deterministic, and time is a side channel.
    this.ctx = rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
  }

  guestMs(): number {
    if (this.execStart === 0) return 0;
    return Math.max(0, (this.execEnd || performance.now()) - this.execStart - this.hostMs);
  }

  execute(stats: () => SandboxStats): RunScriptResult {
    this.setup();
    const outcome = this.runUser();
    const s = stats();
    return outcome.ok ? { ok: true, value: outcome.value, logs: this.logs, stats: s } : { ok: false, error: outcome.error, logs: this.logs, stats: s };
  }

  // ---- setup (trusted code; any failure is a host bug) ----------------------------------
  setup(): void {
    const { ctx } = this;
    const names = Object.keys(this.options.hostApi.functions);
    this.setGlobal("__hostCall", ctx.newFunction("__hostCall", (n, a, s) => this.hostCall(n, a, s)));
    this.setGlobal("__hostLog", ctx.newFunction("__hostLog", (l, m) => this.hostLog(l, m)));
    this.setGlobal("__hostNames", this.json(names));
    this.setGlobal("__paramsJson", ctx.newString(JSON.stringify(this.options.params ?? {})));
    this.evalTrusted(RANDOM, FILES.random);
    this.evalTrusted(BRIDGE, FILES.bridge);
    this.evalTrusted(CONSOLE, FILES.bridge);
    this.evalTrusted(this.options.hostApi.prelude, FILES.prelude);
    this.seal = this.evalTrusted(SEAL, FILES.seal, true);
    this.evalTrusted(HARDEN, FILES.harden);
  }

  seal: QuickJSHandle | undefined;

  setGlobal(name: string, handle: QuickJSHandle): void {
    this.ctx.setProp(this.ctx.global, name, handle);
    handle.dispose();
  }

  json(value: unknown): QuickJSHandle {
    const r = this.ctx.evalCode(`(${JSON.stringify(value)})`, FILES.bridge);
    if (r.error) {
      r.error.dispose();
      throw new Error("sandbox: could not create a guest value");
    }
    return r.value;
  }

  evalTrusted(code: string, file: string): void;
  evalTrusted(code: string, file: string, keep: true): QuickJSHandle;
  evalTrusted(code: string, file: string, keep = false): QuickJSHandle | void {
    const r = this.ctx.evalCode(code, file);
    if (r.error) {
      const e = this.readError(r.error);
      r.error.dispose();
      throw new Error(`sandbox setup failed in ${file}: ${cap(`${e.name ?? "Error"}: ${e.message ?? ""} ${e.stack ?? ""}`, 1000)}`);
    }
    if (keep) {
      this.owned.push(r.value);
      return r.value;
    }
    r.value.dispose();
  }

  // ---- the bridge ------------------------------------------------------------------------
  hostCall(nameH: QuickJSHandle, argsH: QuickJSHandle, siteH: QuickJSHandle): QuickJSHandle {
    const { ctx, L } = this;
    const reply = (body: unknown) => ctx.newString(JSON.stringify(body));
    const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => reply({ e: { code, message: cap(message, 1000), ...extra } });
    if (this.sticky) return fail(this.sticky.error.code, this.sticky.error.message);
    const site = userSite(ctx.typeof(siteH) === "string" ? ctx.getString(siteH) : "", this.filename) ?? {};
    if (this.options.signal?.aborted) {
      this.cancelled = true;
      return this.stick(new StickyFault("SCRIPT_CANCELLED", "The script was cancelled"), site, fail);
    }
    if (++this.hostCalls > L.maxHostCalls) {
      return this.stick(new StickyFault("SCRIPT_LIMIT", `The script made more than ${L.maxHostCalls} host calls`, "Build fewer shapes, or batch them (union(...), subtract(a, b, c))."), site, fail);
    }
    const name = ctx.typeof(nameH) === "string" ? ctx.getString(nameH) : "";
    const fn = Object.hasOwn(this.options.hostApi.functions, name) ? this.options.hostApi.functions[name] : undefined;
    if (!fn) return fail("HOST_ERROR", `unknown host function ${cap(name, 100)}`);
    const text = ctx.typeof(argsH) === "string" ? ctx.getString(argsH) : "";
    if (text.length > MAX_ARGS_BYTES) return fail("SCRIPT_LIMIT", `${name}: arguments are larger than ${MAX_ARGS_BYTES} bytes`);
    let args: GuestValue[];
    try {
      args = JSON.parse(text) as GuestValue[];
    } catch {
      return fail("HOST_ERROR", `${name}: arguments are not plain data`);
    }
    if (!Array.isArray(args)) return fail("HOST_ERROR", `${name}: arguments are not a list`);
    const bad = this.checkArgs(name, args, 0);
    if (bad) return fail("SCRIPT_LIMIT", bad);

    const started = performance.now();
    try {
      this.options.hostApi.beforeCall?.(name, site);
      const value = fn(...args);
      return reply({ v: value === undefined ? null : value });
    } catch (e) {
      const err = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; elements?: unknown; hint?: unknown; op?: unknown };
      const code = typeof err.code === "string" && CODE.test(err.code) ? err.code : "HOST_ERROR";
      const message = e instanceof Error ? e.message : String(e);
      if (code === "SCRIPT_LIMIT" || e instanceof StickyFault) {
        return this.stick(new StickyFault(code, message, typeof err.hint === "string" ? err.hint : undefined), site, fail);
      }
      const extra: Record<string, unknown> = {};
      if (Array.isArray(err.elements)) extra["elements"] = err.elements.filter((x) => typeof x === "string").slice(0, 50);
      if (typeof err.hint === "string") extra["hint"] = cap(err.hint, 500);
      if (typeof err.op === "string") extra["op"] = cap(err.op, 100);
      // Unexpected host exceptions keep their message only: no host stack, object identity
      // or file paths.
      return fail(code, code === "HOST_ERROR" ? `${name} failed: ${cap(redactPaths(message), 300)}` : message, extra);
    } finally {
      const spent = performance.now() - started;
      this.hostMs += spent;
      // The deadline bounds guest JavaScript, not time inside host calls.
      this.deadline += spent;
    }
  }

  stick(error: StickyFault, site: { line?: number; column?: number }, fail: (code: string, message: string) => QuickJSHandle): QuickJSHandle {
    this.sticky = { error, ...site };
    return fail(error.code, error.message);
  }

  checkArgs(name: string, value: GuestValue, depth: number): string | undefined {
    if (depth > MAX_ARGS_DEPTH) return `${name}: arguments are nested deeper than ${MAX_ARGS_DEPTH}`;
    if (typeof value === "string") return value.length > this.L.maxStringArg ? `${name}: a string argument is longer than ${this.L.maxStringArg} characters` : undefined;
    if (Array.isArray(value)) {
      if (value.length > this.L.maxBatch) return `${name}: a list of ${value.length} items is over the batch limit of ${this.L.maxBatch}`;
      for (const v of value) {
        const bad = this.checkArgs(name, v, depth + 1);
        if (bad) return bad;
      }
      return undefined;
    }
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) {
        const bad = this.checkArgs(name, v, depth + 1);
        if (bad) return bad;
      }
    }
    return undefined;
  }

  hostLog(levelH: QuickJSHandle, messageH: QuickJSHandle): void {
    if (this.logs.length >= MAX_LOGS) return;
    const level = this.ctx.typeof(levelH) === "string" ? this.ctx.getString(levelH) : "log";
    const message = this.ctx.typeof(messageH) === "string" ? this.ctx.getString(messageH) : "";
    this.logs.push({ level: level === "warn" || level === "error" ? level : "log", message: cap(message, MAX_LOG_CHARS) });
    if (this.logs.length === MAX_LOGS) this.logs.push({ level: "warn", message: `log limit of ${MAX_LOGS} lines reached; later lines are dropped` });
  }

  // ---- the user script --------------------------------------------------------------------
  runUser(): Outcome {
    const { ctx } = this;
    this.execStart = performance.now();
    this.deadline = Date.now() + this.L.cpuMs;
    this.armed = true;
    try {
      const compiled = ctx.evalCode(wrapUserSource(this.source), this.filename);
      if (compiled.error) return this.guestFailure(compiled.error);
      this.owned.push(compiled.value);
      if (ctx.typeof(compiled.value) !== "function") {
        return { ok: false, error: hostError("SCRIPT_SYNTAX", "The script must be a function body (statements ending in return)") };
      }
      const ran = ctx.callFunction(compiled.value, ctx.undefined);
      if (ran.error) return this.guestFailure(ran.error);
      this.owned.push(ran.value);
      const sealed = ctx.callFunction(this.seal!, ctx.undefined, ran.value);
      if (sealed.error) return this.guestFailure(sealed.error);
      this.owned.push(sealed.value);
      if (this.sticky) return this.stickyFailure();
      const type = ctx.typeof(sealed.value);
      if (type === "undefined") {
        return { ok: false, error: hostError("SCRIPT_NO_RESULT", "The script returned nothing", "End the script with return, for example return box(10, 10, 10);") };
      }
      if (type !== "string") return { ok: false, error: hostError("HOST_ERROR", "The result could not be read") };
      const text = ctx.getString(sealed.value);
      if (text.length > this.L.maxResultBytes) {
        return { ok: false, error: hostError("SCRIPT_RESULT_TOO_LARGE", `The result is ${text.length} bytes; the limit is ${this.L.maxResultBytes}`, "Return fewer parts, or shorter names.") };
      }
      return { ok: true, value: JSON.parse(text) as GuestValue };
    } catch (e) {
      return { ok: false, error: this.engineFailure(e) };
    } finally {
      this.armed = false;
      this.deadline = Infinity;
      this.execEnd = performance.now();
    }
  }

  stickyFailure(): Outcome {
    const s = this.sticky!;
    const error = hostError(s.error.code, s.error.message, s.error.hint);
    if (s.line !== undefined) error.line = s.line;
    if (s.column !== undefined) error.column = s.column;
    if (s.error.code === "SCRIPT_CANCELLED") error.message = "The script was cancelled";
    return { ok: false, error };
  }

  // The deadline stays armed while we read the error: reading it can run guest getters.
  guestFailure(handle: QuickJSHandle): Outcome {
    let dumped: Record<string, unknown>;
    try {
      dumped = this.readError(handle);
    } catch (e) {
      if (this.isEngineFault(e)) return { ok: false, error: this.engineFailure(e) };
      dumped = { message: "the thrown value could not be read" };
    } finally {
      handle.dispose();
    }
    if (this.sticky) return this.stickyFailure();
    return { ok: false, error: scriptErrorFromGuest(dumped, this.filename, { interrupted: this.interrupted, cancelled: this.cancelled, lines: this.source.split("\n").length }) };
  }

  /** Read the parts of a thrown value we care about, as host data, without calling toString. */
  readError(handle: QuickJSHandle): Record<string, unknown> {
    const { ctx } = this;
    const t = ctx.typeof(handle);
    if (t === "string") return { message: ctx.getString(handle) };
    if (t === "number") return { message: String(ctx.getNumber(handle)) };
    if (t === "boolean" || t === "undefined") return { message: t === "undefined" ? "undefined" : String(ctx.dump(handle)) };
    if (t !== "object") return { message: `a ${t} was thrown` };
    const out: Record<string, unknown> = {};
    for (const key of ["name", "message", "stack", "lineNumber", "code", "op", "hint", "elements"]) {
      let prop: QuickJSHandle | undefined;
      try {
        prop = ctx.getProp(handle, key);
        out[key] = this.readPlain(prop, key === "elements");
      } catch (e) {
        if (this.isEngineFault(e)) throw e;
        // A throwing getter: leave the field out.
      } finally {
        prop?.dispose();
      }
    }
    return out;
  }

  readPlain(h: QuickJSHandle, list: boolean): unknown {
    const { ctx } = this;
    const t = ctx.typeof(h);
    if (t === "string") return cap(ctx.getString(h), 4000);
    if (t === "number") return ctx.getNumber(h);
    if (!list || t !== "object") return undefined;
    const lenH = ctx.getProp(h, "length");
    const n = ctx.typeof(lenH) === "number" ? Math.min(50, ctx.getNumber(lenH)) : 0;
    lenH.dispose();
    const items: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const item = ctx.getProp(h, i);
      items.push(ctx.typeof(item) === "string" ? cap(ctx.getString(item), 100) : undefined);
      item.dispose();
    }
    return items;
  }

  isEngineFault(e: unknown): boolean {
    return e instanceof RangeError || e instanceof WebAssembly.RuntimeError;
  }

  /** The engine itself failed (host stack overflow, wasm trap). The instance is dropped. */
  engineFailure(e: unknown): ScriptError {
    this.poisoned = true;
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof RangeError && /call stack/i.test(message)) {
      return hostError("SCRIPT_STACK", "The script recursed too deeply", "Use a loop instead of recursion, or run the sandbox in a worker with a larger stack.");
    }
    if (/memory|Cannot enlarge/i.test(message)) return hostError("SCRIPT_MEMORY", "The script ran out of memory");
    if (this.interrupted) return hostError("SCRIPT_TIMEOUT", "The script was interrupted: it ran past its CPU time limit");
    return hostError("HOST_ERROR", `The script engine failed: ${cap(message, 300)}`);
  }

  dispose(): void {
    if (this.poisoned) return; // Let the garbage collector take the whole instance.
    try {
      for (const h of this.owned) if (h.alive) h.dispose();
      this.ctx.dispose();
      this.rt.dispose();
    } catch {
      // A runtime with leftover objects or jobs can abort on dispose; the instance is
      // per run, so dropping it is enough.
    }
  }
}

/** console.log/warn/error for the guest, writing to the run's logs (never to stdout). */
const CONSOLE = `"use strict";(function (g) {
  const native = g.__hostLog;
  delete g.__hostLog;
  const stringify = JSON.stringify;
  const show = (x) => {
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean" || x === null || x === undefined) return String(x);
    try { const s = stringify(x); return s === undefined ? String(typeof x) : s; } catch (e) { return "[" + typeof x + "]"; }
  };
  const make = (level) => function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) parts.push(show(arguments[i]));
    native(level, parts.join(" "));
  };
  const params = JSON.parse(g.__paramsJson);
  delete g.__paramsJson;
  Object.defineProperty(g, "__params", { value: Object.freeze(params), configurable: true, enumerable: false, writable: false });
  Object.defineProperty(g, "console", { value: Object.freeze({ log: make("log"), info: make("log"), warn: make("warn"), error: make("error") }), configurable: false, enumerable: false, writable: false });
})(globalThis);`;
