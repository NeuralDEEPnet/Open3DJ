# Open3DJ lean plan: industrial pipeline first

Written 28 Oct 2026 for the founder of Neural Deep Network LTD. The founder's constraints:

- no paid staff;
- small, usable releases, improved with Kaizen;
- an industrial design pipeline;
- assembly-first design;
- calculation on both CPU and GPU.

The plan builds on lean-stack.md, industrial-design.md, kaizen-ops.md, assemblies.md, compute-cpu-gpu.md and gap-1 to gap-9 in this folder. It keeps only the parts of PLAN.md and ARCHITECTURE.md that earn their place. "Open3DJ" is a working name until counsel has reviewed it against the live OPEN3D mark (gap-5).

## 1. Thesis

Open3DJ should earn its place the way a production line does: carry one real product from brief to a part in the hand, then remove the biggest delay, and repeat.

The first two releases are a walking skeleton of the whole industrial design pipeline for one product family: small electronics enclosures and handheld products. The skeleton covers:

1. a structured brief;
2. a multi-part assembly built by an agent;
3. evidence gates;
4. print files;
5. a quote or estimate;
6. the measured prototype, fed back into the project.

From then on, the founder runs paying client work through Open3DJ. Each project records its own value stream: time per stage, rework loops, and defects that escaped to the prototype. Each later step deepens the stage that this data shows is the bottleneck.

Agents prepare, measure and draft. Humans approve taste, money and anything that leaves the machine. The geometry of record is computed on a deterministic CPU kernel. GPUs make it faster to see, screen and generate designs, but they never make the final decision.

## 2. Principles

1. **One product family first.** The 3dj starters already cover enclosures (project box, vented enclosure, snap fits, heat-set bosses), and public ABS and PC moulding rules apply to them.
2. **Every design is an assembly.** A single part is a root assembly with one occurrence. No file, tool or report has a part-only mode.
3. **Derive, do not store.** BOM, degrees of freedom (DOF), clash tables, the stage board and value-stream metrics are computed from the project files and the approvals ledger.
4. **GPU screens, CPU decides.** Gate verdicts, GeometryReport numbers and exports come from the CPU kernel.
5. **Humans approve through the daemon.** Approvals are daemon-owned objects, resolved on a local page. MCP elicitation is not used, because an elicitation "accept" can come from a hook (gap-6).
6. **One Kaizen metric per step,** measured on real use.

## 3. Starting stack and how it grows

Start TypeScript-first, as lean-stack.md recommends after measuring the options:

- one npm package, run with `npx -y open3dj mcp`;
- zero native builds;
- $0 until a signed desktop binary ships.

| Layer | Choice (exact pins) | Reason |
|---|---|---|
| MCP | `@modelcontextprotocol/server` 2.4.0 `serveStdio`, dual-era | Claude Code at 2026-07-28; Codex and Gemini CLI at 2025-06-18 |
| Kernel | brepjs 20.11.1 on occt-wasm 5.8.1 (OCCT 8.0.1), behind a vendored `KernelAdapter` | 1.2x to 2.1x slower than native, but a failed fillet names its faulty edges instead of crashing. XCAF, hidden-line drawings and `draft` are exposed |
| Language | Open3DJ DSL v1, a facade over the ~150-entry 3dj dslReference, with tolerance-based conformance on the 18 public starters | Keeps `connector.male/female`, `matchTo`, `attachTo`, `withReferences` and named descriptor returns. brepjs is never public API |
| Sandbox | QuickJS-WASM (quickjs-emscripten 0.32.0) in a short-lived worker under `node --permission`, plus a parent wall-clock kill | Spike: no host access, loops interrupted, about 1% overhead |
| CPU compute | Worker pool (piscina 5.3.2), one kernel per worker; systeminformation 5.33.16 | occt-wasm is deliberately single-threaded, so results reproduce |
| Mesh and analysis | manifold-3d 3.5.4, three-mesh-bvh 0.9.16 | CPU reference for clash, thickness and ray casts |
| Viewer | three 0.186.1 `WebGPURenderer` with a WebGL2 floor, served by the daemon | GPU display everywhere |
| 3MF | `@3mfconsortium/lib3mf` 2.5.0-fix.2 (BSD-2-Clause, WASM) | Components and build items with part numbers |
| Optional | `@open3dj/accel-webgpu` (Dawn `webgpu` 0.6.2, 137 MB, installed on demand); a Python GPU sidecar run through `uvx` | GPU analysis and generative models without bloating the core |
| Subprocesses | OrcaSlicer or PrusaSlicer CLI (AGPL), Cycles (Apache-2.0), CalculiX (GPL-2.0) | Never linked into the process |

