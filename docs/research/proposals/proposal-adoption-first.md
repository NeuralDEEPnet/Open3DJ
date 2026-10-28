# Open3DJ: Adoption-First Architecture and Execution Proposal

*Principal-architect proposal, 27 October 2026. Angle: fastest path to a lovable, installable product with a community. Numbered references [n] point to the Sources list at the end; versions marked "npm" were read from the npm registry on 27 Oct 2026.*

---

## 0. Thesis in one paragraph

Open3DJ wins adoption by being the CAD tool an agent can install with one line (`npx -y open3dj mcp`) and a human can install with one click. The same OCCT 8.0.1 kernel, compiled once to WebAssembly, runs in the CLI, the desktop app and a zero-install web playground, so results are identical everywhere. The modelling language is 3dj.app's proven Replicad-style DSL, opened as Open3DJ DSL v1 with its standard-parts library and the Design Evidence Pack, so every 3dj starter works on day one. Agent scripts run in a QuickJS-in-WASM membrane inside an OS-sandboxed worker. The agent surface is 16 MCP tools with exact CLI parity. A headless agent preview ships in **week 8** and a signed desktop app plus web playground in **week 16**. After that, adoption compounds through plugins and compute/print providers, and 3dj.app is the first paid provider among several rather than a gate. Native OCCT, constraint sketching, Python runtimes and local generative models are added later behind interfaces that are frozen from day one.

---

## 1. Who adopts first, and what they need

| Wave | Who | What makes them adopt | What makes them leave |
|---|---|---|---|
| 1 (weeks 8-16) | Agent power users on Claude Code, Codex, Cursor, Gemini/Antigravity, Goose | A one-line install; a typed, token-cheap tool surface; exact measurements; it works offline | Flaky installs, 25k-token responses, unsafe code execution |
| 2 (weeks 16-30) | Makers and 3D-printing hobbyists, plus OpenSCAD and build123d users | A desktop app that shows the agent's work live, printable 3MF output, gates that catch thin walls | No signed installer, cloud lock-in, subscriptions |
| 3 (weeks 30+) | Professional engineers and small hardware teams | STEP fidelity, fillets that work, revision review, assemblies, provenance | Kernel failures, no feature tree, no reviewable diffs |

The market gap is documented. Zoo's engine is closed and cloud-only (its 3D view is "a video stream from our hosted geometry engine") and its MCP server allows one session per process [1][2][3]; its forum is dominated by "Failed to connect" threads [53]. Autodesk's local Fusion MCP needs a running, licensed Fusion and listens unauthenticated on 127.0.0.1:27182, and the Compute MCP beta is reportedly capped at two sessions [4][5]. PTC's Onshape MCP only writes FeatureScript features [62]. FreeCAD and Blender MCPs run arbitrary Python in a live GUI over unauthenticated sockets [61]. text-to-cad (23.5k stars) has a viewer but no persistent, editable design document [7]. SolidCraft, the closest analogue (MIT OR Apache-2.0, ~11k stars, MCP server), runs on the Rust `truck` kernel without upstream fillets and ships unsigned binaries [6]. Nothing combines open source, local-first B-rep, a typed agent contract, built-in evidence, sandboxing, multi-session use and pluggable cloud GPUs.

The dead projects teach the same lesson: Fornjot (archived June 2026) built its own kernel and CADmium (archived Sep 2025) used a non-open licence [60], and Hacker News scrutinised CADmium's licence, offline use, STEP and fillets before anything else [48]. Open3DJ leads with licence clarity, offline operation, OCCT-grade fillets and STEP.

---

## 2. Design principles (adoption-first)

1. **Install is the product.** `npx`, a signed installer, the web playground, `.mcpb` and a Claude Code plugin all ship together at launch. Nothing requires a compiler, Python, CUDA or an account.
2. **One kernel artifact, three hosts.** The same JS+WASM kernel bundle runs in Node (daemon/CLI), in the Tauri desktop (through the daemon) and in a browser Web Worker (playground and share links).
3. **Reuse, then improve.** Adopt 3dj.app's DSL, `lib.*` and Evidence Pack vocabulary unchanged and publish them as open specifications. Do not invent a new language in year one.
4. **Agents and humans see the same thing.** Every agent mutation becomes a revision that shows up live in the desktop viewer, with a numeric delta and a ghost diff.
5. **Freeze interfaces early, fill implementations late.** `KernelBackend`, `Provider`, the plugin manifest, the command catalogue and the `.o3j` format are versioned specifications from v0.1. Native kernels, Python and GPU models plug in behind them later.
6. **Safe by construction, not by lint.** 3dj's `cad_validate_script` passed a script containing `fetch`, `eval` and `while(true)` [36]; static checks are hints, isolation is the control.
7. **Never charge for the core.** Kernel, format, exports, local MCP and local providers are free forever; revenue comes from GPUs, a hosted relay, print operations and team services (Section 11).

---

## 3. System architecture

### 3.1 Process model

```
 Agents: Claude Code / Codex / Cursor / Gemini-Antigravity / Goose / VS Code      Humans
   | stdio MCP  (npx -y open3dj mcp)      | o3dj CLI --json        | Streamable HTTP 127.0.0.1 + token
   v                                      v                        v
+--------------------------- o3dj daemon (TypeScript on Node 24 LTS) ---------------------------+
| Command catalogue (JSON Schema, versioned)  ->  adapters: MCP | CLI | WS JSON-RPC (UI) | SDK   |
| Doc store + revisions (.o3j)  | Job queue  | Provider router (policy, cost caps, failover)    |
| Evidence engine (gates, confidence) | Formats (3MF/STEP/STL/GLB/OBJ) | Snap renderer (CPU, PNG)  |
| Workspace path jail (realpath containment) | Keychain secrets | Audit + provenance log         |
+------------|----------------------------------------------------------------------|----------+
             | spawn warm pool, N = cores-1, recycled every 200 jobs / on crash      | out-of-process
             v  OS sandbox: Seatbelt (macOS) / bwrap+seccomp or Landlock (Linux) /  v  providers
   kernel-worker (Node, no net, read-only assets, Job Object/rlimits caps)        local GPU worker (Python/CUDA)
     QuickJS-WASM context per run  --membrane-->  @open3dj/dsl  -->  occt-wasm     3dj.app (OAuth 2.1+PKCE)
     (user/agent script)        (handles + data specs)     (OCCT 8.0.1) + manifold-3d    fal / RunPod / Modal
                                                                                  OpenSCAD (GPL, separate)
                                                                                  slicers (AGPL CLIs)
 Desktop: Tauri 2.12 shell -> React 19 UI + three.js r186 viewer <-> daemon over loopback WebSocket
 Web playground: same UI + @open3dj/core in a Web Worker (kernel workers nested), no OS features
```

**Why a TypeScript daemon rather than Rust.** The research digest recommends a Rust daemon with native OCCT [client report]. That is the right end state for raw performance, but the wrong first step for adoption:

