# Open3DJ lean plan: agent value first

28 Oct 2026. An independent proposal from one angle: make agents (Claude Code and other MCP clients) able to design real parts and products reliably, as fast as possible. Everything else waits until agents, or the humans approving their work, pull for it. It follows the founder's constraints and builds on the research folder; the gap notes and the 28 Oct reports override PLAN.md and ARCHITECTURE.md.

## 1. Thesis

Agents rarely fail at CAD because they cannot write code. They fail because they cannot see what the code did, point at geometry stably, recover from kernel errors or prove the result is right. Two results show what fixing this is worth. Execution-verified loops with exact measurements and renders lifted median IoU from 0.81 to 0.96 (CADSmith). On CADGenBench the same model scored 0.752 with the official prompt and 0.805 to 0.830 with build123d-mcp's tools, so tooling is still worth about 0.08 (gap-9).

Open3DJ's product is therefore the feedback loop, delivered to agents first: one `npx` command, five MCP tools, a GeometryReport after every change, deterministic pictures, honest gates, and the assembly as the unit of design.

Three rules follow.

1. **Find and fix the top failure each week.** Ship the smallest thing an agent can finish a real part with. Watch where agents fail, in o3dj-bench and in transcripts, then fix the top failure.
2. **Every design is an assembly.** A single part is a one-part assembly, so there is no part-only code path to migrate later.
3. **Every heavy job declares where it can run: CPU, local GPU or cloud GPU.** The CPU path always exists and decides; the GPU path accelerates and screens. This answers the founder's request to "also allow to calculate on both CPU and GPU".

## 2. Ground rules

**Team.** The founder, unpaid volunteers, Claude and the founder's agents. There are no salaries, hiring, burn or grant plans.

**Effort unit.** One founder-week (FW) is about 25 to 30 hours of founder attention spent specifying, reviewing and testing, while agents write most code and tests. It includes the 6 to 8 hour weekly Kaizen loop. If the founder is part-time, calendar time stretches.

**Honest ranges.** Evidence on AI speed-ups is mixed. METR found experienced open-source developers 19% slower with AI in 2025 and calls its later speed-up signal "very weak evidence". So:

- each step re-estimates from measured PR lead time after its first week;
- an overrun of 50% past the upper bound triggers an A3 and a scope cut, not a longer step.

**Cash.** $0 through Step 8. Free: GitHub Actions standard runners on all six OS/arch targets for public repos, npm trusted publishing, Sigstore attestations, Read the Docs, and the founder's existing Claude subscription via `CLAUDE_CODE_OAUTH_TOKEN` in `claude-code-action@v1`. ID-0 prints use volunteers' printers. GPU work uses volunteers' machines, free Hugging Face ZeroGPU demos, or the user's own cloud keys behind a daemon-owned budget approval. Unavoidable costs arrive only with a desktop binary: Apple's $99 a year for a macOS GUI. Windows signing is free through Microsoft Store MSIX or SignPath Foundation (after a first release); Azure Artifact Signing (about $9.99 a month) only if the publisher must read Neural Deep Network LTD.

## 3. Starting stack and how it grows without rewrites

**Start TypeScript-first** (lean-stack option A). Versions were confirmed on npm on 28 Oct 2026. Open3DJ ships as one npm package built from:

- **`@modelcontextprotocol/server` 2.4.0** (Apache-2.0). Its `serveStdio` serves Claude Code at protocol 2026-07-28, and Codex and Gemini CLI at 2025-06-18, from one server.
- **brepjs 20.11.1** (Apache-2.0) on **occt-wasm 5.8.1** (OCCT 8.0.1 as WebAssembly). Against native OCCT it measured 1.23x to 2.12x slower but started faster (121 ms against 0.83 s), and a failed fillet returned `CONSTRUCTION_FAILED ... faulty edges: 15,23` instead of a segfault.
- **An Open3DJ-owned facade for the 3dj DSL** (about 150 entries). It is the only public modelling API.
- **QuickJS-WASM for agent scripts** (quickjs-emscripten 0.32.0). It runs inside a short-lived Node worker started with `--permission`, with about 1% overhead. The parent process also enforces a wall-clock kill, because the spike's allocation bomb ran 12 s past its 500 ms deadline.
- **occt-wasm hidden-line (HLR) multiview PNG/SVG renders.** They take 135 ms and are byte-identical across processes.
- **Libraries added as steps need them:** manifold-3d 3.5.4, three-mesh-bvh 0.9.16, piscina 5.3.2, systeminformation 5.33.16 and three 0.186.1.