**Five contracts are fixed.** Everything behind them can be swapped:

1. MCP tool and report schemas;
2. DSL v1 and its conformance suite;
3. `KernelAdapter`;
4. the `.o3j` project format, covering the assembly graph, scripts, brief, CMF, provenance and replay;
5. the compute contract: job spec, DeviceInventory, and the `backend` and `device` fields on results.

**Swaps happen only when a measured trigger fires:**

| Trigger | Swap |
|---|---|
| A real part exceeds 4 GiB, or p95 `run` time exceeds 2 s | First a memory64 build of occt-wasm. Then the same occt-wasm C++ facade compiled natively as an N-API addon behind the same adapter |
| A Rust host is wanted | The occt-wasm crate runs the same kernel under wasmtime |
| Untrusted scripts arrive at scale, or a remote mode is needed | An OS sandbox around the unchanged worker protocol |
| Users ask for an installer | Electron 45 or Tauri 2.12 around the same web UI; signing costs start here |
| o3dj-bench favours Python scripts | An optional build123d 0.13.0 `uvx` tier (no Windows ARM64) |

## 4. The agent contract we keep

The old plan had 16 tools. This plan has five, and new capability arrives as new fields on them. Adding a tool needs an A3 showing that a field cannot do the job. Everything works over plain `tools/list` and `tools/call`.

| Tool | What it does | Later additions |
|---|---|---|
| `run` | Applies a change against `base_rev`: a script or patch, an assembly graph patch, or a brief or CMF patch. Returns the GeometryReport and a new `rev` | Mates (Step 3), surfaces (Step 5), draft (Step 6) |
| `inspect` | Tree, part and assembly reports, measures, references, gates, assertions, devices, the value-stream record | BOM, DOF, clashes (Step 3); continuity (Step 5); DFM maps (Step 6) |
| `render` | Deterministic CPU hidden-line multiview PNG/SVG, sections, highlights | Exploded (Step 3), CMF photoreal (Step 5), motion (Step 8) |
| `export` | STEP, 3MF, glTF, STL, Evidence Pack, and anything leaving the machine | Quotes (Step 2); drawings, AP242 and RFQ pack (Step 7) |
| `job` | Long jobs and approvals: get, cancel, list (Step 2) | |

**What we keep from the earlier plan:**

- A GeometryReport after every change, for the changed definitions and the whole assembly (about 300 tokens concise, with `next` hints).
- Five-state references (exact, re-resolved, disambiguated, ambiguous with candidates, broken) on named references and connectors, never silently re-attached.
- Evidence Pack gates with recorded waivers. Agents may waive only agent-waivable gates, with a reason; other waivers need a human.
- Structured errors; deterministic CPU renders that double as CI goldens (135 ms, byte-identical).
- Daemon-owned approvals with a payload hash; our own job model keyed by revision.
- Provenance and replay: hash-identical on one platform, tolerance-based across platforms.
- A licence-aware provider router with 3dj.app as one provider; SKILL.md and a Claude Code plugin; o3dj-bench grown from real failures; MIT OR Apache-2.0 with DCO.

A concise assembly report looks like this:

