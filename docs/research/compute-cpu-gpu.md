# CPU and GPU compute for Open3DJ

Checked 28 Oct 2026. Versions come from the npm, PyPI and crates.io registries and from tagged source files. Measurements: 4 vCPU Xeon at 2.1 GHz, Linux x64, Node 22.22, **no hardware GPU**. Mesa lavapipe (Vulkan in software) stood in for a GPU. Scripts are in [spike/compute/](spike/compute/). This builds on compute-local-and-cloud.md, lean-stack.md, kernels-and-geometry.md, client-and-distribution.md and gap-8.md.

## Bottom line

1. **The geometry of record stays on the CPU.** OCCT has no GPU path. occt-wasm 5.8.1 is a single-threaded wasm32 build. Its memory section is not shared, and it is built with `-msimd128` and no `-pthread`. It also leaves out relaxed-SIMD on purpose, because relaxed-SIMD "made geometry non-reproducible across CPUs". That property is worth keeping.
2. **CPU parallelism comes from jobs, not threads inside one operation.** Run one kernel instance per `worker_thread` and spread variants, assembly parts, analyses and exports across cores. The pthread OCCT build gives only about 1.24x overall (taucad). It needs COOP/COEP headers in browsers, and it costs determinism.
3. **GPUs pay off in six places:** display, path-traced renders, dense implicit-field (SDF and lattice) evaluation, dense ray-cast analysis maps, ML inference, and splat or FEM solvers. They do not help B-rep booleans, fillets or STEP. No production-grade open GPU mesh boolean exists either.
4. **One portable GPU route for TypeScript exists: WebGPU.** Use the browser or webview for display. In the Node daemon, use the Dawn-based `webgpu` npm package (0.6.2, MIT). It ships prebuilt binaries for Windows x64 and ARM64, Linux x64 and ARM64, and macOS universal. It is large: 137 MB unpacked for all platforms together.
5. **CUDA, ROCm and MPS stay in an optional Python sidecar** (PyTorch, Warp, gsplat, COLMAP, Cycles). The same job specification goes to a cloud provider when the machine cannot run it.
6. **Measured here:** a WGSL field kernel on software Vulkan ran 3 to 8 times faster than plain JavaScript. It was bit-identical between repeat runs on the same adapter. Compared with the CPU, only 4 to 10% of values were bit-identical, and 3 of 16.8 million voxels changed from inside to outside. So **"GPU screens, CPU decides"** has to be a written rule for every Evidence gate.
7. **Lean order:** first CPU only with a device inventory, then a CPU worker pool, then GPU for display only, then an optional WebGPU accelerator pack with a CPU twin for every kernel, then the Python GPU sidecar and cloud. The core needs no native GPU dependency until real users ask for one.

## 1. Which workloads gain from a GPU