- **No native dependencies.** occt-wasm ships OCCT 8.0.1 as a ~4.5 MB brotli WASM (170+ facade methods, MIT OR Apache-2.0 tooling, LGPL-2.1 binary, v5.8.1 of 25 Oct 2026) that needs no C++ toolchain and runs on Node 22+ [10]. It therefore runs on Windows/macOS/Linux x64 and arm64, WSL and CI containers. Cross-compiling OCCT for six OS/arch targets would cost a 3-person team about a month and add a long tail of install bugs.
- **`npx` is the lingua franca of MCP configs.** Most published MCP server configs use `npx -y <pkg>`; a Python or Rust daemon adds an install step for wave-1 users.
- **One language across UI, daemon, DSL, plugins and SDK.** The contributor pool is larger, AI coding agents write TypeScript fluently, and the official TypeScript MCP SDK v2.4.0 (23 Oct 2026) already implements the 2026-07-28 revision [16].
- **LGPL hygiene is trivial.** OCCT is a separate, replaceable `.wasm` file with the required notice [9].
- **The upgrade path is preserved.** occt-wasm exposes the same facade from a Rust crate that runs the identical WASM under wasmtime [10]. A native OCCT "turbo" backend (Phase 4) slots in behind `KernelBackend` without changing any tool schema.

**The cost is accepted and bounded.** taucad's OCCT 8.0.1 WASM benchmarks show parity to 2x native on fuse, meshing, fillet, sweep and loft, about 3x on small booleans and about 9x on sub-millisecond primitives where call overhead dominates [11]; wasm32 caps memory at 4 GB per instance [client report]. For the single parts and small assemblies of waves 1 and 2 this is invisible. Heavy assemblies get a worker pool, op-level memoisation and the Phase-4 native backend.

**Runtime packaging.** The npm package `open3dj` is pure JS + WASM (Node ≥22, Node 24 LTS recommended). The desktop sidecar is a pinned Node LTS single executable built with `node --build-sea` (introduced in Node 25.5.0 [58]), falling back to shipping the Node binary plus the bundle. Bun 1.4.4 (npm, 22 Oct 2026) was rejected as the kernel host: it uses JavaScriptCore, while occt-wasm documents only Node and browsers.

### 3.2 Attach-or-host: one daemon, many agents, one live viewer

Every `o3dj` entry point first looks for a running daemon via a lockfile (`$CONFIG/open3dj/daemon.json`, mode 0600, holding port, PID and a random token) and attaches to it; otherwise it hosts the daemon in-process (headless mode). Consequences:

- Claude Code in a terminal and Cursor in an editor drive the same document store, and the desktop app shows both agents' edits live.
- Multi-session is native: documents are addressed by `doc_id` with optimistic concurrency (`base_rev`; a conflict returns `isError` plus the latest revision so the agent can rebase). This removes Zoo's one-session-per-process limit [3] and Fusion Compute's reported two-session cap [5].
- MCP 2026-07-28 removed protocol sessions, so all state lives in explicit server-minted handles (`doc_id`, `rev`, `job_id`) bound to the local user [13].

### 3.3 Anatomy of `o3dj_run`

1. The daemon resolves `doc_id` to an `.o3j` project, applies `code` or `patch`, and computes the cache key (kernel version, script hash, params hash).
2. On a cache miss it leases a kernel worker, which creates a fresh QuickJS context with memory, stack and deadline limits (default 30 s) and evaluates the script against the membrane.
3. **Membrane.** DSL calls cross into trusted code as `{op, args, handles}`. Edge and face queries are declarative builder specs, so `e => e.inDirection("Z").ofLength(20)` crosses as JSON, which is also what makes references persistable (Section 4.3). The script sees no host objects: no clock, no unseeded RNG, no I/O, no `import`.
4. The worker returns `.brep` handles, a binary tessellation with per-face/edge IDs, the op trace (op, args, source span, output IDs, fingerprints), measurements and warnings.
5. The daemon writes the revision and provenance records, diffs against the parent, runs requested gates and renders, pushes the tessellation to connected viewers and returns a `GeometryReport`.

### 3.4 Snap renderer (what the agent sees)

Agent images come from a deterministic CPU rasteriser (`@open3dj/snap`, pure TypeScript: z-buffer, flat shading, crisp B-rep feature edges from the kernel, optional face-ID and dimension overlays). It runs headless with no GPU (CI, SSH, containers), produces identical pixels on every machine so pixel diffs and golden tests are stable, and captions every image with camera, scale and bbox digests. Visual critique carries real weight: in CADSmith's ablation, removing renders from the judge left mean Chamfer distance at 18.19 instead of 0.74 [22]. With the desktop app attached, `o3dj_look {engine:"viewer"}` returns a high-fidelity three.js render of the same camera.

---

## 4. Kernel, DSL and references

### 4.1 Kernel stack (MVP)

| Layer | Choice | Version | Licence | Role |
|---|---|---|---|---|
| B-rep | occt-wasm (OCCT 8.0.1) behind `KernelBackend` | 5.8.x [10] | Tooling MIT/Apache-2.0; WASM LGPL-2.1 + OCCT exception [9] | Solids, fillets, shell, loft, booleans, STEP/STL/BREP/GLB |
| Mesh | manifold-3d | 3.5.4 (npm, 25 Sep 2026) [12] | Apache-2.0 | Mesh CSG, imported-mesh repair, 3MF preparation, DfAM checks, generative-mesh cleanup |
| Script sandbox | quickjs-emscripten | 0.32.0 (npm) [34] | MIT | Per-run JS context with memory, stack and deadline limits |
| DSL | `@open3dj/dsl` (3dj/Replicad-compatible API, MIT replicad 1.2.0 as API reference) | new | MIT OR Apache-2.0 | Parametric scripting, `Param.*`, `lib.*`, references |

**Week-1 kernel spike.** Run all 18 public 3dj starters [36] on three candidates: occt-wasm; replicad 1.2.0 with replicad-opencascadejs 1.1.0 (npm); and taucad libcascade 3.1.0 [11]. Score each on pass rate, volume/bbox agreement with 3dj.app (target ≤1e-6 relative), fillet robustness on a 50-part corpus, cold init time and size. occt-wasm is the default pick on size, OCCT version and its dual TS/Rust facade. `KernelBackend` makes the choice reversible.

The **failure ladder is a product feature**. When a boolean or fillet fails, the kernel layer retries in a fixed order:

1. fuzzy-value sweep
2. glue mode
3. shape healing
4. safe-input mode.

Each attempt is reported as a structured warning (`FILLET_RETRIED_FUZZY`) together with OCCT's `HasErrors` / `HasWarnings` text [kernels report].

### 4.2 The DSL: 3dj's language, opened

The 3dj DSL is published as **Open3DJ DSL v1**, a spec with a conformance suite, co-owned with 3dj.app. Agents and 3dj starters write:

```js
// bracket.o3j.js  (Z-up, millimetres)
export const params = {
  width:  Param.number(60, { min: 30, max: 200, confidence: "measured", tol: 0.15 }),
  holes:  Param.choice("M4", ["M3", "M4", "M5"]),
  ribbed: Param.bool(true),
};
export default ({ width, holes, ribbed }) => {
  let body = box(width, 30, 4).fillet(2, e => e.inDirection("Z")).tag("plate");
  const boss = lib.screwBoss({ size: holes, height: 12 }).attachTo(body.ref("plate").top(), { at: [10, 15] });
  body = body.fuse(boss).cut(lib.screwCutter({ size: holes, length: 20 }).at(boss.axis()));
  if (ribbed) body = body.fuse(lib.rib({ length: width - 20, height: 8 }).onFace(body.ref("plate").top()));
  return { body: body.color("#4a7"), evidence: minWall(body, 0.8) };
};
```

Agents get these from the start:

- **The 3dj surface.** That covers primitives, 2D sketches, extrude/revolve/loft (twist, scaleTop), booleans, fillet/chamfer with edge queries, shell, patterns, bounding-box anchors, named references (`withReferences/attachTo/onFace/hole/cutout`), connectors (`connector.male/female` + `matchTo`), multi-part named returns, `tolerance()`, `chamferBottomEdges()`, `minWall()` and measurement.
- **The `lib.*` standard library.** It includes ISO fasteners M2-M8, screw cutters, heat-set and hex-nut pockets, snap fits, bosses, tabs, cable anchors and 2020 T-slot profiles. It is ported from 3dj and extended from bd_warehouse tables (Apache-2.0) [66].
- **Retrieval-ready docs.** `o3dj_docs` serves the DSL reference as small chunks (CADSmith and CADDesigner both rely on RAG over API docs [research-llm-cad report]). This avoids the token pitfall of 3dj's `cad_get_starters`, which returns 18 scripts plus the whole DSL reference in one response [36].

**Why JS and not Python first.** Python (build123d/CadQuery) dominates LLM pretraining and the benchmarks [24][25], but JavaScript is what 3dj already runs, what runs in the browser playground, and what can be sandboxed without an OS dependency. Mitigations: an in-house JS-vs-build123d evaluation on 200 prompts in week 6, and a Phase-3 Python provider so cadrille-, CADmium- and CADBench-style CadQuery runs unmodified as a trusted-tier plugin.

### 4.3 References that survive edits

The membrane forces every selector to be data, so the op trace records each reference as **selector + creating op ID + geometric fingerprint (type, centroid, normal, area) + human label**. After every run the report includes `refs: {resolved, rematched, broken}`, and broken references carry the line number and a suggested replacement selector. Tags (`.tag("plate")`) are encouraged in the docs and the skill, following KCL's tag model [kernels report]. The Phase 4 addition is an element map built from OCCT `Generated`/`Modified` history and BRepGraph IDs. This needs facade extensions, which will be contributed upstream to occt-wasm.

---

## 5. Native model format: `.o3j`

The format is plain text and git-diffable, and the script is the single source of truth (the KCL "code is the model" lesson [kernels report]). There is no second JSON source that could drift out of sync.

```
bracket.o3j/                  directory; zipped as .o3jz for sharing
  open3dj.json                manifest: format "o3j/1", project UUIDv7, name, units "mm", up "Z",
                              dsl "1.x", kernel pin (occt 8.0.1 / occt-wasm 5.8.x), entry, parts[],
                              variants{name: params}
  parts/bracket.o3j.js        source of truth (DSL v1 module)
  assets/<sha256>.step|stl|png  imported references + <sha256>.meta.json (origin, licence, untrusted text)
  evidence.json               Design Evidence Pack v2 (gates + per-param/per-feature confidence)
  history/revisions.jsonl     append-only: rev, parent, author {kind: human|agent, client, model?},
                              message, script/params hashes, geometry digest (volume, bbox, topology counts)
  history/provenance.jsonl    PROV-O-shaped: activity (tool call, arg hash) -> entity (rev, export hash)
  AGENTS.md                   optional project conventions for agents (Zoo pattern)
  .o3j-cache/                 gitignored: .brep, .glb, tessellation, renders keyed by cache key
```

- **Single-file mode.** A lone `*.o3j.js` is a valid project with an implied manifest. It fits in a gist, a chat message or a GitHub README badge, and that is the viral unit.
- **Derived feature tree.** `build/feature-tree.json` is computed from the op trace. It drives the UI tree and diffs and is never edited directly. In Phase 4, UI edits rewrite literals at the recorded source spans.
- **Determinism.** A pinned kernel plus a deterministic sandbox gives a reproducible geometry digest. That makes the cache content-addressed and lets CI keep golden hashes.
- **Exports carry identity.** Every export embeds the project UUID, the revision and the provenance head hash:
  - 3MF: namespaced metadata plus a MustPreserve `o3j_evidence.json` part [44]
  - STEP: user-defined attributes
  - STL: a sidecar `.evidence.json`.

---

## 6. Agent interface

### 6.1 Contract

- **Protocol and transports.** MCP 2026-07-28 via TypeScript SDK v2.4 [13][16], negotiating 2025-11-25 clients through `server/discover`, with no reliance on sessions, Sampling or Roots. stdio by default; Streamable HTTP binds 127.0.0.1 only, validates Origin and Host (403 otherwise) and requires a keychain-stored per-install bearer token.
- **Three identical faces.** MCP tools, the `o3dj` CLI (`--json`; exit codes 0 ok, 1 geometry invalid, 2 script error, 3 kernel/provider failure) and `@open3dj/sdk` share names and JSON Schemas generated from one catalogue. CLI-plus-skill can cost 4-32x fewer tokens than large MCP tool sets in vendor benchmarks [20][21], so the CLI is a first-class agent interface.
- **Token budget.** Server `instructions` under 512 characters (Codex reads only that much), `response_format: concise|detailed`, paginated catalogues, opt-in images, and every response well under Claude Code's 25k-token default cap [17].
- **Errors are tool results** (`isError:true` with `{code, message, line, col, op, suggestion, docs_ref}`) so the model can self-correct [13].
- **Long work is asynchronous**: the Tasks extension when declared (Claude Code beta [14][17]), otherwise `job_id` polling; no call blocks past 50 s (Codex defaults to 60 s).

### 6.2 Tool surface (16 tools)

| Tool | Key inputs | Output (`structuredContent`) | Hints |
|---|---|---|---|
| `o3dj_open` | `template?` \| `path?` \| `url?` \| `gist?` \| `from_3dj?`, `name?` | `{doc_id, rev, path, params[], summary}` (handle lifetime stated) | — |
| `o3dj_run` | `doc_id`, `code?` \| `patch?[{find,replace}]`, `params?`, `base_rev?`, `capture?["diff","image:iso","checks:fdm"]`, `response_format?` | `GeometryReport` (below) | non-destructive (new rev) |
| `o3dj_params` | `doc_id`, `values{}`, `base_rev?` | `GeometryReport` without resending code | — |
| `o3dj_inspect` | `doc_id`, `rev?`, `queries[bounds\|volume\|mass(density)\|topology\|faces(sel)\|edges(sel)\|section(plane)\|distance(a,b)\|interference\|clearance\|probe]` | per-query values with units + confidence label | readOnly, idempotent |
| `o3dj_look` | `doc_id`, `rev?`, `views["iso","front",..]`, `style`, `section?`, `highlight?[ref]`, `size?`, `engine?` | image blocks + caption `{camera, scale, bbox}` | readOnly |
| `o3dj_check` | `doc_id`, `profile fdm\|sla\|cnc\|custom`, `rules?` | gates `[{name, status pass\|fail\|unevaluated, measured, limit, evidence}]` in Evidence Pack vocabulary | readOnly |
| `o3dj_diff` | `doc_id`, `a`, `b`, `image?` | `{volume/area/bbox deltas, changed_parts, refs_report, image?}` | readOnly |
| `o3dj_export` | `doc_id`, `formats[step,stl,3mf,glb,obj]`, `parts?`, `step_schema?` | `resource_link`s + sha256 + size + provenance | readOnly |
| `o3dj_import` | `doc_id`, `source`, `as reference\|body` | `{asset_id, report, metadata: {untrusted:true, ...}}` | — |
| `o3dj_lib` | `query?` \| `id?`, `cursor?` | paginated parts with a usage snippet each | readOnly |
| `o3dj_docs` | `query`, `max?` | ranked DSL doc chunks + runnable examples | readOnly |
| `o3dj_history` | `doc_id`, `action list\|revert\|label`, `rev?` | revisions with author, digest, message (revert = new rev, never deletes) | — |
| `o3dj_generate` | `kind text_to_mesh\|image_to_mesh\|scan_to_cad\|...`, `input`, `provider?`, `max_cost_usd?`, `target_doc?` | Task or `{job_id, est_cost, provider, license_flags}` | openWorld |
| `o3dj_job` | `job_id?`, `action get\|cancel\|list` | status, progress, artifacts (content-addressed) | — |
| `o3dj_providers` | `kind?` | providers with capabilities, licence/territory flags, health, price model | readOnly |
| `o3dj_quote` | `doc_id`, `rev`, `provider`, `material`, `qty` | quote request ID (acceptance is human-only, in the UI) | openWorld |