```json
{"status":"ok","rev":"r_0193..","assembly":{"occurrences":9,"definitions":5,"mass_g":61.4},
 "parts":[{"def":"base","valid":true,"gates":{"fail":[{"gate":"min_wall","value":0.7,"limit":0.8,"at":"@elem:op_4:side:2"}]}}],
 "clashes":[{"a":"lid#1","b":"screw#3","kind":"clash","volume_mm3":14.7,"confidence":"measured"}],
 "refs":[{"name":"pcb_seat","state":"exact"}],"compute":{"backend":"occt-wasm","device":"cpu x4"},
 "next":["render highlight=[lid#1,screw#3]"]}
```

## 5. Assembly data model

A project is a git-friendly folder:

- `brief.o3j.yaml`
- `assembly.o3j.json`
- `parts/*.o3j.js`
- `cmf.o3j.json` (from Step 5)
- `evidence/`, `exports/`, `prototypes/`, `rfq/`
- `approvals/`
- `provenance.jsonl`

**Definitions.** A definition is a part script, a sub-assembly, or a library standard part, together with its configuration parameters.
- Each unique configuration counts as its own definition for the BOM and for caching.
- Mirrored parts are separate, handed definitions.

**Occurrences.** An occurrence has:
- a UUIDv7 id and a name;
- a definition and its configuration;
- a transform stored as translation plus quaternion (Euler angles are used only at the occt-wasm boundary);
- a suppressed flag, a BOM flag and a colour override.

Occurrences are addressed by path, for example `enclosure/pcb_assy/standoff#2`.

**Connectors.** A connector is a frame on a definition, anchored to a named reference and carrying 3dj gender and type tags. It inherits the five-state report.

**Mates (from Step 3).** A mate binds two connectors. It records a type, an offset, limits, a value bound to a `Param`, and a state.

**Derived data.** BOM, DOF, the clash, contact and clearance table, mass, centre of gravity and the stage board are always derived.

**3dj mapping.**
- Descriptor returns `[{name, shape, color}]` become definitions plus occurrences.
- Identical clones become one shared definition, recovered from clone provenance or a geometry hash and labelled "inferred".
- `matchTo` is solved once and recorded as a fastened mate.
- `withReferences` and `attachTo` become named references and placements.

**Exports, written per definition.**
- XCAF STEP AP214, with names on both the definition and instance labels and a pure assembly root. AP242 needs an occt-wasm facade contribution in Step 7.
- 3MF components and build items carrying `partnumber`.
- glTF with one mesh per definition, optionally using `EXT_mesh_gpu_instancing`.
- STL per definition.

**Staging.**

| Step | Assembly capability |
|---|---|
| 1 | Definitions, occurrences, sub-assemblies, connectors, `matchTo` as fastened. Per-part and whole-assembly reports. Clash, contact and clearance from a bounding-box filter plus exact OCCT. Multi-part STEP, 3MF, glTF and STL |
| 2 | Viewer tree and selection; one `InstancedMesh` per definition |
| 3 | Fastened, revolute, slider and cylindrical mates in closed form for trees, with limits as Params. Named-DOF report. Conflicting mates reported, never ignored. Manifold mesh clash tier, BOM, exploded views, ISO fastener library |
| 8 | Levenberg-Marquardt tier with DOF = 6n − rank(J) for loops. More mate types, branch keeping, motion samples, swept clash, URDF and MJCF |
| Later | Large-assembly mode (BatchedMesh, LOD, graphics-only, 10,000-occurrence gate). In-context references pinned to a revision and updated with a diff. OndselSolver WASM spike |

**brepjs.** We reuse its instancing, joint maths, forward and inverse kinematics, and URDF export. We never use its mate solver or `mechanismDOF` for reports. Measured: it ignored a conflicting mate, and it reported 4 DOF for a four-bar linkage whose mobility is 1. Both cases become regression tests in Step 3.

## 6. Compute-device layer (CPU and GPU)

