// createDsl: binds the DSL to one kernel. One instance per worker; reset() before every run.
import type { ParamValue } from "@open3dj/schemas";
import type { Kernel, KernelAdapter } from "@open3dj/kernel";
import type { GuestValue, HostApi } from "@open3dj/sandbox";
import * as B from "brepjs";
import { collect } from "./collect.ts";
import { DSL_ENTRIES } from "./entries.ts";
import { hostFunctions } from "./host.ts";
import { Library } from "./lib.ts";
import { PRELUDE } from "./prelude.ts";
import { Sketches } from "./sketch.ts";
import { Solids } from "./solid.ts";
import { RunState } from "./state.ts";
import type { Dsl, DslOptions, ScriptReturn } from "./types.ts";

/** Positional tolerance of edge and face queries in mm (3dj publishes none; the spike used 1e-3). */
export const DEFAULT_QUERY_TOLERANCE = 1e-3;

export function createDsl(kernel: KernelAdapter, options: DslOptions = {}): Dsl {
  const tol = options.queryTolerance ?? DEFAULT_QUERY_TOLERANCE;
  if (!(tol > 0)) throw new RangeError(`queryTolerance must be greater than 0, got ${tol}`);
  const raw = (kernel as Partial<Kernel>).raw;
  // brepjs keeps one global kernel registration per thread. It must be this kernel, so the
  // DSL re-registers on every reset() (one kernel per worker thread is the supported setup).
  const brepAdapter = raw ? B.OcctWasmAdapter.fromKernel(raw) : undefined;
  const register = () => {
    if (brepAdapter) B.registerKernel("occt-wasm", brepAdapter);
  };
  register();

  const state = new RunState();
  const sketches = new Sketches(kernel);
  const solids = new Solids(kernel, state, sketches, tol);
  const library = new Library(kernel);
  const hostApi: HostApi = Object.freeze({
    functions: Object.freeze(hostFunctions(kernel, state, { solids, sketches, library })),
    prelude: PRELUDE,
    beforeCall: (_name: string, site: { line?: number }) => {
      state.line = site.line;
    },
    onStart: (limits: { maxHandles: number }) => {
      state.maxHandles = limits.maxHandles;
    },
  });

  return {
    hostApi,
    entries: DSL_ENTRIES,
    reset(params: Record<string, ParamValue> = {}): void {
      register();
      state.reset(params);
    },
    collect(value: GuestValue): ScriptReturn {
      return collect(kernel, state, value);
    },
  };
}
