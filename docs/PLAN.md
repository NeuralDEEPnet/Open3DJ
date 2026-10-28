# Open3DJ plan: lean, agent-first, assembly-first

Status: plan of record from 28 Oct 2026. It replaces the funded-team plan in [research/archive](research/archive/), and supersedes the three funded-era proposals and the three lean proposals in [research/proposals](research/proposals/). The architecture is in [ARCHITECTURE.md](ARCHITECTURE.md), with detail in [ASSEMBLIES.md](ASSEMBLIES.md) and [COMPUTE.md](COMPUTE.md); the industrial design pipeline is in [INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md). Facts come from the research reports in [research/](research/); the gap notes ([research/gap-1.md](research/gap-1.md) to [research/gap-9.md](research/gap-9.md)) and the 28 Oct reports override older reports.

The names `open3dj` and `@open3dj` in commands and packages are working placeholders. Nothing is reserved or published under them until founder decision 1 (section 11).

## 1. Vision

Open3DJ is the best agentic CAD software on the internet: an open-source, local-first CAD engine that AI agents drive through MCP and that humans review and approve in a professional UI. Agents fail at CAD for four reasons: they cannot see what their code did, they cannot point at geometry stably, they cannot recover from kernel errors, and they cannot prove the result is right. Open3DJ's product is the fix for all four: a GeometryReport after every change, stable named references, structured errors, deterministic pictures and honest evidence gates. Every design is an assembly, from a single bracket to a product with enclosure halves, a PCB, buttons and fasteners. Every heavy calculation has a CPU path. Analysis screening, viewing, rendering and generation can also use a local GPU, and rendering and generation a cloud GPU with approval; the deterministic CPU kernel always has the final word. The same engine carries a physical product from brief and concept through form, CMF, engineering and design-for-manufacture to a supplier-ready handoff, with agents doing most of the work and humans approving taste, money and anything that leaves the machine.

## 2. What "best agentic CAD" means

Each goal is measured by o3dj-bench or by real use. Targets are starting points; the Friday review may change them with a recorded reason.

| # | Goal | Measure | First target |
|---|---|---|---|
| G1 | Agents finish real designs | pass^3 on the o3dj-bench capability suite (Claude Code; Codex and Gemini CLI reported when their quotas allow) | 70% at S1, rising each step |
| G2 | Agents recover from failures | share of script, kernel or gate failures fixed within 2 further calls | 80% at S3 |
| G3 | Reports never lie | false passes (gate, clash, reference) on seeded corpora | 0, always (red andon) |
| G4 | References stay stable | silent mis-resolutions in a 1,000-edit sweep | 0, always (red andon) |
| G5 | Fast first result | `npx` to first exported multi-part STEP (until the first npm publish, measured with `npx` on a locally packed tarball) | 5 minutes or less |
| G6 | Parts fit when printed | first-print fit rate on agent-designed enclosures | 80% over 10 prints at S5 |
| G7 | Every client works | plain `tools/list` and `tools/call` pass the CI client matrix at all three protocol eras, 2025-06-18 included, and the founder's manual client checklist ([ARCHITECTURE.md](ARCHITECTURE.md) section 9) | 100% of tools |
| G8 | CPU and GPU agree | gate verdict differences between `compute: auto` and `cpu` | 0, always (red andon) |
| G9 | Handoff is clear | supplier clarification questions per RFQ | falling each cycle |

## 3. Who it is for

1. **AI agents and their operators** (Claude Code, Codex, Gemini CLI, Cursor, VS Code, any MCP client): the primary user.
2. **Industrial and product designers** who brief agents and approve their work, starting with small electronics enclosures and handheld products.
3. **Makers and engineers** who want parametric, printable multi-part designs with evidence.
4. **Volunteers** and **3dj.app users**, who share the DSL (section 9).

## 4. How we work: the Kaizen line

The team is the founder, unpaid volunteers and the neuraldeep.net design agents (run in Claude Code and other agent tools). There are no salaries, no burn and no hiring. The scarce resource is founder review attention, so the line is built around it. Detail and sources: [research/kaizen-ops.md](research/kaizen-ops.md).

### 4.1 Flow and WIP

- The Review column holds at most **3 agent PRs**. Each PR has one concern and fewer than about 400 changed lines.
- Agents are dispatched only when review capacity frees up (pull), never to fill a queue.
- Review happens in two fixed windows a day.
- **Agents never merge.** Branch protection requires one human approval. While the founder is the only maintainer, the founder is on the bypass list for pull requests only ([REPO-SETTINGS.md](REPO-SETTINGS.md)); the bypass is removed when a second maintainer joins.
- GitHub's per-user open-PR cap is set to **2 for users without write access**, with a bypass list for regulars.

### 4.2 The weekly PDCA rhythm (6 to 8 founder hours, counted inside the weekly cap)

- **Daily, on working days (40 to 60 min):** andon check (20 min) and two review windows of 10 to 20 minutes each. PR review happens in these windows and is counted in the loop, not in step work (section 6).
- **Nightly (CI):** regression suite, triage digest and dependency check, published as workflow job summaries (section 4.3). **Weekly (Thursday night):** capability evals for the Friday scorecard; Codex and Gemini CLI runs only when their quotas allow.
- **Monday (30 min, Plan):** pick the top observed failure and at most 3 issues.
- **Through the week (Do):** agents work issues in small PRs; humans review.
- **Wednesday (45 min, Check, gemba):** read 10 agent transcripts, watch one real user, handle one printed part once ID-0 is live.
- **Friday (60 min, Act):** scorecard (compiled overnight, section 4.3), one A3, one standard-work update, weekly release, credited build log with the week's founder hours.
- **Monthly (2 hours):** the founder plus any volunteers pick the worst flow metric on the scorecard, run one 2-hour kaizen session on it, and record the before and after values in the build log.
- **Total:** about 6 to 8 hours a week: 3.3 to 5 hours of andon checks and review windows over five working days, 2.25 hours for the Monday, Wednesday and Friday sessions, and about 0.5 hours a week for the monthly session.

### 4.3 Metrics (the Friday scorecard)