This layer is built in Step 1, while only CPU devices exist, so that adding GPUs later needs no rewrite.

**Job spec.** Every heavy operation is a job of a registered kind. Each kind declares:
- its placements (`cpu`, `gpu-local`, `gpu-cloud`) and the implementation for each;
- `determinism`: record or preview;
- `privacy`: local-only, cloud-anonymous or cloud-full;
- a deadline, a budget and an estimator.

A kind without a CPU placement must say why and name its fallback.

**Discovery.** `open3dj doctor` records a DeviceInventory in provenance and in the Evidence Pack: cores and RAM; GPU vendor, model and VRAM (systeminformation); WebGPU adapter limits once the accelerator pack is installed (WebGPU hides VRAM); CUDA, MPS, ROCm and XPU from the sidecar; and power state. Volunteers attach `doctor --bench` JSON to issues, which gives real GPU numbers for free.

**Placement (one line of standard work).** Filter by capability, licence and privacy. Drop any device whose memory estimate exceeds 70% of its budget. Pick the lowest estimated time from that device's run history. Break ties on cost, then local before cloud.
- A prediction more than 2x off is logged as a defect.
- Cloud spend or data egress always needs an approval, and the budget lives in the daemon.

**CPU pool.**
- One occt-wasm kernel per `worker_thread`, sized at min(cores - 1, free RAM / 400 MB).
- An interactive lane with one reserved worker, and a batch lane for variants, clash pairs, analysis and export.
- Workers are recycled at a 1.5 GiB heap or on any kernel error.
- Assemblies parallelise naturally, because definitions build independently.

| Workload | CPU (reference) | Local GPU | Cloud GPU | Step |
|---|---|---|---|---|
| B-rep build, booleans, STEP, hidden-line snapshots | occt-wasm workers | None | None | 1 |
| Clash and clearance | Exact OCCT; Manifold mesh | WebGPU broad-phase (later) | None | 1, 3 |
| Display; zebra, curvature and draft shading | Hidden-line images | three.js WebGPU, WebGL2 floor | None | 2, 5 |
| Thickness, draft, overhang and undercut maps | three-mesh-bvh in workers | WGSL accelerator pack | None | 5, 6 |
| Photoreal and CMF renders | Cycles CPU | Cycles CUDA, OptiX, HIP, Metal, oneAPI | Provider | 5 |
| Concept images (FLUX.1 schnell, Qwen-Image) | Slow and memory-heavy | Python sidecar | 3dj.app, user key | 4 |
| Image to massing (TRELLIS v1) | None (CUDA-only) | Sidecar on NVIDIA | 3dj.app, Modal, RunPod | 4 |
| Motion sweeps | Pool over poses | WebGPU batch | MuJoCo Warp, NVIDIA Warp | 8 |
| FEA | CalculiX subprocess | Warp FEM, PETSc (later) | Provider | 8, later |
| Implicit fields and lattices | Manifold LevelSet (record) | WGSL preview | Provider | Later |

**Rules.**
- **Labels.** Exact CPU values are "measured"; GPU or mesh values are "observed".
- **Guard band.** A GPU value near a gate threshold is confirmed on the CPU before any verdict, for example 0.8 mm plus or minus 2 voxels, or 45 degrees plus or minus 1. The spike saw 3 of 16.8 million voxels flip between inside and outside.
- **Merging a WGSL kernel** needs a CPU twin, a fixed-seed tolerance test, a lavapipe CI job, and a measured gain of at least 3x on a volunteer's real GPU.
- **On device loss, out-of-memory or a Windows TDR reset,** the job re-queues on the CPU twin.
- **Dispatches** are tiled under about 100 ms and within the 128 MiB binding limit. VRAM use is capped at 60%.
- **On battery,** the pool halves and batch GPU jobs are deferred, and the agent is told.
- **Honest exception.** For 12B to 20B image models and TRELLIS, the "CPU fallback" is a cloud placement with approval, or a structured refusal.
- **Agent control.** `run`, `inspect` and `render` accept `compute: auto|cpu|gpu`. Results carry `backend`, `device` and `placement_reason`.

