import type { ParamValue, ScriptError } from "@open3dj/schemas";

/**
 * Plain data that may cross the sandbox boundary. Shapes never cross: the guest sees small
 * per-run integer handles and the host maps them to kernel handles.
 */
export type GuestValue = null | boolean | number | string | GuestValue[] | { [key: string]: GuestValue };

/**
 * A host function exposed to the guest. It receives and returns plain data only. To report a
 * structured failure, throw an Error with a string `code` (UPPER_SNAKE, for example the
 * KernelError codes), and optionally `elements` (string[]) and `hint` (string). The sandbox
 * copies them into the ScriptError together with the guest's line and column. Any other
 * thrown value becomes code HOST_ERROR.
 */
export type HostFunction = (...args: GuestValue[]) => GuestValue;

/** Where in the user's script a host call was made (1-based, user lines, not wrapper lines). */
export interface CallSite {
  line?: number;
  column?: number;
}

/** What a guest script can reach. Nothing else exists in the guest (no process, require, fetch, Date). */
export interface HostApi {
  /** Exposed to the guest prelude as globalThis.__host[name]. Removed from the global scope before the user script runs. */
  functions: Record<string, HostFunction>;
  /**
   * Guest JavaScript evaluated after hardening and before the user script. It builds the
   * user-facing API (box(), Param, fillet, ...) on top of __host and may define
   * globalThis.__finish(value): the sandbox calls it with the script's return value and
   * returns what it gives back (plain data) as the run's value.
   */
  prelude: string;
  /**
   * Called before every host function with the user's script location of the call (the
   * innermost frame in the user's file). The DSL uses it to record which line made a shape.
   */
  beforeCall?: (name: string, site: CallSite) => void;
  /** Called once per run, before the prelude, with the run's resolved limits (for example maxHandles, which the host enforces). */
  onStart?: (limits: Readonly<Required<SandboxLimits>>) => void;
}

export interface SandboxLimits {
  /** Hard cap of the QuickJS WebAssembly memory. A fresh instance per run; setMemoryLimit alone does not bound total memory (quickjs-emscripten issue 271). Default 128 MiB. */
  memoryBytes?: number;
  /** QuickJS C stack. Keep well below the host thread's stack. Default 256 KiB. */
  stackBytes?: number;
  /** Guest JS deadline via the interrupt handler. It does not cover time inside a host call, and can overshoot (a native Array.fill ran 12 s past 500 ms), so the pool also enforces a wall-clock kill. Default 2000. */
  cpuMs?: number;
  /** Host calls per run. Default 5000. */
  maxHostCalls?: number;
  /** Live guest handles per run. Default 20000. */
  maxHandles?: number;
  /** Items in one array argument (for example fuseAll). Default 1000. */
  maxBatch?: number;
  /** Characters in one string argument. Default 4096. */
  maxStringArg?: number;
  /** Size of the JSON-serialised result value. Default 64 KiB. */
  maxResultBytes?: number;
}

export interface RunScriptOptions {
  /** Values for Param.* by name. The prelude can read them as the frozen global __params, which is removed before the user script runs. */
  params?: Record<string, ParamValue>;
  hostApi: HostApi;
  limits?: SandboxLimits;
  /** Used in error locations. Default "part.o3j.js". Names starting with "open3dj:" are reserved. */
  filename?: string;
  /**
   * Cooperative cancel. The sandbox checks `aborted` in the QuickJS interrupt handler and
   * before every host call, and ends the run with SCRIPT_CANCELLED. An AbortSignal fits, but a
   * run is synchronous, so a signal aborted from the same thread only takes effect if a host
   * function aborts it. To cancel from another thread, pass an object whose getter reads a
   * SharedArrayBuffer flag (Atomics.load). Cancel cannot stop a long host call (a kernel
   * boolean, for example): that needs the pool's wall-clock kill, which terminates the worker.
   */
  signal?: { readonly aborted: boolean };
}

export interface ScriptLog {
  level: "log" | "warn" | "error";
  message: string;
}

export interface SandboxStats {
  /** Guest time, excluding host calls. */
  cpuMs: number;
  hostCalls: number;
  /** Peak QuickJS WebAssembly memory. */
  memoryBytes: number;
  /** Time to create the fresh QuickJS instance. */
  instantiateMs: number;
}

/**
 * Error codes the sandbox itself produces (host functions add their own, for example
 * KERNEL_FILLET_FAILED): SCRIPT_SYNTAX, SCRIPT_RUNTIME, SCRIPT_TIMEOUT, SCRIPT_MEMORY,
 * SCRIPT_STACK, SCRIPT_LIMIT, SCRIPT_RESULT_TOO_LARGE, SCRIPT_NO_RESULT, SCRIPT_CANCELLED, HOST_ERROR.
 */
export type SandboxErrorCode =
  | "SCRIPT_SYNTAX" | "SCRIPT_RUNTIME" | "SCRIPT_TIMEOUT" | "SCRIPT_MEMORY" | "SCRIPT_STACK"
  | "SCRIPT_LIMIT" | "SCRIPT_RESULT_TOO_LARGE" | "SCRIPT_NO_RESULT" | "SCRIPT_CANCELLED" | "HOST_ERROR";

export type RunScriptResult =
  | { ok: true; value: GuestValue; logs: ScriptLog[]; stats: SandboxStats }
  | { ok: false; error: ScriptError; logs: ScriptLog[]; stats: SandboxStats };