```json
{ "doc_id":"d_7f3","rev":"r12","ok":true,
  "parts":[{"name":"body","solids":1,"valid":true,"volume_mm3":18234.5,"area_mm2":9120.2,
            "bbox":{"min":[0,0,0],"max":[80,40,22]},"mass_g":22.6}],
  "params":[{"name":"width","value":80,"min":30,"max":200,"confidence":"measured","tol_mm":0.15}],
  "diff":{"from":"r11","volume_delta_mm3":-412.0,"bbox_delta":[0,0,-2],"changed":["body"]},
  "refs":{"resolved":12,"rematched":1,"broken":0},
  "gates":{"profile":"fdm","pass":3,"fail":1,"unevaluated":1},
  "warnings":[{"code":"FILLET_RETRIED_FUZZY","line":4,"suggestion":"reduce radius below 1.9"}],
  "errors":[], "timing_ms":{"script":38,"kernel":412} }
```

This report is the main lever on result quality. build123d-mcp reports that adding measurement and validation tools raised its CADGenBench score from 0.360 to 0.457 and validity from 88% to 100% [23]. CADSmith's kernel-metrics-plus-render judge lifted median IoU from 0.81 to 0.96 [22]. ProCAD's clarification step cut invalidity from 4.8% to 0.9% [26]; the skill therefore tells agents to confirm missing dimensions before modelling, and a `validate_spec` helper arrives in Phase 3.

### 6.3 Packaging for every agent (all at launch)

- **Claude Code plugin** with skills, MCP config and a hook that runs `o3dj check` before exports [17]; **`.mcpb`** double-click bundle for Claude Desktop [19].
- **SKILL.md** (under 5k tokens, agentskills.io format [18]), also served via Skills over MCP and installable with `o3dj skill install --target claude|codex|cursor|agents-md`.
- **MCP App viewer** `ui://open3dj/viewer` (three.js orbit/section/explode) inline in Claude, VS Code Copilot, Goose and Cursor [15], with a text fallback elsewhere.
- **Registry and listings**: `server.json` in the official MCP Registry, PRs to awesome-mcp-servers (proposing a CAD category) and Glama [49][50].
- **Client snippets** for Cursor, VS Code, Codex and Gemini/Antigravity, written by the desktop "Connect your agent" panel only after showing the exact command [security report].

---

## 7. Desktop and web client

**Stack**

| Layer | Choice | Version |
|---|---|---|
| Shell | Tauri, MIT/Apache-2.0, using OS webviews | 2.12.x; CLI 2.12.4 (npm); 2.12.5 runtime [29] |
| UI | React with Vite, Tailwind and Radix primitives | React 19.3.1 (npm) |
| State | Zustand | — |
| Script editor | CodeMirror 6, with typed completions generated from the DSL schema | — |
| Viewer | three.js `WebGPURenderer` with automatic WebGL2 fallback [31] | r186 |

Viewer details:
- GPU ID-buffer picking keyed on kernel face/edge IDs, with BVH raycasts for snapping and measuring.
- `BatchedMesh` for faces and edges, `InstancedMesh` for repeated `lib.*` parts.
- Clipping-plane sections.
- Custom shaders are written in TSL.

**Linux policy.** WebKitGTK has no WebGPU and may silently software-rasterise WebGL2 [30], so Linux forces WebGL2, runs a first-launch frame-time probe (the renderer string is masked), applies NVIDIA workarounds (`__NV_DISABLE_EXPLICIT_SYNC`, then `WEBKIT_DISABLE_DMABUF_RENDERER`) only when the NVIDIA module is detected, and offers a visible renderer switch. Exit criterion: a 100k-triangle part at 60 fps on Intel Iris Xe under WebKitGTK by week 14, else a Linux-only Electron 45 build or the Tauri 3 CEF runtime once stable [client report].

**MVP UX ("lovable" means these six things work)**
1. **Live agent watch.** An agent badge appears in the title bar, the viewer updates on every revision, and the camera can follow the agent's last `look`.
2. **Revision timeline.** Each revision shows author (human or agent and client), message and the numeric delta card (volume, bbox, mass, feature counts). Revert is one click.
3. **Ghost diff.** Base is shown in blue and target in red with a slider and a flip key, after Onshape Compare [54].
4. **Parameter panel** generated from `Param.*` declarations, with live re-evaluation and confidence badges.
5. **Evidence panel.** FDM gates show pass/fail/unevaluated status with highlights in the viewer and one-click export of 3MF or STEP.
6. **Navigation presets** in seven industry styles (Zoo, Onshape, SolidWorks, NX, Creo, AutoCAD, trackpad), as encoded in Zoo's MIT `cameraControls.ts` [56]. There is also a view cube, a command palette, dark and light themes, and Esc to cancel everything.

**Onboarding (target: first model in under 3 minutes)**
1. The installer opens a sample bracket.
2. "Connect your agent" detects Claude Code, Claude Desktop, Cursor, VS Code, Codex and Gemini/Antigravity and offers one button each.
3. A pre-filled prompt card ("Ask your agent: design a wall hook for a 20 mm rail, FDM-printable") demonstrates the live watch loop.
4. A non-agent path offers the starter gallery plus the script editor.

**Web playground and share links.** The same UI is deployed as a static site, with `@open3dj/core` running in a Web Worker. `o3dj share` publishes a single-file design to a GitHub Gist under the user's own account. The URL `https://<site>/v#gist=<id>` then opens it, executes it locally in the visitor's browser and offers "Open in desktop" or "Copy MCP prompt". A README badge ("Open in Open3DJ") turns every shared design into an install funnel. There is no server-side cost and no account.

**Distribution and signing.** GitHub Releases is the source of truth (NSIS + MSI, universal notarised dmg, AppImage/deb/rpm, x64 and arm64), with winget and a Homebrew cask from week 16 and Flathub from week 26. Apple's USD 99/yr Developer Program is mandatory now that Homebrew removed `--no-quarantine` [32]; Windows uses free SignPath Foundation OSS signing [33]. Day-one signing is a differentiator, since Zoo and SolidCraft ship unsigned binaries [landscape report]. Installers stay under 80 MB (Zoo's Electron app is 211-341 MB [client report]). Hardware target: x86_64 or arm64, 8 GB RAM, any WebGL2 GPU including Intel UHD 620+, Windows 10 1803+, macOS 13+, glibc 2.28+.

---

## 8. Compute-provider abstraction (local GPU + pluggable cloud)