## 7. The steps

The effort estimates assume agents write most of the code and tests, while the founder specifies, reviews and tests with real parts. Evidence on AI speed-up is mixed: METR measured experienced developers 19% slower in 2025. So each Friday compares estimate with actual, and the next step is re-planned.

| Step | Release | Kaizen metric | Founder-weeks |
|---|---|---|---|
| 0 | Go and see | Baseline lead time from brief to prototype, per stage, on 3dj.app | 1 to 2 |
| 1 | Enclosure in a box | Agent first-pass rate: share of real briefs reaching a gate-passing, clash-free assembly with no human script edits | 4 to 7 |
| 2 | Prototype loop | First-print fit rate (at least 80% over 10 prints) | 3 to 5 |
| 3 | Assembly engineering | Assembly escapes per prototype (target 0 over 10) | 3 to 5 |
| 4 | Concept front end | Hours from approved brief to approved direction | 3 to 6 |
| 5 | Form, CMF and visuals | Client review rounds to appearance sign-off | 4 to 7 |
| 6 | Moulding-ready | DFM escapes: issues a moulder or supplier tool finds that the profile missed | 4 to 8 |
| 7 | Handoff and RFQ | Supplier clarification questions per RFQ | 3 to 6 |
| 8 | Mechanisms and validation | Share of validation benchmarks within 2% of analytic results | 5 to 9 |

**Total effort.** 30 to 55 founder-weeks. Steps 0 to 2, which reach a measured prototype, take 8 to 14. From Step 1 onwards, client work is dogfooding.

**Order of Steps 4 to 8.** This is a default. After Step 3, the next step deepens the stage with the longest lead time or the most rework across the last four client projects. For example, if clients move to moulding quickly, Step 6 comes before Step 4.

**Step 0, Go and see.** The usable release is an ID-0 playbook for 3dj.app's MCP today (a draft SKILL.md) plus a baseline value-stream record from two or three real client briefs. It also covers:
- standard work: `AGENTS.md`, `AI_POLICY.md`, DCO, an `andon` label, branch protection, hooks, and free CI on ubuntu, macOS, Windows x64 and `windows-11-arm`;
- reproduced spikes: QuickJS worker, DSL facade on three multi-part starters, dual-era MCP against three clients, and `occt-pool.mjs` scaling on a volunteer machine with 8 or more cores;
- 20 regression tasks, and a question to counsel about the name.

In parallel, the founder adds a presigned upload tool and an evidence-hash field to 3dj's `request_print_quote`.

**Step 1, Enclosure in a box.** `npx -y open3dj mcp` with four tools, DSL v1 in QuickJS, and `brief.o3j.yaml` with executable assertions (for example "PCB 60 x 40 mm seats with at least 0.3 mm clearance") and a clarify pass. It also ships:
- the section 5 assembly graph with per-part and whole-assembly reports, and clash, contact and clearance;
- FDM v1 gates: watertight, 0.8 mm wall, 45 degree overhang, 220 x 220 x 250 mm bed;
- hidden-line renders; STEP, 3MF, glTF and STL named at both levels; the Evidence Pack with hashes;
- the CPU pool, `doctor`, the job registry and SKILL.md v1.

Exit checks:
- the nine multi-part starters round-trip;
- one real client enclosure (base, lid, PCB, four screws, four inserts, button) goes from brief to gate-passing print files;
- CI is green on four operating systems.

**Step 2, Prototype loop.** It ships:
- a local web UI served by the daemon: GPU viewer, tree, gate overlays and picking;
- a nonce approval page for the brief, the design freeze, quotes, human-only waivers and egress;
- `job` and replay.

`export` gains quotes. A local slicer estimate comes from a subprocess, priced by a user table. A 3dj.app operator quote becomes available once the upload tool exists; until then it covers only models made on 3dj.app, with hashes in `notes`. The daemon accepts a quote only after a human approves, and it never orders.

