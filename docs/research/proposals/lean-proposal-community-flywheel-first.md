# Open3DJ lean plan: community flywheel first

28 Oct 2026. This proposal takes one angle: attract users and volunteers while spending as little founder time as possible. It builds on lean-stack.md, assemblies.md, compute-cpu-gpu.md, industrial-design.md and kaizen-ops.md, and on gap-1 to gap-9, which override PLAN.md and ARCHITECTURE.md.

"Open3DJ" is a working name. OPEN3D is a live US registration (Reg. 6468139) one letter away (gap-5), so counsel must settle the name before any public listing.

## 1. Thesis

Founder attention is the only scarce input. Agents make code cheap; review, judgement and trust stay expensive. The plan therefore maximises one ratio: **useful work merged per founder hour**. Three loops drive each other.

1. **Use loop.** Each release does one real job. The first is "an agent builds a multi-part enclosure and exports STEP". When a user hits a failure, a prefilled form turns it into an eval task. Agents fix the top failure, and the next weekly release is better.
2. **Contribution loop.** Each release opens one contribution lane, each with an executable checker. The lanes are library parts, example products, bench tasks, bench runs, print-and-measure reports and hardware reports. The checker, not the founder, does the first review, and contributors are credited by name on public pages.
3. **Proof loop.** A public gallery and leaderboard show, with reproducible numbers, what agents can build with Open3DJ and with competing servers. That draws in the users and contributors who feed loops 1 and 2.

AI agents run the plumbing between the loops. They never merge and never speak for a human.

Three pieces of evidence support this angle:

- **Distribution beats scope.** text-to-cad, a one-line skill pack, has 23.6k stars; vcad, with comparable scope, has 441 (gap-7).
- **Libraries grow through conventions plus automated checks**, as KiCad's KLC and BOSL2 show. One-person part collections (cq_warehouse, bd_warehouse) stayed small.
- **Good-first-issue labels are fading.** The newcomer merge rate on them fell from 61.9% to 42.2%.

## 2. Ground rules

**Team.** The founder, unpaid volunteers, Claude and the founder's agents. There are no salaries, hires or grant plans.

**Effort unit.** One founder-week (FW) is about 20 hours of founder attention spent specifying, reviewing, testing and doing gemba (going to see real use). Agents write most of the code. Calendar time is FW x 20 divided by the founder hours actually available each week.

**Honest ranges.** METR's 2025 trial found experienced open-source developers 19% slower with AI, and METR calls its later speed-up signal "very weak evidence". Two rules follow:

- each step re-estimates after its first week, from measured PR lead time;
- an overrun of more than 50% past the upper bound triggers an A3 (a one-page problem analysis) and a scope cut, not a longer step.

**Founder time.** Running the line is capped at about 8 hours a week, falling as volunteer librarians take over routine review. "Founder minutes per merged PR" is on the public scorecard.

**Cash.** $0 through Step 9. Several things are free:

- GitHub Actions standard runners for public repos, on all six targets;
- npm trusted publishing, GitHub Pages and Sigstore;
- the founder's existing Claude subscription.

Costs that cannot be avoided arrive later:

- **Apple:** $99 a year, only once a macOS GUI ships.
- **Windows signing:** free via Microsoft Store MSIX, or via SignPath Foundation after a first release. Azure Artifact Signing (about $9.99 a month) is needed only if the publisher must read "Neural Deep Network LTD".
- **Filament.**

**Every step** is a small usable release with one hypothesis, one Kaizen metric and one new contribution lane.

## 3. Starting stack and how it grows without rewrites

The stack is lean-stack option A: one npm package, started with `npx -y open3dj mcp`.

