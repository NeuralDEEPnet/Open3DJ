# @open3dj/sandbox

Runs agent-written scripts inside QuickJS-WASM (quickjs-emscripten-core 0.32.0 with the sync release variant). QuickJS is the security boundary for untrusted scripts (ARCHITECTURE.md section 7). The design is ported from the sandbox spike in `docs/research/spikes/sandbox/`.

## Use

```ts
import { runScript } from "@open3dj/sandbox";

const r = await runScript("return box(10, 10, 10);", { hostApi, params, limits, signal });
if (r.ok) use(r.value); else report(r.error); // ScriptError with code, message, line, column
```

`hostApi` has `functions` (plain data in and out), a guest `prelude` that builds the user-facing API on `__host`, and optional `beforeCall` and `onStart` hooks. `@open3dj/dsl` provides one.

## What one run gets

- A fresh QuickJS instance whose `WebAssembly.Memory` is capped at `memoryBytes` (default 128 MiB). `setMemoryLimit` alone bounds single allocations only (upstream issue 271), so the cap is what stops memory bombs.
- A QuickJS stack limit (`stackBytes`, default 256 KiB, never 0).
- An interrupt deadline on guest time (`cpuMs`, default 2000). Time inside host calls does not count.
- Budgets: host calls (`maxHostCalls`), items per argument list (`maxBatch`), characters per string argument (`maxStringArg`), and result size (`maxResultBytes`). Host functions can raise `SCRIPT_LIMIT` (the DSL does for `maxHandles`). Limit errors are sticky: a script that catches one still ends with it.
- No `Date`, a seeded `Math.random`, frozen intrinsics and a frozen global object. No `process`, `require`, `import`, `fetch`, timers or `WebAssembly`.
- `console.log`, `console.warn` and `console.error` write to `logs[]`, never to stdout.
- Only JSON crosses the bridge. Unexpected host exceptions reach the guest as `HOST_ERROR` with the message only, file paths removed.

## Errors

Every script fault comes back as `{ ok: false, error }`, with the line and column in the user's script: `SCRIPT_SYNTAX`, `SCRIPT_RUNTIME`, `SCRIPT_TIMEOUT`, `SCRIPT_MEMORY`, `SCRIPT_STACK`, `SCRIPT_LIMIT`, `SCRIPT_RESULT_TOO_LARGE`, `SCRIPT_NO_RESULT`, `SCRIPT_CANCELLED`, `HOST_ERROR`, or the code a host function threw (for example `KERNEL_FILLET_FAILED`). `runScript` throws only for host bugs, such as invalid limits.

## What it does not do

- It cannot stop a long host call (a kernel boolean) or a native builtin that overshoots the deadline. The spike measured overshoots of 16x, and here a catch-and-retry recursion with a 300 ms deadline ran about 1.8 s. The worker pool in `@open3dj/compute` owns the real bound: it terminates the worker after a wall-clock limit.
- `signal` is a cooperative cancel. It is checked in the interrupt handler and before each host call. Because a run is synchronous, cancelling from another thread needs an object whose `aborted` getter reads a `SharedArrayBuffer` flag.
- Run it in a worker with an 8 MB stack (`resourceLimits.stackSizeMb: 8`). On the main thread a deep `JSON.parse` overflows the host stack before QuickJS's own check. That still ends as `SCRIPT_STACK`, but the instance is then dropped without dispose.

## Tests

`security.test.ts` ports the spike's hostile cases (`cases.mjs`): CPU, memory, stack, capability escapes, handle forgery, host abuse and output limits. Each case must end safely, and a sane run must follow in the same process.
