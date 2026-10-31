# Open3DJ roadmap

This is the public roadmap: where Open3DJ is going, what each step ships, and how you can help with each one, as a person or with your AI agent. The full plan, with metrics, exit criteria and the reasons behind each decision, is [docs/PLAN.md](docs/PLAN.md). If this page and PLAN.md disagree, PLAN.md wins; please open an issue so we can fix this page.

Last updated: 2026-10-29.

## Where we are going

Open3DJ aims to be the best agentic CAD software you can get: an open-source, local-first CAD engine that AI agents drive through MCP, and that people review and approve in a professional interface.

Agents fail at CAD for four reasons. They cannot see what their code did, they cannot point at geometry in a stable way, they cannot recover from kernel errors, and they cannot prove the result is right. Open3DJ is built to fix all four: a GeometryReport after every change, stable named references, structured errors with hints, deterministic drawings and honest evidence checks.

Every design is an assembly, from a single bracket to a product with enclosure halves, a circuit board, buttons and screws. Every heavy calculation has a CPU path, and a GPU only speeds things up; the CPU kernel always has the final word. The same engine is meant to carry a physical product from a brief and a concept through form, color and material, engineering and design for manufacture, to a pack a supplier can quote. Agents do most of the work. People approve taste, money and anything that leaves the machine.

## How the roadmap works

- **Small releases.** Each step ships as weekly releases. There are no calendar dates, because the team is the founder, volunteers and AI agents, with no paid engineers ([docs/PLAN.md](docs/PLAN.md) section 4).
- **One metric per step.** Each step has one Kaizen metric and one exit criterion. A step is done when the exit is measured on real use.
- **The order can change.** After S7b, the order can change when the measured bottleneck says so (PLAN.md section 5).
- **Status words.** **Done**: the exit criterion was met. **In progress**: parts have shipped and work continues. **Next**: the step after the ones in progress. **Later**: planned, not started.

## Status at a glance