- **MCP server.** `@modelcontextprotocol/server` 2.4.0 with `serveStdio`. It is dual-era: Claude Code connects at 2026-07-28, while Codex and Gemini CLI connect at 2025-06-18 through plain `tools/list` and `tools/call`.
- **Kernel.** brepjs 20.11.x on occt-wasm 5.8.x (OCCT 8.0.1 in WASM), pinned exactly. Open3DJ's DSL v1 facade is the only public API.
- **Agent scripts.** They run in QuickJS-WASM inside a short-lived Node worker started with `--permission`. The parent enforces a wall-clock kill and recycles the worker at a heap threshold.
- **Other libraries.** manifold-3d 3.5.4, three.js r186, three-mesh-bvh and systeminformation.

Why this stack: there are no native builds, and it runs on all six desktop targets, including Windows ARM64. Failures are contained: a failed fillet comes back naming the faulty edges, and the process survives. The cost is 1.2x to 2.1x native time.

**A zero-install front door.** occt-wasm also runs in browsers: `OcctWorker` hosts the full kernel in a Web Worker on Chrome and Edge 114+, Safari 17.2+ and Firefox 121+, at about 4.5 MB brotli. The parts gallery and a try-it playground can therefore be a static GitHub Pages site (1 GB, with 100 GB a month of soft bandwidth). It has no servers and costs nothing. Code runs only in the visitor's tab, and a shared link runs its script only after a click.

**Six contracts, versioned and tested in CI:**

1. Tool and report schemas: GeometryReport, five-state references, the Evidence Pack with waivers, jobs, approvals and provenance.
2. DSL v1, with tolerance-based conformance tests on the 18 public 3dj starters.
3. The `KernelAdapter`, vendored into the repo.
4. The `.o3j` project folder: assembly-first, plain text, diffable in git.
5. The Open3DJ Library Convention (O3LC) part manifest.
6. The bench task and result schema.

Contracts 5 and 6 protect volunteers' work from internal churn. A schema bump ships with an agent-written migration, and CI runs it over every contributed file.

**Swap points.** Each opens only when a measured trigger fires.

| Trigger | Response | Unchanged |
|---|---|---|
| A real part exceeds the 4 GiB wasm32 cap, or p95 `run` > 2 s | Contribute a memory64 occt-wasm build; then compile the same C++ facade as an N-API addon | Adapter, DSL, schemas |
| A single binary or stronger isolation is needed | Node SEA, or a Rust host running the same WASM through the occt-wasm crate | Kernel, DSL, tools |
| A sandbox attack test goes red | OS sandbox (bubblewrap, Seatbelt, AppContainer) around the same worker | Worker protocol |
| Bench ablation shows Python scripts ahead by more than 3 points across 3 runs | Optional `uvx` build123d 0.13.0 tier (no Windows ARM64) | Job spec, reports |
| Users ask for a desktop app | Electron 45 or Tauri 2.12 hosting the same web viewer; signing costs start | Viewer component |

## 4. Agent contract: what earns its place

These pieces stay, because each one prevents a measured agent failure:

- **Four tools: `run`, `inspect`, `render`, `export`.** Capabilities grow as new fields, never as new tools, which keeps SKILL.md and token use small.
  - `run` takes a script or an assembly-graph patch with a `base_rev`.
  - `inspect` returns report sections and job status.
  - `render` produces multiview, section, exploded and later motion views.
  - `export` writes STEP, STL, 3MF and glTF, adding URDF, MJCF and the RFQ pack later.
- **A GeometryReport after every run**, for each part and for the whole assembly. The concise mode targets 300 tokens or fewer (G5).
- **Five-state references:** exact, re-resolved, disambiguated, ambiguous with candidates, or broken. "Ambiguous" is never auto-picked. The target is zero silent mis-resolutions (G7).
- **Evidence Pack gates.**
  - Every waiver is recorded.
  - Every value carries a confidence label: measured, observed, inferred or assumed.
  - Invalid output labelled valid (G8) is a red andon.
- **Deterministic hidden-line (HLR) PNG and SVG renders.** They are byte-identical across runs, so they serve as both agent snapshots and CI goldens.
- **An op log with same-platform replay.**
- **Daemon-owned approvals from Step 4.** An MCP elicitation "accept" does not prove a human consented.
- **Our own job model**, an ID plus a status, rather than MCP Tasks.
- **SKILL.md under 5k tokens**, a Claude Code plugin, an MCP Registry entry and skills.sh.
- **o3dj-bench**, now public.
- **MIT OR Apache-2.0 licensing**, with a DCO.