A prototype record stores photos, calliper readings labelled "measured" and the fit outcome. A failed fit drafts an eval task and a 5-whys stub. Step 2 also ships the Claude Code plugin and an MCP Registry entry. The Agent Preview is announced only if the name is cleared.

**Step 3, Assembly engineering.** It ships:
- tree-tier mates with named DOF and conflict reports;
- tiered clash checks: bounding box, then Manifold "observed", then exact "measured". Mated contacts are exempt and press fits are declared;
- clash pairs spread across the batch lane;
- BOM CSV, flat and structured;
- exploded views;
- an ISO fastener and insert library under a Library Convention with a checker, which is the first volunteer on-ramp.

**Step 4, Concept front end (ID-1).** It ships:
- a provider router that shows licence manifests before any download;
- a Python GPU sidecar with FLUX.1 schnell and Qwen-Image (both Apache-2.0). KeyShot 2026.1 made the same move from FLUX to Qwen;
- TRELLIS v1 geometry-only through a clean runner;
- cloud placements on the 3dj.app fleet, or Modal and RunPod under the user's key;
- a concept board recording prompt, model, licence and seed, labelled "concept, not geometry".

A human picks the direction. The agent rebuilds the massing as DSL labelled "assumed" and reports the Hausdorff distance to the original.

**Step 5, Form, CMF and visuals (ID-2).** It ships:
- lofts and sweeps with continuity;
- `MakeFilling` G1 and G2 (checking `G2Error`) and Gordon surfaces (checking `IsApproximate`), contributing facade gaps upstream;
- a CPU continuity table per shared edge (G0 gap, G1 angle, G2 curvature jump) and curvature ranges per face;
- zebra, curvature and draft shaders;
- `cmf.o3j.json`: sRGB or Lab colour, resin, finish class and texture depth, exported as glTF `KHR_materials_variants`;
- a Cycles render provider;
- the first accelerator kernel, a wall-thickness ray-cast map with its CPU twin.

**Step 6, Moulding-ready (ID-3).** Profiles `im.abs.v1`, `im.pc.v1`, `im.pp.v1` and `im.pa.v1`, built from cited public rules. Given a pull direction, they check:
- draft against depth and texture;
- the wall map against the resin range;
- ribs at 40 to 60% of the wall;
- boss rules;
- undercuts, by ray casting from the core and cavity sides;
- parting-line candidates from hidden-line silhouettes;
- sharp corners and sink risk.

The step also ships:
- a `draft` op, which flags freeform faces;
- a golden corpus of about 30 parts with seeded defects, where any false pass stops the line;
- GPU screening with CPU confirmation.

**Step 7, Handoff and RFQ (ID-5).** It ships:
- AP242 with semantic PMI for critical dimensions taken from the brief's assertions (via an occt-wasm contribution);
- human-approved SVG and PDF drawing sheets from hidden-line views, showing critical dimensions only. The user enters the tolerance class; ISO 20457 is cited by number only;
- an RFQ pack: STEP, drawing, CMF sheet, BOM, quantities, Evidence Pack and open questions;
- a quote comparison table.

Humans send and order.

**Step 8, Mechanisms and validation (ID-4).** It ships:
- the Levenberg-Marquardt tier, exiting when a four-bar reports mobility 1;
- motion sweeps on the pool;
- worst-case and RSS tolerance stacks;
- CalculiX and Elmer as CPU subprocesses, with mesh-convergence evidence and the label "simulation, not test";
- a physical drop-test protocol, because OpenRadioss is gone.

## 8. Industrial design slices

