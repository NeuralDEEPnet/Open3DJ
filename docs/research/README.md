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

## Architecture proposals

Three independent proposals were scored by three judges. The final plan builds on the agent-first proposal and grafts ideas from the other two.

| Proposal | Judge total |
|---|---|
| [Agent-first](proposals/proposal-agent-first.md) | 23.2 |
| [Engineering rigour](proposals/proposal-engineering-rigor.md) | 22.3 |
| [Adoption-first](proposals/proposal-adoption-first.md) | 19.3 |