**Why:** zero native builds on every Node target, including Windows ARM64 where Python OCP has no wheel; WASM contains kernel crashes; typed code suits agents. A Python start would duplicate build123d-mcp and need OS sandboxing on day one; a Rust start would rebuild brepjs's layer and still need a TypeScript viewer.

**Four contracts are written once, versioned and changed only with a migration:**

1. **MCP tool and report schemas:** GeometryReport, reference states, Evidence Pack with waivers, jobs, approvals, provenance and the compute block.
2. **DSL v1 conformance.** The DSL v1 surface has a tolerance-based conformance suite on the 18 public 3dj starters. Topology must match exactly. Measures must agree within proposed relative tiers of 1e-6 (no blends) and 1e-4 (fillets and lofts).
3. **The `KernelAdapter`:** a vendored copy of brepjs's synchronous, opaque-handle interface.
4. **The `.o3j` project, assembly graph and replay format.**

**Swaps open only on a measured trigger:**

| Swap | Trigger | First response |
|---|---|---|
| Memory64 build, then the same occt-wasm C++ facade compiled natively (N-API) | A real part exceeds the 4 GiB wasm32 cap, or p95 `run` exceeds 2 s on real projects | Contribute memory64 first; the native build sits behind the same `KernelAdapter` |
| Rust host via the occt-wasm crate on wasmtime | Users need a single binary that Node SEA cannot provide | Same WASM kernel, DSL and schemas |
| OS sandbox (bubblewrap, Seatbelt, AppContainer plus Job Object) | Before any non-loopback transport, or after a sandbox finding | Wrap the worker; the worker protocol does not change |
| Python build123d 0.13.0 tier via `uvx` | A bench ablation shows the JS DSL 5 or more points below build123d-mcp with the same model | Optional worker with the same report schema |
| Desktop shell (Electron 45 or Tauri 2.12) | Measured user demand for an app outside the browser | Same web UI; signing costs start here |

**Dependency hygiene.** Pin exactly; upgrade in one weekly batch PR that merges only if conformance passes, the bench regresses 10% or less, and a 10,000-op soak shows no growth. Mirror occt-wasm and brepjs (one maintainer each) and keep a reproducible occt-wasm build. Ship `occt-wasm.wasm` as a separate, replaceable LGPL-2.1 file.

## 4. The agent contract: what earns its place

Kept from the earlier plan, because each fixes a known agent failure:

- **GeometryReport after every change**, concise (300 tokens or fewer) or detailed. Errors are tool results with script line, faulty sub-shapes and a suggested fix.
- **Five-state named references:** exact, re-resolved, disambiguated, ambiguous (candidates, never auto-picked), broken (with reason).
- **Evidence Pack gates** with recorded waivers and confidence labels (measured, observed, inferred, assumed).
- **Deterministic CPU renders** for agents and CI goldens; provenance and same-platform replay.
- **`base_rev` concurrency** (never keyed on MCP sessions) and an own job model.
- **Daemon-owned approvals:** an MCP elicitation `accept` is never consent, since Claude Code hooks can answer automatically.
- **Licence-aware provider router** with 3dj.app as one provider.
- **Packaging:** SKILL.md under 5k tokens, a Claude Code plugin with an export-gate hook, an MCP Registry entry, client snippets; o3dj-bench grown from real failures; MIT OR Apache-2.0 with DCO.

**Five tools**, all working over plain `tools/list` and `tools/call` at protocol 2025-06-18:

| Tool | Does | Grows later through parameters |
|---|---|---|
| `run` | Runs a part script or applies graph ops (`add_occurrence`, `add_mate`, `set_joint`, `set_param`, `replace_definition`) against `base_rev`. `candidates[]` and `sweep` run in parallel. Returns a GeometryReport, or a `job_id` for long work | `generate` (S6) |
| `inspect` | Reads report fields: tree, refs, gates, fits, dof, bom, measure. Polls jobs and approvals | analysis maps (S5), continuity (S7) |
| `render` | HLR multiview, section, highlight, exploded and motion-sample views | concept board (S6), zebra and curvature (S7) |
| `export` | STEP, 3MF, glTF and STL with an evidence sidecar. Runs the gate check and records waivers | quote (S3), RFQ pack (S8) |
| `docs` | Paged search over the DSL reference, `lib` parts, the error playbook and examples, instead of 3dj's dump-everything starters | none |