| Slice | Where | Agents | Humans |
|---|---|---|---|
| ID-0: brief to printed prototype | Step 0 on 3dj.app; Steps 1 and 2 | Brief, assembly, gates, files, estimate | Approve brief, freeze and quote; print and measure |
| ID-1: concept and massing | Step 4 | Variants, massing, rebuild | Choose the direction |
| ID-2: form, CMF, visualisation | Step 5 | Surfaces, continuity numbers, renders | Approve form and CMF |
| ID-3: moulding DFM | Step 6 | Gates, draft fixes, reasoned waivers | Approve waivers |
| ID-4: engineering and validation | Steps 3 and 8 | Mates, BOM, clashes, stacks, simulation set-up | Interpret results; drop-test |
| ID-5: handoff and RFQ | Step 7 | Drawings, PMI, RFQ pack, quote table | Send RFQs, choose, order |
| ID-6: tooling liaison and Class-A | Volunteer research track | DFM exchange, T1 measurements as QIF | Lead it |

Ergonomics (ANSUR II envelopes, with the dataset and population recorded) waits until a client project pulls for it.

## 9. Operating model

**Review capacity.** The founder's review capacity is the constraint. The rules that protect it:
- at most 3 agent PRs waiting for review;
- one concern per PR, under about 400 changed lines;
- agents are dispatched only when review frees up;
- two review windows a day.

**The weekly loop** takes about 6 to 8 founder hours:
- **daily:** an andon check;
- **Monday:** planning;
- **Wednesday:** gemba, meaning watch real use, read 10 agent transcripts, and handle a printed part;
- **Friday:** check and act, with the scorecard, one A3, standard-work updates, a weekly release and a credited build log;
- **monthly:** a kaizen event.

**Two value streams, one discipline.** The code line tracks PR lead time, first-pass CI, reverts and the regression suite. The client-product line tracks stage lead times, rework loops and escapes, which the product records from its approval and provenance timestamps. The client line picks the next step.

**Poka-yoke.** About ten Claude Code hooks: a Stop hook runs the one-command check in under 10 minutes, and PreToolUse hooks protect golden files, tolerance tables, the licence allowlist and secrets. Add a merge queue, an `Assisted-by` trailer with a human DCO sign-off, and `AGENTS.md` under 200 lines. Agents never merge.

**Andon.**
- **Red:** main red; regression below 100%; any false pass (gate, clash, or a silent reference mis-resolution); a verdict resting on GPU output alone; licence contamination; a security failure; a broken install.
- **Yellow:** a capability drop of more than 3 points over three runs, or the oldest review older than five days.
- **Response:** revert first. Close only with a regression test, a 5-whys and a standard-work change.

**Respect for people.**
- Pulling the andon is thanked, never punished.
- A defect means a missing check, not a person to blame.
- An `experiment` lane lets people explore without needing to merge.
- Volunteers have no deadlines and no on-call.

**Volunteer on-ramps** are executable: failure reports that become evals, print-and-measure, library parts, DFM rule reviews with citations, and GPU bench reports.

**Cash.**
- $0 for npm and CI.
- Filament or print orders.
- Optionally about $2 a month for a GPU smoke test.
- Apple's $99 a year, only when a macOS GUI ships.
- Windows signing free through Microsoft Store MSIX, or SignPath after the first release. Azure Artifact Signing (about $9.99 a month) only if the publisher must read Neural Deep Network LTD.

## 10. Cut or deferred

**Cut.**
- Funding, hiring and star targets.
- A Rust daemon and native OCCT at the start.
- 11 of the 16 tools.
- TypeScript and Python SDK parity.
- Per-operation proposal review. Git branches plus stage approvals replace it.

**Deferred.**
- The desktop shell, updater, signing, winget and Homebrew, until users pull for them.
- The OS sandbox, until its trigger fires.
- MCP Apps, Skills over MCP, Tasks and subscriptions.
- The Python tier, until the benchmark ablation.
- OpenSCAD input, mesh-to-CAD and reconstruction.
- CADGenBench, until after Step 3.
- Cross-platform bit-identical replay.
- Large-assembly mode, in-context design and OndselSolver.
- GPU simulation, implicit and lattice modelling, and GPU broad-phase.
- Ergonomics.