**A provider is an MCP server that conforms to the Open3DJ provider profile.** The provider protocol reuses MCP: tools `capabilities`, `submit`, `status`, `cancel`, `artifacts`, plus a manifest resource. This means:
- 3dj.app's existing MCP server becomes a provider through a thin open-source adapter.
- Anyone can write a provider in any of the six Tier-1 MCP SDK languages.
- Providers run out of process, which is how GPL and AGPL engines stay licence-isolated.

**Manifest (`provider.json`, signed when listed in the registry)**

```json
{ "id":"local-gpu","kind":["gen3d.image_to_mesh","gen3d.text_to_mesh"],
  "models":[{"id":"triposg","license":"MIT","deps_licenses":["..."],"commercial":true,
             "territory_exclude":[],"min_vram_gb":8,"backends":["cuda"]}],
  "egress":"local-only","pricing":{"model":"free"},"auth":"none","health":"/health" }
```

**Router policy**

| Control | Behaviour |
|---|---|
| Egress levels | `local-only` (default), `cloud-anonymous` (metadata stripped), `cloud-full` |
| Cost | Pre-submission estimates and per-job and monthly USD caps; a job is killed if it runs away |
| Failover | Ranked local-to-cloud failover on out-of-memory errors, missing CUDA or SLA miss |
| Licence check | `territory_exclude` is checked against the user's declared region, so Hunyuan3D is blocked for EU/UK/KR [40] |
| Consent | Per-job consent the first time each provider is used |
| Artifacts | Content-addressed (sha256) and shared between local runtimes and cloud workers |
| Job shape | Mirrors 3dj's `modelId` → poll → download URL pattern |

**Provider roadmap**

| Phase | Provider | Notes |
|---|---|---|
| MVP | `provider-3dj` | Text- and image-to-mesh on the managed fleet with its hourly/daily allowance; operator-reviewed print quotes. Uses OAuth 2.1 + PKCE or an API key held in the OS keychain; credentials are never placed in tool arguments. |
| MVP | `provider-http` | Template so the community can wrap any REST API. |
| Phase 3 | `open3dj-worker` | Python, run via uv or a container, exposing the provider profile on loopback. VRAM tiers below. |
| Phase 3 | `provider-fal` | Per-call TRELLIS at $0.02 and TRELLIS.2 at $0.25-0.35 [43]. |
| Phase 3 | `provider-runpod`, `provider-modal` | Bring-your-own container. Prices: 4090 $0.34-0.89/h, H100 $2.69-3.99/h on RunPod; H100 $3.95/h on Modal [43]. |
| Phase 4 | Reconstruction | COLMAP 4.2.1 plus cadrille (Apache-2.0) for scan- and photo-to-CadQuery-to-B-rep, with measured confidence labels [27]. |
| Phase 4 | Slicers | OrcaSlicer/Bambu shared CLI as an AGPL subprocess. |
| Phase 4 | JLC3DP | JLCAPI 3D Printing API (quote-to-order) and Shapeways v1 [45]. |

`open3dj-worker` VRAM tiers:

| VRAM / platform | Default |
|---|---|
| Under 12 GB | Cloud by default |
| 8 GB minimum | TripoSG (MIT) [42] |
| 16-24 GB | TRELLIS family. Flagged: diffoctreerast and nvdiffrast are non-commercial dependencies, so the manifest lists per-dependency licences and the default is off for commercial use [41]. |
| Apple Silicon | Cloud by default |

**3dj.app is one provider among several.** CI runs the same provider conformance tests against `provider-3dj`, `provider-fal` and `local-gpu`. No core feature may require a specific provider.

---

## 9. Security model (compact, shipping in the MVP)

1. **Three execution layers.** (a) A QuickJS-WASM context per run with memory, stack and deadline limits [34], which alone denies all ambient authority on every OS from day one; (b) a recycled kernel-worker process with resource caps (Job Object on Windows, rlimits/cgroups on Linux) and no network; (c) an OS sandbox profile via Anthropic's sandbox-runtime (Apache-2.0, npm 0.0.81: Seatbelt on macOS, bubblewrap/seccomp on Linux) [35], with RFC1918 ranges explicitly added to `deniedResolvedAddresses`. Windows gets AppContainer plus a restricted token in Phase 3.
2. **Python is trusted-tier only**, run in the OS-sandboxed worker with no network; RestrictedPython and Pyodide are not treated as boundaries [security report].
3. **Daemon hardening.** Loopback only, Origin/Host checks, keychain token, realpath workspace jail, and CI regression tests replaying CVE-2025-49596 (DNS rebinding) [37], CVE-2025-53109/53110 (path containment) [38] and CVE-2025-54136 (config rug-pull) [39].
4. **Untrusted content is labelled.** STEP headers, 3MF metadata and imported filenames come back in `untrusted` fields, never in tool descriptions; parsers run in the sandboxed worker.
5. **Plugins.** DSL libraries run inside QuickJS (safe by construction); providers are out-of-process MCP servers needing consent; native plugins are trusted-tier only. Registry entries require npm provenance (Sigstore), and any manifest, description or schema change triggers re-approval.
6. **Telemetry and crash reports are opt-in**, unlike text-to-cad's on-by-default telemetry [7].

---

## 10. Plugin ecosystem, community and launch

**Plugin types (manifest `open3dj-plugin.json`, npm keyword `open3dj-plugin`)**
1. `lib`: DSL part libraries such as gears, enclosures and Gridfinity bins. They run sandboxed and are the easiest first contribution.
2. `check`: custom gates such as "laser-cut kerf" or "injection-moulding draft (approx)". Also sandboxed.
3. `provider`: compute, print, importer or LLM, as described in Section 8.
4. `template`: starters for the gallery and `o3dj_open`.
5. `panel`: UI panels as sandboxed iframes using MCP Apps-style postMessage (Phase 4).

**Registry.** A curated `open3dj/registry` repo (PR-based, like a Homebrew tap) indexes npm packages. The in-app browser shows licence, provenance badge and capabilities. GPL engines (OpenSCAD via an openscad-wasm/nightly Manifold build, FreeCAD Fasteners, BOLTS) live in separate repos as out-of-process providers so the monorepo stays licence-clean.

**Governance and licence.** Relicense to MIT OR Apache-2.0 now: a one-commit change while there is a single copyright holder, keeping the founder's MIT and adding Apache's patent grant [licensing report]. Use a DCO rather than a CLA, CODEOWNERS module ownership, and an RFC repo with a 10-day final comment period. `AGENTS.md` forbids reading GPL/AGPL CAD code (FreeCAD, SolveSpace, OpenSCAD, slicers); OCCT is used only via its public API. Move the repo from the personal account to a GitHub organisation before launch. "Open3DJ" is one letter from Intel ISL's Open3D (14.1k stars) [51], so counsel should clear "3DJ"/"Open3DJ" before week 16, and the npm, PyPI, crates and MCP-registry names should be reserved now.

**Viral demo set (recorded before launch, each under 90 s)**
1. **"Agent designs, human watches."** Claude Code in a terminal, Open3DJ updating live: phone stand → `check` fails one wall → agent fixes it → 3MF opens in Bambu Studio.
2. **"Works on a plane."** Wi-Fi off, full loop offline: the direct contrast to Zoo's cloud engine [1].
3. **"Two agents, one design."** Cursor designs a PCB tray, Claude Code the lid; `matchTo` connectors align them and the timeline shows both authors.
4. **"Paste a link, it runs."** A gist share link renders in the browser with zero install.
5. **"Benchmarks, not vibes."** A public leaderboard compares frontier models with and without Open3DJ feedback tools on a CADGenBench-compatible STEP subset plus dimension assertions [28].