## 5. Assembly data model

Every design is an assembly. A single part is a root assembly with one occurrence, so no code path handles parts alone. A project is a plain folder, reviewable as a PR:

- `assembly.o3j.json` holds the structure (below).
- `parts/*.o3j.js` holds the part geometry as DSL scripts.
- `brief.o3j.yaml` is added from Step 4.
- `evidence.json` and `provenance.jsonl` are generated.

**Entities:**

- **Definition.** A part (script plus params), an assembly (which contains occurrences, giving sub-assemblies) or a standard part (library id, params and O3LC manifest). Each unique parameter set counts as its own definition for the BOM and the cache.
- **Occurrence.** A UUIDv7 id, a path from the root (`gearbox/planet#2`), a definition plus configuration, and a transform stored as a translation plus a unit quaternion. Euler angles are used only at the occt-wasm boundary (measured as Rz·Rx). An occurrence also carries suppressed and BOM flags and a colour override.
- **Connector.** A frame (origin, Z axis, X axis) on a definition, anchored to a named reference, with 3dj gender and type tags. It inherits the five-state report.
- **Mate.** A type, two connector paths, an offset, limits, flip flags and a value bound to a Param.
- **Patterns, explode states and motion studies.** For example, Replicate places one screw onto every `hole_*` connector.

The BOM, DOF table, clash table, mass and centre of gravity are always derived, never stored.

**3dj DSL compatibility:**

| 3dj | Open3DJ |
|---|---|
| Named descriptor returns `[{name, shape, color}]` | Occurrences under the root. Identical clones share one definition, recovered from provenance or a geometry hash and labelled "inferred" |
| `connector.male/female(type, {origin, axis, up})` | A connector on the definition |
| `moving.matchTo(target, a, b)` | A recorded fastened mate, so a later part edit re-seats the part instead of leaving a stale transform |
| `withReferences`, `attachTo`, `onFace`, `hole` | Five-state named references, with placements relative to them |

**The report after every change** lists:

- the tree;
- free DOF per occurrence, in connector terms ("screw#3: 6 free, not mated");
- mate status: satisfied, redundant, conflicting with residual, or broken with candidates;
- a branch-change flag;
- a clash, contact and clearance table with confidence labels;
- the BOM, mass and per-definition gates.

**Interference has three outcomes: clash, contact and clearance.** It runs in three tiers:

1. An AABB filter, which cut 10,440 pairs to 144 in 5.5 ms.
2. Manifold mesh volumes ("observed"), at 5.4 ms a pair and within 0.3% of exact.
3. Exact OCCT checks ("measured"), at 19 to 29 ms a pair, run only on flagged or critical pairs.

Mated contacts are exempt, and press fits are declared.

**Solving.** Fixed, fastened and tree-shaped assemblies are solved in closed form. Kinematic loops come later, through our own TypeScript Levenberg-Marquardt solver, with DOF taken from the Jacobian rank. brepjs's mate solver never feeds reports: in tests it silently ignored a conflicting mate and gave a four-bar linkage 4 DOF instead of 1.

**Exports:**

- **STEP via XCAF**, with names on both definition and instance labels and a pure assembly root. It is AP214 today; AP242 needs an upstream facade contribution.
- **3MF**, with components and build items carrying a `partnumber`.
- **glTF**, from our own writer, with one mesh per definition.

**Community lever.** Every O3LC part ships with connectors and BOM fields, so a contributed M3 screw mates into any matching hole out of the box. Library contributions compound assembly usefulness.