- **A sixth tool needs an A3** that shows a bench gain.
- **The CLI mirrors MCP.** `npx open3dj run ...` calls the same handlers, and one CI test checks that its schema dump equals `tools/list`.

## 5. Assembly data model

The native project is a git-friendly folder:

```
enclosure.o3j/
  project.o3j.json    manifest: schema version, mm, Z-up, engine pins
  assembly.o3j.json   the assembly graph (structure is data)
  parts/*.o3j.js      one 3dj-DSL script per part definition (geometry is script)
  params.o3j.json     typed parameters shared by scripts and mates
  brief.o3j.yaml      ID brief and executable assertions (from S3)
  evidence.json       latest Evidence Pack per revision
  provenance.jsonl    append-only: call, args hash, result hash, engine, device
  .o3j-cache/         content-addressed tessellation per definition
```

**The graph:**

- **Definitions:** a part script, a `lib` standard part with parameters, or a sub-assembly, with part number and configuration.
- **Occurrences:** UUIDv7, name, path address (`gearbox/planet#2`), definition plus configuration, transform (translation plus quaternion), suppressed and BOM-include flags, colour override.
- **Connectors:** frames (origin, Z, X) on a definition, anchored to a named reference, with 3dj gender and type tags.
- **Mates:** type, two connector paths, offset, limits, and a value bound to a `Param`.
- **Patterns, groups, explode states and motion studies.**

**Derived data.** The BOM, DOF and clash tables are always derived, never stored. Agents patch the graph through `run`, and a mate change never re-runs a part script. The file stores quaternions; Euler angles appear only at the occt-wasm XCAF boundary, where R = Rz·Rx was measured.

**3dj compatibility.** Each 3dj construct maps onto the graph:

| 3dj construct | Becomes in Open3DJ |
|---|---|
| Named descriptor returns `[{name, shape, color}]` | Definitions plus occurrences. Clones become one shared definition when provenance or a geometry hash shows it, labelled "inferred" |
| `connector.male/female` | Connectors |
| `matchTo` | A persisted fastened mate. In 3dj it is only a one-time placement |
| `withReferences` points | Named references. They have no orientation, so a connector built on one needs an axis |
| `attachTo` | A placement relative to a reference |

Native scripts may also call `asm.part()` and `asm.place()`.

**Solving comes in tiers.**

- **Closed form (S3, S4).** Fastened mates and tree joints, which cover enclosures, hinges and slides.
- **Numeric (S8).** Open3DJ's own Levenberg-Marquardt solver handles loops. It uses DOF = 6n - rank(J), and rank analysis names redundant and conflicting mates.
- **brepjs reuse.** Its instancing, joint transforms, forward kinematics and URDF export are reused. Its mate solver is not: in a measured test it ignored a conflicting mate and reported 4 DOF for a four-bar linkage whose mobility is 1.

**Fits have three outcomes:** clash (shared volume), contact (zero gap and zero volume) and clearance (positive gap). The check runs in three tiers:

1. An AABB filter, which cut 10,440 pairs to 144 in 5.5 ms.
2. Manifold mesh volume and gap at 5.4 ms a pair, labelled "observed".
3. Exact OCCT on flagged pairs at 19 to 29 ms a pair, labelled "measured".

Mated contacts are exempt, and press fits are declared.

**Exports:**

- **STEP** (AP214 today) through XCAF, with names on both definition and instance labels and a pure assembly root.
- **3MF** with components and build items carrying `partnumber`, written by a small own writer or lib3mf 2.5 (WASM, BSD-2-Clause).
- **glTF** through XCAF at S1, then an own per-definition writer with shared meshes at S4.
- **AP242** through an occt-wasm facade contribution at S8. URDF and MJCF come later.

## 6. Compute-device layer (CPU and GPU)

**Discovery.** `open3dj doctor` builds a DeviceInventory (CPU cores, architecture and RAM; GPU vendor, model and VRAM via systeminformation; WebGPU adapter info when the accelerator pack is installed; CUDA, MPS or XPU when the Python sidecar is present; configured cloud providers) and records it in provenance and the Evidence Pack.

