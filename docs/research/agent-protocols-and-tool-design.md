# Agent Protocols (MCP and friends) and Agent-Friendly CAD Tool API Design — State of October 2026

Research dimension for Open3DJ (neuraldeepnet/open3dj). Date of research: 2026-10-27. Every non-trivial claim carries a source in the Sources section; items that could not be verified against a primary source are marked as such.

## Executive summary

MCP is now a stateless, horizontally scalable, extension-based protocol: the 2026-07-28 revision removed sessions and the `initialize` handshake, replaced server-initiated elicitation/sampling with Multi Round-Trip Requests, added `server/discover`, cacheable list results and header-based routing, deprecated Roots/Sampling/Logging/HTTP+SSE/DCR, and moved long-running Tasks into an official extension alongside MCP Apps (inline UI), Skills-over-MCP and two auth extensions. Six SDKs are Tier 1 (TypeScript, Python, C#, Go, Rust, Ruby). Every major agent client (Claude Code/Desktop, Cursor, VS Code, ChatGPT/Codex, Gemini CLI, OpenAI Agents SDK) consumes MCP tools over stdio and Streamable HTTP, but support for richer features (elicitation, Tasks, Apps, resources, prompts) is uneven, and ChatGPT only reaches public HTTPS servers. In parallel, Agent Skills (SKILL.md), Claude Code plugins/hooks, MCPB bundles and plain CLIs have become the other half of the agent interface, and measured token costs favor CLI + skill tips by 4-32x over large MCP tool sets. The CAD MCP ecosystem has converged on code-as-CAD inside a persistent session plus a small set of feedback tools (render, measure, validate, check, export), and the servers that return images, exact measurements and validity gates demonstrably score higher on CAD benchmarks (build123d-mcp: 0.360 to 0.457 on CADGenBench, validity 88% to 100%; CADSmith: median IoU 0.81 to 0.96 with kernel-measured validation plus a vision judge). Vendors have entered (Autodesk Fusion local MCP server, April 2026; PTC Onshape FeatureScript MCP, August 2026), but both are thin and undocumented. Open3DJ should ship one core command API exposed three ways (MCP server, `o3dj` CLI, SDK) with explicit document handles, compact structured GeometryReports on every mutation, a Tasks-extension path for GPU/cloud jobs with a polling fallback, an MCP App 3D viewer, a bundled SKILL.md, and a reproducible eval harness.

## 1. Model Context Protocol: current state (October 2026)

### 1.1 Revision timeline and what each added

| Revision | Key additions |
|---|---|
| 2025-03-26 | Streamable HTTP transport, OAuth 2.1 authorization, tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), audio content. |
| 2025-06-18 | Structured tool output (`structuredContent` + `outputSchema`), elicitation, resource links in tool results, MCP servers as OAuth Resource Servers with RFC 8707 resource indicators, `title` fields, removal of JSON-RPC batching, `MCP-Protocol-Version` header. |
| 2025-11-25 | Experimental Tasks (durable requests with polling), URL-mode elicitation, enum improvements, tool naming guidance (SEP-986), icons for tools/resources/prompts, OpenID Connect discovery, Client ID Metadata Documents (CIMD) as recommended registration, sampling with tools, input-validation errors to be returned as tool execution errors so the model can self-correct, SDK tiering (SEP-1730), JSON Schema 2020-12 default. |
| **2026-07-28 (current)** | See below. Described by the MCP blog as the biggest change since authorization was added. |

### 1.2 The 2026-07-28 revision

Verified from the official changelog:

