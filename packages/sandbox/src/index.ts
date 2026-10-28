// @open3dj/sandbox: runs agent-written DSL scripts inside QuickJS-WASM, the security
// boundary for untrusted code (ARCHITECTURE.md section 7).
//
// Intended implementation (port from docs/research/spikes/sandbox/src/lib/bridge.mjs,
// guest-prelude.js, guest-harden.js):
// - quickjs-emscripten-core 0.32.0 with @jitl/quickjs-wasmfile-release-sync 0.32.0. Compile
//   the wasm module once per worker; create a FRESH instance per run with its own
//   WebAssembly.Memory capped at limits.memoryBytes (the only hard memory bound found).
// - Harden the guest before the prelude: freeze intrinsics, remove Date and eval-like
//   paths, deterministic Math.random. Close the constructor.constructor escape.
// - Wrap the user source as a function body; map reported lines back to the user's source.
// - Enforce cpuMs with the interrupt handler, plus host-call, handle, batch, string and
//   result-size budgets. The parent pool adds a wall-clock kill (see @open3dj/compute).
// - Never write to process.stdout; guest console output goes to logs[].
// - Port the 55 hostile cases from spikes/sandbox/src/lib/cases.mjs as regression tests.
import { NotImplementedError } from "@open3dj/schemas";
import type { PackageStatus } from "@open3dj/schemas";
import type { RunScriptOptions, RunScriptResult, SandboxLimits } from "./types.ts";

export type * from "./types.ts";

export const PACKAGE_STATUS: PackageStatus = "stub";

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

/**
 * Run one script in a fresh QuickJS instance. Never throws for script faults: syntax
 * errors, runtime errors, limits and host-call failures come back as { ok: false, error }
 * with the user's line and column. It throws only for host bugs (for example a missing
 * hostApi).
 */
export async function runScript(source: string, options: RunScriptOptions): Promise<RunScriptResult> {
  void source;
  void options;
  throw new NotImplementedError("sandbox.runScript");
}