**Declaration.** Every heavy job kind lists its backends, for example `boolean: [cpu.wasm]`, `wall_thickness: [cpu.wasm, gpu.webgpu]`, `image_to_3d: [gpu.cuda.sidecar, cloud.*]`. Each job carries `inputsHash`, determinism (`record` or `preview`), privacy (`local-only`, `cloud-anonymous`, `cloud-full`), deadline, budget and estimate. Heavy tool calls take `compute: "auto" | "cpu" | "gpu" | "cloud"`. `auto` falls back to the CPU and records why. An explicit `gpu` with no adapter returns a structured error.

**Placement.** One line of standard work:

1. Filter devices by capability, licence and privacy.
2. Drop any device whose estimated memory exceeds 70% of its budget.
3. Pick the lowest estimated time from the per-device profile of past runs.
4. Break ties by cost, then local before cloud.

A prediction more than 2x off is logged as a defect. Cloud spend or data egress always needs an approval owned by the daemon.

**CPU worker pool.** Each worker runs one occt-wasm kernel. occt-wasm is single-threaded wasm32 with no pthreads, and it leaves out relaxed-SIMD so results reproduce across CPUs.

- **Lanes:** an interactive lane keeps one worker reserved; a batch lane takes candidates, sweeps, analysis and export.
- **Size:** min(cores - 1, free RAM / 400 MB).
- **Recycling:** at 1.5 GiB heap, after N jobs, or on any kernel error.

**Where GPUs help, each with a CPU twin:**

| Workload | CPU path (decides) | GPU path (accelerates) | Step |
|---|---|---|---|
| B-rep modelling, STEP | occt-wasm pool | none; OCCT is CPU-only | S1, S2 |
| Viewer, overhang and draft display | per-face numbers | three.js WebGPURenderer with WebGL2 floor; shaders | S3 |
| Thickness and clearance maps, assembly broad-phase | three-mesh-bvh rays in workers; Manifold | WGSL in optional `@open3dj/accel-webgpu` (Dawn `webgpu` 0.6.2, 137 MB, installed on demand) | S5 |
| Implicit and lattice fields | Manifold LevelSet meshes the record | WGSL evaluation and preview | S5 |
| Concept images, image-to-3D | ONNX CPU, or cloud | `uvx` Python sidecar (CUDA, MPS, ROCm), or cloud | S6 |
| Photoreal and CMF renders | Cycles CPU | Cycles CUDA/OptiX, HIP, oneAPI, Metal (subprocess) | S7 |
| FEA and dynamics | CalculiX subprocess | Warp FEM, MuJoCo Warp, PETSc GPU (provider) | later |

**Determinism rule: GPU screens, CPU decides.** The geometry of record and every gate verdict come only from the CPU kernel. GPU outputs are "observed", and a GPU value inside a guard band of a threshold (0.8 mm plus or minus 2 voxels, 45 degrees plus or minus 1) is re-checked on the CPU. The reason is measured: on software Vulkan only 4 to 10% of SDF values were bit-identical to the CPU, and 3 of 16.8 million voxels flipped inside/outside.

**GPU merge rule.** A kernel merges only with a CPU twin, a fixed-seed tolerance test, a lavapipe CI job and a gain of at least 3x on a real volunteer GPU.

**Safety limits.** Dispatches are tiled to 100 ms or less (Windows TDR resets at 2 s); storage bindings stay at 128 MiB or less and VRAM use at 60% or less. On battery or thermal pressure the pool halves, the GPU uses `low-power`, batch GPU jobs wait, and the job status tells the agent.

## 7. Step ladder