**Launch sequence.** Week 8: npm, MCP Registry, awesome-mcp-servers PR, Discord. Weeks 9-15: weekly releases with public changelogs and a "good first lib" campaign seeded with 30 issues. Week 16: Show HN whose first paragraph states the licence, offline operation and business model, leading with evidence and provenance rather than "AI" [48].

---

## 11. Open-core relationship with 3dj.app

| Open3DJ (open, MIT OR Apache-2.0) | 3dj.app (closed services) |
|---|---|
| Kernel runtime, DSL v1 spec + conformance suite, `lib.*` | Managed GPU fleet (generative 3D, later reconstruction) with free allowance plus credits |
| Evidence Pack v2 schema (jointly published) and gates | Hosted remote MCP endpoint and **relay** so ChatGPT and claude.ai can reach a user's local daemon (hosted clients need public HTTPS) |
| `.o3j` format, exports, local MCP/CLI/SDK | Team workspaces, cloud sync, sharing with access control |
| Desktop app, web playground, provider SDK, `provider-3dj` adapter | Operator-reviewed print quotes and fulfilment (EUR) |
| Local providers (GPU worker, OpenSCAD, slicers) | Enterprise: SSO/SCIM, audit, on-prem/air-gapped support contracts |

**Rules.** Never charge for local capability (the Ollama pattern: own hardware unlimited, cloud metered [47]); no `/ee` folder or source-available licence; 3dj.app migrates its browser workbench onto `@open3dj/core`, `@open3dj/dsl` and `@open3dj/viewer` in Phases 3-4, so there is one DSL rather than two; 3dj's public `cad_get_starters` and `cad_get_evidence_schema` are re-pointed to the open specs.

**Funnel.** Install → `o3dj_generate` with no GPU → consent prompt offering the 3dj.app free allowance → account → credits and print quotes. Competing providers stay one click away, which is what makes the funnel trustworthy.

---

## 12. Repository layout (pnpm workspaces + Turborepo, Biome, Vitest, Playwright, Changesets)

```
open3dj/
  packages/
    core/            command catalogue + JSON Schemas, doc store, revisions, job queue, router (isomorphic)
    kernel/          KernelBackend interface + backend-occt-wasm (+ backend-native in Phase 4)
    kernel-manifold/ manifold-3d mesh ops, repair, DfAM primitives
    dsl/             Open3DJ DSL v1 (3dj-compatible), Param, refs/op-trace, membrane proxies
    sandbox/         QuickJS membrane, worker pool, OS-sandbox launcher profiles
    stdlib/          lib.* parts (ISO fasteners, pockets, snap fits, T-slot) + data tables
    evidence/        gates, confidence vocabulary, Evidence Pack v2 schema
    formats/         3MF writer (core+production+o3j metadata), STEP/STL/GLB/OBJ via kernel, importers
    snap/            deterministic CPU renderer -> PNG
    viewer/          three.js CAD viewer (desktop, web, MCP App share it)
    ui/              React app shell (panels, timeline, diff, params, evidence, editor)
    mcp/             MCP adapter, Apps resource ui://open3dj/viewer, Skills-over-MCP
    cli/             `o3dj` binary: CLI + daemon + attach-or-host
    sdk/             @open3dj/sdk (TS); sdk-python/ added in Phase 2
    provider-sdk/    provider profile, manifest schema, conformance tests
  providers/         provider-3dj, provider-http, (phase 3) provider-fal, provider-runpod, provider-modal
  workers/gpu/       open3dj-worker (Python, uv, CUDA) - Phase 3
  apps/
    desktop/         Tauri 2.12 shell (thin Rust: sidecar, updater, file associations, deep links)
    web/             playground + share-link viewer (static)
    docs/            docs site (DSL reference doubles as RAG corpus)
  integrations/      claude-code-plugin/, mcpb/, cursor/, codex/, gemini/, skills/SKILL.md
  bench/             eval harness: prompts, golden STEP hashes, CADGenBench-compatible scorer
  examples/          starters (3dj starters ported), gallery
  rfcs/  GOVERNANCE.md  SECURITY.md  AGENTS.md  NOTICE (OCCT credit)  LICENSE-MIT  LICENSE-APACHE
```

A contributor needs only Node 22+ and pnpm. Rust is needed only for `apps/desktop`, and Python only for `workers/gpu`.

---

## 13. MVP scope (v0.5 public launch, week 16; agent preview v0.1 at week 8)

**In**
- **Headless.** `npx open3dj` provides the daemon, CLI and the 16 MCP tools, with attach-or-host, multi-document and multi-agent support.
- **Modelling.** The DSL v1 runs all 3dj public starters. `lib.*` (M2-M8 fasteners, pockets, snap fits, bosses, tabs, anchors, 2020 T-slot), connectors with `matchTo`, multi-part returns, and references with resolve reports.
- **Kernel.** occt-wasm (OCCT 8.0.1) plus manifold-3d, a failure ladder and a deterministic cache.
- **Formats.**
  - Export: STEP AP214 (AP242 when the facade exposes the schema switch), binary STL, 3MF with evidence metadata, GLB, OBJ.
  - Import: STEP, STL, 3MF, OBJ as reference or body.
- **Evidence.** FDM gates with 3dj defaults (0.8 mm wall, 45° overhang, 220×220×250 bed, PLA density), confidence labels on params, and a provenance log.
- **Agent packaging.** SKILL.md, Claude Code plugin, `.mcpb`, MCP App viewer, registry entry and client snippets.
- **Desktop.** Live agent watch, timeline, ghost diff, param panel, evidence panel, script editor, presets, onboarding, and signed installers on all three OSes (x64 + arm64).
- **Web.** The playground and gist share links.
- **Providers.** `provider-3dj` (generate + quote request) and the `provider-http` template.
- **Security.** All of Section 9 except the Windows AppContainer layer.
- **Benchmarks.** Eval harness v1 with published scores.

**Explicitly out (and when)**

| Capability | Phase | Notes |
|---|---|---|
| Sketch constraint solver | 4 | PlaneGCS WASM (LGPL) or ezpz (MIT) |
| Joints and mates assemblies, tolerance stacks | 4 | |
| 2D drawings / DXF | 4 | |
| CAM, FEA | 4+ | |
| Native OCCT turbo backend | 4 | |
| UI-to-script bidirectional editing | 4 | |
| Per-operation accept/reject proposals | 3 | |
| Python (build123d/CadQuery) runtime | 3 | |
| OpenSCAD provider | 3 | Separate GPL repo |
| Local GPU generative models | 3 | |
| fal / RunPod / Modal providers | 3 | |
| ChatGPT/claude.ai relay | 3 | Built by 3dj.app |
| Reconstruction / scan-to-CAD | 4 | |
| Slicer providers, JLC3DP/Shapeways | 4 | |
| Real-time multi-user sync | Not planned | |
| Mobile | Not planned | |
| IGES | Not planned | Not in occt-wasm [10] |
| Hunyuan3D in any default | Never | Licence excludes EU/UK/KR [40] |

---

## 14. Roadmap (3 engineers + founder/DevRel + AI coding agents; 4th engineer from week 12)

Engineer split: E1 owns kernel, DSL and sandbox; E2 owns the agent surface, daemon, providers and evals; E3 owns the UI, viewer and distribution. AI agents do test generation, the `lib.*` port, docs, the starter conformance suite and triage.