| Step | Name | Status | In one line |
|---|---|---|---|
| [S0](#s0-line-and-gauge) | Line and gauge | In progress | The production line (checks, hooks, bench) and measurements on real machines |
| [S1](#s1-agent-preview) | Agent Preview | In progress | A write, run, see and export loop over MCP, where every design is an assembly |
| [S2](#s2-see-it) | See it | In progress | A local 3D viewer for people, with a GPU path and fallbacks |
| [S3](#s3-trust) | Trust | Next | Print checks, full reference states, error recovery, replay |
| [S4](#s4-mates-bom-and-library) | Mates, BOM and library | Later | Fastened mates, a bill of materials and a standard parts library |
| [S5](#s5-approve-and-print-id-0) | Approve and print (ID-0) | Later | From a brief to a measured printed prototype, with human approvals |
| [S6](#s6-mechanisms) | Mechanisms | Later | Hinges, slides and lids with real degrees of freedom |
| [S7a](#s7a-gpu-analysis) | GPU analysis | Later | GPU-accelerated analysis behind CPU twins |
| [S7b](#s7b-providers) | Providers | Later | Cloud and local providers with license checks, budgets and approvals |
| [S8a](#s8a-concept-boards-id-1) | Concept boards (ID-1) | Later | Concept images from license-clean models, on GPU or CPU |
| [S8b](#s8b-massing-id-1) | Massing (ID-1) | Later | A chosen concept turned into an editable massing assembly |
| [S9](#s9-form-and-cmf-id-2) | Form and CMF (ID-2) | Later | Surface quality, color, material and finish |
| [S10](#s10-molding-dfm-id-3) | Molding DFM (ID-3) | Later | Injection-molding rule checks before a molder sees the part |
| [S11](#s11-engineering-and-validation-id-4) | Engineering and validation (ID-4) | Later | A mate solver, tolerance stacks and simulation |
| [S12](#s12-handoff-and-rfq-id-5) | Handoff and RFQ (ID-5) | Later | Drawings, AP242 and a pack suppliers can quote from |

## What works today

The first vertical slice runs end to end, from a clone, on the command line and over MCP:

- The `open3dj` CLI and a dual-era MCP server (protocol versions 2025-06-18, 2025-11-25 and 2026-07-28) with five tools: `run`, `inspect`, `render`, `export` and `docs`.
- A 3dj-compatible DSL that runs in a QuickJS sandbox, with the geometry kernel (OCCT as WebAssembly) in pool workers.
- An assembly-first model: shared definitions, occurrences, connectors and `matchTo`, with exact clash, contact and clearance checks that list each gap of a pair.
- Fingerprint references that report each name as exact, ambiguous or broken.
- Four-view hidden-line drawings, and STEP, STL, GLB and 3MF exports with an evidence file.
- A CPU worker pool.
- `open3dj view`: a local browser viewer with the assembly tree, picking, fit markers and live reload. WebGL2 is verified; the WebGPU path is written but not yet seen on real GPU hardware.
- 10 examples with a gallery ([examples/](examples/README.md)).
- o3dj-bench v0: 12 regression tasks and 10 capability tasks. No agent has run the capability split yet.
- Reference assemblies of 145 and 1,025 occurrences.
- `npm run check`: typecheck, every test (about 690), the bench regression split, and the stdout-leak and license gates.

Not yet: As of 2026-10-31, CI runs `npm run check` on Linux x64 and ARM64, macOS on Apple Silicon, and Windows x64 and ARM64. Everything passes there except two example goldens (`box-with-lid` and `enclosure`) that are waiting to be regenerated, and the browser viewer test is skipped because CI has no browser driver. Nobody outside the project has tested Open3DJ on their own machine yet; [docs/TESTING.md](docs/TESTING.md) shows how. Nothing is published to npm, because the name is pending trademark clearance. Two example goldens (`box-with-lid` and `enclosure`) are waiting for the founder to regenerate them, so `npm run check` reports those two tests as failing until then, and no pull request can merge in either lane before they are regenerated.

## The steps

### S0. Line and gauge

- **Goal:** set up the production line and measure real machines before designing around guesses.
- **Status:** in progress.
- **Shipped:** AGENTS.md, AI_POLICY.md, Claude Code hooks, the one-command `check`, the leak and license gates, issue forms, contract schemas v0, o3dj-bench v0 with task-lint, the reference assemblies, a first determinism (H-det) run on one Linux machine, and a first `doctor --bench`.
- **Still to do:** reports from people on real machines for each tier-1 platform (CI already runs on all five runners); `doctor --bench` micro-benchmarks, a viewer frame-time probe and a WebGPU probe; H-det on the other operating systems; a baseline value stream from 2 or 3 real enclosure briefs.
- **Kaizen metric:** fresh clone to a green `check` in 10 minutes or less on Linux, macOS and Windows.
- **How you can help:**
  - People: install Open3DJ on your own machine, follow the 15-minute checklist in [docs/TESTING.md](docs/TESTING.md), and paste the output of `open3dj doctor --report` into a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml). Developers can also time `npm run check` from a clone.
  - Agents: run `npm run hdet` on a new operating system and draft a hardware report with the table it prints, for your operator to check and file.

### S1. Agent Preview

- **Goal:** every major MCP client gets a write, run, see and export loop, where every design is an assembly.
- **Status:** in progress. Most of the step has shipped.
- **Shipped:** the dual-era MCP server with five tools and CLI parity, the QuickJS sandbox, the DSL core, the assembly graph with connectors and `matchTo`, fingerprint references, exact fits, drawings, multi-part STEP, 3MF, GLB and STL, the compute contract with a worker pool, a minimal job model, [skills/open3dj/SKILL.md](skills/open3dj/SKILL.md) and the [Claude Code plugin](skills/README.md).
- **Still to do:** the first measured pass^3 on the capability split; a JavaScript entry point and an npm publish under a cleared name; an MCP Registry entry; recorded handshakes from real clients (Codex, Gemini CLI, Cursor, VS Code) in the client matrix; the five-minute "first multi-part STEP" timing on the tier-1 runners.
- **Kaizen metric:** pass^3 on the capability split with Claude Code. Exit: at least 70%.
- **How you can help:**
  - Agents: run the [capability split](bench/run-capability.md) (10 briefs, 3 runs each) and share the grader's table. Nobody has done this yet, so the first result sets the baseline. Turn each failed run that shows a product problem into a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml).
  - People: connect your MCP client with [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) and tell us whether it worked. Write a new example or a bench task from a real part you need.

### S2. See it

- **Goal:** people can see agent assemblies quickly; the first GPU path ships.
- **Status:** in progress. `open3dj view` has shipped.
- **Shipped:** a read-only viewer on 127.0.0.1 with a session key, the assembly tree, one instanced mesh per definition, picking, fit markers, a hidden-line fallback without a GPU, and live reload.
- **Still to do:** GPU picking that copies face and edge addresses; the frame-time gate on the 145-occurrence assembly (p95 under 33 ms with WebGPU); a check of the WebGPU path on real GPUs; clash and reference overlays from the report.
- **Kaizen metric:** viewer-only defects per week (problems a person sees that the report did not flag).
- **How you can help:**
  - People: open `npx open3dj view examples/enclosure/enclosure.o3j.js` on your GPU and browser, and report what renderer it shows and how it feels. Every viewer-only defect becomes a regression task.
  - Agents: write a seeded assembly where the viewer and the report disagree, and draft a failure report.

### S3. Trust

- **Goal:** agents know a part or assembly is right and keep it right while editing.
- **Status:** next.
- **Ships:** 3D printing checks per printable part (watertight, 0.8 mm wall, 45 degree overhang, bed size) on the CPU; checks split into agent-waivable and human-only; full five-state references through history; a fast "observed" fit tier; `open3dj replay`; structured errors with a suggested fix.
- **Kaizen metric:** error recovery: the share of failures fixed within 2 further calls. Exit: at least 80%, and zero false passes on a seeded corpus.
- **How you can help:**
  - People: send hard test geometry (thin walls, overhangs, nearly tangent faces) with a note on what other tools get wrong.
  - Agents: collect error messages that did not help your agent recover, and draft failure reports with the script and the transcript lines.

### S4. Mates, BOM and library

- **Goal:** agents assemble products from standard parts and see what is under-constrained.
- **Status:** later.
- **Ships:** fastened mates on connectors; Replicate (for example a screw onto every hole); mate status with residuals; named free degrees of freedom; declared fits; configuration tables; a bill of materials (CSV); exploded views; an ISO fastener and heat-set insert library under a checker.
- **Kaizen metric:** seeded assembly faults named by the report. Exit: 100%, with zero false passes.
- **How you can help:**
  - People: propose a [standard part](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=part_library.yml) with dimensions and their sources.
  - Agents: draft standard part specs with checkable acceptance criteria for your operator to verify.

### S5. Approve and print (ID-0)

- **Goal:** close the loop from a brief to a measured prototype in the hand, with people approving.
- **Status:** later.
- **Ships:** approvals owned by the local daemon (waivers, design freeze, quotes); executable briefs (`brief.o3j.yaml`); enclosure templates as assemblies; per-part 3MF print plates; a slicer estimate as a separate process; a prototype record with caliper readings.
- **Kaizen metric:** first-print fit rate. Exit: at least 80% over 10 prints.
- **How you can help:**
  - People: print an example, measure it with calipers and report the fit. Write a design brief for a real enclosure with the [Industrial design form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=industrial_design.yml).

### S6. Mechanisms

- **Goal:** agents build moving products (hinges, slides, lids, gear trains) with explicit degrees of freedom.
- **Status:** later.
- **Ships:** revolute, slider, cylindrical and planar joints with limits; motion renders; swept clash; URDF export; hinged-lid and drawer-slide templates.
- **Kaizen metric:** pass^3 on 10 mechanism briefs. Exit: at least 70%.
- **How you can help:** write mechanism briefs as bench task proposals ([bench task form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=bench_task.yml)).

### S7a. GPU analysis

- **Goal:** GPU speed for analysis, always behind a CPU twin.
- **Status:** later.
- **Ships:** an optional WebGPU pack with wall-thickness and clearance ray casts and an assembly fit pre-check; the rule "the GPU screens, the CPU decides"; device profiles.
- **Kaizen metric:** analysis time, GPU against CPU. A kernel that is not 3x faster is dropped.
- **How you can help:** run `doctor --bench` on your GPU and file a hardware report.

### S7b. Providers

- **Goal:** send work off the machine only with license checks, a budget and a human approval.
- **Status:** later.
- **Ships:** a provider router across local CPU, local GPU and cloud; license manifests checked at runtime; egress and budget approvals; a stub provider in CI.
- **Kaizen metric:** the share of provider jobs whose license and approval were shown before any call. Exit: 100%.
- **How you can help:** organizations that run GPUs or print services can [offer an integration](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=organization.yml).

### S8a. Concept boards (ID-1)

- **Goal:** get from an approved brief to chosen design directions on any machine, with or without a GPU.
- **Status:** later.
- **Ships:** concept boards from Apache-2.0 image models on a local GPU sidecar, or on the CPU through stable-diffusion.cpp, or on your own cloud GPU with approval. Boards are labeled "concept, not geometry".
- **Kaizen metric:** hours from approved brief to chosen directions.
- **How you can help:** designers: describe how you run concept reviews today.

### S8b. Massing (ID-1)

- **Goal:** turn a chosen direction into an approved, editable massing assembly.
- **Status:** later.
- **Ships:** generated massing (TRELLIS v1 geometry-only, locally or in the cloud), or massing written by the agent in the DSL on the CPU; either way rebuilt as an editable assembly labeled "assumed". Restricted models are opt-in only.
- **Kaizen metric:** hours from approved brief to approved direction.

### S9. Form and CMF (ID-2)

- **Goal:** make surface quality legible to agents, with draft and wall thickness designed into the form.
- **Status:** later.
- **Ships:** lofts and sweeps with continuity options; a continuity table; zebra and curvature views; advisory draft and wall maps; a color, material and finish file exported as glTF variants; Cycles renders through a separate Blender process.
- **Kaizen metric:** review rounds until form and CMF sign-off.

### S10. Molding DFM (ID-3)

- **Goal:** catch injection-molding problems before a molder does, from cited public rules.
- **Status:** later.
- **Ships:** rule profiles for ABS, PC, PP and PA (draft, wall, ribs, bosses, undercuts, sharp corners, sink risk); a `draft` operation; a corpus of about 30 seeded-defect parts. Labeled "rule check, not simulation".
- **Kaizen metric:** the share of seeded defects the agent fixes without help. Exit: at least 70%.
- **How you can help:** engineers: contribute design-for-manufacture rules for a process you know, with sources.

### S11. Engineering and validation (ID-4)

- **Goal:** honest engineering checks for moving and tolerance-critical products.
- **Status:** later.
- **Ships:** a mate solver that names redundant and conflicting mates; worst-case and RSS tolerance stacks; CalculiX as a separate process, labeled "simulation, not test"; MJCF export.
- **Kaizen metric:** the share of a validation corpus reported correctly.

### S12. Handoff and RFQ (ID-5)

- **Goal:** give suppliers a pack they can quote without asking questions.
- **Status:** later.
- **Ships:** drawing sheets with a title block and critical dimensions; AP242 with semantic PMI; an RFQ pack generated only from a design freeze; a quote comparison table. People send every RFQ and place every order.
- **Kaizen metric:** supplier clarification questions per RFQ.
- **How you can help:** suppliers and engineers: tell us which questions you ask most often when a quote request arrives.

## The industrial design pipeline

The same engine carries a product through these slices ([docs/INDUSTRIAL-DESIGN.md](docs/INDUSTRIAL-DESIGN.md)):

| Slice | Where | People approve |
|---|---|---|
| ID-0 Brief to printed prototype | Playbook in S0, used S1 to S4, formal in S5 | Brief, design freeze, quote |
| ID-1 Concept and massing | S8a, S8b | Directions, then one direction |
| ID-2 Form and CMF | S9 | Form, CMF |
| ID-3 Molding DFM | S10 | Waivers |
| ID-4 Engineering and validation | S4, S6, S11 | Tolerance scheme, reading of simulations |
| ID-5 Drawings, AP242 and RFQ | S12 | Every RFQ and order |
| ID-6 Class-A surfaces, Moldflow interop, first article inspection, tooling | Volunteer research lane, no dates | Everything |

## Deliberately deferred

These wait on a trigger, written down in [docs/PLAN.md](docs/PLAN.md) section 7. When a trigger fires, the item becomes an issue.

- A large-assembly mode (level of detail, lazy loading) for projects over 1,000 occurrences.
- In-context and top-down design.
- Kinematic studies, inverse kinematics and GPU simulation.
- A native or 64-bit memory kernel, and a Rust host.
- An operating system sandbox, before any network transport.
- A Python build123d tier and OpenSCAD input, if a bench comparison shows the JS DSL falling behind.
- A desktop app, installers and auto-update, when users ask for them.
- A public leaderboard, gallery site and browser playground, once the bench is stable and a volunteer owns them.
- Scan to CAD, a sketcher, sheet metal, CAM and more process profiles, when a named project needs them.

Never: telemetry by default, a restricted model as a default, GPL or AGPL code inside the process, automatic ordering, a verdict of record from GPU output, or a GPU path without a CPU path.

## Join in

Every step above lists ways to help. To get started, read [CONTRIBUTING.md](CONTRIBUTING.md), or point your agent at [AGENTS.md](AGENTS.md). Ideas for the roadmap are welcome in an [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) issue.