- **Stateless core.** Protocol-level sessions and `Mcp-Session-Id` are removed; `initialize`/`notifications/initialized` are gone. Each request carries `_meta` keys `io.modelcontextprotocol/protocolVersion`, `clientCapabilities`, `clientInfo`; servers answer with `serverInfo`. Servers needing cross-call state must mint explicit handles and accept them as ordinary tool arguments (the spec's "Stateful Tools" guidance: opaque, authorized per call, with stated lifetime and an expiry error the model can recover from).
- **`server/discover`** is mandatory for servers and advertises supported versions, capabilities and extensions.
- **Multi Round-Trip Requests (MRTR)** replace server-initiated `elicitation/create`, `sampling/createMessage` and `roots/list`: a tool returns `resultType: "input_required"` with `inputRequests`; the client retries the same call with `inputResponses` and `requestState`. All results now carry `resultType` (`complete` or `input_required`).
- **`subscriptions/listen`** replaces the HTTP GET stream and `resources/subscribe`; SSE resumability (`Last-Event-ID`) is removed.
- **Cacheable results:** `tools/list`, `prompts/list`, `resources/list`, `resources/read`, templates must return `ttlMs` and `cacheScope`; servers should return tools in deterministic order to improve prompt-cache hit rates.
- **Streamable HTTP routing headers** `Mcp-Method` and `Mcp-Name` are required; tool parameters may be mirrored to `Mcp-Param-*` headers via `x-mcp-header`.
- **Deprecated (12-month minimum window):** Roots, Sampling, Logging; HTTP+SSE transport; `includeContext` values; OAuth Dynamic Client Registration in favor of CIMD.
- **Auth hardening:** RFC 9207 `iss` validation, `application_type` in DCR (fixes localhost redirect for desktop/CLI apps), credentials bound to issuer.
- **Schema loosening:** `inputSchema`/`outputSchema` may use any JSON Schema 2020-12 keyword; `structuredContent` may be any JSON value. Error-code allocation policy: `-32020..-32099` reserved for MCP.
- **Tasks moved out of core** into the `io.modelcontextprotocol/tasks` extension (SEP-2663).

Adoption numbers from the release post: roughly half a billion SDK downloads per month across Tier 1 SDKs; TypeScript and Python each passed 1 billion total downloads.

### 1.3 Official extensions

Extensions are identified as `{vendor}/{name}`, declared in `_meta.clientCapabilities.extensions` on every request and in `server/discover`; they are always opt-in and may be disabled.

- **Tasks (`io.modelcontextprotocol/tasks`).** Server returns `CreateTaskResult` (`resultType: "task"`, `taskId`, `ttlMs`, `pollIntervalMs`); states `working`, `input_required`, `completed`, `failed`, `cancelled`; methods `tasks/get`, `tasks/update` (client supplies mid-flight input), `tasks/cancel` (cooperative); optional `notifications/tasks` via `subscriptions/listen`. Servers must never return a task to a client that did not declare the extension. Claude Code supports Tasks in public beta from v2.1.304 (`pollIntervalMs` clamped 250-30000 ms, calls over 2 minutes auto-background). The official extension matrix lists no other client as supporting Tasks yet.
- **MCP Apps (`io.modelcontextprotocol/ui`).** Spec revision 2026-01-26 in `modelcontextprotocol/ext-apps`. Tools declare `_meta.ui.resourceUri` pointing at a `ui://` HTML resource rendered in a sandboxed iframe; app and host talk over postMessage JSON-RPC (`ui/initialize`, `tools/call`) with `permissions` and `csp`. Supported by Claude (web), Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, Archestra.AI and Cursor. Official examples include a Three.js scene server, so an in-chat 3D viewer is a proven pattern. SDK: `@modelcontextprotocol/ext-apps` (App and AppBridge); `@mcp-ui/client` for React hosts.
- **Skills over MCP (`io.modelcontextprotocol/skills`, SEP-2640 Final).** `skills/list`/`skills/get` return SKILL.md frontmatter plus a file manifest (URI, SHA-256, size); files are read via `resources/read` and hosts verify digests. Cap: 512 files or 16 MiB per skill. Client support is partial (ChatGPT plugins, fast-agent, MCP Inspector).
- **Auth extensions:** OAuth Client Credentials (machine-to-machine) and Enterprise-Managed Authorization.

### 1.4 The official MCP Registry

`registry.modelcontextprotocol.io` launched in preview on 2025-09-08 and is still labelled preview ("breaking changes or data resets may occur before GA"). It stores `server.json` metadata (reverse-DNS name such as `io.github.user/server`, package pointers to npm/PyPI/Docker/NuGet or a remote URL, run arguments, env vars) with namespace ownership verified via GitHub, DNS or HTTP; it feeds downstream aggregators rather than hosts directly, excludes private servers, and owners cannot yet delete entries. Third-party censuses report roughly 30k-43k unique servers in September-October 2026 (dedup methods differ; unverified against the API). Zoo's MCP repo already ships a `server.json`.

### 1.5 Official SDKs

Per the official SDK page (2026-07-28 docs): Tier 1 — TypeScript, Python, C#, Go, Rust, Ruby; Tier 2 — Java; Tier 3 — Swift, PHP, Kotlin. Rust was promoted to Tier 1 on 2026-08-21 and Ruby in late September 2026 (third-party reports; the official table confirms the result). Tier 1 means the SDK speaks the current revision at release. Extensions are optional for SDKs and must be explicitly enabled.

## 2. Client support matrix (verified from vendor docs, October 2026)

| Client | Transports | Auth | Tools | Resources | Prompts | Elicitation | Tasks | Apps | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | stdio, HTTP (recommended), SSE (deprecated), ws | OAuth (`claude mcp login`), headers | yes; ToolSearch deferred loading on by default | yes | yes | yes (dialog, `Elicitation` hook) | public beta v2.1.304+ | not documented | 10k-token warning, 25k default cap (`MAX_MCP_OUTPUT_TOKENS`); >50k-char results saved to file; tools `mcp__<server>__<tool>`; `.mcp.json`. |
| Claude Desktop / claude.ai | stdio via MCPB (Desktop), remote HTTPS | OAuth | yes | yes | yes | yes | — | yes | Directory no longer accepts MCPB; ship local servers in plugins. |
| Cursor | stdio, SSE, Streamable HTTP | OAuth 2.1 + PKCE, RFC 9728, DCR/static | yes (approval default) | yes | yes | yes | — | yes | Images attached to chat; Roots supported; `.cursor/mcp.json`. |
| VS Code (Copilot) | stdio, HTTP/SSE | yes | yes | yes | yes (`/<server>.<prompt>`) | not on main page | — | experimental | Own `servers` config key. |
| ChatGPT (plugins) | Streamable HTTP, public HTTPS only | OAuth 2.1, CIMD recommended; mTLS | yes (`search`/`fetch` contract) | not documented | not documented | — | — | ChatGPT UI | `_meta` hidden from model; confirmation before writes. |
| Codex | stdio, Streamable HTTP | Bearer, OAuth (CIMD, DCR) | yes; per-tool approval | not documented | not documented | — | — | — | `config.toml`; `tool_timeout_sec` default 60; server `instructions` (first 512 chars). |
| Gemini CLI | stdio, SSE, Streamable HTTP | OAuth auto-discovery | yes (`mcp_{server}_{tool}`) | yes (`@server://path`) | yes | not documented | — | — | Image/audio/resource blocks; `includeTools`/`excludeTools`; 10 min timeout. |
| OpenAI Agents SDK / Responses API | Hosted MCP (remote), Streamable HTTP, SSE, stdio | approval callbacks | yes; `allowed_tools`, `defer_loading` | pagination only | yes | — | — | — | `cache_tools_list`, retries. |
| Windsurf | Streamable HTTP via `serverUrl` | — | yes | — | — | — | — | — | Third-party reports only. |

Takeaways: tools over stdio and Streamable HTTP are universal; everything else is optional. A CAD server must degrade gracefully (text + image results) and must not depend on Sampling or Roots, which are deprecated.

## 3. Adjacent agent interfaces

**Agent Skills (SKILL.md).** Published by Anthropic on 2025-12-18 at agentskills.io as an open format; one source says stewardship moved to the Agentic AI Foundation (unverified). Required frontmatter: `name` (1-64 chars, lowercase/digits/hyphens, must match directory) and `description` (1-1024 chars); optional `license`, `compatibility` (<=500 chars), `metadata`, experimental `allowed-tools`. Progressive disclosure: ~100 tokens of metadata always loaded, SKILL.md body under 500 lines (~5k tokens) on activation, `scripts/`, `references/`, `assets/` on demand. `skills-ref validate` checks conformance. build123d-mcp already ships an `install_skill(target, skill)` tool that writes modeling/drawing/repair skills into Claude, Cursor, Windsurf or AGENTS.md — a pattern worth copying.

**A2A.** Google's Agent2Agent protocol (Linux Foundation since 2025) reached v1.0 (multi-protocol support, enterprise multi-tenancy, signed Agent Cards) with 150+ supporting organizations by 2026-04-09, is integrated in Azure AI Foundry, Copilot Studio and Bedrock AgentCore, and moved under the Agentic AI Foundation in late August 2026 (sources give Aug 20 vs Aug 27). SDKs: Python, JavaScript, Java, C#/.NET, Go, Rust. It covers cross-organization agent delegation and is complementary to MCP; Open3DJ can defer it to a later "design-and-quote" Agent Card.

**OpenAI Apps SDK / ChatGPT plugins.** Apps in ChatGPT launched October 2025 and third-party submissions opened 2025-12-17. By mid-2026 the packaging is the "plugin": skills + an MCP server + optional UI, built once for ChatGPT and Codex and submitted to the ChatGPT Directory with domain verification and review; the help center still labels the Apps SDK preview. ChatGPT's UI reference is separate from the MCP Apps extension (which OpenAI co-authored and Claude, Cursor and VS Code render), so ChatGPT UI is a second target.

**Claude Code plugins and hooks.** A plugin directory with `.claude-plugin/plugin.json` (only `name` required) bundles `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json` (stdio/http servers or `.mcpb` bundles), `.lsp.json`, `userConfig` (sensitive values in keychain) and `experimental.evals`. Plugin tools are named `mcp__plugin_<plugin>_<server>__<tool>`. Hooks cover 33 events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `Elicitation`, `PreCompact`, ...) with five handler types (`command`, `http`, `mcp_tool`, `prompt`, `agent`) that can block, rewrite tool input, replace tool output or inject context.

