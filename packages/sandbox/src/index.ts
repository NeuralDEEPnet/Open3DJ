// @open3dj/sandbox: runs agent-written DSL scripts inside QuickJS-WASM, the security
// boundary for untrusted code (ARCHITECTURE.md section 7). Ported from the sandbox spike
// (docs/research/spikes/sandbox/src/lib).
//
// What one run gets: a fresh QuickJS instance whose WebAssembly.Memory is capped at
// limits.memoryBytes, a QuickJS stack limit, an interrupt deadline on guest time, budgets
// for host calls, argument sizes and the result size, no Date, a seeded Math.random, frozen
// intrinsics and no host globals (no process, require, import, fetch). Only JSON data
// crosses the bridge; shapes stay on the host behind small integer ids.
//
// What it does not do: bound time spent inside a host call (a long kernel boolean), or stop
// a native builtin that overshoots the deadline (measured 16x in the spike). The worker
// pool in @open3dj/compute owns that: it terminates the worker after a wall-clock limit.
// Inside a worker, give the thread an 8 MB stack (resourceLimits.stackSizeMb) so QuickJS's
// own stack check fires before the host's; on a small host stack a deep recursion still ends
// as SCRIPT_STACK, but the instance is then dropped without dispose.
import type { PackageStatus } from "@open3dj/schemas";

export type * from "./types.ts";
export { DEFAULT_LIMITS, resolveLimits, runScript } from "./run.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";