| Workload | CPU path (default, deterministic) | GPU path | Expected gain | Decision |
|---|---|---|---|---|
| B-rep modelling (booleans, fillets, shell, sweep, STEP) | occt-wasm, one kernel per worker | None. OCCT modelling is CPU-only | None | CPU forever. Native OCCT with TBB is a later swap point |
| OCCT intra-op parallelism | `BOPAlgo_Options::SetRunParallel`, global `SetParallelMode`, `IMeshTools_Parameters::InParallel` (default false). `OSD_Parallel` uses TBB if built with it, otherwise OCCT threads | n/a | taucad MT WASM: about 1.24x overall, up to 3.46x on loft | Only after a native-addon trigger fires. Test replay hashes with parallel on and off |
| Tessellation | occt-wasm `tessellate`; native BRepMesh in parallel later | n/a | Parallel across faces and parts on CPU | Parallelise per part across workers |
| Mesh booleans and repair | manifold-3d 3.5.4 (WASM is "serial-only for now"). manifold3d Python wheels on 9 platforms use TBB | None production-grade. GPU research is voxel/SDF-approximate (cuda-mesh-voxelization) or a thesis. Exact methods (EMBER, Cherchi et al.) are CPU | n/a | CPU. Use native or Python Manifold with TBB for large meshes |
| Implicit/SDF fields, lattices, infill | Manifold `LevelSet`; Fidget 0.5.1 JIT (MPL-2.0); libfive (MPL-2.0 core) | WGSL compute in Node or the webview. `fidget-wgpu` renders only (no meshing). nTop claims 10x to 100x on NVIDIA | 3x to 8x even on software Vulkan (spike below); far more on real GPUs | GPU evaluates and previews; CPU meshes the field of record |
| Interference and clearance | Exact: occt-wasm `distanceBetween`, `section`, `intersectionCells`. Screening: three-mesh-bvh 0.9.16 on CPU, with `ParallelMeshBVHWorker` | three-mesh-bvh `./webgpu` WGSL BVH queries; Warp mesh BVH queries (CUDA) | Large only for dense all-pairs checks | CPU BVH first. GPU for assembly-scale sweeps |
| Analysis maps (wall thickness, draft, curvature, overhang) | Draft and overhang are a dot product per face. Curvature: occt-wasm `surfaceCurvature`. Thickness: BVH ray casts in workers | Per-pixel shaders for display; WGSL ray casting for dense thickness maps | Draft, overhang and curvature: none for numbers, large for display. Thickness: large above about 1M rays | Numbers on CPU; heat maps on GPU |
| Agent snapshots | occt-wasm HLR `toMultiviewPNG/SVG` (135 ms, byte-identical across processes, lean-stack.md) | n/a | n/a | Keep CPU as the CI and agent default |
| Interactive viewer | n/a | three.js r186 `WebGPURenderer`, which falls back to WebGL2. The fallback emulates compute through transform feedback | Essential | GPU, with WebGL2 as the floor |
| Photoreal and CMF renders | Cycles on CPU | three-gpu-pathtracer 0.0.27 (MIT, **now requires WebGPU**). Cycles: CUDA/OptiX (CC 5.0+), HIP (RDNA1+), oneAPI (Arc), Metal (Apple Silicon) | 5x to 50x typical | Cycles as a subprocess provider (Apache-2.0 standalone). Browser path tracer for previews |
| Structural FEA | CalculiX 2.23 (GPL-2.0, subprocess) | Warp 1.18.0 `warp.fem` (Apache-2.0, CUDA; CPU-only on macOS). PETSc 3.26 (BSD-2: CUDA, HIP, Kokkos, OpenCL). AMGX (BSD-3-Clause, CUDA). JAX-FEM is GPL-3.0 | Large at more than 1M DOF | CalculiX first. GPU solvers only as a later provider |
| Topology optimisation | Small SIMP studies on CPU | Warp ships a cantilever topology optimisation example | Large for 3D | Later, provider only |
| Generative 3D and ML | ONNX Runtime CPU EP | PyTorch 2.14.1 (CUDA, ROCm, MPS, XPU). onnxruntime-node 1.31.1: CUDA 12 (Linux x64), DirectML (Windows), CoreML (macOS), WebGPU (experimental) | TRELLIS v1 needs CUDA (Linux-tested, 16 GB) | Sidecar or cloud. Small ONNX models in process |
| Reconstruction | COLMAP 4.2.1 SfM and global mapper on CPU ("all COLMAP functionality except the dense reconstruction part") | COLMAP dense MVS needs CUDA. gsplat is CUDA. **Brush** (Apache-2.0) trains splats on WebGPU across AMD, NVIDIA, Intel and Apple | Large | COLMAP CPU plus Brush cross-vendor; gsplat on NVIDIA |

## 2. Go and see: the same field on CPU and on a WebGPU device

The script `sdf-gpu-vs-cpu.mjs` evaluates a sphere intersected with a gyroid lattice. It runs once as JavaScript, rounded to float32 at each step, on 1 thread and on 4 `worker_threads`. It runs again as WGSL through `webgpu` 0.6.2 on lavapipe, which Dawn reported as `vendor: mesa, architecture: software, isFallbackAdapter: true`. GPU times are warm and include the readback.

| Grid | JS, 1 thread | JS, 4 workers | WGSL on lavapipe | Max abs diff | Bit-identical to CPU | Inside/outside flips | GPU repeat identical |
|---|---|---|---|---|---|---|---|
| 128³ (2.1M) | 478 ms | 247 ms | 17 ms | 2.7e-7 | 9.5% | 0 | yes |
| 256³ (16.8M) | 3,043 ms | 1,152 ms | 114 to 387 ms (2 runs) | 3.9e-7 | 4.3% | 3 | yes |

What this shows:

- **WebGPU in Node works with no browser and no flags.** Chromium's Linux allowlist (Intel Gen12+, NVIDIA on Wayland) is a browser policy and does not apply to dawn.node.
- **A software adapter is a useful CPU fallback for the same WGSL.** lavapipe is a multithreaded LLVM JIT, which is why it beat plain JavaScript. It is not present by default, though. Linux needs `mesa-vulkan-drivers`, and macOS has no software adapter. A JS or WASM CPU twin therefore stays mandatory.
- **Cross-device results differ in the last bits, and that can flip classification.** WGSL explicitly allows this: "An implementation may reassociate operations. An implementation may fuse operations…" and "Implementations may assume that overflow, infinities, and NaNs are not present."
- **Not measured: real GPU speed.** No hardware GPU was available. A test of occt-wasm throughput across several workers was written (`occt-pool.mjs`), but the sandbox permission policy stopped it from running. It is the first follow-up spike.

## 3. Reaching the GPU from TypeScript in 2026

| Route | Status (verified) | Use in Open3DJ |
|---|---|---|
| Browser or webview WebGPU | Chromium: Windows x64, macOS and ChromeOS since 113. Linux: Intel Gen12+ from 144, NVIDIA on Wayland from 147, "other Linux setups require a command-line flag". Windows ARM64 is behind `--enable-unsafe-webgpu`. Firefox: Windows since 141, macOS since 145/147, Linux in Nightly only. Safari 26 and WKWebView (macOS 26): on by default. WebKitGTK release notes through 2.54.2 do not mention WebGPU | Viewer only. WebGL2 is the floor (three.js falls back automatically) |
| Electron 45 | Bundles Chromium, so it inherits these rules. Exposes GPU info and `powerMonitor` | R5 shell. Can host GPU compute in a renderer or utility process |
| Tauri 2.12 | WebView2 follows Edge; WKWebView needs macOS 26 or later; WebKitGTK has none | Viewer falls back to WebGL2 on Linux |
| Node + `webgpu` (dawn.node) | 0.6.2, 2 Oct 2026, MIT. Five prebuilt binaries (darwin-universal, linux-x64/arm64, win32-x64/arm64). Backends: d3d12, d3d11, metal, vulkan, opengl, opengles. Dawn enumerates software DXGI adapters (WARP) as CPU-type adapters. Pre-1.0 | **The daemon's GPU compute route.** Ship as an optional, on-demand package |
| Deno | WebGPU still behind `"unstable": ["webgpu"]` | Not used |
| Bun | No built-in WebGPU. Third-party `bun-webgpu` and Electrobun | Not used |
| wgpu via Rust and N-API | wgpu 30.0.1 (MIT OR Apache-2.0), using napi-rs | Only if a Rust host arrives. Same WGSL |
| onnxruntime-node 1.31.1 | CPU on all six targets. WebGPU on 5 (experimental). DirectML on Windows. CUDA 12 on Linux x64 only. CoreML on macOS | Small models in process |
| TensorFlow.js | Last release 4.22.0, Oct 2024 | Avoid |
| Python sidecar | torch 2.14.1 wheels (no win_arm64 on PyPI); warp-lang 1.18.0 (R580+ driver, Turing+); openvino 2026.4.1; onnxruntime-qnn 2.7.0 (includes win_arm64) | Heavy GPU work, installed only when a provider is chosen |

**By vendor:**

- **NVIDIA:** everything works, including CUDA, OptiX, Warp, gsplat, COLMAP dense and TRELLIS.
- **AMD:** ROCm on Linux. On Windows, PyTorch ROCm (ROCm 7.2, Jan 2026) covers RDNA3 and RDNA4 only, on Windows 11. Cycles HIP supports RDNA1 and newer. Chrome on Linux needs a flag for WebGPU, but dawn.node and Vulkan do not.
- **Intel:** Arc through Cycles oneAPI, PyTorch XPU and OpenVINO. WebGPU on Chrome for Linux needs Gen12 or newer.
- **Apple Silicon:** Metal, MPS and CoreML. WebGPU in Safari and WKWebView on macOS 26. No CUDA-only models: TRELLIS, gsplat and Warp's GPU path all fall back to cloud or CPU.
- **Qualcomm (Windows on Arm):**
  - Browser WebGPU is behind a flag.
  - The Node route has a dawn.node win32-arm64 binary. Its behaviour on Adreno is untested.
  - DirectML works in maintenance mode. Microsoft says "no new functionality" and points to Windows ML, which `onnxruntime-windowsml` provides on win_arm64.
  - QNN serves the NPU.
  - Cycles has no Adreno backend, so it renders on the CPU.
- **Integrated GPUs:** pass `powerPreference: 'low-power'` for background jobs. Share memory with the CPU and budget for it.

**Driver pitfalls to design for:**