**MCPB bundles.** `.mcpb` (formerly DXT) is a zip of a stdio server plus `manifest.json` (`user_config` auto-generates a settings UI); Claude Desktop installs it by double-click with bundled Node.js. The Anthropic directory no longer accepts MCPB submissions; local servers must ship inside a plugin to be listed.

**CLIs as the agent interface.** The best-measured comparison (Scalekit, 75 runs, Claude Sonnet 4, GitHub tasks; vendor-authored, n=5 per task) found MCP with the 43-tool GitHub server used 4-32x the tokens of a bash CLI, and ~800 tokens of CLI tips cut tool calls and latency by about a third. Anthropic's guidance agrees: "Code execution with MCP" (2025-11-04) reports 150,000 to 2,000 tokens (98.7%) by exposing servers as code APIs and filtering results before they reach the model; "Writing effective tools for agents" (2025-09-11) recommends few consolidated tools, namespacing, natural-language identifiers, `response_format: concise|detailed` (72 vs 206 tokens), pagination/truncation defaults, actionable error strings, and notes Claude Code's 25k-token response cap. Claude Code's ToolSearch and the Claude API's `defer_loading` tool search are the platform-side answer. For Open3DJ the CLI is the cheapest agent interface and must have strict JSON parity with the MCP server.

## 4. Existing CAD/3D MCP servers: tool designs

