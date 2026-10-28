# @open3dj/compute

Compute contract C5 for S1: the DeviceInventory, placement, the CPU worker pool and the job worker. The design is in COMPUTE.md sections 3 and 4.

## Use

```ts
const pool = createPool({ log: (line) => daemonLog(line) });  // size from the machine
const result = await pool.run({ kind: "run", script, params, rev: "r_12" }, { mode: "auto" });
if (result.ok) result.report;  // GeometryReport; result.compute says where it ran
else result.error;             // ScriptError, including the pool's own codes below
await pool.close();
```

- `kind: "run"` returns the GeometryReport and the assembly graph.
- `kind: "render"` adds `images` (multiview PNG and SVG bytes).
- `kind: "export"` adds `artifacts` (files plus the evidence sidecar). With `export.dir` and `export.root` the worker also writes them under the path policy of `writeArtifacts()` and returns `files`.

`run()` resolves with a JobResult for every outcome of the job. It rejects only with `ComputeError` `POOL_CLOSED`.

| Code | When |
|---|---|
| `JOB_TIMEOUT` | The job passed its wall-clock deadline (`jobTimeoutMs`, default 30 s, or `timeoutMs` per run). The worker was terminated and replaced. |
| `JOB_CANCELLED` | The run's `AbortSignal` fired. A queued job is dropped. A running job is asked to stop and its worker is terminated if it does not stop within `cancelGraceMs` (default 2 s). |
| `WORKER_CRASHED` | The worker died during the job, or workers fail to start three times in a row. |
| `NO_BACKEND` | `mode` was `gpu` or `cloud`. S1 has only `cpu.wasm`. The result's compute block has backend `none`. |
| anything else | From the script, the DSL, the kernel (`KERNEL_*`), the assembly or the renderer. `INTERNAL_ERROR` is a bug in Open3DJ. |

## How the pool works

- **Workers.** `worker_threads` created with `stdout: true` and `stderr: true`. Both streams are drained line by line into `log` (default: `process.stderr`), never into `process.stdout`. The kernel's print hook also writes to the worker's stderr. Each worker holds one occt-wasm kernel and one DSL, and runs one job at a time. Workers get `resourceLimits.stackSizeMb = 8`, which the sandbox needs for deep guest recursion.
- **Size.** `min(cores - 1, floor(freeRAM x 0.7 / recycleBytes))`, at least 1. Workers start on first demand, or all at once with `warm: true`.
- **Lanes.** With more than one worker, slot 0 is reserved for the interactive lane. Batch jobs never use it. Interactive jobs try the reserved worker first and also take any idle batch worker. `run` and `render` default to interactive, `export` to batch.
- **Watchdog.** A timer per job, started when a worker takes it. The QuickJS deadline is best effort and cannot stop a long kernel call, so the parent terminates the worker.
- **Recycling.** A worker is retired after `maxJobsPerWorker` jobs (default 200), when kernel WASM memory plus its JS heap passes `recycleBytes` (default 1.5 GiB, because WebAssembly memory never shrinks), or after any kernel error, including one the script caught. Its slot gets a new worker at once. A kernel loads in about 120 ms.
- **Per job.** `checkpoint()`, run the script, build the assembly, fits, report, then render or export, then `releaseSince()`. Every result reports `liveShapes` after release.

## Inventory, placement and doctor

- `deviceInventory()` reads `node:os` and the engine versions. `gpus` is empty and `backends` is `["cpu.wasm"]`: GPU discovery arrives in a later step (`GPU_NOTE`).
- `inventoryHash()` is the hash for provenance lines. It leaves out the timestamp and free RAM.
- `place(mode, kind, inventory)` returns `{ backend: "cpu.wasm", device: "cpu xN", placement_reason }` for `auto` and `cpu`, and throws `ComputeError` `NO_BACKEND` for `gpu` and `cloud`.
- `doctor({ bench })` returns the inventory, its hash and notes. With `bench: true` it measures kernel load, a box-fillet-cut part, peak worker memory and pool scaling over 1..N workers, all inside pool workers.

Measured on a shared 4-vCPU container (2026-10-28): kernel load 124 ms, bench part 81 ms warm and 296 ms on a fresh worker, peak worker memory 195 MB, throughput 1.45x with 2 workers and 1.62x with 3.

## Never in the daemon

`runJobInline()` runs a job on a fresh kernel in the calling thread. It is for tests and a CLI inline mode only. In the MCP daemon the kernel must load only inside pool workers.

The package entry point loads no kernel, DSL, assembly or render code: `runJobInline()` imports them when it is first called. This keeps the daemon and every CLI command about 230 ms faster to start and about 35 MB smaller. The job runner the workers use, `createJobRunner(kernel)`, is exported from `@open3dj/compute/job`.

## Tests

- `index.test.ts`: inventory schema and versions, pool sizing, placement and the inventory hash.
- `job.test.ts`: run, render and export composed inline; files under the path policy; error mapping.
- `pool.test.ts`: parallel jobs, lanes, the watchdog, recycling by job count, memory and kernel error, cancel, NO_BACKEND, crashes (with `fake-worker.testing.ts`), failed starts and close.
- `stdout.test.ts`: a child process runs STEP and 3MF exports and a render through the pool; its stdout must be 0 bytes, and the kernel's STEP statistics must appear in the log.
- `doctor.test.ts`: the bench and the scaling series.