**Left to partners or research.** Class-A surfacing, moulding simulation, validated drop tests, mould design and certification.

**Never.**
- TripoSG or Hunyuan3D as a default; they are opt-in restricted packs only.
- SMPL-X and Pantone libraries.
- GPL or AGPL code inside the process.
- Automatic ordering.

## 11. Risks

| Risk | Countermeasure |
|---|---|
| Founder review bandwidth and burnout | WIP cap, a capped loop, client work as dogfooding |
| Single-maintainer occt-wasm and brepjs churn | Exact pins, mirrors, a reproducible build, and a weekly batch upgrade gated on conformance, at most 10% bench regression and a 10,000-op soak |
| Quoting gap on 3dj.app | Founder adds the upload tool and hash field; the local slicer estimate covers the gap meanwhile |
| 4 GiB WASM cap and heap leaks | Worker recycling, mesh-first large assemblies, the memory64 trigger |
| Real GPU gains and pool scaling unmeasured | Step 0 spike on volunteer hardware; the 3x merge rule |
| Big generative models lack a practical CPU path | Stated openly: cloud with approval, or refusal |
| A false DFM or clash pass reaches a client | Cited rules, seeded corpora, red andon, "rule check, not simulation" labels, human approvals |
| AP242 and freeform draft untested | Spikes before Steps 5 and 7; upstream contributions |
| Licence contamination | Manifests, an allowlist hook, GPL and AGPL as subprocesses only |
| OPEN3D trademark | Counsel before any public launch |
| JavaScript DSL has less LLM pretraining than Python CAD | o3dj-bench ablation, with the Python tier later |
| Client confidentiality | Local-only by default, telemetry off, approval for any egress |

## 12. Founder decisions and the first two weeks

**Decisions.**
1. The name, after counsel.
2. The 3dj upload tool and hash field.
3. The default for client confidentiality with cloud generation.
4. Whether client-derived eval tasks may be published, with consent and anonymisation.

**Weeks 1 and 2.** Step 0, then the Step 1 issues written to the definition of ready, in this order: dual-era server, DSL subset, assembly graph, gates, exports, pool, SKILL.md.

## Sources

**Research files (this folder):** lean-stack.md, industrial-design.md, kaizen-ops.md, assemblies.md, compute-cpu-gpu.md, spike-occt-wasm.md, spike-assemblies.md, gap-1.md to gap-9.md.

**npm registry** (versions checked 28 Oct 2026):
- https://www.npmjs.com/package/@modelcontextprotocol/server
- https://www.npmjs.com/package/occt-wasm
- https://www.npmjs.com/package/brepjs
- https://www.npmjs.com/package/webgpu
- https://www.npmjs.com/package/three-mesh-bvh
- https://www.npmjs.com/package/manifold-3d
- https://www.npmjs.com/package/piscina
- https://www.npmjs.com/package/systeminformation
- https://www.npmjs.com/package/@3mfconsortium/lib3mf

**MCP and Node:**
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
- https://nodejs.org/api/permissions.html

**OCCT:**
- https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_filling.html
- https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___draft_angle.html

**Moulding rules and standards:**
- https://www.protolabs.com/resources/design-tips/injection-molding-basics/
- https://www.iso.org/standard/84300.html

**GPU:**
- https://www.w3.org/TR/WGSL/
- https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys

**Assembly formats and in-context design:**
- https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md
- https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
- https://cad.onshape.com/help/Content/in-context.htm

**Models, rendering and simulation:**
- https://huggingface.co/black-forest-labs/FLUX.1-schnell
- https://huggingface.co/Qwen/Qwen-Image
- https://github.com/blender/cycles
- https://www.dhondt.de/

**Operations and signing:**
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://code.claude.com/docs/en/hooks
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options

**3dj MCP:** the public tool `cad_get_evidence_schema`, called 28 Oct 2026.