- **Windows TDR.** A GPU task that cannot be preempted within 2 seconds is reset. Microsoft says applications must not change this setting. Split dispatches into tiles of about 50 to 100 ms.
- **Hybrid laptops** may pick the wrong GPU.
- **Stale drivers.** OptiX needs driver 575 or newer; Warp's CUDA 13 wheels need R580.
- **WebGPU hides VRAM.** `GPUAdapterInfo` has vendor, architecture, device, description, subgroup sizes and `isFallbackAdapter`, but no memory size. The spec defaults are a 256 MiB buffer and a 128 MiB storage binding (lavapipe also reported 128 MiB).

**Headless CI with no GPU:**

- **Linux:** run Dawn on lavapipe, as measured above.
- **Windows:** WARP probably works the same way; confirm it on `windows-latest`.
- **macOS:** hosted runners cannot use MPS on larger arm64 runners ("Apple's Virtualization Framework" limitation).
- **Real GPUs:** GitHub GPU runners cost $0.052 per minute on Linux and $0.102 on Windows, so a 10-minute weekly smoke test is about $2 a month (optional). The free alternative: volunteers run `open3dj doctor --bench` and attach the JSON to an issue. Never use self-hosted runners on a public repo.

## 4. The compute-device layer

**4.1 Discovery (`open3dj doctor`).** Build a `DeviceInventory` once at startup and cache it:

- **CPU:** `os.availableParallelism()`, architecture, total and free RAM.
- **GPUs:** `systeminformation` 5.33.16 (MIT) gives vendor, model, `vram` and `vramDynamic`. With `nvidia-smi` it also gives memory used, temperature, power draw and limit. It reports battery `acConnected`.
- **WebGPU:** if the accelerator pack is installed, record `GPUAdapterInfo`, limits, features and `isFallbackAdapter`.
- **Python sidecar:** if present, it reports `torch.cuda` / `mps` / `xpu` availability and a hash of its licence manifest.
- **Recording:** the inventory goes into provenance for every job and into the Evidence Pack.

**4.2 Job model and placement.** Every heavy operation is a job with:

- `kind`
- `inputsHash`
- `determinism: 'record' | 'preview'`
- `privacy: 'local-only' | 'cloud-anonymous' | 'cloud-full'`
- `deadlineMs`
- `budgetEur`
- `estimate`

The placement rule is standard work, one line:

1. Filter devices by capability, licence and privacy.
2. Drop any device whose estimated memory exceeds 70% of its budget.
3. Pick the lowest estimated time.
4. Break ties by lowest cost, then local before cloud.

Estimates come from a local per-device profile: the median time per unit of work (cells, rays, triangles, DOF). This is PDCA in code: every run updates the profile, and a prediction off by more than 2x is logged as a defect to root-cause.

Cloud placement always needs an approval owned by the daemon when it costs money or sends data off the machine. The budget lives in the daemon, not in the agent's arguments.

**4.3 A CPU fallback for every GPU path (mistake-proofing).** A GPU kernel may merge only together with:

- a CPU twin in TypeScript or WASM
- a conformance test on fixed seeds that compares the two within a stated tolerance
- a lavapipe CI job
- a benchmark showing a gain of at least 3x on one real reference GPU, run by a volunteer

Without that gain the kernel is waste and is not shipped. At runtime, any device loss, out-of-memory, TDR or validation error re-queues the job on the CPU twin and records why.

**4.4 CPU worker pool.**