| Server | License / stars | Model | Tools (abridged) | Feedback | Notable pitfalls |
|---|---|---|---|---|---|
| Blender MCP (ahujasid) | MIT, 32.5k stars | Socket bridge into live Blender (port 9876, no auth) | `execute_blender_code`, `look` (viewport/camera/angles/frames; solid/material/rendered/wireframe/xray), `get_scene_info` (one line per object, field selection, query), `generate_3d` (Tripo/Hunyuan3D/Rodin/Meshy), `search_assets`/`import_asset` (Poly Haven, Sketchfab, Poly Pizza), `get_addon_status`, telemetry controls | Images only; compact scene summaries | Arbitrary Python; mesh not B-Rep; GUI must be open; unauthenticated socket. |
| FreeCAD MCP (neka-nat) | MIT, 3.1k stars | RPC add-on inside FreeCAD GUI | 17 tools: document CRUD, `create_object`/`edit_object`/`delete_object`/`get_objects`, `get_view(view_name,width,height,focus_object)`, `execute_code` (GUI thread), `execute_code_async` + `get_async_status` (job id), `execute_code_headless` (freecadcmd), `get_rpc_status`, parts library, `run_fem_analysis` (CalculiX, timeout 600 s) | Optional screenshot on most mutations (`include_screenshot` default true, `view_name` default Isometric; `--only-text-feedback` flag) | `execute_code` is effectively shell access; shared Python namespace persists per process; GUI must be open. |
| build123d-mcp (pzfreo) | Apache-2.0 | Persistent build123d session (stdio: one session per process; HTTP: one shared session, no auth) | `execute`, `validate` (gate before export), `find_candidates(kind, qualifiers, stated_value)`, `interface_features`, `edit_feature(handle, diameter, protected_refs)` (predicted vs measured volume change), `compare(kind="shape")`, `install_skill`, render/measure/import/export/snapshot, `last_error` | PNG/SVG/DXF previews, 2D drawings, volume/area/bbox/topology/COM, printability, fit/alignment | Self-reported CADGenBench: 0.360 to 0.457, validity 88% to 100% (June 2026). |
| OpenSCAD MCP (RobertCoop) | MIT | OpenSCAD CLI (2021.01+), BOSL2 optional | 12 tools: `render` (views/section/parts/compare; grounded, annotate, isolate), `check` (interference/clearance/contact/alignment/motion/rules, shell exit codes 0/1/2), `measure` (model/parts/section/mass/probe/features/printability/orientation/anchors), `validate` (syntax/geometry/predicates/includes/printability, sweep, autofix), `scad_eval`, `reference` (fits, fasteners, inserts, bearings, materials with confidence labels), `model` (workspace CRUD), `export_model` | Every response carries `errors`, `warnings`, `hints`; text digest with camera/scale/bbox accompanies images | Mesh only, no STEP; needs xvfb for PNG on headless 2021.01. |
| Zoo MCP (KittyCAD) | MIT, Python | Single persistent modeling session per server process against Zoo's cloud engine | `start_modeling_session`/`get_modeling_sessions`/`stop_modeling_session`, `execute_kcl` (mock preflight first), `exec_kcl_project` (returns `ok` + artifact graph path), `mock_execute_kcl`, `snapshot`, selection/highlight/camera tools, `import_cad_file`, KCL sample list/search/get, `list_org_datasets` | Snapshot renders; structured ok/artifact-graph result | Requires API token; cloud dependency; prebuilt binaries not code-signed; ships `server.json`. |
| CadQuery MCP (rishigundakaram) | — | Script execution | `verify_cad_query` (checks model vs text criteria), `generate_cad_query` (stub), STL/STEP export, SVG preview | SVG | Immature; generation tool is a stub. |
| Autodesk Fusion MCP (official) | included with Fusion | Built into Fusion desktop, `http://127.0.0.1:27182/mcp`, Streamable HTTP, no auth, desktop-only | "Dynamic tooling": tool list discovered at connect time, not published; Autodesk's FusionMCPSample has `get_best_practices`, `get_api_documentation`, `execute_api_script`, `get_screenshot` | Screenshots | Fusion must be open with a document; modal dialogs block scripts; Autodesk says not yet reliable for complex models/assemblies. GA April 2026; Claude connector May 2026. |
| Onshape FeatureScript MCP (PTC, Onshape Labs) | hosted, App Store | Generates/tests FeatureScript custom features | Build, test, debug, refine one FeatureScript feature | FeatureScript errors, resulting geometry | Announced 2026-08-13; cannot read assemblies; community `onshape-mcp`/`jarvis-onshape-mcp` wrap the REST API with bbox/interference/multi-view. |
| 3dj.app (hosted sibling) | closed | Replicad/OpenCascade.js 7.7.2 WASM scripts with `Param.*`; OpenSCAD via Manifold; GPU mesh generation | Public: `cad_get_starters`, `cad_validate_script`, `cad_get_evidence_schema`, `openscad_get_starters`; authed: `openscad_compile_model`, `cad_list_models`, `generate_from_text/image_url` + `get_generation_status` + `get_model_download_url`, `list_providers`, print quotes | Evidence Pack v1 gates (watertight, 0.8 mm wall, 45 deg overhang, 220x220x250 bed) and confidence labels (measured ±0.15 / observed ±0.35 / inferred ±0.80 / assumed) | Observed live: unfiltered `cad_get_starters` returns 18 full scripts plus the whole DSL reference in one response (tens of thousands of characters), a token-cost pitfall; `cad_validate_script` is lint only; no public geometry-execution tool. |

