# Open3DJ research notes (October 2026)

These reports were produced by parallel research agents and each was adversarially fact-checked against primary sources. Corrections from the fact-checks are applied in the plan and architecture documents. Treat version numbers and prices as a snapshot from 2026-10-27.

| Report | Topic |
|---|---|
| [landscape-ai-cad.md](landscape-ai-cad.md) | Competitive landscape of AI and agentic CAD |
| [research-llm-cad.md](research-llm-cad.md) | State of the art in LLM/VLM-driven CAD generation |
| [kernels-and-geometry.md](kernels-and-geometry.md) | Geometry kernels, constraint solvers, CAD language layers |
| [agent-protocols-and-tool-design.md](agent-protocols-and-tool-design.md) | MCP and agent-friendly CAD tool API design |
| [client-and-distribution.md](client-and-distribution.md) | Desktop client stack, rendering, distribution |
| [compute-local-and-cloud.md](compute-local-and-cloud.md) | Local vs pluggable cloud GPU compute |
| [formats-interop-manufacturing.md](formats-interop-manufacturing.md) | File formats, interop, manufacturing pipeline |
| [ux-human-agent-collab.md](ux-human-agent-collab.md) | Professional UI and human-agent collaboration |
| [security-sandboxing.md](security-sandboxing.md) | Sandboxing agent-generated code, MCP security |
| [community-licensing-business.md](community-licensing-business.md) | Licensing, governance, community, business model |

## Hands-on spikes

| Note | Result |
|---|---|
| [spikes/README.md](spikes/README.md) | Step 0: MCP server with kernel worker, script sandbox, 3dj DSL on brepjs, endurance and determinism. Independently reproduced. |
| [spike-assemblies.md](spike-assemblies.md) | Multi-part assemblies with shared definitions export to STEP and glTF, survive re-import, and support interference checks |
| [spike-occt-wasm.md](spike-occt-wasm.md) | Open CASCADE as WebAssembly runs in Node.js with no native build, fast enough for agent edits, with CPU-rendered drawings |

## Gap-fill notes

A completeness review of the draft plan found gaps. These notes answer them and override the reports above where they conflict.

| Note | Question answered |
|---|---|
| [gap-1.md](gap-1.md) | Funding, burn and grants for a 3-4 engineer, 68-week plan |
| [gap-2.md](gap-2.md) | Cost of re-implementing the 3dj DSL, and reuse via brepjs and occt-wasm |
| [gap-3.md](gap-3.md) | Which build123d and CadQuery releases actually run on OCP 8 |
| [gap-4.md](gap-4.md) | Licence audit of TripoSG and TRELLIS inference pipelines |
| [gap-5.md](gap-5.md) | Trademark and namespace availability for the name Open3DJ |
| [gap-6.md](gap-6.md) | MCP 2026-07-28 support in clients and in the Rust rmcp crate |
| [gap-7.md](gap-7.md) | Adoption baselines for comparable CAD and 3D agent packages |
| [gap-8.md](gap-8.md) | Developer OS share, and native versus WASM OCCT performance |
| [gap-9.md](gap-9.md) | Code signing eligibility, CADGenBench scores, Apple fees, 3dj MCP inputs |

## Lean re-plan notes (28 Oct 2026)

Written under the founder's constraints (no paid engineers, small releases, Kaizen, an industrial design pipeline, CPU and GPU compute). They are newer than the reports and gap notes above and feed the lean [PLAN.md](../PLAN.md).

| Note | Topic |
|---|---|
| [lean-stack.md](lean-stack.md) | Lean starting stack: TypeScript, occt-wasm, QuickJS sandbox, measured overheads |
| [kaizen-ops.md](kaizen-ops.md) | Kaizen operating model for a founder, volunteers and AI agents; free programmes and cash costs |
| [assemblies.md](assemblies.md) | Assemblies, mates, solvers and fit checks, with two spikes |
| [compute-cpu-gpu.md](compute-cpu-gpu.md) | CPU and GPU compute: worker pool, WebGPU spike on lavapipe, sidecar and vendors |
| [industrial-design.md](industrial-design.md) | Industrial product design pipeline: tools survey, moulding rules, gaps |

Spike scripts and raw output for these notes are in [spike/lean/](spike/lean/), [spike/asm2/](spike/asm2/), [spike/compute/](spike/compute/) and [bench/](bench/).

## Architecture proposals

Three independent proposals for the funded-team plan were scored by three judges. That plan built on the agent-first proposal and grafted ideas from the other two.

| Proposal | Judge total |
|---|---|
| [Agent-first](proposals/proposal-agent-first.md) | 23.2 |
| [Engineering rigour](proposals/proposal-engineering-rigor.md) | 22.3 |
| [Adoption-first](proposals/proposal-adoption-first.md) | 19.3 |

Three lean proposals followed under the founder's new constraints and were scored by three judges. The lean plan builds on the judges' winner and grafts ideas from the other two.

| Lean proposal | Angle | Judge total |
|---|---|---|
| [Agents first](proposals/lean-proposal-agents-first-lean.md) | Agent value first | 24.5 |
| [Industrial pipeline first](proposals/lean-proposal-industrial-pipeline-first.md) | The product design pipeline first | 23.5 |
| [Community flywheel first](proposals/lean-proposal-community-flywheel-first.md) | Users and volunteers for little founder time | 18.9 |

## Archive

| Document | Status |
|---|---|
| [Full-scale plan](archive/full-scale-plan.md) | Superseded by the lean plan. Written for a funded team. |
| [Full-scale architecture](archive/full-scale-architecture.md) | Superseded by the lean architecture. Kept for detail. |