- **Pool library:** use `piscina` 5.3.2 (MIT) or a 100-line pool.
- **Pool size:** `min(availableParallelism - 1, floor(freeRAM / 400 MB))`. Each occt-wasm worker starts at about 103 MB RSS (lean-stack.md) and grows with work.
- **Recycling:** recycle a worker at 1.5 GiB heap (Tau's figure), after N jobs, or on any kernel error. This also limits pointer-order nondeterminism (gap-8, OCCT PR #1600).
- **Two lanes:** an interactive lane gets one reserved worker so agent edits stay under 1 s; a batch lane takes variants, analysis and export.

**4.5 Determinism policy.** The geometry of record, GeometryReport numbers and Evidence gate verdicts come only from the CPU kernel.

- **GPU outputs are "observed."** Under 3dj's confidence labels, a CPU result is "measured" and a GPU result is "observed."
- **GPU screens, CPU decides.** When a GPU value falls within a guard band of a gate threshold, the CPU confirms it. For example, 0.8 mm wall plus or minus 2 voxels, or 45 degrees plus or minus 1.
- **Fixed parameters.** Fix seeds, sample counts and tile order, so that repeats on one adapter stay bit-identical. The spike shows this holds.
- **Replay** compares the hash of the record on the CPU, and compares GPU artefacts by tolerance.

**4.6 Memory, power and heat.**

- **Tiling:** split grids larger than the storage binding limit (128 MiB is about 32M floats, or 320³).
- **VRAM budget:** cap use at 60% of reported VRAM (dynamic or shared memory counts against RAM).
- **On battery** (`acConnected` false, Electron `on-battery`):
  - halve the pool size
  - use `powerPreference: 'low-power'`
  - defer batch-lane GPU jobs
  - tell the agent through the job status, for example "deferred: on battery"
- **Thermal throttling:** react to Electron `speed-limit-change` (macOS and Windows) and `thermal-state-change` (macOS), and to `PressureObserver` (CPU only, Chromium 125+) in the UI.

## 5. Lean staging

| Release | Compute added | Exit check |
|---|---|---|
| R0 (now) | CPU only: occt-wasm in one worker; HLR PNG for agents; `doctor` prints the DeviceInventory; provenance records the device | CI green on 4 OSes. Byte-identical PNG across runs |
| R1 | Worker pool with interactive and batch lanes; three-mesh-bvh CPU analysis (thickness, draft, overhang, clearance) feeding Evidence gates; parallel variant sweeps | Throughput scales at least 0.7x per added core on 4 cores. Measured with `occt-pool.mjs` |
| R2 | Viewer: three.js `WebGPURenderer` with WebGL2 fallback; GPU picking; zebra, curvature and draft shaders (display only) | Works on WebGL2-only Linux. Frame-time data from real users |
| R3 | Optional `@open3dj/accel-webgpu` (wraps `webgpu`): WGSL kernels for SDF/lattice preview and thickness ray casts, each with a CPU twin; lavapipe CI | At least 3x gain on a volunteer GPU. Zero gate verdicts that the CPU does not confirm |
| R4 | Python GPU sidecar provider (`uvx`): TRELLIS v1 clean runner (CUDA), Cycles renders for CMF variants, COLMAP and Brush; the same job specification on RunPod, Modal or 3dj.app | Licence manifest shown before download. Local and cloud artefacts interchangeable |
| Later, by trigger | Warp/CalculiX FEA provider; onnxruntime-node models; native OCCT N-API with TBB parallel flags; a contributed occt-wasm pthread build | Trigger: p95 job time over budget on real projects |

## 6. Recommended libraries

| Library | Version | Licence | Role |
|---|---|---|---|
| occt-wasm | 5.8.1 | Tooling MIT OR Apache-2.0; `.wasm` LGPL-2.1 | CPU kernel of record |
| manifold-3d / manifold3d | 3.5.4 | Apache-2.0 | Mesh booleans, level sets (CPU) |
| three-mesh-bvh | 0.9.16 | MIT | CPU BVH; WGSL BVH queries |
| three | 0.186.1 | MIT | Viewer; WebGPU with WebGL2 fallback |
| three-gpu-pathtracer | 0.0.27 | MIT | Browser previews (WebGPU only) |
| webgpu (dawn.node) | 0.6.2 | MIT | GPU compute in Node (optional) |
| systeminformation | 5.33.16 | MIT | Device discovery |
| piscina | 5.3.2 | MIT | Worker pool |
| onnxruntime-node | 1.31.1 | MIT | In-process ML |
| Fidget / fidget-wgpu | 0.5.1 | MPL-2.0 (file-level copyleft; fine as a dependency) | Implicit fields, later |
| Cycles standalone | Blender 5.2-era | Apache-2.0 | Render provider |
| warp-lang | 1.18.0 | Apache-2.0 (libmathdx under an NVIDIA licence) | GPU FEM and queries provider |
| CalculiX | 2.23 | GPL-2.0, subprocess only | CPU FEA provider |
| Brush | main branch, no release | Apache-2.0 | Cross-vendor splat training |
| Avoid in process | JAX-FEM (GPL-3.0); TensorFlow.js (stalled); torch-directml (last release 2024) | | |

## 7. Stop-the-line rules and open questions

**Stop the line on any of these:**

- A CPU and GPU divergence beyond tolerance.
- A gate verdict that rests only on GPU output.
- A TDR or device loss in CI.
- A placement estimate that misses by more than 2x on the reference set.

Each one gets a root cause and a regression test.

**Open questions:** real-GPU speedups per vendor; dawn.node on Adreno and WARP; occt-wasm scaling across workers; whether OCCT parallel booleans change replay hashes.

## Sources

- occt-wasm build flags and README: https://github.com/andymai/occt-wasm/blob/main/xtask/src/build.rs ; https://github.com/andymai/occt-wasm ; https://www.npmjs.com/package/occt-wasm (local check of the 5.8.1 binary: memory not shared, no pthread runtime)
- OCCT 8.0.1 sources:
  - https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_Options.hxx
  - https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingAlgorithms/TKMesh/IMeshTools/IMeshTools_Parameters.hxx
  - https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/FoundationClasses/TKernel/OSD/OSD_Parallel.hxx
- taucad WASM benchmarks: https://github.com/taucad/opencascade.js/blob/main/BENCHMARKS.md
- Manifold: https://github.com/elalish/manifold ; https://pypi.org/project/manifold3d/
- Mesh boolean research: https://arxiv.org/abs/2205.14151 ; https://graphics.rwth-aachen.de/person/248 ; https://relatedrepos.com/gh/bigmat18/cuda-mesh-voxelization
- Fidget: https://crates.io/crates/fidget ; https://docs.rs/fidget-wgpu/latest/fidget_wgpu/
- libfive: https://github.com/libfive/libfive
- three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh
- three-gpu-pathtracer: https://github.com/gkjohnson/three-gpu-pathtracer
- three.js WebGL fallback: https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/WebGLBackend.js
- Cycles: https://projects.blender.org/blender/cycles ; https://docs.blender.org/manual/en/latest/render/cycles/gpu_rendering.html
- Warp: https://github.com/NVIDIA/warp ; https://pypi.org/project/warp-lang/
- PETSc: https://petsc.org/release/overview/gpu_roadmap/ ; https://gitlab.com/petsc/petsc/-/blob/main/LICENSE
- AMGX (SPDX header in `src/amgx_c.cu`): https://github.com/NVIDIA/AMGX
- JAX-FEM: https://pypi.org/project/jax-fem/
- CalculiX: http://www.calculix.de/
- PyTorch: https://pypi.org/project/torch/
- AMD PyTorch on Windows: https://www.amd.com/en/resources/support-articles/release-notes/RN-AMDGPU-WINDOWS-PYTORCH-7-2.html
- ONNX Runtime:
  - Node binding: https://www.npmjs.com/package/onnxruntime-node
  - QNN: https://pypi.org/project/onnxruntime-qnn/
  - Windows ML: https://pypi.org/project/onnxruntime-windowsml/
  - DirectML status: https://github.com/microsoft/DirectML
- OpenVINO: https://pypi.org/project/openvino/
- torch-directml: https://pypi.org/project/torch-directml/
- TensorFlow.js: https://www.npmjs.com/package/@tensorflow/tfjs
- COLMAP: https://colmap.github.io/faq.html ; https://pypi.org/project/pycolmap-cuda12/
- gsplat: https://github.com/nerfstudio-project/gsplat
- Brush: https://github.com/ArthurBrussee/brush
- Dawn for Node: https://www.npmjs.com/package/webgpu ; https://github.com/dawn-gpu/node-webgpu ; https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md
- Dawn D3D backend: https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/d3d/PhysicalDeviceD3D.cpp ; https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/d3d/BackendD3D.cpp
- WebGPU status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; https://webkitgtk.org/news.html
- WebGPU and WGSL specs: https://www.w3.org/TR/webgpu/ ; https://www.w3.org/TR/WGSL/#floating-point-evaluation
- Chrome 136 isFallbackAdapter: https://developer.chrome.com/blog/new-in-webgpu-136
- Deno: https://docs.deno.com/runtime/desktop/webgpu/
- Bun: https://github.com/kommander/bun-webgpu ; https://framework.blackboard.sh/electrobun/guides/changelog/v1-15-1/
- wgpu: https://crates.io/crates/wgpu
- Compute Pressure API: https://developer.chrome.com/docs/web-platform/compute-pressure
- Electron powerMonitor: https://www.electronjs.org/docs/latest/api/power-monitor
- systeminformation: https://systeminformation.io/graphics.html ; https://www.npmjs.com/package/systeminformation
- piscina: https://www.npmjs.com/package/piscina
- Windows TDR: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys
- GitHub runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; https://docs.github.com/en/billing/reference/actions-runner-pricing ; https://github.com/actions/runner-images/issues/9254
- Earlier notes in this folder: compute-local-and-cloud.md, lean-stack.md, kernels-and-geometry.md, client-and-distribution.md, gap-8.md, industrial-design.md