Each step has exactly one Kaizen metric and one exit, both in section 6. The per-step indicators in [ASSEMBLIES.md](ASSEMBLIES.md) section 17 and [COMPUTE.md](COMPUTE.md) section 11, and the stage metrics in [INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 6, are secondary scorecard indicators, not gates.

Two test suites feed the scorecard:

- **Regression suite:** deterministic replays of reference solutions and seeded corpora, with no LLM in the loop. It must stay at 100% and runs in `check` and nightly. In S0, before the DSL facade exists, it holds schema round-trips and contract tests only; the 20 bench v0 replay tasks join it in S1.
- **Capability suite:** agent runs of bench briefs, repeated 3 times and reported as pass^3, once a week. It has targets (G1), never a 100% rule.

| Group | Metrics | Source | Owner |
|---|---|---|---|
| Flow | PR lead time, review queue age, reverts | GitHub API | Nightly CI job |
| Flow | Founder minutes per merged PR | A `/time 15m` comment or the PR-template field, filled by the founder on each review | Founder logs; nightly job sums |
| Quality | Regression suite (must be 100%), first-pass CI rate, false passes, silent mis-resolutions, CPU and GPU verdict differences | CI and nightly results | Nightly CI job |
| Product | G1 to G9 and the current step's Kaizen metric | Capability runs, bench results, prototype records, supplier questions | Founder |
| Value stream (from S5) | Stage lead time, rework loops and escapes per project | Approval and provenance timestamps in dogfood projects, plus four single-field entries on the approval page, the prototype record and the returned-quote entry ([INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 6); the S0 baseline by hand in the issue 16 template | Founder adds the weekly export |
| People | Newcomer first response time, returning contributors | GitHub API | Nightly CI job |
| People | Founder hours | The founder's weekly total in the build log | Founder |

The nightly CI job is a deterministic GitHub Actions workflow, not an agent. It publishes the scorecard draft and the triage digest as its job summary and workflow artifacts, and it never commits, merges or opens issues or PRs (sections 4.1 and 4.8); only the andon automation in section 4.4 opens or labels issues. Agent runs inside CI, such as the weekly capability evals, only produce results for that summary. In the Friday review the founder commits the scorecard to `ops/scorecard/YYYY-WW.md` and the A3 to `ops/a3/`. The founder reads the triage digest in the daily andon check.

### 4.4 Stop the line

This is the single andon list. [COMPUTE.md](COMPUTE.md) and [INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) point here.

| Level | Triggers | Response |
|---|---|---|
| Red, repo | main red; regression suite below 100%; any false pass on a seeded corpus (gate, clash, reference, library checker); CPU and GPU divergence beyond tolerance, or a GPU-screened verdict or GPU-dropped pair that the nightly CPU recompute contradicts; a verdict of record resting on GPU output; kernel output on MCP stdout; licence contamination; a security failure, including any egress without an approval; a broken tier-1 install (section 4.6) | Freeze the merge queue, revert first, then a regression test, a 5-whys note and a standard-work change before the andon closes |
| Red, project | a fault inside a user's project: the stage triggers in [INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 6, such as a dimension labelled "measured" with no measurement behind it, a CMF render used as evidence of a physical finish, or a false gate pass found on a printed part | Block that project's design freeze, exports and RFQ until the fault is fixed or a human waives it; file a failure report for triage. If triage finds a code defect, it becomes a repo andon |
| Yellow | capability drop of 2 or more tasks across 3 runs while the capability split has under 30 tasks (one task of 10 is 10 points), or over 3 points once it has 30 or more; oldest review item over 5 days; a newcomer waiting over 48 hours; a step 50% over its re-estimate in founder hours (section 6) | Discuss in the next Friday A3; adjust WIP or scope |

**How to pull it.** CI opens or labels an `andon` issue automatically when main goes red or the regression suite fails. An agent pulls the andon by writing a line that starts with `ANDON:`, with its evidence, in its transcript or PR; the human operator files it with one click, because no agent opens issues on its own (section 4.8). In a project, the daemon raises a project andon itself where a check can detect the fault, and `inspect` returns a prefilled failure-report link. Anyone, human or agent, may pull the andon. Pulling it is thanked.

### 4.5 Every failure becomes a regression test

Reproduce the failure as a bench task, unit test or corpus entry; ask "why" until the answer is a missing check, context or standard, never a person; add that check (test, hook, gate, AGENTS.md line or SKILL.md example); link it in the closing PR. Failed prints, confusing transcripts and supplier questions count as failures.

### 4.6 Definition of done

- **Issue ready:** problem, an executable acceptance check, files in scope, under one day of agent work, a label (`agent-ready`, `needs-human` or `experiment`).
- **PR done:** one concern; checks green; a new or updated test or eval; evidence attached; `Assisted-by` trailer and human DCO sign-off; docs and changelog line; one human approval; no golden-file or tolerance edits without a stated reason.
- **Tier-1 platforms** are those with a free GitHub-hosted runner: Linux x64 (`ubuntu-latest`), Linux ARM64 (`ubuntu-24.04-arm`, [free for public repositories](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)), macOS arm64 (`macos-latest`), Windows x64 (`windows-latest`) and Windows ARM64 (`windows-11-arm`). macOS x64 is tier 2: best effort, no CI gate.
- **Step done:** installs from npm on tier-1 platforms (from the first npm publish, section 11 decision 1); regression suite at 100% (in S0: schema round-trips and contract tests, section 4.3) and no open red repo andon; the step's exit criterion measured on real use, met or waived in an A3; docs, changelog and credited build log published; the founder has watched a real user (or a recorded agent session on a real brief) complete the step's main task.

### 4.7 Standard work and mistake-proofing

- **AGENTS.md** (under 200 lines) is the single standard for every agent. CLAUDE.md imports it.
- **Hooks, not prose, for zero-exception rules.** Five Claude Code hooks to start: a Stop hook running the one-command `check` (under 10 minutes), and four PreToolUse hooks that protect golden files, tolerance tables, the licence allowlist and secrets.
- **Skills:** `SKILL.md` for using Open3DJ (under 5k tokens), plus internal skills for recurring work (add a DSL entry, gate, bench task or library part).

### 4.8 How agents and volunteers contribute

- **AI_POLICY.md:** agents are welcome; the contributor pays the validation cost. Agent-assisted commits carry an `Assisted-by` trailer naming tool and model; DCO sign-off is human only; the contributor can explain the change; no agent opens issues, PRs or reviews without a human pressing the button. The founder's agents follow the same rules.
- **claude-code-action@v1** runs on the founder's subscription token, only for users with write access; forks get no secrets.
- **Agent PR quality control:** the Stop-hook check passes before a PR exists; the PR meets the definition of done; the transcript is linked for non-trivial changes.
- **Executable on-ramps** (a checker does the first review): failure reports that become eval tasks (`inspect` returns a prefilled report link on errors, never an automatic post), library parts under the Open3DJ Library Convention checker, bench tasks under task-lint, print-and-measure reports, `doctor --bench` hardware reports, and DFM, CMF and brief reviews with citations.
- **Review ladder:** contributor, then checker, then volunteer librarian (triage role and CODEOWNERS for `lib/` or `bench/`), then the founder, who reviews contracts, kernel, security and licences.
- **Credit:** All Contributors, named authors on library parts and bench tasks, and the weekly build log.

### 4.9 Respect for people

Reviews are blameless; an agent's error is a missing check or missing context. Responses teach rather than punish. An `experiment` lane lets anyone explore unusual ideas without needing to merge, and the "what we tried" log records failed experiments as learning. Volunteers have no deadlines or on-call. The founder's weekly hours are capped (decision 5; default 15 hours, including the weekly loop): when the plan and the person conflict, the plan bends.

## 5. Key decisions

| Decision | Choice | Why | Rejected |
|---|---|---|---|
| Starting stack | TypeScript, one npm package, `npx -y open3dj mcp` | Zero native builds on all six targets including Windows ARM64 (the five tier-1 targets are tested in CI, section 4.6); WASM contains kernel crashes ([research/lean-stack.md](research/lean-stack.md)) | Day-one Rust daemon with native OCCT; Python-first (duplicates build123d-mcp, no Windows ARM64 wheel) |
| MCP | `@modelcontextprotocol/server` 2.4.0, dual-era `serveStdio`; everything works over plain `tools/list` and `tools/call` | Only Claude Code defaults to 2026-07-28; Codex and Gemini CLI send 2025-06-18 ([research/gap-6.md](research/gap-6.md)) | Modern-only server; relying on Tasks or MCP Apps |
| Kernel | brepjs 20.11.1 on occt-wasm 5.8.1 (OCCT 8.0.1) behind a vendored `KernelAdapter`; native or memory64 only on a measured trigger | Measured 1.23x to 2.12x of native; structured errors instead of segfaults | Native OCCT now; brepjs as public API |
| Modelling API | Open3DJ-owned 3dj DSL facade (about 150 entries) is the only public API, with tolerance-based conformance on the 18 3dj starters | Shared with 3dj.app; shields users from brepjs churn (12 majors in 2026) | Exposing Replicad or brepjs APIs |
| Tool surface | Five tools: `run`, `inspect`, `render`, `export`, `docs` | `docs` offsets the JS DSL's thin pretraining; jobs and approvals poll through `inspect`; a sixth tool needs an A3 | 16 tools; four tools without `docs` |
| Assembly | Assembly-first from S1; a part is a one-occurrence assembly; structure is JSON data, geometry is script | Founder requirement; no part-only path to migrate ([research/assemblies.md](research/assemblies.md)) | Parts first, assemblies later |
| References in S1 | Five-state reference schema from S1; the S1 fingerprint resolver emits exact, ambiguous and broken; S3 adds re-resolved and disambiguated through history | Connectors ship in S1 and anchor to references, so their state must be reported from the first release | Reference states only from the second step |
| Fit checks in S1 | Exact OCCT clash, contact and clearance on AABB candidates from S1; Manifold "observed" tier in S3 | Exact checks are cheap after the AABB filter (19 to 29 ms a pair) | Overlap warnings only |
| Compute | Compute contract, DeviceInventory and a CPU worker pool with two lanes in S1; GPU viewer in S2; WGSL pack in S7a; provider router in S7b; Python GPU sidecar and the CPU image backend in S8a | Founder requirement for early pool plus GPU viewer; lean order from [research/compute-cpu-gpu.md](research/compute-cpu-gpu.md) | CPU-only until a late step |
| CPU and GPU authority | "GPU screens, CPU decides"; every GPU path has a CPU placement, and every GPU kernel a CPU twin whose exact samples it uses; the GPU clears a sample only outside a guard band wider than the GPU-CPU deviation measured for that adapter and driver times a safety factor; a verdict resting on GPU-cleared samples is a `preview`, and every verdict of record is recomputed on the CPU ([COMPUTE.md](COMPUTE.md) section 6) | Only 4 to 10% of GPU values were bit-identical to CPU; 3 of 16.8M voxels flipped | GPU-decided gates; GPU paths with no CPU option |
| S0 exit | Gated on the five free tier-1 CI runner types plus the founder's own machines; volunteer data is a bonus | The plan must work if nobody shows up | Requiring 10 volunteer machines and 3 GPU vendors |
| Order after S7b | Default order below; the value stream recorded from S5 may reorder S8a to S12, but only independent steps move: S8a stays before S8b, S9 before S10 and S12 (texture depth, CMF sheet), and S11 before S12. S11 may move ahead of S8a when a mechanism project pulls loop solving | Fix the measured bottleneck | Fixed roadmap; roadmap tied to paying client work |
| Tolerances and drawings | Tolerance stacks (S11) before drawings, AP242 and RFQ (S12) | Drawings and PMI carry tolerances | Handoff first |
| Form and DFM | Form and CMF (S9) include advisory draft and wall overlays; moulding gates follow (S10) | OCCT draft cannot taper freeform faces, so draft must be designed into the form | Form without DFM feedback |
| 3dj.app | A provider and a DSL sibling; requested changes are proposals, not dependencies | Keeps the open roadmap independent | Making Open3DJ steps wait on 3dj.app work |
| Generative defaults | Apache-2.0 image models on the GPU sidecar, or on the CPU through stable-diffusion.cpp; TRELLIS v1 geometry-only via a clean runner, or massing written in the DSL on the CPU; restricted models only as opt-in packs | TripoSG is not licence-clean ([research/gap-4.md](research/gap-4.md)) | TripoSG default |
| Public proof | Bench design adopted (task-lint, held-out split, pass^k); leaderboard, gallery and playground on the pull board | Upkeep competes with the product loop | Leaderboard and gallery as early steps |
| Licence | Proposed: MIT OR Apache-2.0 with DCO (founder decision 2; MIT today) | Patent grant plus compatibility | MIT only; CLA |

Sandbox, replay and file-format decisions are in [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. Roadmap: small releases

One founder-week (FW) is 18 hours of founder step work outside the weekly Kaizen loop: specifying issues, testing, dogfooding and decisions, while agents write most code and tests. PR review is not part of an FW, because it happens in the loop's review windows (section 4.2). The loop takes 6 to 8 hours a week at any cap, so calendar weeks per step = FW x 18 / (weekly founder-hour cap minus loop hours) (decision 5; default cap 15 hours). At the default cap that leaves 7 to 9 step hours a week, or 2.0 to 2.6 calendar weeks per FW; at a 25-hour cap it is about 1 calendar week per FW. Each extra founder hour above the loop goes to step work. Each step re-estimates in founder hours after its first week; overruns are measured in founder hours against that re-estimate, and a 50% overrun triggers an A3 and a scope cut, never a longer step. Steps ship as weekly releases. There are no calendar dates.

| Step | Name | Assembly | Compute | FW |
|---|---|---|---|---|
| S0 | Line and gauge | Bench briefs are assemblies | `doctor --bench` | 2-4 |
| S1 | Agent Preview | Definitions, occurrences, sub-assemblies, connectors, exact fits, multi-part exports | Compute contract, pool with two lanes | 3-5 |
| S2 | See it | Viewer tree, instancing per definition | GPU viewer; WebGL2 and CPU image fallbacks | 2-3 |
| S3 | Trust | Full reference states, observed fit tier | CPU analysis maps on the pool | 3-5 |
| S4 | Mates, BOM and library | Fastened mates, Replicate, BOM, named DOF, exploded steps | Batch lane: candidates and sweeps | 3-4 |
| S5 | Approve and print (ID-0) | Enclosure templates, print plates | Slicer estimate as a CPU subprocess | 3-5 |
| S6 | Mechanisms | Tree joints, motion, swept clash | Swept clash across the pool | 3-4 |
| S7a | GPU analysis | GPU fit pre-check and clearance maps across the assembly | WGSL pack with CPU twins, device profiles | 2-3 |
| S7b | Providers | none | Provider router, licence manifests, budget and egress approvals, 3dj quotes if P-1 ships | 1-2 |
| S8a | Concept boards (ID-1) | none | Python GPU sidecar, stable-diffusion.cpp on the CPU, cloud GPU | 2-3 |
| S8b | Massing (ID-1) | Massing rebuilt as an assembly | TRELLIS on local CUDA or cloud; DSL massing on the CPU | 1-2 |
| S9 | Form and CMF (ID-2) | CMF per occurrence | Cycles GPU or CPU | 3-5 |
| S10 | Moulding DFM (ID-3) | Gates per moulded definition | GPU screens ray casts | 3-5 |
| S11 | Engineering and validation (ID-4) | Loop solver, tolerance stacks | CalculiX on CPU | 4-6 |
| S12 | Handoff and RFQ (ID-5) | Drawings and AP242 of the assembly | HLR drawings on CPU | 3-5 |

S0 to S6 deliver the agent core with mechanisms in 19 to 30 FW: about 38 to 77 calendar weeks at the default cap of 15 hours a week, or 18 to 32 weeks at 25 hours a week. The ladder to RFQ is 38 to 61 FW: about 76 to 157 weeks at 15 hours a week, or 36 to 65 weeks at 25 hours a week. The low ends assume a 6-hour loop and the high ends an 8-hour loop.

### S0. Line and gauge (2-4 FW)

- **Goal:** set up the production line and measure real machines before designing around guesses.
- **Ships:** the standard work, hooks and CI of section 4 (issues 1 to 9 in section 12); contract schemas v0 ([ARCHITECTURE.md](ARCHITECTURE.md) section 2); o3dj-bench v0 (a regression split of 20 deterministic tasks: the 18 public 3dj starters plus 2 multi-part assembly variants; a capability split of 10 multi-part enclosure briefs; task-lint, which in S0 checks reference solutions against goldens captured from the 3dj workbench and from S1 runs them through Open3DJ; the 20 regression tasks join the regression suite in S1, section 4.3); `corpora/reference-assemblies` (the 145-occurrence plate, the 10 enclosure briefs as assemblies, a generated assembly of 1,000 or more occurrences, and dense wall-thickness maps of about 1M rays or more on the enclosure parts), which is the S7a corpus; golden STEP files and measures for the 18 starters, captured once from the 3dj workbench into `corpora/` as the conformance reference ([ARCHITECTURE.md](ARCHITECTURE.md) section 7); the H-det run without the S1 facade (20 fresh processes and 20 warm reuses on the 3 starters that the issue 15 spike runs, plus a shell and offset corpus written as raw occt-wasm scripts, on each tier-1 OS, [ARCHITECTURE.md](ARCHITECTURE.md) section 8); `open3dj doctor --bench` (DeviceInventory, kernel micro-benchmarks, worker scaling, a viewer frame-time probe, optional WebGPU probe), published as `npx open3dj doctor --bench` once the name is cleared (decision 1) and run from a git checkout and CI until then; the ID-0 playbook for the 3dj.app MCP as a draft SKILL.md; a baseline value stream from 2 or 3 enclosure briefs on 3dj.app (time per stage, rework loops, first-print fit), filled in by hand in the issue 16 template.
- **Kaizen metric:** fresh clone to green `check` in 10 minutes or less on Linux, macOS and Windows.
- **Exit:** `doctor --bench` JSON from all five tier-1 CI runner types and the founder's own machines (at least one GPU; if the founder has none, a volunteer's GPU, a cloud GPU on Modal Starter credits, where a headless Dawn run is to verify, or the decision 9 GPU runner); occt-wasm pool scaling re-measured on an idle machine (the contended spike gave 1.67x with 4 workers, [research/spike-occt-wasm.md](research/spike-occt-wasm.md)); H-det result recorded, with its fallback chosen if it fails; baseline value stream recorded.

### S1. Agent Preview: every design is an assembly (3-5 FW)

- **Goal:** every major MCP client gets a write, run, see, export loop where every design is an assembly.
- **Ships:**
  - `npx -y open3dj mcp`, dual-era, five tools, CLI parity, QuickJS-WASM sandbox, kernel in workers.
  - DSL v1 core: `Param`, primitives, sketches, batched booleans, fillet and chamfer by edge query, shell, patterns, named descriptor returns, `connector.male/female`, `matchTo` (recorded as a fastened mate; a second mate on the same occurrence is reported as redundant or conflicting with its residual, never silently ignored), `attachTo`, `withReferences`, and the undocumented calls the starters use (`.color()`, `.name()`, `lib.bolt`, `lib.nut`, `lib.washer`, `.cutPlane`).
  - Assembly graph: named definitions, occurrences with transforms (translation plus quaternion), sub-assemblies, connectors.
  - GeometryReport per definition and for the whole assembly (validity, volume, bbox, mass, centre of mass, counts), with reference states from a fingerprint resolver (exact, ambiguous with candidates, broken) and an exact clash, contact and clearance table on AABB candidates.
  - HLR multiview renders of the whole assembly and each part.
  - Multi-part STEP (XCAF, names at both levels), 3MF components and build items, per-definition glTF, and STL.
  - Compute contract; append-only `provenance.jsonl`, each line with the DeviceInventory hash; `inspect fields=[devices]`; own CPU worker pool with captured worker stdout, one kernel per worker, interactive and batch lanes, recycling at 1.5 GiB of WASM memory plus JS heap; `compute: auto|cpu` (a `gpu` or `cloud` request returns a structured error naming the missing backend).
  - A minimal job model: work that misses the interactive deadline returns what it has plus a `job_id`, which the agent polls with `inspect fields=[job]` and cancels with `run ops=[{op: "cancel_job"}]`.
  - SKILL.md, Claude Code plugin, MCP Registry entry (under a cleared name), CI client matrix and manual client checklist.
- **Release order:** S1 ships as weekly releases in three slices, so feedback starts early: (1) `npx`, the dual-era server, the sandbox, the DSL core and the five tools over a one-occurrence assembly, with HLR renders, STEP, STL, SKILL.md and the CI client matrix; (2) occurrences, sub-assemblies, connectors, `matchTo`, exact fits, 3MF and glTF; (3) the interactive and batch lanes with the job model, the Claude Code plugin and the registry entry. The Kaizen metric is tracked from slice 2, when the multi-part briefs can run; the exit applies to the whole step.
- **Kaizen metric:** pass^3 on the capability split of bench v0 with Claude Code (Codex and Gemini CLI reported when their quotas allow).
- **Exit:** pass^3 at least 70%; `npx` to first multi-part STEP in 5 minutes or less (on a packed tarball until the first npm publish, as in G5) on the five tier-1 runners and in recorded sessions; client compatibility green in both layers of [ARCHITECTURE.md](ARCHITECTURE.md) section 9: the CI client matrix (scripted SDK clients at each protocol era, plus recorded handshakes of each named client, with no secrets) and the founder's manual client checklist, recorded in the build log. Pool scaling and interactive p95 are observed, not gated ([COMPUTE.md](COMPUTE.md) section 11).

### S2. See it: GPU viewer (2-3 FW)

- **Goal:** humans can see agent assemblies quickly; the first GPU path ships.
- **Ships:** a read-only page served by the daemon on loopback with a nonce; three.js WebGPURenderer with WebGL2 fallback and a CPU HLR image view where no GPU context exists; assembly tree; `InstancedMesh` per definition; GPU picking that copies an element address for the agent; clash and reference overlays from report data.
- **Kaizen metric:** viewer-only defects per week: problems a human sees in the viewer that the report did not flag. Each one becomes a regression task.
- **Exit:** the frame-time gate: orbiting the 145-occurrence reference assembly, measured by the S0 frame-time probe on the founder's GPU machine (an integrated GPU counts; if the founder has no GPU at all, this gate is waived in an A3 and volunteer reports are recorded instead), has p95 under 33 ms (about 30 fps) with WebGPU and under 50 ms (proposed) with WebGL2; the assembly opens with WebGL2 in headless CI (`--enable-unsafe-swiftshader`, tests only), and the HLR image view appears when no context exists; no viewer-only defect stays open longer than one week.

### S3. Trust (3-5 FW)

- **Goal:** agents know a part or assembly is right and keep it right while editing.
- **Ships:** FDM evidence gates per printable definition (watertight, 0.8 mm wall, 45 degree overhang, 220 x 220 x 250 mm bed) computed on the CPU, with wall-thickness ray casts (three-mesh-bvh) spread across the pool; gate split into agent-waivable (with a reason) and human-only; full five-state references using occt-wasm history ops plus fingerprints; Manifold "observed" fit tier before exact checks; `open3dj replay` over the provenance recorded since S1; export-gate hook in the plugin; structured errors with a suggested fix and `next` hints.
- **Kaizen metric:** error recovery: share of failures fixed within 2 further calls.
- **Exit:** recovery at least 80%; zero false passes on the seeded gate corpus; zero silent mis-resolutions in a 1,000-edit sweep. Human-only waivers stay blocked until S5.

### S4. Mates, BOM and library (3-4 FW)

- **Goal:** agents assemble products from standard parts and see what is under-constrained.
- **Ships:** persisted fastened mates on connectors (closed form); Replicate onto matching connectors (for example screws onto every `hole_*`); mate status from the single enum in [ASSEMBLIES.md](ASSEMBLIES.md) section 4.4 (conflicting mates with their residual, ambiguous and broken ones with candidates); named free DOF per occurrence in connector terms; declared fits (press, thread); named configuration tables; derived flat and structured BOM (CSV) with stored part numbers; exploded views as ordered assembly steps, edited by the agent and shown in renders and the viewer; ISO fastener and heat-set insert library with connectors and BOM fields under the Library Convention checker; `candidates[]` (best-of-N) and `sweep` on the batch lane; a regression test with a conflicting mate. The four-bar test waits for revolute joints in S6.
- **Kaizen metric:** seeded assembly faults named by the report.
- **Exit:** 100% of seeded mate and fit faults named, zero false passes; first external library part merged through the checker (bonus, not a gate).

### S5. Approve and print: ID-0 (3-5 FW)

- **Goal:** close the loop from brief to a measured prototype in the hand, with humans approving.
- **Ships:** daemon-owned approval objects with payload hashes (human-only waivers, design freeze pinning the revision and Evidence Pack hash, quote acceptance; egress approvals use the same service from S7b), shown on the nonce page and delivered as `approval_pending{url, id}`; an exploded-step editor in the viewer that writes through `run` with `base_rev` on the nonce page; a WebAuthn user-verification spike; `brief.o3j.yaml` with executable assertions and a clarify pass; enclosure templates as assemblies (two shells, PCB placeholder, buttons, heat-set inserts, screws); per-part 3MF print plates; a free OrcaSlicer subprocess estimate (AGPL, never linked), which covers ID-0 (3dj.app quotes join in S7b if proposal P-1 ships); a prototype record (photos, calliper readings and CMF sample chips labelled "measured"), where each failed fit drafts an eval task and a 5-whys stub; value-stream recording from timestamps, plus single-field entries on the approval page and prototype record for the counts only a human knows ([INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 6).
- **Kaizen metric:** first-print fit rate.
- **Exit:** at least 80% over 10 prints (the founder's printer counts; volunteer prints are a bonus).

### S6. Mechanisms (3-4 FW)

- **Goal:** agents build moving products (hinges, slides, lids, gear trains) with explicit degrees of freedom.
- **Ships:** tree joints (revolute, slider, cylindrical, planar) in closed form with limits bound to Params; named DOF; motion-sample renders; swept clash across N poses spread over the batch lane; `EXT_mesh_gpu_instancing` in glTF; URDF export; hinged-lid and drawer-slide templates; a four-bar regression test, whose cycle-closing joint is reported with mate status `loop_unsolved` and its free motion named until the S11 solver reports mobility 1.
- **Kaizen metric:** pass^3 on 10 mechanism briefs.
- **Exit:** pass^3 at least 70%; every seeded joint and swept-clash fault caught.

### S7a. GPU analysis (2-3 FW)

- **Goal:** GPU acceleration for analysis and implicit work behind CPU twins.
- **Ships:** optional `@open3dj/accel-webgpu` pack (Dawn, installed on demand); WGSL wall-thickness and clearance ray casts, an assembly fit pre-check (broad phase and mesh distance screening that may only drop pairs beyond the watch distance plus a guard band) and SDF and lattice previews, each under the CPU-twin merge rule and the bounded-screening rule ([COMPUTE.md](COMPUTE.md) section 6); a lattice op meshed on the CPU (Manifold LevelSet); re-queue on the CPU twin on device loss, out-of-memory or TDR; per-device profiles and local placement.
- **Kaizen metric:** analysis time per kernel, `auto` against `cpu`, on `corpora/reference-assemblies`.
- **Exit:** each merged WGSL kernel is 3x or more faster on its workload in the large corpus (the 1,000-occurrence assembly, the dense wall maps) on the founder's GPU (if the founder has none: a volunteer's GPU, a cloud GPU on Modal Starter credits or the decision 9 GPU runner), with volunteer GPUs reported; no slowdown under `auto` on the enclosure corpus; zero verdict differences. Kernels without the gain are dropped. S7a may close with only the device profiles and the fallback path if no kernel earns its place.

### S7b. Providers (1-2 FW)

- **Goal:** send work off the machine only with licence checks, a budget and a human approval.
- **Ships:** provider router v1 (placement across local CPU, local GPU and cloud by [COMPUTE.md](COMPUTE.md) section 3.3); licence manifests checked at runtime; daemon-owned egress and budget approvals on the S5 approval service; a stub provider in CI that speaks the job spec; the 3dj.app provider for operator-reviewed quotes (`export format=quote`), live only if proposal P-1 ships. 3dj.app generation joins in S8b; its OpenSCAD compile waits for the OpenSCAD input item on the pull board.
- **Kaizen metric:** share of provider jobs whose licence manifest and approval were shown before any call. First-placement success is a secondary indicator ([COMPUTE.md](COMPUTE.md) section 11: provider jobs re-placed or retried).
- **Exit:** 100% shown before any call across the stub suite and every real provider job; zero egress without an approval.

### S8a. Concept boards: ID-1 (2-3 FW)

- **Goal:** get from an approved brief to chosen design directions on any machine, with or without a GPU.
- **Ships:** `generate kind=gen.image` and `render view=board`; `uvx` Python GPU sidecar (CUDA, MPS, ROCm, XPU) sharing one job spec with cloud providers; concept boards from FLUX.1 schnell or Qwen-Image (Apache-2.0), recording prompt, model, licence and seed, labelled "concept, not geometry"; a `cpu.sdcpp` backend that runs [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (MIT) with quantised GGUF weights of the same models, each weight file under the same licence manifest, labelled "preview" because it is slow; its approval card shows the CPU time estimate per image and per board; `auto` picks it when no capable GPU exists and egress is `never`, or when the user prefers it; the user's own cloud GPU with approval; onnxruntime-node small models (background removal) on the CPU or GPU. A human picks the directions.
- **Kaizen metric:** hours from approved brief to chosen directions.
- **Exit:** baseline measured on 3 briefs, at least one of them on a machine with no GPU and egress `never`; CPU time per image recorded.

### S8b. Massing: ID-1 (1-2 FW)

- **Goal:** turn a chosen direction into an approved, editable massing assembly.
- **Ships:** `generate kind=gen.massing`; TRELLIS v1 geometry-only clean runner on local CUDA when the card has room for it under the placement memory rule ([COMPUTE.md](COMPUTE.md) section 3.3), otherwise routed to the cloud with approval, as on Apple, AMD and Qualcomm machines; 3dj.app generation as a provider: text-to-3D, and image-to-3D from a local board only once proposal P-1 ships (until then only from an image the user already hosts at a public HTTPS URL, sent under its own egress approval); restricted packs (TripoSG, TRELLIS.2, Hunyuan3D) opt-in only; the agent rebuilds a generated massing as an editable assembly labelled "assumed" and reports the Hausdorff distance. The CPU path works on every machine: the agent writes the massing directly in the DSL from the approved board, runs it on the CPU pool and labels it "assumed" (a `docs` playbook page). TripoSR (MIT) is a candidate mesh backend on the sidecar's CPU (MPS to verify), labelled `preview` and "assumed", only after a four-layer licence audit of its chain (to verify; [COMPUTE.md](COMPUTE.md) section 2). A structured refusal comes back only when the user insists on a generated mesh and no local mesh backend is cleared. A human approves the direction. An ANSUR II grip and reach envelope check ships here only if a handheld brief pulls for it.
- **Kaizen metric:** hours from approved brief to approved direction.
- **Exit:** baseline measured on 3 briefs. Halving it on the next 3 briefs is tracked on the scorecard afterwards, not gated.

### S9. Form and CMF: ID-2 (3-5 FW)

- **Goal:** make surface quality legible to agents, with draft and wall designed into the form.
- **Ships:** lofts and sweeps with continuity options; guided and binormal sweeps return a structured warning and have a seeded expected-volume regression test until OCCT #1681 is fixed, because OCCT 8.0.1 gives them wrong volumes (reported in build123d #1474, [research/gap-3.md](research/gap-3.md); if DSL v1 exposes these modes earlier, the warning and test move to that step); MakeFilling (G1, G2) and Gordon surfaces accepted only after `G2Error` and `IsApproximate` checks; a CPU-computed continuity table (G0 gap, G1 angle, G2 jump per shared edge; curvature per face); zebra and curvature shaders in the viewer plus CPU renders for CI; advisory draft and wall-map overlays for a declared pull direction; `cmf.o3j.json` (sRGB or Lab, resin, finish class, texture depth; no Pantone) exported as glTF `KHR_materials_variants`; Cycles as a render provider inside an official Blender build run as a `blender -b` subprocess (GPL, never linked; GPU where present, CPU otherwise). Open3DJ does not build Cycles. Official Blender builds cover Windows x64 and ARM64, macOS arm64 and Linux x64; on Linux ARM64 a `cmf` render needs a distribution's Blender package (to verify) or returns a structured error ([ARCHITECTURE.md](ARCHITECTURE.md) section 11).
- **Kaizen metric:** review rounds until form and CMF sign-off.
- **Exit:** a seeded continuity corpus fully reported; a reference handheld passes form and CMF approval in at most 2 review rounds each.

### S10. Moulding DFM: ID-3 (3-5 FW)

- **Goal:** catch injection-moulding problems before a moulder does, from cited public rules.
- **Ships:** `im.<resin>.v1` gate profiles (ABS, PC, PP, PA) with citations and versions: draft per face against depth and texture, wall map against resin range, ribs at 40 to 60% of wall, boss rules, undercuts by ray casting, parting-line candidates from HLR silhouettes, sharp corners, sink risk; a `draft` op for planar, cylindrical and conical faces, with freeform faces flagged; GPU screening of ray casts with CPU confirmation; a golden corpus of about 30 seeded-defect parts. Labelled "rule check, not simulation".
- **Kaizen metric:** share of seeded DFM defects the agent fixes without help. DFM escapes reported by suppliers are tracked from S12, when RFQs start ([INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 6).
- **Exit:** at least 70% fixed by the agent; zero false passes on the corpus.

### S11. Engineering and validation: ID-4 (4-6 FW)

- **Goal:** honest engineering checks for moving and tolerance-critical products.
- **Ships:** own Levenberg-Marquardt solver with DOF = 6n - rank(J), naming redundant and conflicting mates and warning on branch changes; worst-case and RSS tolerance stacks with user-entered ISO 20457 class names (standards cited by number only); CalculiX (and Elmer) as GPL subprocess providers on the CPU with mesh-convergence evidence, labelled "simulation, not test"; MJCF export; a physical drop-test protocol for prototypes.
- **Kaizen metric:** share of the S11 validation corpus reported correctly: seeded loop and mate faults named, seeded tolerance stacks matching their hand calculations, and FEA benchmarks within 2% of analytic results.
- **Exit:** every corpus case passes: a four-bar reports mobility 1; a seeded conflicting mate is named; a seeded worst-case and RSS stack matches its hand calculation; cantilever, plate and fin within 2%.

### S12. Handoff and RFQ: ID-5 (3-5 FW)

- **Goal:** give suppliers a pack they can quote without asking questions.
- **Ships:** HLR drawing sheets (SVG and PDF) with title block and critical dimensions only, human-approved; AP242 with semantic PMI for critical dimensions via an occt-wasm facade contribution; an RFQ pack (STEP, drawing, CMF sheet, BOM, quantities, Evidence Pack, open questions) generated only from a design freeze; a quote comparison table. Humans send every RFQ and place every order.
- **Kaizen metric:** supplier clarification questions per RFQ.
- **Exit:** baseline from the first 3 RFQs, falling on the next 3.

### Industrial design slices at a glance

| Slice | Where | Humans approve |
|---|---|---|
| ID-0 Brief to printed prototype | Playbook S0, dogfood S1 to S4, formal S5 | Brief, design freeze, quote |
| ID-1 Concept and massing | S8a, S8b | Directions, then direction |
| ID-2 Form and CMF | S9 | Form, CMF |
| ID-3 Moulding DFM | S10 | Waivers |
| ID-4 Engineering and validation | S4, S6, S11 | Tolerance scheme, reading of simulation |
| ID-5 Drawings, AP242 and RFQ | S12 | Every RFQ and order |
| ID-6 Class-A, Moldflow interop for licence holders, QIF first article, tooling liaison | Volunteer research lane, no dates | Everything |

## 7. Deliberately deferred (the pull board)

Each item has a trigger; when it fires, the item becomes an issue with an A3.

- Large-assembly mode (BatchedMesh, LOD, graphics-only, lazy load; the GPU fit pre-check ships in S7a): a real project over 1,000 occurrences, or a real project misses the S2 frame-time gate.
- In-context and top-down design with pinned snapshots: 3 or more cross-part dimension-copy errors a month in transcripts.
- Kinematic studies, IK, MuJoCo: a mechanism or robotics project needs them.
- GPU simulation (Warp FEM, MuJoCo Warp, PETSc): CalculiX p95 over budget on real ID-4 studies.
- OndselSolver as WASM: the LM solver fails on real assemblies, or gear and screw relations are requested.
- Memory64 or native N-API kernel: a part exceeds 4 GiB, or p95 `run` over 2 s.
- Rust host via the occt-wasm crate: a single-binary need Node SEA cannot meet.
- OS sandbox (bubblewrap, Seatbelt, AppContainer): before any non-loopback transport, or a sandbox finding.
- Python build123d tier, OpenSCAD input: a bench ablation shows the JS DSL 5 or more points behind. Method: once a quarter, the founder or a volunteer runs the capability split through the external build123d-mcp server (Apache-2.0, over stdio) in a Linux x64 CI job, so agent-written Python runs only on a disposable runner, and records the result in the build log. Scoring its STEP output with the bench harness is to verify.
- Desktop shell, installers, auto-update, signing: measured user demand.
- MCP Apps viewer, SEP-2663 Tasks: two or more major clients support them by default.
- Public leaderboard, static gallery and browser playground: bench stable for 3 months and a volunteer owns upkeep.
- Telemetry: never by default; crash data stays local.
- Scan to CAD, sketcher, sheet metal, CAM, and gate profiles for SLA, SLS, MJF, CNC and sheet metal: user pull with a named project ([INDUSTRIAL-DESIGN.md](INDUSTRIAL-DESIGN.md) section 3.10).

Never: salaries, burn or hiring; TripoSG or any restricted model as a default; SMPL-X bodies; Pantone libraries; GPL or AGPL code in process; automatic ordering; any verdict of record from GPU output, or any GPU-screened verdict without a measured bound; any GPU path without a CPU placement.

## 8. Risks and countermeasures

- **Founder overload and review bottleneck.** WIP cap of 3, small PRs, hooks, review ladder, capped hours.
- **Single-maintainer dependencies (occt-wasm, brepjs).** Exact pins, mirrors, reproducible occt-wasm build, vendored `KernelAdapter`, DSL as the only public API, weekly gated upgrade batch.
- **JS DSL has less pretraining than CadQuery or build123d.** `docs` tool, SKILL.md examples, bench ablation trigger for a Python tier.
- **4 GiB wasm32 cap and heap leaks.** Worker recycling, 10,000-op soak, mesh-first large assemblies, swap triggers.
- **GPU nondeterminism.** GPU screens, CPU decides; CPU twin merge rule; red andon on any verdict difference.
- **Unmeasured GPU gains; pool scaling measured only under contention** (1.67x with 4 workers on a shared 4-vCPU container, [research/spike-occt-wasm.md](research/spike-occt-wasm.md)). With one worker reserved for the interactive lane, a 4-core machine has 2 batch workers, so batch-lane plans assume modest gains until the S0 idle-machine re-run and CI data say otherwise, before S3 and S7a depend on them.
- **Approval spoofing by a local agent with shell access.** Daemon-owned approvals, payload hashes, MCP `accept` never treated as consent, WebAuthn spike, documented residual risk.
- **False confidence from rule-based DFM or gates.** "Rule check, not simulation" labels, golden corpora, human approval, red andon on any false pass.
- **Licence contamination.** Four-layer licence gate, model-pack manifests, GPL and AGPL only as subprocesses.
- **Trademark conflict with OPEN3D, and EU or UK risk from 3DJake.** Name chosen and cleared by a counsel opinion, through a free clinic first, before the first npm publish or any other public listing (section 11, [research/gap-5.md](research/gap-5.md)).
- **Flood of low-quality AI PRs.** AI_POLICY, PR cap of 2 for outsiders, checker-first lanes.
- **Volunteers never arrive.** Every exit criterion can be met by the founder and agents alone, except S8a, S8b and S12, which need real briefs and supplier responses (founder dogfood work, decision 4); if fewer are available, the exit is waived in an A3 with the count reached. This assumes the founder has at least one machine with a GPU; if not, S0, S2 and S7a use the fallbacks named in their exits.
- **Client confidentiality in dogfood work.** Local-only by default, egress approvals, eval tasks derived from client work only with consent.

## 9. Relationship with 3dj.app

3dj.app is Open3DJ's closed hosted sibling. Today Open3DJ uses it as:

- **the DSL reference:** the 3dj DSL and its 18 public starters are the conformance target;
- **a provider:** operator-reviewed print quotes (from S7b, if P-1 ships), generative 3D on the managed GPU fleet (from S8b: text-to-3D, and image-to-3D from a local board once P-1 ships) and OpenSCAD compilation (only if OpenSCAD input is pulled, section 7), reached through 3dj's public MCP server under the user's own account and an egress approval;
- **the ID-0 baseline:** S0 records the current brief-to-prototype value stream on 3dj.app.

No Open3DJ step depends on a 3dj.app change. Proposals for the 3dj.app team (proposals only, not commitments):

1. **P-1:** add a presigned upload tool that both `request_print_quote` and `generate_from_image_url` can use, and an evidence-hash field to `request_print_quote`, so locally built parts can be quoted and local concept boards can be sent for image-to-3D. Until then the OrcaSlicer estimate covers ID-0, and 3dj image-to-3D works only from an image the user already hosts at a public HTTPS URL ([research/gap-9.md](research/gap-9.md)).
2. **P-2:** publish a versioned DSL reference with a changelog, so the conformance suite tracks it.
3. **P-3:** accept the Open3DJ Evidence Pack as an attachment for operator review.
4. **P-4:** publish the DSL specification (not the service) under an open licence.
5. **P-5:** point 3dj.app's agent docs to Open3DJ as the local engine.

## 10. Licensing and governance

- **Code:** propose dual licence MIT OR Apache-2.0 with DCO sign-off (no CLA). Today the repo is MIT; the change needs the founder's decision and, for existing contributions, contributor agreement.
- **Kernel and tools:** `occt-wasm.wasm` (LGPL-2.1-only) ships as a separate, replaceable file. Everything bundled is permissive; GPL and AGPL tools (CalculiX, Elmer, Blender, slicers) run only as subprocesses.
- **Models:** licence manifests (licence, territory, commercial use, model hash) shown before any download; restricted packs opt-in.
- **Standards and data:** ISO standards cited by number only; numeric colour only; anthropometric dataset and population recorded on every check.
- **Governance:** as in [../GOVERNANCE.md](../GOVERNANCE.md): lazy consensus, RFCs for breaking contract changes (additive changes need only a minor schema version bump, [ARCHITECTURE.md](ARCHITECTURE.md) section 2), the lead maintainer breaks ties, and an intent to move the trademark to a neutral foundation as the community grows.

## 11. Founder decisions needed

1. **Name.** OPEN3D is a live US mark (Reg. 6468139, class 9) one letter from OPEN3DJ. The EU and UK registers could not be checked, and 3DJake (niceshops GmbH) is a large EU and UK 3D-printing store whose trademark status is unknown ([research/gap-5.md](research/gap-5.md)). Choose a name on the 3DJ house mark that avoids the OPEN3D conflict. Run the free USPTO, EUIPO and UKIPO searches, then get a clearance opinion from counsel, including a full EU and UK search with 3DJake in mind, before the first npm publish or any other public listing. A self-search is not a clearance. The free route to the opinion is a university IP clinic or a pro bono programme; filing 3DJ in classes 9 and 42 is optional founder spend (table below). Reserve namespaces only under the final name. *When:* the clearance opinion before the first npm publish, planned in S0. Until then `doctor --bench` runs from a git checkout (`node packages/open3dj/bin doctor --bench`) and in CI, and the npm criterion of section 4.6 applies from that publish. Namespaces are currently free.
2. **Licence** change to MIT OR Apache-2.0. *When:* S0. Today MIT.
3. **3dj.app proposals** P-1 to P-5: which, if any, the founder will do as 3dj.app owner. *When:* any time. Not a dependency.
4. **Dogfood source:** whether founder client briefs feed ID-0, and the consent rule for turning them into eval tasks. *When:* S0. Open briefs work too.
5. **Weekly founder-hour cap** (default 15 hours, including the 6 to 8 hour loop; section 6 converts FW to calendar weeks at this cap) and the review WIP cap of 3. *When:* S0.
6. **OndselSolver spike:** approve a native and Emscripten build when its trigger fires. *When:* later. Needs human approval.
7. **Signing:** Apple $99 a year only when a macOS GUI is pulled; Windows through an individual Microsoft Store account or SignPath Foundation after the first release, or Azure Artifact Signing (about $9.99 a month) only if Neural Deep Network LTD must be shown as publisher. *When:* a desktop shell is pulled.
8. **Free programmes:** apply to Codex for OSS now; aim for Claude for Open Source eligibility; never plan on them. *When:* S0.
9. **GPU CI runner:** a paid GPU runner or none. GitHub GPU runners are larger runners, which only organizations on the GitHub Team or Enterprise Cloud plan can use, and which are billed per minute even on public repositories ([larger runners](https://docs.github.com/en/actions/concepts/runners/larger-runners), checked 28 Oct 2026). The cost is about $2 a month in minutes for a weekly 10-minute run (Linux 4-core GPU at $0.052 a minute, [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), checked 28 Oct 2026; [COMPUTE.md](COMPUTE.md) section 7), plus the Team plan's per-seat price (to verify). Free alternatives: volunteer `doctor --bench` JSON, or a weekly manual run on the founder's GPU. Never self-hosted runners on the public repo. *When:* when founder and volunteer `doctor --bench` data stop being enough.

**Cash costs and free alternatives.** Nothing here is needed to start. Each row lists the free path first; the cash column is optional founder spend unless marked otherwise ([research/kaizen-ops.md](research/kaizen-ops.md)).

| Item | When | Free path | Small cash |
|---|---|---|---|
| Name and trademark | S0 | A name on the 3DJ house mark; free USPTO, EUIPO and UKIPO searches; a clearance opinion from a university IP clinic or pro bono programme (required before the first publish) | A paid clearance opinion only if no free route gives one in time (cost to verify); filing 3DJ in classes 9 and 42 in the US, EU and UK (optional; fees to verify) |
| Print material | S0 baseline, S5 exit (10 prints), CMF sample chips (S9) | The founder's own printer and callipers; volunteer print-and-measure reports | Filament and sample chips (unavoidable for ID-0; amounts to verify) |
| Cloud GPU for TRELLIS | S8b, only if the founder's GPU has no room for TRELLIS v1 under the placement memory rule ([COMPUTE.md](COMPUTE.md) section 3.3): its declared peak must fit within 90% of free VRAM, so an 8 GB card never has room, a 24 GB or larger card does, and a 16 GB card only if the measured peak fits (to verify in S8b) | Massing written in the DSL on the CPU (skip TRELLIS); Modal Starter's $30 a month of credits; volunteers' GPUs | Per-job spend under a daemon budget (about a cent of GPU time per asset, [research/compute-local-and-cloud.md](research/compute-local-and-cloud.md)) |
| Agent subscriptions | S0 onward | Codex for OSS; Claude for Open Source once eligible; a free Gemini API key (daily Flash quota to verify in the AI Studio console: [research/kaizen-ops.md](research/kaizen-ops.md) records 250 requests a day, and press reports from December 2025 say about 20) | The founder's existing Claude subscription, which runs `claude-code-action` and the weekly capability evals; paid Codex or Gemini plans only if capability runs need them (to verify) |
| GPU CI runner | Decision 9 | Founder and volunteer `doctor --bench` JSON; a weekly manual run on the founder's GPU | About $2 a month in runner minutes, plus a GitHub Team plan for the organization (per-seat price to verify) |
| Windows signing | A desktop shell is pulled | An individual Microsoft Store account (free registration is stated only for individuals, not companies); SignPath Foundation after the first release | Azure Artifact Signing, about $9.99 a month, only if the company must be shown as publisher |
| macOS signing | A macOS GUI is pulled | None needed for the headless npm package | Apple Developer Program, $99 a year |
| Domain | Optional | github.io | A domain |

## 12. The first two weeks: issues to open

Week 1: the line.

1. Add AI_POLICY.md (Assisted-by trailer, human-only DCO, no agent PR without a human click).
2. Trim AGENTS.md to under 200 lines; make CLAUDE.md import it.
3. Branch protection, merge queue, required checks, per-user PR cap of 2, `andon` and `experiment` labels.
4. Issue forms: failure report, part request, bench task, hardware report; PR template with the definition of done.
5. One-command `check` (lint, typecheck, unit, conformance stub) under 10 minutes; Stop hook that runs it.
6. PreToolUse hooks guarding goldens, tolerance tables, the licence allowlist and secrets.
7. CI matrix on the five tier-1 runners: `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `windows-latest` and `windows-11-arm`; licence gate job.
8. `claude-code-action@v1` with the subscription token, `--max-turns` and concurrency groups.
9. Founder decisions 1 (free name searches, then a counsel clearance opinion through a free clinic first), 2, 4, 5 and 8 recorded as issues.

Week 2: the gauge.

10. Contract schemas v0: GeometryReport, references, Evidence Pack, jobs, approvals, provenance, compute block, `.o3j` manifest.
11. `KernelAdapter` vendored; occt-wasm and brepjs pinned exactly and mirrored; reproducible occt-wasm build documented.
12. `open3dj doctor --bench`: DeviceInventory, kernel micro-benchmarks, worker scaling, viewer frame-time probe, optional WebGPU probe; run on all five tier-1 CI runners.
13. Re-run the existing pool benchmark ([research/spike/pool_bench.mjs](research/spike/pool_bench.mjs)) on an idle founder machine (8 or more cores if available). The contended 4-vCPU run gave 1.67x with 4 workers ([research/spike-occt-wasm.md](research/spike-occt-wasm.md)). Run H-det on the same machine and on the CI runners, on the 3 starters that the issue 15 spike runs plus a shell and offset corpus written as raw occt-wasm scripts.
14. o3dj-bench v0: task schema with task-lint (reference solutions checked against the 3dj workbench goldens until the S1 facade can run them); regression split of 20 deterministic tasks (the 18 public 3dj starters plus 2 multi-part assembly variants); capability split of 10 multi-part enclosure briefs; `corpora/reference-assemblies`; golden STEP and measures for the 18 starters captured from the 3dj workbench. As built: the regression split has 12 tasks from Open3DJ's own parts instead of the starters ([bench/README.md](../bench/README.md)), and it runs in `npm run check`.
15. Spikes: dual-era stdio echo server against Claude Code (default and legacy), Codex and Gemini CLI, recording each client's opening handshake as the first CI client-matrix fixtures; QuickJS worker with the DSL facade on 3 multi-part starters.
16. ID-0 playbook for the 3dj.app MCP as a draft SKILL.md; a value-stream template (`ops/value-stream.md`, one row per stage: stage, start, end, rework count); baseline value stream from 2 or 3 briefs, filled in by hand in that template.
17. First Friday review: scorecard, A3 template, build log.