Also: BuildCAD AI (hosted build123d) and AWV's smlibpy/ClassCAD MCPs return before/after pixel diffs, sections and mass properties; ClassCAD gates STEP export behind a paid tier.

## 5. Best practices and pitfalls for agent-friendly CAD tool APIs

1. **Code-as-CAD is the winning primary interface, but only with a kernel-backed feedback loop.** Every strong server (build123d-mcp, OpenSCAD MCP, Zoo, 3dj, Fusion sample's `execute_api_script`) centers on "run this script in a persistent session". Atomic ops (FreeCAD's `create_object`/`edit_object`) are useful for small edits and for UIs, but agents lose track of state across many micro-calls. CADSmith's result (execution 95% to 100%, median IoU 0.8085 to 0.9629) came from pairing code generation with exact kernel measurements (bbox, volume, validity) and a VLM judge; BenchCAD found frontier models capture coarse shape but misread dimensions and replace sweeps/lofts with extrudes — exactly the failures that numeric feedback catches and images do not.
2. **Return a compact structured report on every mutation.** Bounds, volume, area, solid count, validity, centroid, named parts, warnings/hints and a diff against the previous revision, in `structuredContent` with an `outputSchema` and a terse text mirror in `content`. OpenSCAD MCP's `errors/warnings/hints` on every response and build123d's "predicted vs measured volume change" are the models.
3. **Images are opt-in and captioned.** FreeCAD's `include_screenshot` (default true) wastes tokens on intermediate steps; make rendering explicit, return a text digest (camera, scale, bbox) with each image, and offer multi-view, section and x-ray modes (Blender's `look`, OpenSCAD's `render mode=views|section|compare`). Cursor, Gemini CLI and Claude Code accept `image` blocks.
4. **Stateless with explicit handles.** Every tool takes `doc_id` (optionally `rev`); the description states handle lifetime; the model carries handles forward (the spec's basket example). Avoid build123d-mcp's shared, unauthenticated HTTP session.
5. **Errors are tool results.** Validation and geometry failures return `isError: true` with what failed, where in the script, and a correct example (SEP-1303, Anthropic guidance); JSON-RPC errors only for unknown tools and malformed requests.
6. **Annotations and idempotency.** `readOnlyHint` on inspect/render/export; `run` non-destructive but creates a revision unless an `idempotency_key` is passed; `destructiveHint` on delete/cancel. Clients treat annotations as untrusted, so deletes still need confirmation.
7. **Long-running work uses Tasks with a polling fallback.** Mesh generation, cloud GPU jobs, FEM: return a task when the client declares `io.modelcontextprotocol/tasks`, else a `job_id` with `job_get`/`job_cancel` (3dj's `get_generation_status` pattern), plus `notifications/progress`. Codex's default tool timeout is 60 s and Gemini's 10 min; slower work must be async.
8. **Batching.** `params` maps and `params_set` re-evaluation without resending code; multi-query `inspect`; multi-format `export`. Fewer, larger calls are cheaper and more reliable.
9. **Token efficiency.** `response_format`, paginated search (not list-all) on catalogs, `docs_search` instead of dumping the DSL reference, deterministic tool order with `ttlMs`, server `instructions` under 512 chars (Codex weights only that much), under ~20 tools, workflow guidance in a SKILL.md rather than long descriptions.
10. **Security.** Sandbox script execution (WASM kernel or jailed subprocess); no raw-Python escape hatch over the network; loopback-only local HTTP with a per-install token (Fusion's unauthenticated 127.0.0.1:27182 is the counterexample); no credentials in tool arguments.
11. **Deterministic evals.** Deterministic kernel build, golden STEP hashes, kernel-measured metrics (validity, volume IoU, surface-distance F1, Betti numbers, explicit dimension assertions) as in CADGenBench and BenchCAD, plus tool calls, tokens and tool errors per task.

## 6. Evaluation landscape (for Open3DJ's eval harness)

- **CADGenBench** (Hugging Face, Apache-2.0): tool-agnostic — one STEP/BREP per sample; Generation (from engineering drawing) and Editing (modify a STEP) tasks; validity gate (zeroes other scores), shape similarity (surface-distance F1 and volume IoU), interface match (keep-in/keep-out volumes), topology (Betti numbers b0-b2); leaderboard on HF Spaces with private ground truth.
- **BenchCAD** (arXiv 2605.10865, May 2026): 17,900 execution-verified CadQuery programs across 106 industrial part families; VQA, code QA, image-to-code, instruction-guided edits; finds 10+ frontier models capture outer shape but fail fine detail and parameter reading; leaderboard updated 2026-10-26.
- **Text2CAD-Bench** (arXiv 2605.18430): text to CadQuery, IoU on 256^3 voxels, up to 3 retries with error feedback.
- **P3D-Bench** (arXiv 2606.11152): JSON, OpenSCAD, CadQuery and Three.js targets; notes only BenchCAD checks numeric dimensions explicitly.
- **CADSmith** (arXiv 2603.26512, March 2026): multi-agent loop with kernel measurements plus VLM judge; the strongest published evidence that tool feedback, not just model size, drives CAD accuracy.

## 7. Proposed Open3DJ tool surface (MCP, CLI and SDK parity)

Design: one core command API (`o3dj-core`, local daemon or in-process library) with JSON schemas; the MCP server, the `o3dj` CLI and the TypeScript/Python SDKs are thin adapters over it, so every operation has the same name, inputs and output schema in all three. Units mm, Z-up, degrees. All document-scoped tools take `doc_id`; mutations return a new `rev`.

| MCP tool | CLI | Inputs (key) | Output (`structuredContent`) | Annotations |
|---|---|---|---|---|
| `o3dj_doc_create` | `o3dj doc create` | `name?`, `units?`, `from?` (path/URL/STEP/STL/3MF/OBJ) | `{doc_id, rev, bounds?, solids?}`; handle lifetime stated in description | — |
| `o3dj_doc_list` / `o3dj_doc_get` | `o3dj doc list|get` | `cursor?`, `doc_id` | paginated summaries | readOnly |
| `o3dj_run` | `o3dj run -f part.js --lang o3dj-js --json` | `doc_id`, `lang` (`o3dj-js` Replicad-compatible, `openscad`, `cadquery`, `build123d`), `code`, `params?`, `capture?` (`geometry`,`diff`,`image`,`checks`), `response_format?`, `idempotency_key?` | `GeometryReport`: `{rev, ok, parts:[{name,volume,area,bounds,solids,valid}], diff:{volume_delta,bbox_delta,changed_parts}, params:[declared], warnings, hints, errors:[{line,col,message,suggestion}], image?}` | non-destructive |
| `o3dj_validate` | `o3dj validate -f part.js` | `lang`, `code` | lint result (syntax, prohibited APIs, declared params) in <100 ms, no geometry | readOnly, idempotent |
| `o3dj_params_set` | `o3dj params set` | `doc_id`, `params` | `GeometryReport` for re-evaluated model | — |
| `o3dj_inspect` | `o3dj inspect --query bounds,volume` | `doc_id`, `rev?`, `queries:[bounds|volume|mass(density)|topology|faces(filter)|edges(filter)|features(kind)|section(plane)|probe(point)|distance(a,b)|interference(parts)|clearance(parts)]`, `part?` | per-query results with units and confidence | readOnly, idempotent |
| `o3dj_render` | `o3dj render --views iso,front --section z=10` | `doc_id`, `views`, `style`, `section?`, `annotate?`, `size?`, `isolate?` | `image` blocks + text digest (camera, scale, bbox) | readOnly |
| `o3dj_check` | `o3dj check --profile fdm` | `doc_id`, `profile` (`fdm`,`sla`,`cnc`,`sheet`,`custom`), `rules?` (wall, overhang, bed, density) | gates `{name, status: pass|fail|unevaluated, measured, limit, evidence}` with confidence labels | readOnly |
| `o3dj_diff` | `o3dj diff r3 r4 --image` | `doc_id`, `rev_a`, `rev_b`, `image?` | geometric diff + optional pixel-diff image | readOnly |
| `o3dj_export` | `o3dj export --format step,3mf` | `doc_id`, `formats`, `parts?`, `tolerance?` | `resource_link`s (`open3dj://doc/{id}/rev/{rev}/model.step`), sha256, size, provenance (STEP AP214) | readOnly |
| `o3dj_import` | `o3dj import file.step` | `doc_id?`, `source` | `GeometryReport` + feature recognition summary | — |
| `o3dj_lib_search` / `o3dj_lib_get` | `o3dj lib search m3 heat-set` | `query`, `category?`, `cursor?` | paginated catalog (fasteners, inserts, profiles, bearings) with confidence-labelled data | readOnly |
| `o3dj_docs_search` | `o3dj docs search fillet` | `query`, `max?` | ranked DSL reference snippets (progressive disclosure instead of a full dump) | readOnly |
| `o3dj_generate` | `o3dj generate --text "..." --provider local` | `prompt|image`, `provider` (`local-gpu`,`cloud:<id>`, `3dj`), `target_doc?` | Task (ext) or `{job_id}` | openWorld |
| `o3dj_job_get` / `o3dj_job_cancel` | `o3dj job get|cancel` | `job_id` | status, progress, result link | readOnly / destructive |
| `o3dj_providers_list` | `o3dj providers` | — | local GPU capabilities, configured cloud GPU and print-quote providers with health | readOnly |
| `o3dj_history` | `o3dj history` | `doc_id`, `revert_to?` | revisions with messages, volumes, hashes | — |

Supporting primitives: resources (`open3dj://doc/{id}/preview.png`, `.../report.json`, `open3dj://reference/dsl`), prompts (`o3dj.design-for-fdm`), an MCP App `ui://open3dj/viewer` (Three.js orbit/section/explode, calling `o3dj_inspect` through the host) and `skill://open3dj-modeling/SKILL.md` served via the Skills extension and installable with `o3dj skill install --target claude|cursor|codex|agents-md`. The CLI emits the identical JSON (`--json`) with exit codes 0 ok / 1 geometry invalid / 2 script error / 3 kernel or provider failure; `o3dj mcp serve --stdio|--http 127.0.0.1:PORT --token` launches the server, which declares the tasks, ui and skills extensions, publishes `server.json` to the registry, and ships as an `.mcpb`, a Claude Code plugin, a Cursor entry, a Codex `config.toml` snippet and a ChatGPT plugin backed by an optional hosted relay.

## Recommendations for Open3DJ

1. Target MCP 2026-07-28 from day one with the TypeScript or Rust Tier 1 SDK; support 2025-11-25 clients via `server/discover` negotiation; never rely on sessions, Sampling, Roots or HTTP+SSE.
2. Make the `o3dj` CLI a first-class, JSON-parity interface and ship a <5k-token SKILL.md; this is the cheapest path into Claude Code, Codex and Gemini CLI, and it is what the token benchmarks favor.
3. Keep the MCP surface to about 16 tools with deterministic ordering, `ttlMs`, `response_format`, pagination on catalogs, and short server `instructions`; defer workflow guidance to the skill.
4. Return a structured `GeometryReport` with diff and warnings on every mutation; make images opt-in and always captioned; support multi-view/section/pixel-diff renders.
5. Implement DfM checks as gates with `pass|fail|unevaluated` and confidence labels (borrowing 3dj's Evidence Pack vocabulary) so 3dj.app can plug in as one quote/GPU provider behind `o3dj_providers_list`.
6. Use the Tasks extension for GPU/cloud/FEM jobs with a `job_id` fallback, progress notifications, and cooperative cancel; respect Codex's 60 s default timeout by never blocking on long work.
7. Sandbox all script execution (WASM OpenCascade or subprocess jail); loopback-only local HTTP with a per-install token; no raw Python/JS escape hatch over the network.
8. Build an MCP App 3D viewer (Three.js example in ext-apps) so Claude, VS Code, Goose and Cursor users see the model in the chat, with text fallback for ChatGPT/Codex.
9. Publish `server.json` to the MCP Registry, an `.mcpb` for Claude Desktop, a Claude Code plugin (with hooks for auto-validate before export), and a hosted relay option so ChatGPT plugins can reach a user's local kernel.
10. Ship a reproducible eval harness (CADGenBench-compatible STEP outputs, BenchCAD-style dimension assertions, tool-call/token/error metrics) and gate releases on it; publish results to differentiate from thin vendor servers.

## Sources

- MCP 2026-07-28 changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- MCP 2026-07-28 release post: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP 2025-11-25 changelog: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- MCP 2025-06-18 changelog: https://modelcontextprotocol.io/specification/2025-06-18/changelog
- MCP Tools spec (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MCP Extensions overview: https://modelcontextprotocol.io/docs/extensions/overview
- MCP Tasks extension: https://modelcontextprotocol.io/extensions/tasks/overview
- MCP Apps extension: https://modelcontextprotocol.io/extensions/apps/overview
- MCP Apps announcement (SEP-1865): https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
- Skills over MCP extension: https://modelcontextprotocol.io/extensions/skills/overview
- Extension client matrix: https://modelcontextprotocol.io/extensions/client-matrix
- MCP SDKs and tiers: https://modelcontextprotocol.io/docs/2026-07-28/sdk
- MCP Registry about: https://modelcontextprotocol.io/registry/about
- MCP Registry preview announcement: https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/
- Registry census (third-party, Oct 2026): https://www.localcan.com/blog/state-of-mcp-server-development
- Rust SDK Tier 1 promotion (third-party): https://www.digitalapplied.com/blog/mcp-sdk-conformance-tiers-what-tier-1-means
- Agent Skills specification: https://agentskills.io/specification
- Agent Skills background (third-party): https://www.firecrawl.dev/blog/agent-skills
- A2A one-year press release (LF, 2026-04-09): https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- A2A site: https://a2a-protocol.org/latest/
- A2A joins AAIF (third-party): https://enterprisedna.co/resources/news/google-a2a-aaif-agent-protocol-open-standard-august-2026/
- OpenAI app submissions open: https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/
- OpenAI Apps SDK help center: https://help.openai.com/en/articles/12515353-building-with-the-apps-sdk
- OpenAI plugins MCP server guide: https://developers.openai.com/plugins/build/mcp-server
- OpenAI plugins docs index: https://developers.openai.com/apps-sdk
- OpenAI Responses API MCP guide: https://developers.openai.com/api/docs/mcp
- OpenAI Agents SDK MCP: https://openai.github.io/openai-agents-python/mcp/
- Codex MCP docs: https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code plugin manifest reference: https://code.claude.com/docs/en/plugins-reference
- MCPB bundles: https://claude.com/docs/connectors/building/mcpb
- Cursor MCP docs: https://cursor.com/docs/context/mcp
- VS Code MCP docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers
- Gemini CLI MCP docs: https://geminicli.com/docs/tools/mcp-server/
- Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Scalekit MCP vs CLI benchmark: https://www.scalekit.com/blog/mcp-vs-cli-use
- CLI vs MCP commentary: https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/
- Blender MCP: https://github.com/ahujasid/blender-mcp
- FreeCAD MCP: https://github.com/neka-nat/freecad-mcp and https://raw.githubusercontent.com/neka-nat/freecad-mcp/main/docs/tools.md
- build123d-mcp: https://github.com/pzfreo/build123d-mcp and https://pypi.org/project/build123d-mcp/
- OpenSCAD MCP (RobertCoop): https://github.com/RobertCoop/openscad-mcp
- CadQuery MCP server: https://glama.ai/mcp/servers/@rishigundakaram/cadquery-mcp-server
- Zoo MCP: https://github.com/KittyCAD/mcp
- Autodesk Fusion MCP blog (Autodesk Developer Blog, 2026-05-04): https://blog.autodesk.io/fusion-mcp-server/
- Autodesk MCP servers page: https://www.autodesk.com/solutions/autodesk-ai/autodesk-mcp-servers
- Fusion MCP setup analysis (third-party): https://techdrawai.com/blog/connect-claude-to-fusion-360
- PTC Onshape FeatureScript MCP (2026-08-13): https://www.ptc.com/en/news/2026/onshape-launches-featurescript-mcp-server and https://www.onshape.com/en/blog/featurescript-mcp-server-enables-text-code-cad
- CAD MCP comparison (Leo AI): https://www.getleo.ai/blog/cad-mcp-server-comparison-2026
- CAD MCP comparison (BuildCAD, vendor): https://buildcad.ai/guides/cad-mcp-servers
- 3dj.app MCP server (public tools observed live): https://www.3dj.app/agents
- CADGenBench: https://github.com/huggingface/cadgenbench
- BenchCAD: https://arxiv.org/abs/2605.10865
- Text2CAD-Bench: https://arxiv.org/abs/2605.18430
- P3D-Bench: https://arxiv.org/html/2606.11152v1
- CADSmith: https://arxiv.org/abs/2603.26512