| Step | Ships (headline) | Kaizen metric | Effort (FW) |
|---|---|---|---|
| S0 Line and gauge | Standard work, contracts v0, o3dj-bench v0, `doctor --bench` | Bench JSON from at least 10 machines covering all six OS/arch targets and at least 3 GPU vendors | 1-2 |
| S1 Agent Preview: every design is an assembly | `npx -y open3dj mcp`, five tools, DSL core, sandbox, multi-part reports and exports | pass^3 on bench v0 with Claude Code at least 70% | 3-5 |
| S2 Trust | FDM gates, five-state refs, fit table, worker pool, best-of-N, replay | Error recovery within 2 further calls at least 80% | 3-5 |
| S3 Human approval, BOM and ID-0 | GPU viewer and approval page, fastened mates, DOF, BOM, exploded views, brief to print | First-print fit rate at least 80% on 10 volunteer prints | 3-5 |
| S4 Mechanisms | Tree joints, named DOF, motion samples, swept clash, ISO library | pass^3 at least 70% on 10 mechanism briefs | 3-4 |
| S5 GPU analysis and scheduler | Accelerator pack, analysis maps, lattices, cloud router, 3dj provider | Analysis pass at least 3x faster with `auto` on volunteer GPUs, zero verdict differences | 3-5 |
| S6 Concept to massing (ID-1) | Python GPU sidecar, concept boards, TRELLIS v1 clean runner | Median hours from approved brief to approved direction, halved from the S6 baseline | 3-5 |
| S7 Form, CMF and moulding DFM (ID-2, ID-3) | Continuity table, surfacing ops, CMF file, `im.<resin>.v1` gates | Share of seeded DFM defects the agent fixes without help, at least 70% | 5-8 |
| S8 Engineering and handoff (ID-4, ID-5) | Loop solver, tolerance stacks, CalculiX, drawings, AP242, RFQ pack | Supplier clarification questions per RFQ, falling each cycle | 5-8 |

S0 to S4 deliver the agent core with mechanisms in **13 to 21 FW**. The full ladder to RFQ is **29 to 47 FW**.

### S0: Line and gauge (1-2 FW)

**Ships:**

- **Standard work.** AGENTS.md (under 200 lines) and AI_POLICY.md: an `Assisted-by` trailer, human-only DCO sign-off, and no agent PR without a human pressing the button.
- **Hooks and CI.** About ten hooks, including a Stop hook running a one-command check in under 10 minutes; CI on ubuntu, macOS, Windows x64 and `windows-11-arm`.
- **Contracts and bench.** The contract schemas (v0), plus o3dj-bench v0: 20 starter tasks and 10 multi-part enclosure briefs.
- **`npx open3dj doctor --bench`.** It reports the DeviceInventory, kernel micro-benchmarks, worker scaling and an optional WebGPU probe. Volunteers run it and attach the JSON to an issue.

**Why first:** the spikes the sandbox blocked (worker scaling, real-GPU gains, Windows ARM64) get measured on real machines before anything is designed around guesses.

### S1: Agent Preview (3-5 FW)

**Ships:**

- **Install.** `npx -y open3dj mcp`, the five tools and the QuickJS sandbox. The kernel runs in a worker, because its STEP writer prints to stdout, which would corrupt MCP stdio.
- **DSL v1 core:** `Param`, primitives, sketches, booleans with batched cutters (`fuseAll` took 0.7 s where 200 sequential fuses took 17.5 s), fillet and chamfer by edge query, shell, patterns, named descriptor returns, and `connector`, `matchTo`, `attachTo`, `withReferences` as placements.
- **The assembly graph:** definitions, occurrences and sub-assemblies.
- **GeometryReport per definition and for the whole assembly:** validity, volume, bbox, mass, centre of mass, counts, overlap warnings.
- **Output.** HLR renders; multi-part STEP, 3MF and glTF, plus STL; SKILL.md and the plugin.
- **Client matrix:** Claude Code (default and `legacy`), Codex at 2025-06-18, Gemini CLI, Cursor and VS Code.

The enclosure tasks make ID-0 the dogfood product from day one.

### S2: Trust (3-5 FW)

**Ships:**

- **FDM gates** per printable definition (watertight, 0.8 mm wall, 45 degree overhang, 220 x 220 x 250 mm bed), with waivers recorded.
- **Five-state references,** built on occt-wasm history-tracking ops plus a geometric fingerprint.
- **The tiered fit table.**
- **The worker pool,** with interactive and batch lanes, `candidates[]` (best-of-N) and `sweep`.
- **Jobs and replay.** The job model, provenance and `open3dj replay`.
- **The export-gate hook.**

**Red andons:**

- an invalid output labelled valid;
- a silent mis-resolution in a 1,000-edit sweep.

### S3: Human approval, BOM and ID-0 (3-5 FW)

**Ships:**