| Step | Assembly capability |
|---|---|
| S1 | Definitions, occurrences and sub-assemblies with transforms; `matchTo` recorded as fastened mates; per-part and whole-assembly reports; exact clash on AABB candidates; multi-part STEP, 3MF and glTF |
| S2 | Persisted fastened mates on library connectors; Replicate; derived BOM CSV; three-outcome clash with the mesh tier; named free-DOF report |
| S4 | Exploded views; instanced drawing per definition in the viewer |
| S5 | Tree joints (revolute, slider, cylindrical) with limits bound to Params; motion samples; swept clash; URDF |
| S9 | Numeric loop solver; redundancy and conflict diagnosis; branch keeping; MJCF |
| Later | Large-assembly mode (BatchedMesh, LOD, graphics-only, lazy loading; gate: 10,000 occurrences at the frame-time target); in-context design with snapshots pinned to a revision and updated by explicit diff; OndselSolver WASM spike |

## 6. Compute-device layer (CPU and GPU)

**Job contract.** Every heavy job declares:

- `kind` and `inputsHash`;
- `runsOn`, a subset of `cpu`, `gpu-local` and `gpu-cloud`;
- `determinism` (`record` or `preview`);
- `privacy` (`local-only`, `cloud-anonymous` or `cloud-full`);
- a deadline and a budget.

Calls accept `compute: auto | cpu | gpu`. With no GPU, `auto` falls back to the CPU and an explicit `gpu` request fails with a structured error. Provenance records the backend, the device and an inventory hash.

**Discovery.** `open3dj doctor` builds a DeviceInventory with these fields:

- CPU cores and RAM;
- GPU vendor, model and VRAM, from systeminformation (WebGPU does not report VRAM);
- WebGPU adapter details;
- sidecar capabilities and a licence-manifest hash;
- battery and thermal state.

**Scheduler.** Placement is one line of standard work:

1. Filter devices by capability, licence and privacy.
2. Drop any device whose memory estimate exceeds 70% of its budget.
3. Pick the lowest estimated time, using per-device profiles of past runs.
4. Break ties by cost, then local before cloud.

A prediction off by more than 2x is logged as a defect. Cloud spend and data egress always need a daemon-owned approval, and the budget lives in the daemon.

**CPU.** occt-wasm is single-threaded wasm32 with SIMD. It omits relaxed-SIMD on purpose, so results reproduce across CPUs. Parallelism therefore comes from one kernel per `worker_thread`:

- pool size `min(cores - 1, freeRAM / 400 MB)`;
- an interactive lane with one reserved worker, and a batch lane for variants, bench runs, analysis and export;
- recycling at 1.5 GiB of heap or on any kernel error;
- stdout captured, because the STEP writer prints to it and MCP stdio uses it for protocol messages.

**GPU, only where it pays.** GPUs handle display and rendering, analysis maps (thickness, draft, overhang, curvature, broad-phase), implicit and lattice fields, ML and generative 3D, and simulation. They never run booleans, fillets or STEP. There are three routes:

- **WebGPU:** in the browser for display, and in Node through the optional Dawn `webgpu` package (137 MB, so installed on demand).
- **Python sidecar:** for CUDA, ROCm and MPS.
- **Cloud:** the same job spec sent to a provider.

**Mistake-proofing.** A GPU kernel merges only with all four of:

- a CPU twin;
- a tolerance conformance test;
- a lavapipe CI job;
- a gain of at least 3x on a real volunteer GPU.

At runtime, device loss, out-of-memory or a Windows TDR reset re-queues the job on the CPU twin and records why.

**GPU screens, CPU decides.** In the spike, only 4% to 10% of GPU values were bit-identical to the CPU's, and 3 of 16.8 million voxels flipped inside/outside. Gate verdicts therefore come only from the CPU, and GPU values inside a guard band around a threshold are re-checked there. Dispatches are tiled to about 100 ms, below the 2 s Windows reset. On battery, the pool halves.

**Community lever: a hardware matrix.** The project has no GPU lab. Volunteers run `open3dj doctor --bench` and attach the JSON (pool scaling, kernel speed-ups, CPU-GPU conformance) through an issue form. An agent aggregates the results nightly into a public matrix. That measures the 3x rule for $0. Paid GitHub GPU runners ($0.052 a minute) are only for gaps.