| Phase | Weeks | Deliverables |
|---|---|---|
| 0. Foundations and spikes | 2 (w1-2) | Relicense + governance files + org move + name clearance started; kernel spike decision record (3 candidates × 18 starters); QuickJS membrane spike with a 10-op DSL; Tauri + Node-SEA sidecar spike on Win/macOS/Linux including WebKitGTK frame-time test; Apple and SignPath accounts; monorepo, CI, licence gate |
| 1. Agent Preview v0.1 | 6 (w3-8) | Daemon/CLI/MCP with 16 tools (generate/quote stubbed); DSL v1 + 3dj starter conformance; `lib.*` core; GeometryReport, diff, refs report; snap renderer; FDM gates + Evidence Pack; STEP/STL/3MF/GLB; Seatbelt/bwrap/QuickJS sandbox; SKILL.md, Claude Code plugin, `.mcpb`, registry entry; eval harness v0 + JS-vs-build123d eval (w6); **public on npm at w8** |
| 2. Desktop Beta v0.5 (launch) | 8 (w9-16) | Tauri app (viewer, timeline, ghost diff, params, evidence, editor, presets, onboarding); MCP App viewer; web playground + gist share; `provider-3dj` (generate, quote); provider SDK; signed installers x64+arm64, auto-update, winget + Homebrew; demo videos; benchmark page; weekly releases; **Show HN at w16** |
| 3. Ecosystem v0.8 | 10 (w17-26) | Plugin registry + `lib`/`check` plugin types; OpenSCAD provider (separate GPL repo); Python provider (build123d 0.13 / CadQuery 2.8 via uv, trusted tier); `open3dj-worker` (TripoSG default) + fal/RunPod/Modal; per-op proposal accept/reject + plan mode; Windows AppContainer; Python SDK; ACP host so the app can embed external agents such as Gemini CLI, which has native ACP support; Claude Code works via an adapter (secondary sources [57]); 3dj relay (3dj team); Flathub |
| 4. Pro 1.0 | 14 (w27-40) | Native OCCT turbo backend (Rust/wasmtime or N-API) for big assemblies; element map from OCCT history; UI edits rewrite script spans; sketch constraints; assemblies with joints; DXF/SVG drawings; reconstruction pipeline (COLMAP + cadrille); OrcaSlicer/Bambu provider; JLC3DP + Shapeways providers; WCAG 2.2 pass; external security audit + bounty; **1.0 at w40** |

Gates between phases:
- **End of Phase 1:** all 18 starters pass; `run` p50 under 1 s on the starters; npx cold start under 10 s.
- **End of Phase 2:** install success above 97% (opt-in reporting plus a CI install matrix); first model in under 3 minutes in 5 recorded user tests.
- **End of Phase 3:** at least 25 third-party plugins and at least 2 non-3dj providers passing conformance.

---

## 15. Differentiators

| Versus | Open3DJ advantage |
|---|---|
| **Zoo Design Studio / Zookeeper** | Fully local and offline on an open OCCT 8.0.1 kernel, versus Zoo's closed, cloud-only engine streamed as video [1][2]. Multi-agent, multi-document daemon versus one session per MCP process [3]. Signed installers about a third of the size. No per-minute agent billing: the user brings any agent. |
| **Autodesk Fusion MCP trio** | No licence and no running GUI required. Authenticated loopback versus an unauthenticated 127.0.0.1:27182. Published, versioned tool schemas versus undocumented dynamic tools. No two-session cap [4][5]. |
| **Onshape FeatureScript MCP** | Full document read/write/inspect/export, versus custom-feature authoring only. Free and local [62]. |
| **FreeCAD / Blender MCP** | Sandboxed DSL rather than arbitrary host Python. Headless with no GUI required. Exact structured measurements rather than screenshots-by-default [61]. |
| **SolidCraft** | OCCT-grade fillets, shells, lofts and STEP versus truck (no upstream fillets) [6]. 3dj's `lib.*` standard content and Evidence Pack. Pluggable GPU and print providers. Zero-install web runtime identical to desktop. `npx` install. Signed binaries. |
| **text-to-cad / build123d-mcp** | A persistent, editable design document with a revision timeline, live desktop viewer and diffs. Multi-session. Sandboxed execution. Python compatibility added in Phase 3 rather than required [7][23]. |
| **All of them** | Evidence-first outputs (gates, confidence labels, provenance hashes embedded in exports), share links that execute in the browser, a published benchmark harness, and an open provider market that 3dj.app competes in rather than owns. |

---

## 16. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | WASM kernel too slow or memory-capped (1.1-3x typical, about 9x on tiny ops, 4 GB wasm32) [11] | Worker pool and op memoisation; `KernelBackend` interface frozen at v0.1; native turbo backend in Phase 4; benchmark corpus in CI from week 4 with published numbers |
| 2 | Dependency on single-maintainer occt-wasm | Pin a vendored fork built from the OCCT submodule (MIT/Apache tooling); libcascade 3.1.0 as tested fallback; contribute upstream |
| 3 | JS DSL less accurate for LLMs than Python [24][25] | Week-6 in-house eval; retrieval-ready docs and examples; Python provider in Phase 3; publish results whichever way they fall |
| 4 | SolidCraft/Zoo velocity in a crowded MCP field [6][49] | Weekly releases; differentiate on evidence, OCCT, `lib.*`, providers, share links; propose a shared Evidence Pack schema to SolidCraft |
| 5 | Linux WebKitGTK rendering problems [30] | Forced WebGL2, frame-time probe, targeted driver workarounds; Electron/CEF Linux build if the week-14 exit criterion fails |
| 6 | Sandbox escape or prompt injection via file metadata | Three isolation layers, untrusted labelling, CVE regression tests, parser fuzzing, bounty before 1.0 |
| 7 | Licence contamination (GPL OpenSCAD, AGPL slicers, Hunyuan territory terms, TRELLIS non-commercial dependencies) [40][41] | CI licence gate on the core; GPL/AGPL only as separate-repo, out-of-process providers; per-dependency licence fields in provider manifests; territory checks |
| 8 | Name or trademark conflict with Open3D [51] | Counsel clearance before week 16; rename option prepared (namespaces reserved for two alternatives) |
| 9 | Community distrust of open core | Written charter; provider parity tests; no `/ee`; 3dj dogfoods the open packages |
| 10 | Signing friction (SmartScreen reputation, notarisation) [33] | SignPath from w2; Apple notarisation in CI; document expected warnings for early builds; Microsoft Store EXE later |
| 11 | MCP churn (2026-07-28 stateless model; Tasks supported mainly by Claude Code) [13][14] | Official SDK v2.x; polling fallback is first-class; CLI parity as an escape hatch |
| 12 | Topological naming breaks agent edits | Tags plus data selectors plus fingerprint re-matching with an explicit refs report now; OCCT history element map in Phase 4 |
| 13 | Small-team overload after launch | Strict "out" list, CODEOWNERS, AI-assisted triage, RFCs, fourth engineer at w12 |

---

## 17. Adoption metrics (what success looks like at w26)

- npm weekly downloads above 5k; desktop installs above 10k.
- Install success at least 97%; median time-to-first-model under 3 minutes.
- At least 25 third-party plugins; at least 3 providers passing conformance.
- A published benchmark showing a measurable lift with Open3DJ's feedback tools versus a raw-code baseline.
- 3dj provider activations as the open-core metric, guarded by at least 30% of `generate` jobs served by non-3dj or local providers.

