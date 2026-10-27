# Open3DJ: Agent-First Architecture and Execution Proposal

*Principal architect proposal, 2026-10-27. Angle: optimize for what makes agents (Claude Code, Cursor, Codex, custom MCP clients, CI pipelines) effective and reliable. The human UI is secondary but must be professional. Every non-trivial claim is grounded in the verified research digest; source URLs are listed inline and in the references.*

---

## 0. Thesis in one paragraph

Agents do not fail at CAD because they cannot write code. They fail because they cannot see what the code did, cannot point at geometry stably, cannot recover from kernel errors, and cannot prove the result is right. The published evidence agrees. Execution-verified loops with exact kernel measurements plus rendered views raised median IoU from 0.81 to 0.96 and cut mean Chamfer distance from 28.4 to 0.74 (CADSmith, https://arxiv.org/html/2603.26512). A clarification step cut invalidity from 4.8% to 0.9% (ProCAD, https://arxiv.org/abs/2602.03045). Measurement plus validation tools raised build123d-mcp's CADGenBench score from 0.360 to 0.457 (https://github.com/pzfreo/build123d-mcp). Frontier models alone still reach only 0.565-0.812 executability on industrial tasks (RealCADBench, https://arxiv.org/abs/2609.03773). So **Open3DJ should be a headless, deterministic, sandboxed CAD engine whose product is the feedback loop.** It should offer one typed command contract exposed with identical schemas over MCP, CLI and SDKs. Every mutation should return an evidence-rich GeometryReport. It should have stable, query-based references and transactional branches, and a public benchmark harness that gates every release. It should be local-first on OCCT 8.0.1 and pluggable to cloud GPUs (3dj.app among them). The desktop app is a professional *review and steering surface* on top of that engine, not the other way round.

---

## 1. Design principles (agent-first, ranked)

1. **Engine before app.** Everything the UI can do goes through the same command API that agents use. The UI is the first client, not the owner of the model. This is the CADWorld lesson: GUI agents reach 17.5% vs 87% for humans, and scripted builds failed for "wrong document structure" (https://arxiv.org/html/2609.16251v2). The fix is a native document that is both scriptable and editable.
2. **Parity is a test, not an aspiration.** MCP tool, CLI subcommand, TS/Python SDK method and REST route are generated from one JSON-Schema command catalogue. CI fails if any surface drifts.
3. **Every mutation returns evidence.** Each mutation returns structured numbers first (bbox, volume, validity, deltas), images when asked for, and line-anchored errors with suggested fixes. It does not return "ok".
4. **Determinism and replay.** The same inputs on the same engine version give the same content hash. Any agent session can be replayed bit-for-bit in CI.
5. **Explicit state, never hidden sessions.** MCP 2026-07-28 removed protocol sessions and recommends server-minted handles (https://modelcontextprotocol.io/specification/2026-07-28/changelog). Open3DJ uses `doc_id`/`rev`/`branch` handles with stated lifetimes.
6. **Token economy.** Keep about 20 consolidated tools, a `response_format: concise|detailed` switch, opt-in images, paginated search and no list-all dumps. 3dj.app's unfiltered `cad_get_starters` returns tens of thousands of characters in one response, which is exactly the anti-pattern to avoid (see agent-protocols report). The CLI plus a SKILL.md is a first-class path, because measured token costs favor it by 4-32x on some tasks (https://www.scalekit.com/blog/mcp-vs-cli-use, vendor-authored and caveated).
7. **Secure by construction.** Scripts run in a WASM interpreter inside an OS-sandboxed worker, with no host Python by default and token-protected loopback transport. Every other open CAD MCP server ships with weaker guards, as listed in §8.
8. **Measured, not claimed.** We publish CADGenBench/CADBench/MUSE-compatible scores for every release.

---

## 2. System architecture

### 2.1 Process model

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ Clients                                                                 │
 │  Claude Code / Cursor / Codex / custom   CI pipelines     Desktop UI    │
 │  (MCP stdio or Streamable HTTP)          (o3dj CLI/SDK)   (Tauri+React) │
 └──────────────┬───────────────────────────────┬──────────────┬───────────┘
                │ MCP 2026-07-28                │ JSON/exit    │ REST + WS
 ┌──────────────▼───────────────────────────────▼──────────────▼───────────┐
 │ o3dj daemon (Rust, one binary: `o3dj serve | o3dj mcp | o3dj <cmd>`)    │
 │  ├─ command router  (one JSON-Schema catalogue → MCP/CLI/REST/SDK)      │
 │  ├─ doc store       (.o3j projects, op log, branches, content cache)    │
 │  ├─ job scheduler   (Tasks extension + job_id polling, cost caps)       │
 │  ├─ evidence engine (gates, assertions, diffs, provenance ledger)       │
 │  ├─ render service  (wgpu headless: views, sections, ID/pixel diffs)    │
 │  ├─ provider router (local GPU, RunPod, Modal, fal, 3dj.app, slicers)   │
 │  └─ auth/policy     (per-install token, keychain, egress levels, audit) │
 └──────────────┬──────────────────────────────────────────────────────────┘
                │ length-prefixed CBOR over pipes; one worker per doc branch
 ┌──────────────▼──────────────────────────────────────────────────────────┐
 │ kernel workers (short-lived processes, OS-sandboxed: bwrap+seccomp /    │
 │ Seatbelt / AppContainer+Job Object; no network; RO snapshot, WO output) │
 │  ├─ libo3dj_occt.so  (C++17 shim over OCCT 8.0.1, dynamically linked)   │
 │  ├─ Manifold 3.5.4   (mesh CSG, 3MF prep, DfAM checks)                  │
 │  ├─ QuickJS-ng→WASM under wasmtime 50 (JS DSL; fuel/epoch/memory caps)  │
 │  └─ optional: Python worker (build123d 0.13 / CadQuery 2.8 on OCP 8.0.1)│
 │               OpenSCAD nightly (Manifold) as a subprocess               │
 └─────────────────────────────────────────────────────────────────────────┘
```

**Why a daemon plus disposable workers.** OCCT is a multi-million-line C++ kernel, and fillets and booleans are its historical weak point. A segfault or runaway boolean must kill one worker, not the session. One worker per `(doc, branch)` lets several agents work in parallel. Zoo's MCP allows one modeling session per process (https://github.com/KittyCAD/mcp) and Fusion Compute MCP caps users at two sessions (https://blog.championxperience.com/autodesk-fusion-compute-mcp-ai-cad-manufacturing/), so this beats both. Workers are pooled warm (pre-forked, OCCT loaded) to keep `run` latency under about 150 ms for small parts. That latency target must be verified by benchmark.

**Why Rust for the daemon.** Rust gives one static binary for CLI, daemon and MCP. rmcp is now a Tier 1 MCP SDK (promoted 2026-08-21, https://modelcontextprotocol.io/docs/2026-07-28/sdk). We pin rmcp ≥ 1.4.0, the release that fixed its DNS-rebinding Host-validation bug (GHSA-89vp-x53w-74fx). wgpu 30 provides headless rendering, wasmtime 50 runs the sandbox, and the keyring 4.2 crate handles secrets. The TypeScript SDK is generated from the same schemas.

**Transports.** `o3dj mcp` speaks stdio by default, which is the zero-config path for Claude Code, Cursor and Codex. `o3dj serve` exposes Streamable HTTP and REST/WS on `127.0.0.1` only. It validates Origin and Host and returns 403 otherwise. It requires a per-install bearer token stored in the OS keychain and sends `Mcp-Method`/`Mcp-Name` headers, as the 2026-07-28 spec requires (https://modelcontextprotocol.io/specification/2026-07-28/changelog). It never binds 0.0.0.0 unless the user sets an explicit flag, and remote mode then requires OAuth 2.1 + PKCE + RFC 8707/9728.

### 2.2 Kernel layer

- **B-rep: OCCT 8.0.1**, LGPL-2.1 with the Open CASCADE exception, dynamically linked so the core stays permissive (https://github.com/Open-Cascade-SAS/OCCT/releases, https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt). We use its BRepGraph typed IDs and mutation history as the base for element naming (https://github.com/Open-Cascade-SAS/OCCT/discussions/1275). Boolean history (Generated/Modified/IsDeleted) feeds the element map. STEP AP242DIS/AP214/AP203 export goes through XDE. We do **not** assume the AP242 tessellated-PMI work (PR #1647), which is merged only into the IR branch and not yet tagged.
- **Mesh: Manifold 3.5.4** (Apache-2.0). It has been deterministic across platforms since 3.5.0 (May 2026) and has a progress/cancel API (https://github.com/elalish/manifold). We use it for STL/OpenSCAD paths, 3MF preparation and fast DfAM booleans.
- **Kernel trait.** `trait Kernel { fn eval(op) -> Result<ShapeHandle, KernelError>; fn history(); fn measure(); fn tessellate(); }` lets NVIDIA USD BRep (SMLib, Apache-2.0, OCCT converters both ways, https://github.com/NVIDIA-Omniverse/usd-brep) plug in later as a second backend or exchange path. We write no kernel: Fornjot was archived in June 2026 and CADmium in September 2025.
- **Failure ladder (agent-visible).** When a boolean or fillet fails, the worker retries automatically: safe-input/non-destructive mode, then a fuzzy-value sweep, then glue, then ShapeFix healing, and for fillets a reduced radius as a *suggestion only*. Every attempt is logged in `report.warnings[]`, so the agent learns *why* the operation failed rather than seeing a bare `HasErrors` (OCCT boolean options: https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html).
- **2D constraints (post-MVP):** PlaneGCS (LGPL-2.1+) as a dynamically loaded library, with ezpz (MIT) evaluated as the long-term default. SolveSpace is excluded because it is GPL-3.

### 2.3 Script execution tiers

| Tier | Language | Runtime | Default? | Why |
|---|---|---|---|---|
| A (sandboxed) | **o3dj-js**, a Replicad/3dj-compatible JS DSL | QuickJS-ng compiled to WASM, under wasmtime 50 with `epoch_interruption`, `consume_fuel` in deterministic mode, `ResourceLimiter` memory cap, inside the OS-sandboxed worker | yes | Strong isolation. 3dj.app scripts (Param.*, lib.*, withReferences/attachTo) run unchanged. Deterministic by construction: no clock, RNG, network or FS. |
| B (trusted, sandboxed process) | **Python build123d 0.13 / CadQuery 2.8** on OCP 8.0.1 | separate Python worker under bwrap/Seatbelt/AppContainer, no network | opt-in per project | Frontier LLMs and every open CAD model (cadrille, CADmium) and benchmark emit CadQuery/build123d (https://arxiv.org/html/2605.18430v1, https://arxiv.org/html/2605.10873v1). Benchmarks run unmodified. |
| C (external) | **OpenSCAD nightly** (Manifold backend) | GPL subprocess provider | opt-in | Compatibility only. No stable release since 2021.01, and the GPL engine must stay out of process (https://openscad.org/news.html). |

The JS membrane exposes geometry only as opaque handles (the Figma plugin pattern). Static "prohibited API" scanning is **not** a security control. 3dj.app's `cad_validate_script` returned `valid:true` for a script using `fetch`, `eval`, `new Function` and `while(true)` (security report). Isolation is the control.

**The open question we test, not assume:** no benchmark evaluates a JS/Replicad DSL against build123d. Phase 2 runs the same 200-task suite in both tiers. The SKILL.md then recommends whichever measures better, and both stay first-class.

---

## 3. Native model format: `.o3j`

The `.o3j` format is a git-friendly directory, which can also be zipped as `.o3jz` for sharing:

```
bracket.o3j/
  project.o3j.json      # manifest: o3j schema version, engine version, units=mm, Z-up, UUIDv7 project id
  features.o3j.json     # canonical, deterministically serialised feature tree (sorted keys, 2-space)
  params.o3j.json       # typed parameters (number/bool/choice/string; min/max/step/unit) → UI controls
  scripts/              # script features: *.js (tier A), *.py (tier B), *.scad (tier C)
  refs.o3j.json         # named persistent references: {name, query, fingerprint, label}
  spec.o3j.json         # requirements + executable assertions (CADTests-style)
  evidence.json         # latest Evidence Pack v2 per rev (measured/observed/inferred/assumed)
  provenance.jsonl      # append-only, PROV-O-shaped ledger: agent, tool call, arg hash, result hash
  AGENTS.md             # project conventions for agents (Zoo pattern)
  .o3j-cache/           # content-addressed .brep/.glb/.step; git-ignored, reproducible
```

**Feature tree.** The tree is an ordered DAG of nodes `{id: uuidv7, kind, name, inputs, outputs[]}`. `kind` is one of `script` (JS/Py/SCAD, producing named bodies and references), `op` (native op: `extrude|revolve|loft|boolean|fillet|chamfer|shell|pattern|transform|hole|lib.insert|mirror`), `import` (STEP/mesh with source hash) or `assembly.mate` (post-MVP). Script nodes let a whole 3dj.app script drop in as a single node. Native op nodes let agents make *small structured edits* with `patch_feature` instead of regenerating code. LLM4CAD-Editor reports named-feature DSLs to be 1.4x more robust for editing than Python (https://arxiv.org/abs/2606.20607, authors' claim).

**References (the hard problem).** A reference is `{name, query, fingerprint}`:
- `query` is an Onshape-style criterion resolved against history, never a positional index. Examples are `createdBy(feature:"boss1").face(role:"top")`, `adjacent(face:@hole1.wall, kind:"edge", convexity:"convex")` and `lib.anchor("M3_insert_1","axis")`.
- `fingerprint` holds geometric disambiguation data: surface type, area, centroid, normal and adjacency hash. It is used only when the history match ties, the same idea as FreeCAD's element map and CADIR's signature matching.
- After every rebuild, `report.refs` lists each reference as `stable | re-resolved | disambiguated | broken`, with a cause. Agents therefore see topological-naming breakage explicitly instead of getting silently wrong fillets.

**Op log and branches.** Every committed change appends a `rev` record (parent rev, command, args hash, result content hash) to the project's history, stored as git-like objects in `.o3j/.history` and mirrored to git when the folder is a repo. `branch`, `fork`, `merge` and `proposal` are first-class. Several agents work on separate branches, and humans merge through the Compare UI.

**Interchange.** STEP AP242DIS by default (AP214 compatibility option) with CAx-IF `V5_UUID_ATTRIBUTE` persistent IDs and user-defined attributes carrying confidence labels. 3MF via lib3mf 2.5 (BSD-2) with Production UUIDs, `o3j:`-namespaced metadata and a MustPreserve `Metadata/o3j_evidence.json` part. GLB via OCCT RWGltf with KHR_xmp_json_ld. Binary STL plus a `.evidence.json` sidecar. Sources: https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html, https://3mf.io/spec/.

---

## 4. The agent contract

### 4.1 Common envelopes

Every mutating command returns a **GeometryReport** in MCP `structuredContent`, matching a published `outputSchema`, and mirrors it as compact JSON text:

```jsonc
{
  "doc_id": "d_01J...", "rev": "r_0042", "parent_rev": "r_0041", "branch": "agent/claude-1",
  "status": "ok|warning|error",
  "content_hash": "blake3:...", "engine": "o3dj 0.3.0 / OCCT 8.0.1 / Manifold 3.5.4",
  "bodies": [{"name":"bracket","valid":true,"solids":1,"shells":1,"faces":38,"edges":96,
              "bbox_mm":[[-20,-10,0],[20,10,12]],"volume_mm3":5321.4,"area_mm2":3120.7,
              "com_mm":[0,0,4.1],"mass_g":{"value":6.6,"material":"PLA","density":1.24}}],
  "delta": {"volume_mm3":-212.3,"faces":+4,"bbox_changed":false},
  "refs": [{"name":"mount_face","state":"stable"},{"name":"edge_fillet_A","state":"disambiguated","why":"two candidates; matched by area"}],
  "gates": {"profile":"fdm-default","pass":["watertight","bed_fit"],"fail":[{"gate":"min_wall","value_mm":0.62,"limit_mm":0.8,"at":"face:f_17"}],"unevaluated":["overhang"]},
  "warnings": [{"code":"FILLET_RADIUS_REDUCED_SUGGESTION","msg":"...","fix":"set fillet r<=1.4 on edge_fillet_A"}],
  "errors": [{"code":"BOOLEAN_FAILED","script":"scripts/main.js","line":27,"col":9,"cause":"tool not intersecting target","fix":"...","docs":"o3dj://docs/booleans#non-intersecting"}],
  "images": [],                       // only if capture[] requested; each captioned with camera, scale, bbox digest
  "next": ["o3dj_render views=iso,top", "o3dj_check profile=fdm-default"]
}
```

Errors are business results (`isError:true`) so models can self-correct, as the tools spec recommends (https://modelcontextprotocol.io/specification/2026-07-28/server/tools). Every tool takes `response_format: concise|detailed`. Concise output aims at 300 tokens or fewer and stays well below Claude Code's 25k-token default cap. Large artifacts are returned as `resource_link` (`o3dj://doc/{id}/rev/{rev}/export/part.step`), never inline.

### 4.2 MCP tool surface (20 tools)

The names are namespaced `o3dj_*` and returned in deterministic order with `ttlMs`/`cacheScope`, so clients can pin hashed descriptions (trust-on-first-use) against rug-pull attacks. Each tool carries annotations (readOnly/destructive/idempotent).

| # | Tool | Key inputs | Output | Notes |
|---|---|---|---|---|
| 1 | `o3dj_doc_open` | `path?` \| `template?` \| `from_doc+rev` (fork), `branch?` | `{doc_id, rev, branch, params, refs, summary}` | create/open/fork; returns handles with lifetime |
| 2 | `o3dj_doc_list` | `cursor?`, `filter?` | paged docs/branches | read-only |
| 3 | `o3dj_run` | `doc_id, base_rev, source{lang,code}\|patch, params?, capture?[], dry_run?` | GeometryReport (+ new rev unless dry_run) | primary loop; optimistic concurrency on `base_rev` |
| 4 | `o3dj_patch` | `doc_id, base_rev, ops[] (add/update/remove feature, set_param, rename_ref)`, `atomic=true` | GeometryReport | transactional batch with rollback |
| 5 | `o3dj_params` | `doc_id, rev, set?{}` or `sweep?{param, values[]}` | report per value | sweeps catch parametric fragility |
| 6 | `o3dj_inspect` | `doc_id, rev, target(ref\|query\|body), fields[]` | topology, per-face/edge metrics, feature tree slice | read-only; paged |
| 7 | `o3dj_measure` | `a, b (refs/points), kind: distance\|angle\|clearance\|thickness\|interference` | values with confidence label | exact kernel numbers |
| 8 | `o3dj_render` | `views[iso,top,front,…], style, section?{plane}, highlight?[refs], size, annotate?` | captioned PNGs (resource or inline) | same wgpu renderer as the UI |
| 9 | `o3dj_check` | `profile (fdm-default, sla, cnc-3axis, custom)`, `assertions?` | Evidence Pack v2 | DfM/DfAM gates + spec assertions |
| 10 | `o3dj_spec` | `doc_id, text_requirements?` or `assertions[]` | `{missing[], conflicting[], assumed[], assertions_added}` | ProCAD-style clarify; assertions rerun on every rev |
| 11 | `o3dj_diff` | `doc_id, rev_a, rev_b, render?` | semantic feature diff + geometric deltas + ref states + optional overlay image | also IoU/Chamfer vs a reference mesh |
| 12 | `o3dj_refs` | `make{name, pick\|query}` / `resolve{name}` | ref token + fingerprint + highlight render | shared grammar with UI picks |
| 13 | `o3dj_history` | `log` / `checkout` / `branch` / `merge` / `propose{title, summary}` | rev list or proposal id | `propose` hands work to human review |
| 14 | `o3dj_export` | `formats[step_ap242, step_ap214, stl, 3mf, glb, obj, dxf, svg]`, `bodies?` | resource_links + SHA-256 + embedded provenance head | export blocked if gates fail unless `force` (human-confirmed) |
| 15 | `o3dj_import` | `uri/path (jailed), kind` | import feature + report | parsed in sandboxed worker; metadata returned as untrusted |
| 16 | `o3dj_lib` | `search{q, cursor}` / `get{id}` | std-parts entries with params, anchors, example snippet | ISO fasteners, pockets, snap fits, T-slot |
| 17 | `o3dj_docs` | `search{q}` / `get{topic}` | DSL reference chunks (RAG-sized) | replaces 3dj's dump-everything starters |
| 18 | `o3dj_generate` | `kind (text_mesh, image_mesh, scan_to_cad, mesh_to_cad), inputs, provider?, budget_usd?` | MCP Task (or `job_id`) | async; never blocks past 60 s (Codex default) |
| 19 | `o3dj_job` | `get\|cancel\|list, job_id` | status, progress, cost, result refs | polling fallback for clients without Tasks |
| 20 | `o3dj_providers` | `list` / `estimate{kind, inputs}` | capability manifests, health, price, license/territory flags | 3dj.app appears here |

Also published: an MCP **resource** namespace `o3dj://` (docs, exports, renders); an **MCP App** viewer `ui://open3dj/viewer` (Three.js, with a text fallback) for Claude Desktop/web, VS Code Copilot and Cursor (https://modelcontextprotocol.io/extensions/apps/overview); and a **Skills over MCP** pack. Tasks use the official extension where the client declares it. Today the only such client is Claude Code, in beta from v2.1.304 (https://code.claude.com/docs/en/mcp), so `job_id` polling is the primary path.

### 4.3 CLI and SDK parity

`o3dj <tool-without-prefix> --json '{...}'` or flag form, e.g. `o3dj run bracket.o3j --file main.js --capture iso --json`. Exit codes: `0` ok, `1` gate/assertion failure, `2` script/kernel error, `3` usage/auth, `4` job pending. CI uses exactly the same commands. A schema-diff test asserts that `o3dj schema dump` equals the MCP `tools/list` output and the SDK type definitions. Generated SDKs are `@open3dj/sdk` (TS) and `open3dj` (Python, typed with pydantic), both thin clients of the daemon.

### 4.4 Skills, plugins and packaging for agents

- `SKILL.md` under 5k tokens (the agentskills.io spec): the loop *spec → run → check → render → diff → export*, error-code playbook and reference grammar, installed with `o3dj skill install --target claude|cursor|codex|agents-md`.
- A Claude Code plugin with `.mcp.json`, the skill, and a **PreToolUse hook** that blocks `o3dj_export` while `gates.fail` is non-empty unless the user approves. An MCPB bundle for Claude Desktop. A Codex `config.toml` snippet, with server instructions kept under 512 chars because Codex reads only the first 512. MCP Registry `server.json` under `io.github.neuraldeepnet/open3dj`.

### 4.5 Agent loop we design for

```
spec(text) → missing dims? → ask user (via client) → assertions stored
run(code) → report(errors? → fix by line) → check(profile) → gates fail? → patch
render(iso,top,section) → VLM self-critique → diff vs prev → propose → human accept → export
```

Best-of-N is built in. `o3dj_run` accepts `candidates[]`, which run in parallel workers and are ranked by assertion pass count, then gate failures, then distance to the reference if one is given (the CAD-Recode best-of-10 idea, https://arxiv.org/html/2412.14042v2).

---

## 5. Evidence, determinism and evals

**Evidence Pack v2** is co-published with 3dj.app as a superset of v1. It keeps v1's gates (watertight, 0.8 mm nozzle-safe wall, 45° overhang, 220x220x250 mm bed, PLA 1.24 g/cm³) and confidence labels (measured ±0.15 / observed ±0.35 / inferred ±0.80 / assumed). v2 adds per-feature UUID keys, `method`, `instrument`, `source_asset`, `engine` and `provenance_head`, plus `unevaluated` as a first-class gate state. Gate algorithms are written on OCCT and Manifold: wall thickness by BRepExtrema sampling, overhang by face normals vs build direction, draft vs pull direction, trapped volumes, bed fit. No permissive library provides these today (formats report).

**Determinism.** In `--deterministic` mode (the CI default) the engine pins kernel versions, disables OCCT `SetRunParallel`, runs wasmtime with fuel instead of epochs, canonicalises output ordering, and hashes BRep plus tessellation with fixed parameters. `o3dj replay provenance.jsonl` re-executes a session and asserts that hashes match. Any nondeterminism found is a P0 bug.

**o3dj-bench (ships in the MVP, gates every release):**
- *Contract suite*: 300 golden tasks (ISO bracket, enclosure with heat-set pockets, T-slot mount, etc.) with expected hashes, bboxes and assertions.
- *Agent suite*: scripted runs of Claude Code, Codex and an open model (Qwen3-Coder-30B-A3B via llama.cpp) against 100 text-to-part briefs. Metrics: success, tool calls, tokens, wall time, error-recovery rate, cost.
- *External*: CADGenBench (Apache-2.0, STEP submissions; https://github.com/huggingface/cadgenbench) and a CADBench subset run through tier B. Only permissively licensed constituent datasets are used; the Fusion-360-derived family is excluded (https://github.com/anniedoris/CADBench). MUSE assembly briefs come later.
- *Ablations*, published: no-report vs report, no-render vs render, JS vs Python tier. These turn "best for agents" into a measured claim.

---

## 6. Compute-provider abstraction

```rust
trait Provider {
  fn manifest(&self) -> CapabilityManifest;       // signed
  async fn estimate(&self, req: &JobReq) -> Estimate;   // USD, seconds, VRAM
  async fn submit(&self, req: JobReq) -> JobHandle;     // mirrors 3dj modelId/poll/download
  async fn poll(&self, h: &JobHandle) -> JobStatus;     // working|input_required|completed|failed|cancelled
  async fn cancel(&self, h: &JobHandle);
  async fn fetch(&self, h: &JobHandle) -> Artifacts;    // content-addressed into cache
}
```

**CapabilityManifest** fields: `capabilities[]` (gen3d.text, gen3d.image, recon.photogrammetry, cad.scan_to_cad, fea.static, slice.fdm, quote.print), `models[]` with **per-dependency SPDX licence**, `commercial_ok`, `territory_exclusions`, `mau_cap`, `min_vram_gb`, `platforms` (cuda/rocm/metal/cpu), `price_model`, `egress_policy`, `data_retention`, `tee_attestation?`.

The per-dependency licence matters. TRELLIS's `diffoctreerast`, and TRELLIS.2's nvdiffrast/nvdiffrec, are **non-commercial** even though the models are MIT (community-licensing report, https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt). All Hunyuan3D community licences exclude the EU, UK and South Korea (https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE). The router *enforces* these fields. It refuses territory-excluded models based on a user-declared jurisdiction and warns on non-commercial dependencies.

**Router policy.** The router decides in this order: egress level (`local-only` default, `cloud-anonymous`, `cloud-full`) → licence/territory → VRAM fit → cost cap (pre-submit estimate, kill switch on runaway) → ranked failover from local to cloud on OOM or SLA miss. Each job's data flow is shown and consented to per job. Metadata is stripped by default. Model weights are accepted as safetensors only.

**Initial providers:**
1. `local.cpu`: the kernel, gates and renders themselves (always present).
2. `local.gpu`: the `open3dj-worker` container or venv. TripoSG (MIT, 8 GB) is the default image-to-mesh model, and TRELLIS (16 GB) or TRELLIS.2 (24 GB, Linux) are opt-in "research/non-commercial deps" tiers until the renderers are swapped. Step1X-3D (Apache-2.0, 27-29 GB) covers textured output. cadrille (Apache-2.0) does mesh/point-cloud-to-CadQuery (https://github.com/col14m/cadrille).
3. `runpod`, `modal`, `fal`: the same worker image (bring-your-own container), or per-call fal endpoints (TRELLIS about $0.02, TRELLIS-2 $0.25-0.35; https://fal.ai/pricing).
4. **`3dj`**: wraps 3dj.app's MCP/REST (generate_from_text/image_url → modelId → get_generation_status → get_model_download_url; request_print_quote/list_print_quotes; OAuth 2.1 + PKCE or API key in the keychain). Users without a GPU get the managed fleet, and Open3DJ stays fully functional without it.
5. `slicer.orca` / `slicer.bambu` / `slicer.prusa`: AGPL CLIs run as subprocesses (shared `--slice/--export-3mf/--load-settings` contract). `quote.shapeways` (public API) and `quote.jlc` (JLCAPI 3D printing API, https://api.jlcpcb.com/) come post-MVP.

Local LLMs are *not* bundled. Open3DJ is the tool the agent's brain uses, so the brain stays with the client. For fully offline users we document Ollama/llama.cpp with Qwen3-Coder-30B-A3B or Gemma 4 26B-A4B (Apache-2.0) as an optional `o3dj agent` reference loop.

---

## 7. Desktop client stack (secondary but professional)

- **Shell: Tauri 2.12** (MIT/Apache-2.0; https://v2.tauri.app/blog/tauri-2.12/), with the `o3dj` daemon as a sidecar. The UI is a React 19 + Vite bundle shared verbatim with a future zero-install web mode. Tauri-specific calls sit behind a thin `HostBridge`.
- **Renderer: three.js r186 `WebGPURenderer`**, which falls back automatically to WebGL2. Linux WebKitGTK has no WebGPU and may silently software-rasterize (https://v2.tauri.app/develop/debug/linux-graphics/), so Linux defaults to `forceWebGL` with a frame-time probe and a user-visible renderer switch. All materials are TSL. Selection uses a GPU ID-buffer keyed on kernel-stable face/edge IDs plus BVH raycasts for snapping. The viewer does clipping-plane sections, and agents get kernel sections. InstancedMesh handles lib.* parts.
- **Linux escape hatch:** if WebGL2 in WebKitGTK misses 60 fps on an Iris Xe at 100k triangles, we ship a Linux-only Electron 45 build. We do not wait for the Tauri 3 CEF runtime, which is still alpha.
- **Agent-collaboration UX (the reason a human opens the app):**
  - *Proposal inbox*: each agent branch shows as a colour-tagged proposal with per-operation accept/reject/edit-then-accept (the Claude Code pattern). User edits are reported back to the agent.
  - *Compare*: Onshape-style base-blue/target-red overlay with a slider, a numeric delta card, changed-face colouring and section diffs (https://cad.onshape.com/help/Content/compare.htm).
  - *What the agent saw*: snapshot thumbnails, camera trail and evidence cards per turn.
  - *Presence*: "agent/claude-1 editing boss1", follow-agent camera.
  - *Permission modes*: Manual / Accept-additive / Plan / Auto with a geometric risk score (dependent features, mass delta). Exports, cloud jobs and print quotes always require person-only confirmation. No agent message counts as approval.
- **Pro basics in the MVP:** parameter panel generated from `params.o3j.json`, feature tree, code editor (CodeMirror 6 with an LSP for o3dj-js), measure-on-select, view cube, section view, fuzzy command palette, dark and light themes, and navigation presets (Onshape, SolidWorks, NX, Creo, AutoCAD, trackpad, Blender, Zoo). Keybindings are verified before shipping.
- **Distribution:** GitHub Releases is the source of truth (NSIS + MSI, universal DMG notarized with the $99/yr Apple account, AppImage + deb + rpm), then winget, Homebrew cask and Flathub. Windows signing goes through SignPath Foundation, which is free for OSS. Target installer size is 60-120 MB (Zoo's Electron app is 211-341 MB; FreeCAD's is 495-783 MB). The minimum spec is "any PC": x86_64/arm64, 4 cores, 8 GB RAM, WebGL2/Vulkan 1.1/Metal.

---

## 8. Security model (summary)

The attack surfaces are agent-generated code, untrusted files, prompt injection through file metadata, the local HTTP daemon, plugins and cloud egress. Controls:

- **Three-layer sandbox:** WASM interpreter → wasmtime limits → OS sandbox profile, reusing Anthropic sandbox-runtime/Codex-style profiles. The worker gets no network, and private RFC 1918 ranges are added explicitly to the deny list because sandbox-runtime does not deny them by default (https://github.com/anthropic-experimental/sandbox-runtime).
- **Import parsers** (STEP/3MF/STL/SCAD) run in the same sandbox: DTDs rejected, ZIP and array caps, continuous fuzzing. STEP headers, 3MF metadata and SCAD comments reach agents only inside `<untrusted>` delimiters and never appear in tool descriptions.
- **Daemon:** stdio-first. HTTP on loopback only, with Origin/Host checks and a keychain token. Handles are bound to the token owner (MCP: "MUST NOT treat possession of a state handle as authentication"). URLs open only through a scheme allow-list, never through a shell (the CVE-2025-6514 class of bug).
- **Tool descriptions** are static, versioned and hashed, so clients can pin them. A CI regression suite replays the 2025 incident classes: DNS rebinding (CVE-2025-49596), prefix/symlink path escapes (CVE-2025-53109/53110), config rug-pull (CVE-2025-54136) and ANSI injection.
- **Plugins:** WASM components with declared capabilities, Sigstore signatures and SLSA L2 provenance. Native plugins are a trusted tier with re-approval on any manifest change.
- **Contrast with existing servers:** Blender MCP runs LLM code "without any guards" over an unauthenticated socket (https://www.blender.org/lab/mcp-server/). freecad-mcp runs arbitrary Python inside a live FreeCAD. build123d-mcp's HTTP mode has no auth. Autodesk's local Fusion MCP is unauthenticated on 127.0.0.1:27182 (https://help.autodesk.com/view/ADSKMCP/ENU/).

---

## 9. Repository layout (monorepo)

```
open3dj/
  Cargo.toml  pnpm-workspace.yaml  pixi.toml  LICENSE  NOTICE  GOVERNANCE.md  AGENTS.md  SECURITY.md
  schemas/                 # SOURCE OF TRUTH: command catalogue (JSON Schema 2020-12), GeometryReport,
                           #   Evidence Pack v2, .o3j file schemas, provider manifest
  crates/
    o3dj-schema/           # codegen from schemas → Rust types, MCP tool defs, CLI clap, TS/Py SDK
    o3dj-core/             # command router, doc store, op log, branches, provenance
    o3dj-ir/               # feature tree, reference queries, element map, fingerprint matcher
    o3dj-kernel/           # Kernel trait + worker protocol (CBOR)
    o3dj-kernel-occt/      # Rust side of the OCCT shim (cxx); cpp/ holds libo3dj_occt (C++17, LGPL-boundary)
    o3dj-mesh/             # Manifold bindings, mesh gates
    o3dj-script/           # wasmtime host, QuickJS-ng wasm, capability membrane, o3dj-js stdlib bridge
    o3dj-evidence/         # gates, assertions, diff (IoU/Chamfer/Hausdorff), confidence vocabulary
    o3dj-render/           # wgpu headless renderer, ID buffer, sections, pixel diff
    o3dj-sandbox/          # bwrap/Landlock+seccomp, Seatbelt, AppContainer+Job profiles
    o3dj-providers/        # Provider trait, router, cost caps, egress policy; adapters/{local,runpod,modal,fal,3dj,orca,…}
    o3dj-mcp/              # rmcp server (stdio + Streamable HTTP), Tasks ext, MCP App resource
    o3dj-daemon/           # serve: REST/WS, auth, job scheduler
    o3dj-cli/              # the `o3dj` binary (all subcommands)
  workers/
    python/                # tier-B worker: build123d/CadQuery bridge, pinned envs (pixi)
    gpu/                   # open3dj-worker container (TripoSG, TRELLIS*, cadrille), safetensors only
  packages/
    sdk-ts/  dsl-types/    # @open3dj/sdk, o3dj-js .d.ts for editors and agents
    ui/  viewer/           # React UI, three.js viewer (shared desktop/web/MCP App)
    mcp-app-viewer/        # ui://open3dj/viewer bundle
  python/open3dj/          # Python SDK (generated)
  apps/
    desktop/               # Tauri 2.12 shell (+ linux-electron/ fallback target)
    web/                   # zero-install mode (later: occt-wasm/libcascade kernel in worker)
  stdlib/                  # lib.*: ISO fasteners, pockets, snap fits, T-slot (from Apache-2.0 bd_warehouse + ISO tables)
  skills/                  # SKILL.md packs, Claude Code plugin, MCPB manifest, server.json
  bench/                   # o3dj-bench: golden tasks, agent harness, CADGenBench/CADBench adapters, dashboards
  docs/  rfcs/  examples/
```

The licence gate in CI (cargo-deny + license-checker + a model-manifest linter) fails the build on any GPL/AGPL or Tencent-licensed dependency entering the core. The digest recommends relicensing from MIT to **Apache-2.0** now, for the patent grant and trademark clause, while there is a single copyright holder. Crates can be dual `Apache-2.0 OR MIT`. Contributions are DCO, not CLA.

---

## 10. MVP scope: Open3DJ 0.1 "Agent Alpha" (public, ~week 22)

**Ships:**
1. The `o3dj` binary for Windows x64/arm64, macOS universal and Linux x64/arm64: daemon, CLI, and MCP over stdio and loopback HTTP, targeting MCP 2026-07-28.
2. OCCT 8.0.1 worker with primitives, sketches (rect, roundedRect, circle, polygon, path, spline, text), extrude/revolve/loft/sweep, booleans, fillet/chamfer with ref queries, shell, patterns, transforms, holes. Manifold mesh path.
3. Tier A o3dj-js DSL that is source-compatible with 3dj.app scripts (Param.*, withReferences/attachTo/onFace, lib.*, connector.male/female single-part matching), with a compatibility test suite of 3dj starters.
4. Tier B Python build123d/CadQuery worker, opt-in and sandboxed.
5. `.o3j` format, op log, branches, provenance ledger, replay.
6. All 20 MCP tools with CLI parity, generated TS/Python SDKs, GeometryReport, Evidence Pack v2 (FDM profile), spec assertions, diff, wgpu renders and sections.
7. Exports: STEP AP242DIS/AP214, STL, 3MF (lib3mf), GLB. Imports: STEP, STL, 3MF.
8. Providers: local.cpu, local.gpu (TripoSG image-to-mesh), fal, and **3dj** (generation + print quote).
9. Desktop app: viewer, feature tree, params, code editor, measure, section, proposal inbox with accept/reject, Compare overlay, evidence cards, presets, themes.
10. SKILL.md, Claude Code plugin with export hook, MCPB, registry entry, Cursor/Codex snippets.
11. o3dj-bench with a public results page: contract suite plus CADGenBench submission plus agent suite on Claude Code and Codex.
12. Signed, notarized installers; SECURITY.md; fuzzing in CI.

**Explicitly out of 0.1:**
- Interactive 2D constraint sketcher (PlaneGCS/ezpz). Sketches are script and op only.
- Assemblies with joints/mates, kinematics and tolerance stacks (0.3).
- Scan/photogrammetry pipeline (COLMAP, VGGT) and cadrille scan-to-CAD (0.2 beta).
- FEA (CalculiX), CAM/G-code, sheet metal, drawings/TechDraw and GD&T authoring.
- Web zero-install mode (occt-wasm), multi-user real-time collaboration and hosted relay for ChatGPT.
- Bundled local LLM; Hunyuan3D in any form; OpenSCAD tier C (0.2); IGES; USD/IFC export.
- RunPod/Modal adapters (0.2), slicer providers (0.2), Shapeways/JLC quoting (0.3).

---

## 11. Phased roadmap (team: 3 engineers plus AI coding agents, 1 part-time designer)

| Phase | Weeks | Deliverables |
|---|---|---|
| **P0 Foundations** | 3 | Repo/monorepo, schemas-first codegen skeleton, licence gate, CI matrix (Win/mac/Linux, x64/arm64), OCCT 8.0.1 build + C++ shim smoke tests, Apache-2.0 relicense, RFC process, naming/trademark check started. **Benchmarks** decide go/no-go on worker latency, OCCT op timings and WebGL2 in WebKitGTK. |
| **P1 Headless kernel + format** | 6 | Kernel worker protocol, op set, element map + ref queries + fingerprints, `.o3j` format, op log/branches, QuickJS-WASM tier A with membrane, 3dj DSL compatibility layer, STEP/STL/3MF export, deterministic mode + replay. |
| **P2 Agent contract + evidence** | 5 | 20 MCP tools via rmcp, CLI and SDK parity tests, GeometryReport, gates, assertions, diff, wgpu renders and sections, docs/lib search, failure ladder, SKILL.md, o3dj-bench contract + agent suites, JS-vs-Python ablation. **Internal dogfood:** agents build the stdlib with Open3DJ. |
| **P3 Desktop review UI** | 6 (overlaps P2 by 3) | Tauri shell, viewer (WebGPU/WebGL2), tree/params/editor, proposals inbox, Compare, evidence cards, presets, Linux renderer probe + fallback decision. |
| **P4 Providers + jobs** | 3 | Provider trait, router, cost caps, egress policy, Tasks + job polling, local.gpu TripoSG, fal, 3dj provider (OAuth/API key via keychain), Python tier B sandboxed. |
| **P5 Hardening + launch** | 3 | Security regression suite, fuzzing, signing/notarization, installers, registry/plugin/MCPB, public bench page, docs site, Show HN that leads with licence, business model and measured scores. |
| **= 0.1 public alpha** | **~22** (P2/P3 overlap) | |
| **0.2 "Reconstruct"** | 8 | OpenSCAD tier C, cadrille scan/mesh-to-CAD, COLMAP 4.2 + VGGT-1B-Commercial front end, RunPod/Modal adapters, Orca/Bambu/Prusa slicer providers, web zero-install mode (libcascade/occt-wasm). |
| **0.3 "Assemble"** | 10 | Multi-part assemblies with mates/joints, interference and clearance gates, tolerance stacks, MUSE eval, 2D constraint sketcher (PlaneGCS → ezpz evaluation), Shapeways/JLC quoting. |
| **1.0** | 8 | Stable schema v1 with semver guarantees, AP242 PMI once OCCT tags it, WCAG 2.2 pass + VPAT, plugin registry with Sigstore, USD BRep backend experiment, governance trigger to a neutral host. |

That is about 22 weeks to the public alpha and about 48 weeks to 1.0 for 3 engineers. With 4 engineers, P3 runs fully in parallel and the alpha lands near week 18.

---

## 12. Differentiators

| vs | Their limit (verified) | Open3DJ answer |
|---|---|---|
| **Zoo** (KCL, Zookeeper, MIT MCP) | Proprietary engine is cloud-only and the viewport is a video stream (https://zoo.dev/docs/faq). One modeling session per MCP process. Top community threads are connection failures. | Local OCCT engine works offline. Unlimited parallel per-branch workers. Open kernel path. Evidence and provenance built in. |
| **Onshape FeatureScript MCP** | Early access. Writes FeatureScript features only; cannot read assemblies or report changes. | Full read/write document contract, diff and ref-resolution reports. |
| **Autodesk Fusion MCP trio** | Local server is unauthenticated with an undocumented dynamic tool list and needs Fusion running. Compute MCP is limited to 2 sessions and 1 h, and needs a licence. | Headless, authenticated, schema-stable and free. Runs in CI without a GUI. |
| **FreeCAD / Blender MCPs** | Arbitrary Python inside a live GUI app with unauthenticated sockets. | Sandboxed tiered execution, deterministic replay, no GUI dependency. |
| **build123d-mcp / text-to-cad** | Library-level, single shared session (or no persistent document), no human review app. | Persistent branchable `.o3j` documents, while still running their Python unchanged in tier B. |
| **SolidCraft** (MIT OR Apache-2.0, Rust, MCP, ~11k stars) | Kernel is truck (no upstream fillets); its SMLib port is experimental. Unsigned binaries. | OCCT 8 maturity (fillets, lofts, STEP AP242). Evidence Pack and confidence labels. Provider plug-ins (GPU, print). Benchmark-gated releases. Signed installers. |

Cross-cutting differentiators, all of which compound:
1. **Typed agent contract with parity** across MCP, CLI, SDK and REST, under schema semver.
2. **Evidence-by-default**: every mutation is measured and gated, with labelled confidence.
3. **Stable references with explicit re-resolution reports**, which turn topological naming from silent corruption into a visible signal.
4. **Branches and proposals** for multi-agent work with human merge.
5. **Deterministic replay plus a public benchmark** that makes "best for agents" falsifiable.
6. **Open provider ecosystem**: local GPU first, with 3dj.app, fal and others as interchangeable plug-ins carrying machine-readable licence and territory metadata.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OCCT boolean/fillet failures frustrate agents | Failure ladder with structured warnings, per-op timeouts, worker isolation, fillet-last guidance in SKILL.md, corpus of failing cases fed upstream. |
| Topological naming breaks agent edits | Query + fingerprint references, `refs` state in every report, `o3dj_params sweep` to expose fragility, golden ref-stability tests. |
| JS DSL underperforms Python with LLMs | Both tiers first-class; ablation in P2 decides the SKILL.md default; JS stays for sandbox and 3dj compatibility. |
| WASM-in-worker overhead on interactive latency | Warm worker pool, geometry in native OCCT (only script logic in WASM), benchmark gate in P0; fall back to tier B process-only isolation if overhead exceeds about 30%. |
| MCP client fragmentation (Tasks, Apps, timeouts) | Job polling as primary, Apps with text fallback, all calls under 60 s, CLI path documented, compatibility matrix tested in CI against Claude Code, Cursor and Codex. |
| Linux WebKitGTK rendering | `forceWebGL`, frame-time probe, NVIDIA env workarounds applied only when detected, Electron-for-Linux fallback build. |
| Licence contamination (GPL/AGPL/NC weights) | CI licence gate, per-dependency licence fields in provider manifests, subprocess boundary for GPL/AGPL tools, TRELLIS NC renderers flagged, Hunyuan geo-gated or excluded. |
| SolidCraft or Zoo moves faster on narrative | Ship a measured benchmark early, differentiate on OCCT maturity and evidence, offer interop (STEP, MCP federation) instead of a feature race. |
| Security incident in local daemon | Stdio default, loopback + token + Origin/Host checks, incident-replay CI suite, fuzzing, bug bounty before 1.0. |
| Small-team scope creep | Hard MVP cut list (§10), schemas-first codegen to cut parity work, AI agents doing stdlib, tests and adapters under CODEOWNERS review. |
| Naming conflict (Intel Open3D, existing "3DJ" uses) | Trademark clearance in P0. Reserve package names and registry namespace. Be ready to rename the OSS product before launch. |
| 3dj.app dependency or conflict of interest | 3dj is just one provider behind a public trait. Open3DJ is fully functional with it disabled. Evidence Pack v2 is published as an open schema. |

---

## 14. First 10 concrete actions (week 1)

1. Commit `schemas/commands/*.json` for the 20 tools and the GeometryReport schema, and generate stubs.
2. Build OCCT 8.0.1 on all five targets in CI and publish timing baselines.
3. Prototype the QuickJS-ng WASM + wasmtime membrane with `box().fillet()`, and measure the round-trip.
4. Port 18 3dj.app starters as the compatibility test corpus.
5. Write SKILL.md v0 alongside the schemas, so docs drive the API shape.
6. Stand up `bench/` with 30 golden tasks.
7. Relicense to Apache-2.0; add NOTICE, DCO, SECURITY.md and AGENTS.md (clean-room: no reading GPL CAD code; OCCT via its public API only).
8. Start trademark clearance and reserve names.
9. Apply to SignPath Foundation and enrol in the Apple Developer Program.
10. Agree on the Evidence Pack v2 and provider contract with the 3dj.app team.

---

## References (primary)

- MCP 2026-07-28 changelog / tools / security: https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://modelcontextprotocol.io/specification/2026-07-28/server/tools · https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- MCP SDK tiers: https://modelcontextprotocol.io/docs/2026-07-28/sdk · Tasks: https://modelcontextprotocol.io/extensions/tasks/overview · Apps: https://modelcontextprotocol.io/extensions/apps/overview · Skills: https://agentskills.io/specification
- Claude Code MCP limits/Tasks: https://code.claude.com/docs/en/mcp · plugins/hooks: https://code.claude.com/docs/en/plugins-reference
- OCCT 8: https://github.com/Open-Cascade-SAS/OCCT/releases · https://github.com/Open-Cascade-SAS/OCCT/discussions/1275 · exception: https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt
- Manifold: https://github.com/elalish/manifold · USD BRep: https://github.com/NVIDIA-Omniverse/usd-brep · 3MF: https://3mf.io/spec/
- CADSmith: https://arxiv.org/html/2603.26512 · ProCAD: https://arxiv.org/abs/2602.03045 · CADBench: https://arxiv.org/html/2605.10873v1 · Text2CAD-Bench: https://arxiv.org/html/2605.18430v1 · RealCADBench: https://arxiv.org/abs/2609.03773 · CADWorld: https://arxiv.org/html/2609.16251v2 · CADGenBench: https://github.com/huggingface/cadgenbench · cadrille: https://github.com/col14m/cadrille
- Zoo: https://zoo.dev/docs/faq · https://github.com/KittyCAD/mcp · SolidCraft: https://github.com/tangency-labs/solidcraft · Fusion MCP: https://help.autodesk.com/view/ADSKMCP/ENU/ · build123d-mcp: https://github.com/pzfreo/build123d-mcp · Blender MCP: https://www.blender.org/lab/mcp-server/
- Tauri 2.12: https://v2.tauri.app/blog/tauri-2.12/ · Linux graphics: https://v2.tauri.app/develop/debug/linux-graphics/ · three.js: https://github.com/mrdoob/three.js/releases · wgpu: https://docs.rs/crate/wgpu/latest
- wasmtime: https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html · QuickJS: https://bellard.org/quickjs/ · sandbox-runtime: https://github.com/anthropic-experimental/sandbox-runtime
- Hunyuan licence: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE · TRELLIS.2: https://github.com/microsoft/TRELLIS.2 · nvdiffrast licence: https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt · fal pricing: https://fal.ai/pricing · JLCAPI: https://api.jlcpcb.com/
- Scalekit CLI vs MCP: https://www.scalekit.com/blog/mcp-vs-cli-use · Onshape Compare: https://cad.onshape.com/help/Content/compare.htm