- **A local page,** nonce-protected and served by the daemon: a three.js viewer (GPU, WebGL2 floor, `InstancedMesh` per definition, overhang and draft heat maps) and an approvals panel.
- **Approval objects** for human-only waivers, quotes and egress. Every client receives them as `approval_pending{url, id}`; clients that support it also get a URL elicitation.
- **A spike: WebAuthn user verification on `localhost`.** Chromium treats `localhost` as a secure origin, and a shell-capable agent cannot pass a platform-authenticator gesture.
- **Assembly additions.** Persisted fastened mates, a DOF report naming unmated occurrences, a CSV BOM and exploded HLR views.
- **ID-0 tooling:** `brief.o3j.yaml`, a free print estimate from an OrcaSlicer subprocess (AGPL, never linked), and 3dj quotes once 3dj accepts an upload and an evidence hash.

**Agent pull:** agents stall at every waiver and quote until a human can see and approve.

### S4: Mechanisms (3-4 FW)

**Ships:**

- **Tree joints** (revolute, slider, cylindrical, planar), with limits bound to Params.
- **Named DOF,** for example "rotation about Z of `lid_hinge`".
- **Motion.** Motion-sample renders, and a swept clash check in the batch lane.
- **Replicate** onto matching connectors.
- **An ISO fastener and insert library** with BOM fields, checked by a KiCad-style Library Convention checker.
- **An own glTF writer,** with optional `EXT_mesh_gpu_instancing`.

**Gate:** every seeded mate fault is named.

### S5: GPU analysis and scheduler (3-5 FW)

**Ships:**

- **The optional `@open3dj/accel-webgpu` pack:** WGSL thickness and clearance ray casts and SDF and lattice previews, each with a CPU twin.
- **A lattice op** meshed on the CPU through Manifold LevelSet; analysis heat maps in `inspect`; placement profiles.
- **Provider router v1** with licence manifests and budget approvals, and the 3dj.app provider through its MCP server.

**Agent pull:** analysis latency on assemblies, and lattice lightweighting for DfAM.

### S6: Concept to massing, ID-1 (3-5 FW)

**Ships:**

- **A `uvx` Python GPU sidecar** sharing its job spec with cloud providers.
- **Concept boards** from FLUX.1 [schnell] or Qwen-Image (Apache-2.0), recording prompt, model, licence and seed.
- **TRELLIS v1 massing,** geometry-only via a clean runner, on local CUDA or in the cloud on Apple, AMD and Qualcomm machines. Restricted packs (TripoSG, TRELLIS.2, Hunyuan3D) are opt-in with licence manifests.
- **Rebuild.** The agent rebuilds the chosen massing as an editable assembly labelled "assumed" and reports the Hausdorff distance. A human picks the direction.

### S7: Form, CMF and moulding DFM, ID-2 and ID-3 (5-8 FW)

**Ships:**

- **Surfacing ops.** `MakeFilling` (G1/G2) and Gordon surfaces, accepted only after an `IsApproximate` and `G2Error` check.
- **A continuity table:** G0 gap, G1 angle and G2 jump per shared edge, plus curvature ranges per face.
- **Zebra and curvature renders.**
- **A `draft` op** for planar, cylindrical and conical faces.
- **CMF.** `cmf.o3j.json` (sRGB or Lab colour, resin, finish, texture depth), with glTF `KHR_materials_variants` and an optional Cycles provider.
- **The `im.<resin>.v1` gate profile,** from cited public rules. Given a pull direction it checks draft per face, a wall-thickness map, rib and boss ratios, undercuts (ray casting), parting-line candidates (HLR silhouettes) and sink risk.
- **A golden corpus** of about 30 parts with seeded defects.

**Red andon:** any false pass on the golden corpus.

### S8: Engineering and handoff, ID-4 and ID-5 (5-8 FW)

**Ships:**

- **A Levenberg-Marquardt loop solver** with rank-based DOF, conflict naming and branch-change warnings.
- **Tolerance stacks,** worst-case and RSS. The user enters ISO 20457 class names.
- **CalculiX** as a GPL subprocess, labelled "simulation, not test".
- **HLR drawings** showing critical dimensions only.
- **AP242,** through a contributed occt-wasm facade option.
- **An RFQ pack** (STEP, drawing, CMF, BOM, Evidence Pack, open questions) and a quote comparison.

Humans send every RFQ and place every order.

**Gates:**