| Stage | Step | Adds |
|---|---|---|
| C0 | S1 | CPU only: kernel in a worker, HLR snapshots, DeviceInventory in provenance, `runsOn` in the schema from day one |
| C1 | S3 | Worker pool and lanes; per-device profiles and placement; `doctor --bench`; the hardware matrix |
| C2 | S4 | Viewer GPU rendering: WebGPURenderer with a WebGL2 floor, instancing, GPU picking |
| C3 | S6 | Optional `@open3dj/accel-webgpu`: WGSL thickness ray casts, SDF and lattice previews, broad-phase, each with a CPU twin; Manifold `LevelSet` meshes the field of record |
| C4 | S7 | `uvx` Python GPU sidecar (image models, TRELLIS v1); cloud GPU providers (3dj.app, or the user's own Modal or RunPod keys) on the same job spec |
| C5 | Later | GPU simulation (Warp FEM, MuJoCo Warp). CalculiX on the CPU comes first, in S9 |

## 7. Step ladder

| Step | Release | Contribution lane | Kaizen metric | FW |
|---|---|---|---|---|
| S0 | The line | Failure reports, bench task proposals | Fresh clone to green check on 3 OSes, ≤ 10 min | 1-2 |
| S1 | Agent Preview: assemblies in, evidence out | One-click failure report | Median `npx` to first exported multi-part STEP, over 5 recorded sessions, ≤ 5 min | 3-5 |
| S2 | Library and gallery | Library parts, example products | Founder minutes per merged external part, ≤ 10 | 2-4 |
| S3 | Public leaderboard and worker pool | Bench tasks, bench runs, hardware reports | Accepted external submissions a month, ≥ 10 by month 2 | 2-3 |
| S4 | Human loop and ID-0 | Print and measure | First-print fit rate, ≥ 80% over 10 volunteer prints | 3-5 |
| S5 | Mechanisms | Mechanism examples | Seeded joint and swept-clash defects caught, 100%, with zero false passes | 3-4 |
| S6 | Analysis maps (CPU first, GPU optional) | GPU bench reports, validation parts | p95 wall-thickness map on the 30-part set ≤ 2 s, with no verdict change against the CPU | 3-5 |
| S7 | Concept to massing (ID-1) | Provider adapters with licence manifests | Median hours from an approved brief to a chosen direction with a parametric rebuild | 3-5 |
| S8 | Form, CMF and moulding DFM (ID-2, ID-3) | Cited DFM rules, seeded-defect parts | False-positive rate on the seeded corpus < 10% (any false negative is a red andon) | 5-8 |
| S9 | Engineering and handoff (ID-4, ID-5) | FEA benchmarks, drawing reviews | Supplier clarification questions per RFQ, falling | 5-8 |

The total is 30 to 49 FW. The flywheel core, S0 to S4, is 11 to 19 FW.

- **S0.** The repo ships as a contribution system before any code:
  - `AI_POLICY.md`, `AGENTS.md` under 200 lines, and a DCO;
  - issue forms;
  - branch protection, a merge queue, a cap of 2 open PRs per outside user, and an `andon` label;
  - a `check` command under 10 minutes, enforced by hooks;
  - `claude-code-action@v1`;
  - bench v0 with 20 regression tasks from the 3dj starters.

  Two blocked spikes, pool scaling and the OndselSolver build, run on approved volunteer machines.
- **S1.**
  - The four tools.
  - The DSL subset the 18 starters need: connectors, `matchTo` and descriptor returns.
  - The S1 assembly row.
  - FDM gates per definition: watertight, 0.8 mm wall, 45 degree overhang and the 220 x 220 x 250 mm bed.
  - The sandbox and C0.
  - SKILL.md, the plugin and the Registry entry.
  - CI on four runners, including `windows-11-arm`.
  - On a failure, `inspect` returns a prefilled issue link, never an automatic post.
- **S2.**
  - **The O3LC checker.** It covers the cited standard, units, tolerances, licence, connectors, BOM fields and a gate run.
  - **About 40 seed parts.** They are re-authored from the public 3dj reference: ISO 4762 screws, nuts, washers, heat-set inserts, standoffs, snap fits, bosses and 2020 T-slot.
  - **The gallery and playground**, which credit every author.
  - **Docs examples rendered from code**, as BOSL2 does.
  - **A deterministic coverage script** that opens `good-first-part` issues.
- **S3.** It ships:
  - **Tasks** with a brief, executable assertions and a reference solution. A task-lint check requires the reference to pass and a seeded mutant to fail.
  - **Splits:** a public dev split, and a held-out split that runs only in maintainer CI.
  - **A harness** that drives any MCP server on the submitter's own model keys.
  - **Leaderboard rows** showing pass@1, pass^3, tokens and calls per task, and the invalid-output rate. A row stays "self-reported" until an agent reproduces a sample.
  - **CADGenBench scores**, published but not gating.
  - **C1**, because bench runs need the batch lane.
- **S4.** It ships:
  - the daemon-served viewer, reusing the gallery component (C2);
  - a nonce-protected page for approving the brief, design, export-for-quote and waivers;
  - exploded views and `brief.o3j.yaml`;
  - enclosure templates (shells, PCB placeholder, buttons, inserts, screws);
  - per-part 3MF plates.

  Quotes come from an optional OrcaSlicer subprocess (AGPL, never linked), or from 3dj once it accepts uploads with an evidence hash.
- **S5.** Tree joints, named DOF, motion samples, swept clash and URDF, with hinge and drawer-slide templates.
- **S6.** The CPU computes wall thickness (pool ray casts), draft, overhang and curvature, which feed the gates. The viewer shows heat maps, and C3 adds the GPU pack.
- **S7.** A provider router shows licence manifests (licence, territory, commercial use, model hash) before any download. Concept images come from FLUX.1 schnell or Qwen-Image (both Apache-2.0). Massing comes from a TRELLIS v1 geometry-only clean runner; it needs CUDA, so Apple, AMD and Qualcomm machines route to the cloud. A concept board records the prompt, model, licence and seed. An agent rebuilds the massing as DSL labelled "assumed". TripoSG, Hunyuan3D and TRELLIS.2 stay opt-in.
- **S8.** It ships:
  - a per-edge continuity table (G0 gap, G1 angle, G2 jump) with zebra renders;
  - MakeFilling and Gordon surfaces, accepted only after `IsApproximate` and `G2Error` are checked;
  - `cmf.o3j.json`, storing sRGB or Lab colour with no Pantone, exported through `KHR_materials_variants`;
  - an `im.<resin>.v1` profile covering draft, wall range, ribs and bosses, undercuts and parting-line candidates, tested on about 30 seeded-defect parts.
- **S9.** It ships:
  - the numeric solver;
  - worst-case and RSS stacks, where the user enters an ISO 20457 class name and no standard text is shipped;
  - CalculiX as a GPL subprocess, labelled "simulation, not test";
  - AP242 export;
  - critical-dimension HLR drawings;
  - an RFQ pack with a quote comparison.

  A human sends every RFQ and order.

## 8. Industrial design pipeline as slices

Every product here is an assembly (enclosure halves, PCB, buttons, fasteners), so every slice uses the assembly model.

| Slice | Step | Agents do | Humans approve | Community role |
|---|---|---|---|---|
| ID-0 Brief to printed prototype | S4 (dogfooded on 3dj from S1) | Brief, assembly, gates, plates, estimate | Brief, design, quote acceptance | Print, measure, post calliper readings |
| ID-1 Concept and massing | S7 | Variants, massing, parametric rebuild | Direction | Provider adapters, prompt sets |
| ID-2 Form and CMF | S8 | Continuity table, variant renders | Form, CMF | Rhino or Plasticity owners cross-check the numbers |
| ID-3 Moulding DFM | S8 | Draft, wall, ribs, bosses, undercuts, parting lines | Waivers | Engineers review the cited rules |
| ID-4 Engineering | S9 | Tolerance stacks, BOM, linear FEA | Results | Analytic benchmarks |
| ID-5 Handoff | S9 | AP242, drawings, RFQ pack | Every RFQ and order | Drawing reviews |
| ID-6 Tooling and Class-A | Research track | Nothing committed | n/a | Volunteer designers; Moldflow interop for licence holders |

## 9. Infrastructure maintained by AI agents

| Job | When | Output | Human touch |
|---|---|---|---|
| Evals: regression, plus capability x3 | Nightly | Scorecard; drafted andon if red | Founder files it |
| Triage digest | Daily | Labels and a digest | Read at the andon check |
| Dependency batch (Dependabot weekly groups) | Weekly | One PR with conformance, bench delta (≤ 10% regression) and a 10,000-op soak | One approval |
| Licence gate (allowlist, SPDX) | Every PR | Red on GPL, non-commercial or territory-restricted code or weights | Only if red |
| Gallery, leaderboard and matrix rebuild | On merge | GitHub Pages | None |
| Leaderboard reproduction | Nightly sample | "Reproduced" marks | Librarian settles disputes |
| Release notes and credited build log | Friday | Drafts | Founder publishes |

Rules for the agents:

- Agents never merge.
- LLM-written text addressed to people goes out only when a human presses the button. Deterministic bots are labelled as bots.
- Runs are capped by `--max-turns`, timeouts and concurrency groups.
- `claude-code-action` runs only for users with write access, and fork PRs get no secrets. Outsiders therefore cannot spend the founder's tokens.

## 10. Operating model (Kaizen)

**The constraint is founder review.**

- At most 3 agent PRs sit in Review, each under about 400 lines with one concern.
- Agents are dispatched only when review capacity frees up (pull), against a fixed daily quota (heijunka).
- Review climbs a ladder: contributor, then checker, then a volunteer librarian with the triage role and CODEOWNERS for `lib/` or `bench/`, then the founder.
- The founder reviews only contracts, the kernel, security and licences. By S4 the founder reviews no routine library PRs.

**Weekly loop, 8 hours or less:**

| When | What |
|---|---|
| Daily | 20-minute andon check, plus two review windows |
| Monday | 30-minute plan |
| Wednesday | 45-minute gemba: watch one real user and read 10 agent transcripts |
| Friday | 60-minute check and act: scorecard, one A3, a standard-work update, the release and a credited build log |
| Monthly | Kaizen event with volunteers |

**Red andon** stops new merges when any of these occurs:

- `main` is red, or the regression suite is below 100%;
- a false pass: G8, an Evidence gate, or a silent reference mis-resolution;
- a contributed part or task passes its checker but is wrong (fix the checker);
- licence contamination;
- a security failure;
- a broken tier-1 install.

**Yellow andon** fires on any of these:

- a capability drop of more than 3 points across 3 runs;
- a review-queue age over 5 days;
- a first response to a newcomer slower than 48 hours.

**Response:** revert, freeze the merge queue, add a regression test, write a 5-whys note and change standard work.

**Respect for people.** Reviews are blameless: an error is a missing check or missing context, never grounds for punishment. An `experiment` label marks an exploration lane for spikes that need not merge. Volunteers have no deadlines, everyone gets credit, and PRs are closed quickly and kindly. GitHub Discussions is the single durable channel; Discord opens only once a volunteer moderator owns it.

**Scorecard:**

| Area | Measures |
|---|---|
| Flow | Lead time, queue age, founder minutes per merged PR |
| Quality | First-pass green rate, reverts |
| Product | G1, G4, G5, G7, G8, first-print fit rate |
| Flywheel | Downloads (median day x 7); opt-in weekly active installs (telemetry off by default); share of a peer index (build123d-mcp, agentcad, openscad-mcp, freecad-mcp); new contributors with a merged PR; 60-day return rate; external submissions |
| Cost | Subscription hours per merged PR |

Preview bases from gap-7, re-based quarterly: 1,000 downloads a week, 300 weekly active installs and 700 stars.

## 11. Cut or deferred

**Cut:**

- salaries, hiring and grants;
- the 16-tool surface (now 4 tools);
- G12 three-language SDK parity, replaced by one schema source;
- MCP Tasks and the MCP App viewer;
- an rmcp/Rust daemon at the start;
- native OCCT builds;
- CADGenBench and cross-platform determinism (G13) as release gates (both are now published numbers);
- SolveSpace and CasADi in process.

**Deferred until a trigger fires:**

- the desktop shell, installers, auto-update and signing;
- the Python tier;
- a native or memory64 kernel;
- the OS sandbox;
- GPU simulation;
- restricted model packs;
- the hosted ChatGPT relay;
- the plugin marketplace.

**After S9:**

- large-assembly mode and in-context design;
- the sketcher;
- scan to CAD;
- IGES and DXF;
- CAM and sheet metal;
- multi-user editing;
- OpenUSD.

**Research track only:** Class-A surfacing, moulding simulation, drop testing and mould design. OpenRadioss was retired in October 2026.

## 12. Risks

| Risk | Countermeasure |
|---|---|
| Founder review becomes the bottleneck | WIP cap; checkers first; librarian ladder; founder-minutes metric |
| A flood of low-quality AI PRs | AI policy; 2-PR cap; checker-first lanes, so contributors pay for validation |
| Single-maintainer dependencies (occt-wasm, brepjs) | Exact pins; mirrors; a reproducible occt-wasm build; a vendored adapter |
| The leaderboard is gamed or noisy | Held-out split; pass^k; reproduction; caution on gaps under 3 points |
| Volunteer churn | Executable on-ramps; credits; the 60-day return metric; librarian roles |
| Licence contamination | Licence gate; clean-room rule; required citations; ISO cited by number only; numeric colour |
| Contributed scripts carry attack code | The same QuickJS sandbox; the playground runs only in the visitor's tab |
| Large assemblies hit the 4 GiB WASM cap | Mesh-first large-assembly mode, then a trigger-based kernel swap |
| Fast competitors (SolidCraft, text-to-cad) | Compete on evidence, assemblies, the library and the leaderboard |

## 13. Founder decisions in the first two weeks

1. Settle the name with counsel before any listing.
2. Relicense to MIT OR Apache-2.0 while there is still a single copyright holder.
3. Add a presigned upload and an evidence-hash field to 3dj `request_print_quote`.
4. Approve the pool-scaling and OndselSolver spikes.
5. Keep telemetry opt-in only.
6. Apply to Codex for OSS now. Treat Claude for Open Source's "20+ unique external contributors" criterion as a flywheel milestone, never as a dependency.

## Sources

- Research notes in this folder: lean-stack.md, assemblies.md, compute-cpu-gpu.md, industrial-design.md, kaizen-ops.md, community-licensing-business.md, gap-4.md to gap-9.md, spike-assemblies.md, spike-occt-wasm.md.
- occt-wasm browser support and size: https://github.com/andymai/occt-wasm
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Dependabot groups: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
- MCP TypeScript SDK v2: https://www.npmjs.com/package/@modelcontextprotocol/server
- GitHub runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- Per-user PR cap: https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/
- Claude Code GitHub Actions: https://code.claude.com/docs/en/github-actions
- METR: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://metr.org/blog/2026-02-24-uplift-update/
- Good-first-issue decline: https://arxiv.org/abs/2604.27532
- Eval guidance: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Microsoft Store signing: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- WGSL floating point: https://www.w3.org/TR/WGSL/#floating-point-evaluation
- Dawn for Node: https://www.npmjs.com/package/webgpu
- Claude for Open Source: https://claude.com/contact-sales/claude-for-oss