## 18. Decisions needed from the founder this week

1. Relicense to MIT OR Apache-2.0 and move the repo to a GitHub organisation.
2. Open-source 3dj's DSL spec, `lib.*` and the Evidence Pack schema into Open3DJ. This is the biggest single adoption lever.
3. Approve the TS/WASM-first core with a native backend deferred to Phase 4.
4. Start name clearance, and buy the Apple Developer membership and apply to SignPath.
5. Commit the 3dj.app team to building `provider-3dj` endpoints and the relay on the public provider profile.

---

## Sources

1. Zoo FAQ — https://zoo.dev/docs/faq
2. KittyCAD/modeling-app README — https://github.com/kittycad/modeling-app
3. KittyCAD/mcp — https://github.com/KittyCAD/mcp
4. Autodesk Fusion MCP overview — https://help.autodesk.com/view/fusion360/ENU/?guid=FMCP-OVERVIEW
5. Fusion Compute MCP beta (secondary) — https://blog.championxperience.com/autodesk-fusion-compute-mcp-ai-cad-manufacturing/
6. SolidCraft — https://github.com/tangency-labs/solidcraft ; architecture (truck kernel) https://raw.githubusercontent.com/tangency-labs/solidcraft/main/docs/architecture.md
7. text-to-cad README — https://raw.githubusercontent.com/earthtojake/text-to-cad/main/README.md
8. OCCT 8.0 release discussion — https://github.com/Open-Cascade-SAS/OCCT/discussions/1275 ; releases https://github.com/Open-Cascade-SAS/OCCT/releases
9. OCCT LGPL exception — https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt
10. occt-wasm README (OCCT 8.0.1, ~4.5 MB brotli, Rust crate via wasmtime, Node 22+) — https://raw.githubusercontent.com/andymai/occt-wasm/main/README.md ; npm https://registry.npmjs.org/occt-wasm
11. taucad libcascade benchmarks — https://github.com/taucad/opencascade.js/blob/main/BENCHMARKS.md
12. Manifold — https://github.com/elalish/manifold ; npm https://registry.npmjs.org/manifold-3d
13. MCP 2026-07-28 changelog — https://modelcontextprotocol.io/specification/2026-07-28/changelog ; tools https://modelcontextprotocol.io/specification/2026-07-28/server/tools
14. MCP Tasks extension — https://modelcontextprotocol.io/extensions/tasks/overview
15. MCP Apps — https://modelcontextprotocol.io/extensions/apps/overview
16. MCP TypeScript SDK releases (v2.4.0, 23 Oct 2026) — https://github.com/modelcontextprotocol/typescript-sdk/releases
17. Claude Code MCP docs — https://code.claude.com/docs/en/mcp ; plugins https://code.claude.com/docs/en/plugins-reference
18. Agent Skills specification — https://agentskills.io/specification
19. MCPB — https://claude.com/docs/connectors/building/mcpb
20. Scalekit MCP vs CLI benchmark — https://www.scalekit.com/blog/mcp-vs-cli-use
21. Anthropic, code execution with MCP — https://www.anthropic.com/engineering/code-execution-with-mcp
22. CADSmith — https://arxiv.org/html/2603.26512
23. build123d-mcp — https://github.com/pzfreo/build123d-mcp
24. Text2CAD-Bench — https://arxiv.org/html/2605.18430v1
25. CADBench — https://arxiv.org/html/2605.10873v1
26. ProCAD — https://arxiv.org/abs/2602.03045
27. cadrille — https://github.com/col14m/cadrille
28. CADGenBench — https://github.com/huggingface/cadgenbench
29. Tauri 2.12 — https://v2.tauri.app/blog/tauri-2.12/ ; releases https://github.com/tauri-apps/tauri/releases
30. Tauri Linux graphics — https://v2.tauri.app/develop/debug/linux-graphics/
31. three.js releases — https://github.com/mrdoob/three.js/releases
32. Apple Developer Program — https://developer.apple.com/programs/ ; Homebrew no-quarantine removal https://github.com/Homebrew/brew/issues/20755
33. Microsoft code-signing options — https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options ; SignPath Foundation https://signpath.org/
34. QuickJS — https://bellard.org/quickjs/ ; quickjs-emscripten https://github.com/justjake/quickjs-emscripten
35. Anthropic sandbox-runtime — https://github.com/anthropic-experimental/sandbox-runtime
36. 3dj.app agents page (validator probe, starters) — https://www.3dj.app/agents
37. CVE-2025-49596 — https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596
38. CVE-2025-53109/53110 — https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/
39. CVE-2025-54136 — https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/
40. Hunyuan3D 2.1 licence — https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE
41. TRELLIS.2 — https://github.com/microsoft/TRELLIS.2 ; nvdiffrast licence https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt
42. TripoSG — https://github.com/VAST-AI-Research/TripoSG
43. fal pricing — https://fal.ai/pricing ; RunPod https://www.runpod.io/pricing ; Modal https://modal.com/pricing
44. 3MF specs — https://3mf.io/spec/ ; core spec https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
45. JLCAPI — https://api.jlcpcb.com/ ; Shapeways API https://developers.shapeways.com/docs
46. OrcaSlicer CLI — https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_mode
47. Ollama Cloud — https://ollama.com/cloud
48. CADmium Show HN — https://news.ycombinator.com/item?id=40428827
49. MCP Registry — https://github.com/modelcontextprotocol/registry ; CAD search https://registry.modelcontextprotocol.io/v0/servers?search=cad&limit=50
50. awesome-mcp-servers — https://github.com/punkpeye/awesome-mcp-servers
51. Intel ISL Open3D — https://github.com/isl-org/Open3D
53. Zoo community top threads — https://community.zoo.dev/top
54. Onshape Compare — https://cad.onshape.com/help/Content/compare.htm
56. Zoo cameraControls.ts — https://github.com/KittyCAD/modeling-app/blob/main/src/lib/cameraControls.ts
57. ACP overview (secondary) — https://www.morphllm.com/agent-client-protocol
58. Node.js 25.5.0 (`--build-sea`) — https://nodejs.org/en/blog/release/v25.5.0
60. Fornjot shutdown — https://fornjot.app/blog/shutting-down-fornjot/ ; CADmium https://github.com/CADmium-Co/CADmium
61. FreeCAD MCP — https://github.com/neka-nat/freecad-mcp ; Blender MCP https://github.com/ahujasid/mcp-for-blender
62. Onshape FeatureScript MCP — https://www.barchart.com/story/news/3828340/ptc-advances-leadership-in-ai-driven-design-with-launch-of-onshape-featurescript-mcp-server
66. bd_warehouse — https://github.com/gumyr/bd_warehouse
- Package versions (bun 1.4.4, replicad 1.2.0, replicad-opencascadejs 1.1.0, @modelcontextprotocol/sdk 1.32.2, three 0.186.1, @tauri-apps/cli 2.12.4, react 19.3.1, @anthropic-ai/sandbox-runtime 0.0.81, quickjs-emscripten 0.32.0) read from https://registry.npmjs.org/ on 27 Oct 2026.
- Bracketed "[x report]" references point to the verified research reports in `scratchpad/research/` (landscape-ai-cad, research-llm-cad, kernels-and-geometry, agent-protocols-and-tool-design, client-and-distribution, compute-local-and-cloud, formats-interop-manufacturing, ux-human-agent-collab, security-sandboxing, community-licensing-business).