- a four-bar linkage reports mobility 1;
- a seeded conflicting mate is named;
- FEA lands within 2% of analytic results.

## 8. Industrial design pipeline as slices

| Slice | Step | Human approves |
|---|---|---|
| ID-0 Brief to printed prototype | Dogfooded from S1, formal in S3 | Brief, design, quote acceptance |
| ID-1 Concept board and massing | S6 | Direction |
| ID-2 Form and CMF | S7 | Form and CMF |
| ID-3 Moulding-ready DFM | S7 | Waivers |
| ID-4 Engineering detail and validation | S8 | Tolerance scheme, simulation reading |
| ID-5 Drawings, AP242 and RFQ | S8 | Every RFQ and order |
| ID-6 Class-A, Moldflow interop for licence holders, QIF first-article, tooling liaison | Volunteer research lane, no dates | All |

The first product family is small electronics enclosures and handhelds: assemblies of enclosure halves, PCB, buttons and fasteners, so ID work is assembly work from the first release. Licence rules: numeric colour and no Pantone libraries; no SMPL-X bodies; GPL and AGPL tools (CalculiX, Elmer, Blender, slicers) only as subprocesses; standards cited by number only; drop tests stay physical, since OpenRadioss is being wound down.

## 9. Pull board: deferred until a trigger fires

| Item | Trigger |
|---|---|
| Large-assembly mode: BatchedMesh, LOD, graphics-only, lazy load, GPU broad-phase | A real project above 1,000 occurrences, or the viewer misses its frame-time gate on the reference laptop |
| In-context and top-down design (snapshots pinned to a revision) | 3 or more cross-part dimension-copy errors a month in transcripts |
| Kinematic studies beyond samples: trajectories, IK, URDF/MJCF, MuJoCo | A mechanism or robotics project needs them |
| GPU simulation: Warp FEM, MuJoCo Warp, PETSc | CalculiX p95 over budget on real ID-4 studies |
| OndselSolver as a WASM module | The LM tier fails on real assemblies, or gear and screw relations are requested. The native build needs human approval |
| Python and OpenSCAD tiers | The section 3 ablation, or user requests. 3dj's OpenSCAD compiler serves as a provider meanwhile |
| Desktop shell, installers, auto-update, signing | Measured user pull |
| MCP App viewer, SEP-2663 Tasks | Two or more major clients support them by default |
| TypeScript and Python SDKs | An external integrator asks |
| Branches and per-op proposal review | Multi-agent parallel editing in real use |
| Web playground and share links | Replay determinism holds across OSes |

## 10. Cut list

Cut or deferred from PLAN.md and ARCHITECTURE.md:

- **Funding:** salaries, burn, grants for salaries, hiring, the 68-week schedule.
- **Day-one Rust daemon on rmcp and native OCCT build:** now swap triggers.
- **16 tools:** cut to 5. Generated TypeScript and Python SDKs and REST parity: only the CLI remains.
- **First-release scope:** the three-layer OS sandbox; Tauri desktop, installers, auto-update, winget, Homebrew and signed binaries.
- **Editing machinery:** branches, per-op proposals, the traced feature-tree membrane, "explode to native ops".
- **Preview extras:** Python and OpenSCAD tiers, web playground, constraint sketcher, scan-to-CAD, texturing packs.
- **Release gates on CADGenBench and adoption numbers:** kept as tracked evals.
- **Data upload:** telemetry and crash upload (crash data stays local).
- **Unsafe defaults:** TripoSG as a default, any GPU kernel without a CPU twin, any reliance on OpenRadioss.

## 11. Operating model (Kaizen)

**Review is the constraint.** Founder review attention is the system constraint, so:

- the Review column is capped at 3 agent PRs;
- PRs stay under about 400 changed lines with one concern each;
- agents are dispatched only when review capacity frees up;
- agents never merge.

**Weekly loop (6 to 8 founder hours):**

| When | What happens |
|---|---|
| Daily | Andon check and two review windows |
| Nightly | Agent evals and a triage digest |
| Monday | Plan |
| Wednesday | Gemba hour: read 10 transcripts and watch one real user |
| Friday | Scorecard, one A3, standard-work update, weekly release and a credited build log |
| Monthly | Kaizen event |

