# Open3DJ compute: CPU and GPU

Status: compute design of record from 28 Oct 2026, paired with [PLAN.md](PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [ASSEMBLIES.md](ASSEMBLIES.md). Step numbers S0 to S12 are the plan's. Versions, the measured CPU and WebGPU spike and vendor detail are in [research/compute-cpu-gpu.md](research/compute-cpu-gpu.md); cloud providers and prices in [research/compute-local-and-cloud.md](research/compute-local-and-cloud.md); model licences in [research/gap-4.md](research/gap-4.md). Numbers marked "proposed" are starting points to measure; unchecked facts are marked "to verify".

## 1. Rules

1. **Open3DJ calculates on both CPU and GPU.** Every heavy workload declares where it can run (CPU, local GPU, cloud GPU); the runtime discovers devices and a scheduler places each job.
2. **The CPU kernel owns the geometry of record.** OCCT has no GPU path. B-rep geometry, GeometryReport numbers and gate verdicts come from occt-wasm on the CPU, single-threaded and built without relaxed-SIMD so results reproduce across CPUs.
3. **GPU screens, CPU decides.** A GPU value never decides a verdict inside a guard band, and never fails or passes a sample without a measured bound (section 6). A verdict that rests on GPU-cleared samples is a `preview`; every verdict of record is recomputed on the CPU. Every GPU path has a declared CPU placement: a CPU twin for analysis, or a slower CPU backend for generation (`cpu.sdcpp` for concept images, DSL massing for image-to-3D). A cloud GPU with approval is an extra option, never the only one.
4. **CPU parallelism comes from jobs, not threads inside one operation.** One kernel per worker; parts, clash pairs, variants, analyses and exports spread across cores.
5. **Nothing leaves the machine without a human approval owned by the daemon.** Cloud GPUs are a pluggable provider, never a default.
6. **Lean order.** CPU pool and GPU viewer first; GPU analysis and local GPU models next; GPU simulation only on a measured trigger.

## 2. Workload table

"Record" means geometry or a verdict of record. "Advisory" means it informs a human or agent and never decides a gate alone.

| Workload | CPU | Local GPU | Cloud GPU | Library and licence | CPU fallback | Result | Step |
|---|---|---|---|---|---|---|---|
| Script run, booleans, fillets, tessellation, STEP | yes, one kernel per worker | no | no | occt-wasm 5.8.1 (`.wasm` LGPL-2.1, separate file), brepjs 20.11.1 (Apache-2.0) | is the CPU path | Record | S1 |
| Exact clash, contact, clearance | yes | no | no | occt-wasm | is the CPU path | Record ("measured") | S1 |
| Fit broad phase and mesh fit tier | yes | WGSL pre-check | no | own AABB filter; Manifold 3.5.4 (Apache-2.0); three-mesh-bvh 0.9.16 (MIT) | AABB and Manifold in workers | Advisory ("observed"); may only drop pairs beyond watch distance plus guard band | S1, S3; GPU S7a |
| Wall thickness map | BVH ray casts in workers | WGSL ray casts | no | three-mesh-bvh (MIT), own WGSL | CPU twin | Verdict on CPU inside the guard band; the GPU may clear samples only under the measured-bound rule, and such a verdict is a `preview` until a `record` request recomputes it on the CPU (section 6) | S3; GPU S7a |
| Overhang, draft, undercut | per-face dot products, CPU ray casts | viewer shading; WGSL ray casts for dense maps | no | own code | CPU twin | Verdict on CPU | S3, S9, S10 |
| Curvature and continuity | yes | viewer shading only | no | occt-wasm `surfaceCurvature` | is the CPU path | Record numbers; shading advisory | S9 |
| Agent and CI pictures | yes | no | no | occt-wasm HLR PNG and SVG | is the CPU path | Deterministic, byte-identical | S1 |
| Interactive viewer | no | three.js r186 `WebGPURenderer`, WebGL2 fallback | no | three 0.186.1 (MIT) | HLR image view from the daemon | Display only | S2 |
| Variants, sweeps, swept clash | batch lane | later: WGSL pose sweeps | no | own code, occt-wasm | is the CPU path | Record | S4, S6 |
| SDF and lattice fields | Manifold `LevelSet` | WGSL preview | no | Manifold; Fidget 0.5.1 (MPL-2.0) later | Manifold meshes the field of record | GPU preview advisory | S7a |
| Slicer estimate | subprocess | no | no | OrcaSlicer (AGPL, never linked) | is the CPU path | Advisory | S5 |
| Concept images (`gen.image`) | `cpu.sdcpp`: stable-diffusion.cpp (MIT) as a subprocess, quantised GGUF weights, AVX, AVX2 or AVX512 on x86 | Python sidecar | yes, with approval | FLUX.1 schnell, Qwen-Image (Apache-2.0); PyTorch 2.14.1 on GPU; stable-diffusion.cpp on CPU; each GGUF file gets the same licence manifest | `cpu.sdcpp`: slow, so the result is an advisory `preview` and the approval card shows a time estimate | "concept, not geometry" | S8a |
| Image or text to 3D massing (`gen.massing`) | DSL route: the agent builds the massing in the DSL from the approved board on the CPU pool. Candidate mesh backend: TripoSR (MIT, about 6 GB on CUDA, CPU fallback through torchmcubes, [research/compute-local-and-cloud.md](research/compute-local-and-cloud.md)) in the sidecar on the CPU, or MPS (to verify), only after a four-layer licence audit of its chain like gap-4's (to verify) | sidecar, CUDA only (TRELLIS v1; upstream minimum a 16 GB card) | yes, with approval | TRELLIS v1 geometry-only clean runner: code and weights MIT, other components permissive except easydict (LGPL-3.0), per [research/gap-4.md](research/gap-4.md); DSL facade | DSL route; TripoSR once audited; a structured refusal only when the user insists on a generated mesh and no local mesh backend is cleared | Advisory, "assumed"; TripoSR output also `preview` | S8b |
| Small ML models (background removal) | ONNX Runtime CPU | ONNX Runtime GPU providers | optional | onnxruntime-node 1.31.1 (MIT); BiRefNet or rembg with u2net | CPU execution provider | Advisory | S8a |
| Photoreal and CMF renders | Cycles CPU | Cycles CUDA, OptiX, HIP, oneAPI, Metal | optional | Cycles inside an official Blender 5.2 LTS build, run as a `blender -b` subprocess (Blender GPL-3.0-or-later; Cycles code Apache-2.0); no official Linux ARM64 build ([ARCHITECTURE.md](ARCHITECTURE.md) section 11) | Cycles CPU | Display only | S9 |
| Mate solving, DOF, tolerance stacks | yes | no | no | own solver (Open3DJ's own code: MIT today; MIT OR Apache-2.0 proposed, [PLAN.md](PLAN.md) section 11 decision 2) | is the CPU path | Record | S1, S4, S11 |
| Drawing sheets, parting-line silhouettes | yes | no | no | occt-wasm HLR | is the CPU path | Record | S10, S12 |
| Ergonomic envelope check (only if a brief pulls it) | yes | no | no | own code, ANSUR II data | is the CPU path | Advisory ("inferred") | S8b |
| Structural FEA | CalculiX subprocess | pull board: Warp FEM, PETSc | provider | CalculiX 2.23 (GPL-2.0, subprocess only); warp-lang 1.18.0 (Apache-2.0) | CalculiX | "simulation, not test" | S11; GPU later |

**Generation on a machine without a GPU.** For `gen.image`, `auto` picks `cpu.sdcpp` when no capable GPU exists and the egress policy is `never`, or when the user prefers it in the daemon config; the card that shows the model's licence manifest before the job runs also shows the estimated CPU time per image (to verify, section 12). For `gen.massing` with no CUDA GPU and no cloud allowed, `auto` takes the DSL route: the result returns the approved board, a `next` hint and the massing playbook (a `docs` page), and the agent writes the massing as DSL scripts on the CPU pool, labelled "assumed", as it already does for simple boxes ([INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 3.4). A call that names a model gets that model or a structured refusal. `model: "triposr"` runs on the sidecar's CPU backend (MPS to verify) once TripoSR's licence audit passes, labelled `preview` and "assumed", and is refused with the audit status until then. `model: "trellis-v1-geometry"`, or `compute: "gpu"` or `"cloud"`, with no capable CUDA GPU and no cloud allowed, gets a structured refusal naming the missing VRAM and the policy.

Reconstruction from photos stays on the pull board. Every job kind has a CPU placement; a new kind without one needs an A3 that says why. A new GPU workload enters this table through an A3 and the merge rule in section 6.

## 3. The compute-device layer

The layer lives in `packages/compute/` and implements contract C5 ([ARCHITECTURE.md](ARCHITECTURE.md) section 2).

### 3.1 Discovery and the capability record

`open3dj doctor` builds a DeviceInventory at daemon start and caches it. `doctor --bench` adds kernel micro-benchmarks, worker scaling, a viewer frame-time probe (the S2 gate) and a WebGPU probe; its JSON is the hardware report volunteers attach to issues. Sources:

- **Node `os`:** `availableParallelism()`, architecture, total and free RAM.
- **systeminformation 5.33.16 (MIT):** GPU vendor, model, VRAM, shared VRAM; with `nvidia-smi` also memory used, temperature and power; battery `acConnected`.
- **WebGPU probe** (accel pack): `GPUAdapterInfo`, limits, features, `isFallbackAdapter`, backend.
- **Python sidecar** (S8a): CUDA, MPS, ROCm or XPU availability, VRAM, driver version, licence manifest hash.
- **Provider config** (S7b): configured cloud providers, their manifests and the daemon's budget caps.

Each device gets a capability record: id, kind, vendor, model, VRAM, shared or dedicated memory, backends (for example `webgpu.d3d12`, `sidecar.cuda`), WebGPU limits, power state and its timing profile. WebGPU hides VRAM, so VRAM comes from systeminformation or the sidecar. A software adapter (Mesa lavapipe, Windows WARP) is recorded as a CPU-class device. The DeviceInventory hash goes into every provenance line and the Evidence Pack.

### 3.2 Jobs

Every heavy operation is a job ([ARCHITECTURE.md](ARCHITECTURE.md) section 9) with these C5 fields:

- `kind` (such as `fit.precheck`, `map.wall`, `gen.massing`) and `runsOn`, the backends it declares (section 2).
- `determinism`: `record` (CPU only) or `preview` (any backend). A cached `preview` result never satisfies a `record` request. A verdict that rests on GPU-cleared samples is a `preview` and names its screen in `screened_by` (for example `webgpu.d3d12`); a `record` request (design freeze, export gates, RFQ pack) recomputes those samples on the CPU twin (section 6).
- `privacy`: the data class the job would send: `local-only`, `cloud-anonymous` (geometry only, names hashed, metadata stripped) or `cloud-full` (prompts, images, names).
- `inputsHash`: results are cached by `inputsHash` plus backend class.
- `estimate` per candidate device (time, memory, cost) and `state`: `queued`, `running`, `deferred` (with a reason), `awaiting_approval`, `done`, `failed`, `cancelled`.
- `progress`: `{done, total, unit}` in tiles, rays, pairs or poses.
- `attempts[]`: each placement tried, with backend, device, outcome and reason.

### 3.3 Placement rules

The scheduler applies the same rules in the same order every time.

1. **Explicit request.** `compute: "cpu"` places only on CPU. `"gpu"` with no capable local device returns a structured error naming the missing backend. `"cloud"` considers only providers. `"auto"` considers everything.
2. **Capability.** The backend is in the kind's `runsOn` and the device has the features the kernel needs.
3. **Licence.** The manifest allows use in the user's declared territory and for the declared commercial use. Restricted packs are candidates only after opt-in.
4. **Privacy.** Egress policy `never` drops every cloud candidate. With the default `ask`, cloud candidates stay, but placing on one first creates an approval.
5. **Memory.** The check depends on the job type.
   - **Model jobs** (sidecar and subprocess models such as TRELLIS, FLUX.1 schnell, Qwen-Image, TripoSR): the model pack's manifest declares a peak VRAM, taken from the model card until a measured peak from the device profile replaces it. The device is kept only if **the peak is at most 90% of free VRAM** at placement (proposed). Free VRAM comes from `nvidia-smi` through systeminformation or from the sidecar; where it cannot be read, reported VRAM stands in, and an out-of-memory error re-queues the job (section 3.4).
   - **Daemon WGSL and viewer work**, which shares the GPU with the display, and **any job without a declared peak**: drop the device if the estimate exceeds 70% of a budget of 60% of reported VRAM, so **at most 42% of reported VRAM** (about 3.4 GB on an 8 GB card).
   - Shared VRAM counts against system RAM. A CPU worker's budget is its recycle limit (section 4).

   For TRELLIS v1, whose upstream minimum is a 16 GB card, this means: never on an 8 GB card; on a 24 GB or larger card, yes; on a 16 GB card only if the measured peak fits (to verify in S8b).
6. **Power and heat.** On battery or under thermal pressure, batch-lane GPU jobs are deferred, GPU jobs use `powerPreference: "low-power"` and the CPU pool halves. Interactive jobs still run, and the job state tells the agent.
7. **Time.** Lowest estimated wall time, including upload, cold start and Dawn start-up.
8. **Cost.** Ties go to the lowest cash cost (local is zero), then local before cloud.

Estimates come from per-device profiles (median time per unit of work), seeded by `doctor --bench` and updated after every run. This is PDCA in code: a prediction more than 2x off is logged as a defect and root-caused at the Friday review. If nothing meets the interactive deadline (1 s, proposed), the tool returns what it has plus a `job_id`. Hybrid laptops may pick the wrong GPU, so interactive jobs ask for `high-performance` and the user can pin a device in the daemon config.

### 3.4 Runtime fallback

Device loss, out-of-memory, a Windows TDR reset or a WebGPU validation error re-queues the job on its CPU twin and records the reason in `attempts[]`. A cloud failure tries the next provider the user ranked, with a new approval, because each approval names its provider.

## 4. The multi-core CPU worker pool

- **Workers.** Each Node `worker_thread` holds one single-threaded occt-wasm instance, Manifold and a QuickJS-WASM sandbox. Pool size is `min(availableParallelism - 1, floor(freeRAM x 0.7 / recycle limit))`, at least 1, so workers that each grow to the recycle limit cannot over-commit RAM. A worker starts at about 103 MB RSS ([research/lean-stack.md](research/lean-stack.md)). Peak worker memory on the starters is an S0 measurement in the `doctor --bench` worker-scaling output; if the formula leaves too few workers, the recycle limit drops to match the measured peak (gap-8 hypothesis H-mem proposes recycling at 1 GB, [research/gap-8.md](research/gap-8.md)).
- **Lanes.** The interactive lane reserves one worker so agent edits stay under 1 s; the batch lane takes variants, maps, exports and swept clash. With one worker, interactive jobs go first.
- **Scaling.** The occt-wasm pool benchmark gave 1.46x with 2 workers and 1.67x with 4 on a 4-vCPU container shared with other jobs, about 0.22 per added core ([research/spike-occt-wasm.md](research/spike-occt-wasm.md)). This result is labelled "contended". A 4-core machine runs 3 workers, so its batch lane has 2; until S0 re-measures on an idle machine, batch throughput there is sized at about 1.5x one worker.
- **Kernel stdout isolation.** The STEP writer prints to stdout, which MCP stdio uses for messages ([research/spike-occt-wasm.md](research/spike-occt-wasm.md)). Node pipes a worker's stdout into the parent's unless the worker is created with `stdout: true` and `stderr: true`. piscina 5.3.2 does not pass these options to `new Worker` (checked in its `dist/index.js`), so Open3DJ uses its own small pool that sets both and drains output into the daemon log. The worker also passes Emscripten `print` and `printErr` hooks through occt-wasm's `createModule` wrapper, which captured all kernel output in [research/spikes/mcp-worker.md](research/spikes/mcp-worker.md). That spike recommends child processes as the only production backend, because only a child kept file-descriptor-level stdout writes from a `node:vm` escape off the MCP wire; QuickJS-WASM gives scripts no file-descriptor access, so worker threads with stdout capture plus print hooks are the S1 choice, and the swap to child processes applies if a sandbox finding or a native kernel arrives. A CI test exports STEP during a live MCP session and checks that every stdout frame is valid JSON-RPC.
- **Memory limits and recycling.** Node's `resourceLimits` bound only the JS heap, not external memory such as `ArrayBuffer`s, and a WebAssembly memory never shrinks. Each worker reports WASM memory plus JS heap after every job; the pool recycles it at 1.5 GiB combined, after N jobs (200, proposed) or on any kernel error. Only a fresh kernel instance per record run gives bit-identical offset and shell results; recycling alone does not ([research/spikes/endurance.md](research/spikes/endurance.md)). The wasm32 cap of 4 GiB is the trigger for memory64 or a native kernel ([ARCHITECTURE.md](ARCHITECTURE.md) section 4).
- **WASM threads.** occt-wasm and Manifold's WASM build are single-threaded. The OCCT pthread build gave about 1.24x overall in taucad's benchmarks, needs cross-origin isolation in browsers and costs determinism, so the kernel of record does not use WASM threads. A threaded or native TBB build may join only after replay hashes are tested with parallel modes on and off. Node allows `SharedArrayBuffer` without special headers, so it would start in Node rather than the browser, but still in captured workers or child processes, never in the daemon process. A native build runs in child processes with redirected stdout, because native code writes to file descriptor 1 directly and bypasses a worker's captured stream ([ARCHITECTURE.md](ARCHITECTURE.md) section 4).
- **Subprocesses.** OrcaSlicer, Blender (for Cycles), stable-diffusion.cpp and CalculiX run with piped and captured stdout and stderr, a wall-clock limit and a niceness increment. Each comes from its project's official binaries, a package manager or the user's own install; Open3DJ never compiles them ([ARCHITECTURE.md](ARCHITECTURE.md) principle 6).

## 5. GPU access paths

Four routes, each optional except the viewer:

1. **Viewer:** three.js `WebGPURenderer` in the browser or webview, falling back to WebGL2, then to the HLR image view served by the daemon. Since Chrome 139, WebGL context creation fails where it would have used SwiftShader, so a GPU-less machine may have no WebGL at all.
2. **Daemon WGSL:** `@open3dj/accel-webgpu` wraps the Dawn-based `webgpu` package 0.6.2 (MIT, pre-1.0, prebuilt for Windows x64 and ARM64, Linux x64 and ARM64, macOS universal; about 137 MB unpacked for all platforms), installed on demand and run in a dedicated worker. It works headless with no browser (measured on lavapipe).
3. **Python sidecar:** a `uvx` subprocess with PyTorch, warp-lang or gsplat for CUDA, ROCm, MPS and XPU, speaking the same job spec over stdio as cloud providers.
4. **ONNX Runtime:** onnxruntime-node 1.31.1 in process (CPU everywhere; WebGPU experimental; DirectML on Windows, in maintenance mode, where Microsoft promises no new functionality and points to Windows ML; CUDA 12 on Linux x64 only; CoreML on macOS). In the sidecar: MIGraphX for AMD (the ROCm provider is marked deprecated), OpenVINO for Intel, QNN for Qualcomm NPUs (`onnxruntime-qnn`), and Windows ML through the `onnxruntime-windowsml` Python package. No Node binding for Windows ML is known ([research/compute-cpu-gpu.md](research/compute-cpu-gpu.md)).

| Platform | Viewer | Daemon WGSL (Dawn) | Sidecar and ONNX | Cycles |
|---|---|---|---|---|
| Windows x64, NVIDIA | WebGPU | d3d12 | CUDA; DirectML in Node | CUDA, OptiX |
| Windows x64, AMD | WebGPU | d3d12 | PyTorch ROCm 7.2 on RDNA3 and RDNA4, Windows 11; DirectML in Node | HIP |
| Windows x64, Intel | WebGPU | d3d12 | XPU, OpenVINO; DirectML in Node | oneAPI (Arc) |
| Windows ARM64, Qualcomm | WebGL2 (WebGPU behind a flag) | win32-arm64, untested on Adreno (to verify) | no PyTorch wheel on PyPI; QNN and Windows ML in the sidecar; CPU, or DirectML (maintenance mode; ARM64 support to verify) in Node | CPU |
| macOS, Apple Silicon | WebGPU (Safari 26, WKWebView on macOS 26, Chromium) | metal | MPS; CoreML in Node; no CUDA-only models | Metal |
| Linux x64, NVIDIA | WebGPU on Chrome 147+ under Wayland, else WebGL2 | vulkan | CUDA; CUDA in Node | CUDA, OptiX |
| Linux x64, AMD | WebGL2 (Chrome needs a flag) | vulkan | ROCm; MIGraphX | HIP |
| Linux x64, Intel | WebGPU on Gen12+ from Chrome 144, else WebGL2 | vulkan | XPU, OpenVINO | oneAPI |
| Linux ARM64 (tier 1, mostly headless CI and servers) | WebGL2 where a browser and GPU exist, else HLR image view | linux-arm64 prebuilt, vulkan where a driver exists (to verify) | CPU; PyTorch CPU wheels; GPU support depends on the board (to verify) | none (no official Blender build; see below) |
| No GPU | WebGL2 if allowed, else HLR image view | CPU twin | ONNX Runtime CPU; `cpu.sdcpp` for concept images; DSL route for massing (TripoSR on the CPU once audited); cloud with approval where allowed | CPU |

The Cycles column assumes an official Blender build, which exists for Windows x64, Windows ARM64, macOS arm64 and Linux x64 only (checked 28 Oct 2026). Linux ARM64, a tier-1 platform, has none: there `render view=cmf` uses a distribution's Blender package if one is installed (to verify), or returns a structured error naming the missing renderer ([ARCHITECTURE.md](ARCHITECTURE.md) section 11).

**Driver pitfalls designed in.** Windows resets a GPU task that cannot be preempted within 2 seconds (TDR), so WGSL dispatches are tiled to about 50 to 100 ms. Grids larger than the 128 MiB storage binding default are tiled. OptiX needs driver 575 or newer and Warp's CUDA 13 wheels need R580; the scheduler drops a backend whose driver is too old and says so.

## 6. Determinism rules

1. **Geometry of record** comes only from the CPU kernel. Across platforms, measures agree within the C2 tolerances. Same-platform hash equality is hypothesis H-det. On native OCCT, PR #1600's pointer-keyed maps let one input succeed in only 11 of 20 fresh processes ([research/gap-8.md](research/gap-8.md)). On occt-wasm, a single spike that has not been reproduced yet ([research/spikes/endurance.md](research/spikes/endurance.md)) found fresh processes and fresh instances bit-identical, while warm-instance reuse broke bit-identity for offset and shell. S0 re-runs H-det on every tier-1 OS. The first fallback is to run record requests (goldens, evidence hashes, replay) on a fresh kernel instance (about 30 ms with a shared Module), ahead of the PR #1600 patch and tolerance comparison ([ARCHITECTURE.md](ARCHITECTURE.md) section 8).
2. **Labels.** A number computed deterministically on the CPU from the geometry of record (the B-rep, or its tessellation at a recorded tolerance) is "measured". A screening value, from the GPU or a mesh tier used only to filter, is "observed". Generated geometry is "assumed". These four labels (measured, observed, inferred, assumed) are the only confidence values, as in the Evidence Pack. GPU screening is recorded in separate fields, never in the label: a verdict whose cleared samples came from a GPU screen under rule 4 is `determinism: preview` with `screened_by` naming the backend, for example `webgpu.d3d12`.
3. **Guard bands.** A verdict needs a value outside a band around the threshold (proposed: wall 0.8 mm plus or minus the larger of 2 samples or the chordal tolerance; angles plus or minus 1 degree). Inside the band the CPU re-checks at a finer tessellation; a value still inside is `marginal` and fails until waived. Outside the band, a GPU value counts only under rule 4.
4. **GPU values never decide a verdict inside the guard band, never fail or pass a sample without a measured bound, and never decide a verdict of record.** A GPU kernel may clear a sample only under the conservative-drop rule used for fit pre-checks: it uses exactly the CPU twin's sample set (same rays and tessellation), and the guard band exceeds the largest GPU-CPU deviation measured for that adapter and driver by a stated safety factor (proposed: 2x). The bound is calibrated per adapter and driver: on first use of a new adapter or driver version, the kernel runs a fixed calibration set from the corpus against its CPU twin and stores the largest deviation in the device profile; until then the GPU clears nothing. WGSL lets each driver reassociate and fuse operations ([research/compute-cpu-gpu.md](research/compute-cpu-gpu.md)), so the bound is a measurement on known geometry, not a proof for a user's new geometry. A verdict that rests on GPU-cleared samples is therefore a `preview` (rule 2). A `record` request (design freeze, export gates, RFQ pack) recomputes every GPU-cleared sample on the CPU twin and reports `cpu_confirmed`, so every verdict of record is CPU-decided. Every other sample goes to the CPU. The nightly full CPU-twin recompute on the corpus is the gauge: a sample the GPU cleared that the CPU fails is a red andon. A GPU map shown on its own carries its backend and "observed". A kernel that cannot meet this rule ships no speed-up for pass verdicts; it may only point the CPU at suspect regions.
5. **Fixed parameters.** Seeds, sample counts, tile order and workgroup sizes are fixed, so repeats on one adapter are bit-identical (measured on lavapipe). Cross-device results compare by tolerance: in the spike only 4 to 10% of values were bit-identical to the CPU, and 3 of 16.8 million voxels flipped inside and outside.
6. **Merge rule.** A GPU kernel merges only with a CPU twin, a fixed-seed conformance test against it, a lavapipe CI job and a benchmark showing at least 3x on one real GPU. Without the gain it is waste and does not ship.
7. **Gauge.** G8 in [PLAN.md](PLAN.md): zero verdict differences between `compute: auto` and `compute: cpu` on the seeded corpora, checked nightly.

## 7. Testing on machines without GPUs

CI uses only the free hosted runners: the five tier-1 runners `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `windows-latest` and `windows-11-arm` ([PLAN.md](PLAN.md) section 4.6); none has a GPU.

| What | How |
|---|---|
| WGSL kernels | Dawn on Mesa lavapipe on Linux, as measured; Dawn on WARP on Windows (to verify). macOS has no software adapter: GPU tests report "skipped", never "passed", and the CPU twin runs |
| CPU twins | Every runner, fixed seeds, compared with GPU output where a software adapter exists |
| Viewer | Headless Chromium with `--enable-unsafe-swiftshader` (tests only) for WebGL2, plus a forced no-context run that must show the HLR image view |
| Fault injection | Forced device loss, simulated out-of-memory and a long dispatch must re-queue on the CPU twin with the reason recorded |
| Sidecar and cloud | A stub provider speaking the job spec and returning fixture meshes tests contracts, approvals and licence checks. Real models are smoke-tested on the founder's GPU machine before each sidecar release |
| Real GPU numbers | Volunteers attach `open3dj doctor --bench` JSON, and the founder can run it weekly by hand on a GPU machine. A paid GitHub GPU runner is optional: about $2 a month in minutes for a weekly 10-minute run, plus a GitHub Team plan, because GPU runners are larger runners (founder decision 9 in [PLAN.md](PLAN.md) section 11). Never self-hosted runners on the public repo |

## 8. Security and privacy for cloud GPUs

- **Default.** Each project starts with egress policy `ask`: nothing leaves without a per-job approval. `never` removes cloud candidates. No telemetry.
- **Approval payload.** Provider and endpoint host; region if declared; data class; each file with size and hash; prompt text; model with its licence manifest (licence, territory, commercial use, model hash); cost estimate and remaining budget. The approval stores a hash of this payload, and any change asks again. Approval happens only on the nonce-protected local page; an MCP elicitation `accept` is never consent.
- **Budgets** live in the daemon config, per day and per project; tool arguments cannot raise them.
- **Redaction.** `cloud-anonymous` sends geometry only, with names replaced by hashes; images lose EXIF and other metadata.
- **Credentials** live in the user's config directory with owner-only permissions, never in tool arguments, the project or logs. OS keychain storage arrives with a desktop shell ([research/security-sandboxing.md](research/security-sandboxing.md)).
- **Licences.** The four-layer licence gate runs in CI on every model pack; at runtime the scheduler checks manifests against the declared territory and commercial use. TRELLIS v1 geometry-only is the clean default; TripoSG, TRELLIS.2 and Hunyuan3D are opt-in restricted packs. Refusals name the reason, for example "territory: EU excluded by licence".
- **Local sidecar.** Installed through `uvx` only after its licence manifest is shown, then run with `HF_HUB_OFFLINE=1` so it cannot fetch new weights silently.
- **Returned artefacts are untrusted data:** size limits, parsing in a worker, a recorded hash, the "assumed" label.
- **Audit.** Each egress writes a provenance line: provider, bytes sent, file hashes, model hash, approval id and actual cost.

## 9. The agent-facing surface

No new tools. Compute adds a field, a parameter and a result block to the five tools. Their canonical inputs, including `compute`, `provider`, `job_id` and `approval_id`, are in [ARCHITECTURE.md](ARCHITECTURE.md) section 9.

| Need | How |
|---|---|
| See devices | `inspect {fields: ["devices"]}`, no project needed: CPU workers, GPUs and backends, configured providers, power state, egress policy, and which job kinds each device can run |
| Request a placement | `compute: "auto" \| "cpu" \| "gpu" \| "cloud"` and an optional `provider` hint, as listed in ARCHITECTURE.md section 9 |
| See where a result ran | Every result carries `compute: {backend, device, placement_reason}`, plus `fallback_from` when the job moved, `cpu_confirmed: n` when the CPU confirmed GPU values, and `screened_by` with `determinism: "preview"` when a verdict rests on GPU-cleared samples |
| Follow a long job | `{job_id}` in the result; `inspect {fields: ["job"], job_id}` returns `state`, `progress`, `attempts[]`, estimate and actual |
| Cancel | `run {ops: [{op: "cancel_job", job_id}]}`; creates no revision |
| Consent | `approval_pending{url, id}`; the human approves on the local page; the agent polls `inspect {fields: ["approval"], approval_id}` |

Backend ids: `cpu.wasm`, `cpu.subprocess`, `cpu.sdcpp`, `webgpu.<d3d12|metal|vulkan>`, `webgpu.software`, `sidecar.<cuda|mps|rocm|xpu|cpu>`, `ort.<provider>`, `cloud.<provider>`.

## 10. Worked example: enclosure analysis and a concept job

Illustrative calls and numbers at S10 capability, on the handheld enclosure from [ASSEMBLIES.md](ASSEMBLIES.md) section 16.

**1. Look at the machine.** On a laptop with an 8 GB GPU and the accel pack, `inspect {fields: ["devices"]}` reports 7 CPU workers (8 cores and 32 GB RAM; 1 interactive, 6 batch), `gpu0` (RTX 4060 Laptop, 8,188 MB, `webgpu.d3d12` and `sidecar.cuda`), providers `cloud.modal` and `cloud.3dj`, mains power and egress policy `ask`.

**2. Analyse wall thickness and draft** on every moulded definition, pulling along Z:

```json
{"tool": "inspect", "project": "handheld.o3j", "rev": "r_14",
 "fields": ["maps", "gates"], "maps": ["wall", "draft"], "pull": [0, 0, 1],
 "gates": "im.abs.v1", "compute": "auto"}
→ {"job_id": "j_0193..c4", "state": "running"}
```

The scheduler puts `map.wall` on `webgpu.d3d12` (profile: 0.9 s against 6.1 s on the batch lane) and keeps `map.draft` on the CPU, where a per-face dot product beats a GPU upload. Polling `inspect fields=[job]` returns:

```json
{"state": "done",
 "maps": [{"def": "top_shell", "map": "wall", "min_mm": 0.71, "at": "@elem:op_9:boss_rim:3", "confidence": "observed"}],
 "gates": {"determinism": "preview", "screened_by": "webgpu.d3d12", "fail": [
   {"gate": "min_wall", "def": "top_shell", "value": 0.72, "limit": 0.8, "confidence": "measured", "waivable": "agent"},
   {"gate": "draft_textured", "def": "bottom_shell", "value_deg": 0.4, "limit_deg": 1.5, "face": "@elem:op_3:side:2", "confidence": "measured"}]},
 "compute": {"backend": "webgpu.d3d12", "device": "RTX 4060 Laptop", "placement_reason": "auto: fastest by profile (0.9 s vs 6.1 s)", "cpu_confirmed": 3},
 "next": ["run ops=[set_param boss_rim_wall 1.0]", "render view=highlight targets=[top_shell#1]"]}
```

The GPU kernel cast exactly the CPU twin's rays on the same tessellation. It cleared every sample above the guard band, which exceeds the largest deviation measured for this adapter and driver (its calibration run, stored in the device profile) by the safety factor, and found the thin boss rim. The CPU re-measured the three values inside the band and gave the 0.72 mm value, labelled "measured". The gate result as a whole is a `preview` with `screened_by: "webgpu.d3d12"`, because its passing samples were cleared by the GPU. When the agent later asks for design freeze or an export with gates, that `record` request recomputes the cleared samples on the CPU twin (about the 6.1 s batch-lane time above); the nightly CPU-twin recompute on the corpus is the gauge. The 1.5 degree draft limit is illustrative; the real value comes from the cited `im.abs.v1` profile.

**3. The same call without a GPU.** On a desktop with no GPU, the verdicts are identical and the job takes about 7 s:

```json
"compute": {"backend": "cpu.wasm", "device": "cpu x3", "placement_reason": "auto: no gpu backend for map.wall (accel pack not installed)"}
```

Had the laptop GPU hit a TDR reset mid-job, `attempts[]` would show `webgpu.d3d12: device lost` then `cpu.wasm: done`, with `fallback_from: "webgpu.d3d12"`.

**4. A generative concept job with consent.** The approved brief asks for massing directions from a concept board:

```json
{"tool": "run", "project": "handheld.o3j", "base_rev": "r_15",
 "ops": [{"op": "generate", "kind": "gen.massing", "from_image": "concepts/board_2.png", "model": "trellis-v1-geometry"}],
 "compute": "auto"}
```

`sidecar.cuda` is dropped: TRELLIS v1's declared peak (about 16 GB, from its model card until S8b measures it) is above 90% of the 8 GB card's free VRAM (rule 5 in section 3.3); on a 24 GB card the same job would place locally. `cloud.3dj` is dropped for this job because 3dj's `generate_from_image_url` takes only a publicly reachable HTTPS URL and the board is local ([research/gap-9.md](research/gap-9.md)). Publishing the board at a public URL would be a separate egress approval; the presigned upload in proposal P-1 ([PLAN.md](PLAN.md) section 9) would remove that step. 3dj text-to-3D needs no upload. `cloud.modal`, the user's own endpoint running the same sidecar image, is chosen:

```json
{"status": "approval_pending", "approval_pending": {"url": "http://127.0.0.1:7817/a/ap_..?n=..", "id": "ap_0193..d1"},
 "summary": "Send concepts/board_2.png (1.2 MB, sha256 9f..) and prompt to cloud.modal; TRELLIS v1 geometry-only clean runner: code and weights MIT; DINOv2, spconv, kaolin and FlexiCubes Apache-2.0; rembg MIT with u2net Apache-2.0; easydict LGPL-3.0 (unmodified Python dependency); other dependencies MIT, BSD or Apache-2.0 (full list on the approval page); no territory limits found by the four-layer gate; estimate 0.04 EUR; budget left today 4.96 EUR"}
```

The founder approves on the local page. The mesh returns hashed, parsed in a worker and labelled "assumed"; provenance records the provider, bytes sent, model hash, approval id and cost. The agent rebuilds the chosen direction as an editable massing assembly and reports the Hausdorff distance, as in [PLAN.md](PLAN.md) S8b. With policy `never`, `auto` would take the DSL route and say so in `placement_reason`: the agent writes the massing from the board as DSL scripts on the CPU pool, labelled "assumed". A call naming `triposr` would run on the sidecar CPU once that model's licence audit passes; a call that insists on TRELLIS (`compute: "gpu"` or `"cloud"`) would get a structured refusal naming the missing VRAM and the policy (section 2).

## 11. Staged roadmap

Each step's one Kaizen metric and exit are in [PLAN.md](PLAN.md) section 6. The indicators below join the Friday scorecard; they are not gates.

| Step | Compute added | Secondary scorecard indicator (not a gate) |
|---|---|---|
| S0 | `doctor` and `doctor --bench` (worker scaling, peak worker memory, viewer frame-time probe); C5 schema; `corpora/reference-assemblies`; idle-machine re-run of the occt-wasm pool benchmark; H-det | Share of the five tier-1 CI runner types and the founder's machines with a bench JSON |
| S1 | Own worker pool with stdout capture, lanes, RAM-safe sizing and WASM-memory recycling; minimal job model (`job_id`, `inspect fields=[job]`, `cancel_job`) for work that misses the interactive deadline; `compute: auto \| cpu`; compute block in every result; DeviceInventory hash in each `provenance.jsonl` line; `inspect fields=[devices]` | Observe only: batch throughput per added worker on an idle machine (hypothesis 0.7x per added core, against the contended 0.22); interactive p95 with the batch lane full (proposed deadline 1 s) |
| S2 | Viewer chain WebGPU, WebGL2, HLR image; GPU picking; instancing | Viewer tier reached per session (local logs, volunteer reports); frame-time p95 per tier |
| S3 | CPU wall and overhang maps on the batch lane; guard bands; `marginal` | CPU analysis time on `corpora/reference-assemblies` (the S7a baseline) |
| S4 | Candidates and sweeps on the batch lane | Variants per minute per core |
| S5 | OrcaSlicer subprocess; approval service (egress approvals use it from S7b) | Placement estimates more than 2x off, per week |
| S6 | Swept clash across the pool | Swept-clash time per sampled pose |
| S7a | Accel pack (wall and clearance ray casts, fit pre-check, SDF and lattice previews) under the CPU-twin and measured-bound rules; per-adapter and per-driver bound calibration; runtime fallback; device profiles | Share of samples the GPU clears; nightly CPU-recompute differences |
| S7b | Provider router v1 with licence manifests, budgets and egress approvals; stub provider in CI; 3dj.app quote provider (if P-1 ships) | Provider jobs re-placed or retried, per week |
| S8a | Python sidecar; `cpu.sdcpp` for concept images on the CPU; user cloud GPU providers on the same job spec; onnxruntime-node small models | CPU and GPU time per concept image |
| S8b | TRELLIS runner on local CUDA (where rule 5 places it) or the cloud; the DSL route for massing on the CPU; TripoSR on the sidecar CPU once its licence audit passes; 3dj.app generation (text, or an image at a public URL until P-1) | Generative jobs finished on first placement without refusal or retry |
| S9 | Cycles provider through `blender -b`, GPU where present, CPU otherwise; zebra and curvature shading | Render minutes per CMF variant set |
| S10 | GPU-screened draft and undercut ray casts with CPU confirmation | Share of GPU values needing CPU confirmation; zero verdict differences |
| S11 | CalculiX on CPU | CalculiX p95 on real ID-4 studies (the GPU simulation trigger) |
| Later | GPU simulation (Warp FEM, PETSc); native OCCT with TBB or a pthread build; reconstruction | Trigger: p95 job time over budget on real projects |

## 12. Stop the line, and open questions

**Andon.** Compute faults (CPU and GPU divergence beyond tolerance, a GPU-cleared sample or GPU-dropped pair that the CPU recompute contradicts, kernel output on MCP stdout, egress without an approval) are red repo andons in the single list in [PLAN.md](PLAN.md) section 4.4. Each gets a root cause and a regression test before the andon closes.

**To verify:** real GPU speedups per vendor; occt-wasm scaling across workers on an idle machine (S0 re-run; the 1.67x with 4 workers was measured under contention); H-det (S0); CPU time per image for `cpu.sdcpp` with GGUF FLUX.1 schnell and Qwen-Image on the founder's machines, and which platforms stable-diffusion.cpp release binaries cover (S8a); Dawn on Adreno and WARP; whether OCCT parallel modes change replay hashes; provider data-retention terms; measured peak VRAM of TRELLIS v1 geometry-only, FLUX.1 schnell and Qwen-Image on consumer cards (S8a, S8b), and whether TRELLIS fits a 16 GB card under rule 5; TripoSR's four-layer licence audit and its MPS support; DirectML on Windows ARM64 in onnxruntime-node; a Blender package for Linux ARM64; which platforms CalculiX binaries cover.

## Sources

Beyond the linked research notes:

- Node `worker_threads` (`stdout`, `stderr`, `resourceLimits`): https://nodejs.org/api/worker_threads.html
- piscina 5.3.2 (its `dist/index.js` passes `env`, `argv`, `execArgv`, `resourceLimits`, `workerData` and `trackUnmanagedFds` to `new Worker`): https://www.npmjs.com/package/piscina
- stable-diffusion.cpp (MIT; FLUX.1 schnell and Qwen-Image; GGUF weights; CPU backend with AVX, AVX2 and AVX512 on x86; pre-built release binaries): https://github.com/leejet/stable-diffusion.cpp
- GitHub-hosted runners (`ubuntu-24.04-arm`, `windows-11-arm`, `macos-15-intel`; standard runners free and unlimited on public repositories): https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/
- ONNX Runtime execution providers (ROCm marked deprecated; MIGraphX, OpenVINO, QNN, WebGPU listed): https://onnxruntime.ai/docs/execution-providers/
- Cycles standalone (no GitHub releases; built from source per BUILDING.md with CMake, plus the CUDA Toolkit and OptiX SDK for NVIDIA GPUs), checked 28 Oct 2026: https://github.com/blender/cycles
- Blender 5.2.3 LTS downloads (Windows x64 and ARM64, macOS arm64, Linux x64; no Linux ARM64 or macOS x64) and licence (GPL; Cycles Apache-2.0; scripts using the Python API published under a GPL-compliant licence), checked 28 Oct 2026: https://www.blender.org/download/ ; https://www.blender.org/about/license/
- `bpy` 5.2.3 on PyPI (GPL-3.0, Python 3.13 only; wheels for win_amd64, win_arm64, manylinux x86_64 and macOS arm64), checked 28 Oct 2026: https://pypi.org/project/bpy/
- Chromium SwiftShader WebGL fallback removal and `--enable-unsafe-swiftshader`: https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM ; https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/docs/gpu/swiftshader.md