**Andons.** A red andon stops new merges: main red, regression suite below 100%, any false pass, licence contamination, a security failure, or a broken tier-1 install. A yellow andon fires on a capability drop over 3 points across 3 runs, or a review item older than 5 days. Response: revert first, then a regression test, a 5-whys note and a standard-work change.

**Respect for people.** Reviews are blameless: an agent error is a missing check or missing context. The response teaches rather than punishes, and an `experiment` lane lets people explore unusual ideas without having to merge. Volunteers never have deadlines.

**On-ramps are executable:** failure reports that become eval tasks, print-and-measure for ID-0, `lib` parts under the Library Convention checker, benchmark tasks, DFM, CMF and brief reviews, and a librarian ladder. Contributors are credited through All Contributors.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Single-maintainer kernel and library | Pin, mirror, reproducible build, vendored `KernelAdapter`, DSL as the only public API |
| The JS DSL has less pretraining data than Python CAD | SKILL.md examples, the `docs` tool, and the ablation trigger for the Python tier |
| WASM heap growth and the 4 GiB cap | Worker recycling, soak tests, swap triggers |
| GPU nondeterminism | "GPU screens, CPU decides" and the CPU-twin merge rule |
| Local approval spoofing by an agent with shell access | Approvals owned by the daemon, the WebAuthn step-up spike, documented residual risk |
| Rule-based DFM gives false confidence | "Rules, not simulation" labels, human approval, red andon on any false pass |
| Licence contamination | A four-layer licence gate, model-pack manifests, GPL only as subprocesses |
| Founder overload | WIP caps, small batches and hooks. The plan bends, not the person |

## 13. Founder decisions

1. **Name.** OPEN3D is a live US mark (Reg. 6468139), one letter from OPEN3DJ. Decide before the npm listing at S1. A free alternative is a name built on the 3DJ house mark.
2. **3dj.app upload and hash.** Add a presigned upload tool and an evidence-hash field to `request_print_quote`. This is the cheapest unblocker for ID-0 quotes.
3. **Review cap.** Confirm the starting review WIP cap of 3.
4. **Apple fee.** Pay the $99 only when a macOS GUI is pulled.

## Sources

- Research folder (28 Oct 2026): lean-stack.md, assemblies.md, compute-cpu-gpu.md, industrial-design.md, kaizen-ops.md, spike-occt-wasm.md, spike-assemblies.md, gap-2 to gap-9, PLAN.md, proposal-agent-first.md.
- MCP TypeScript SDK v2: https://www.npmjs.com/package/@modelcontextprotocol/server ; https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
- occt-wasm: https://github.com/andymai/occt-wasm ; brepjs: https://www.npmjs.com/package/brepjs
- quickjs-emscripten: https://www.npmjs.com/package/quickjs-emscripten ; Node permissions: https://nodejs.org/api/permissions.html
- CADSmith: https://arxiv.org/html/2603.26512 ; CADGenBench: https://github.com/huggingface/cadgenbench
- METR: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://metr.org/blog/2026-02-24-uplift-update/
- WebAuthn origins on localhost (Chromium): https://chromium.googlesource.com/chromium/src/+/main/content/browser/webauth/origins.md
- WGSL floating point: https://www.w3.org/TR/WGSL/#floating-point-evaluation ; Dawn for Node: https://www.npmjs.com/package/webgpu
- Windows TDR: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys
- three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh ; Manifold: https://github.com/elalish/manifold
- glTF instancing: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md ; 3MF Core: https://github.com/3MFConsortium/spec_core
- Onshape mate connectors: https://www.onshape.com/en/blog/build-assemblies-faster-mate-connectors ; OndselSolver: https://github.com/FreeCAD/OndselSolver
- OCCT MakeFilling and Gordon: https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_filling.html ; https://occt3d.com/dev/doc/refman/html/class_geom_fill___gordon.html
- Protolabs moulding rules: https://www.protolabs.com/resources/design-tips/injection-molding-basics/
- FLUX.1 schnell: https://huggingface.co/black-forest-labs/FLUX.1-schnell ; Qwen-Image: https://huggingface.co/Qwen/Qwen-Image
- GitHub runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners ; Claude Code GitHub Actions: https://code.claude.com/docs/en/github-actions
- Microsoft signing options: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options ; Apple: https://developer.apple.com/programs/enroll/
- OPEN3D registration: https://tsdr.uspto.gov/statusview/sn90330051
