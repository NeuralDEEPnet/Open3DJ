# Open3DJ: Engineering-Rigor-First Architecture and Execution Proposal

*Principal architect proposal, 27 Oct 2026. Angle: geometric correctness, robust B-rep, STEP fidelity, edit-surviving history, constraint solving and manufacturing readiness first; agent accessibility built on top of that.*

---

## 0. Thesis

Agentic CAD in late 2026 fails for geometric reasons, not conversational ones. The best published agentic score on Parametric CAD Bench V3 is 61/100 at about $574 per run (https://cadbench.ai/). Frontier VLMs reach IoU of about 0.31 on CADBench, against 0.90 for an optimisation-based fitter (https://arxiv.org/html/2605.10873v1). GPT-5.2 produces invalid output on 68% of hard Text2CAD-Bench prompts (https://arxiv.org/html/2605.18430v1). What moves results is exact feedback from the kernel and the renderer (CADSmith: median IoU 0.81 to 0.96, mean Chamfer distance 28.4 to 0.74; https://arxiv.org/html/2603.26512), along with executable requirement tests (https://arxiv.org/abs/2605.07807).

Open3DJ should therefore be **the CAD system whose geometry a professional can trust and whose trust an agent can verify by calling tools**. Concretely:

1. **A mature B-rep kernel.** OCCT 8.0.1, called natively, behind a kernel-neutral interface. Open3DJ does not write a new kernel.
2. **A feature graph that is the source of truth.** It is text and diffable. References in it are resolved by query, so they survive edits, and every re-resolution is reported.
3. **Validation everywhere.** Each operation returns validity, measurements, an evidence block and a diff. Failures are structured and come with a retry ladder.
4. **STEP AP242 as the primary output.** Round-trip tests run in CI, persistent IDs are written into the file, and the measurement-confidence vocabulary travels inside every export.
5. **One agent contract.** It is a small, typed and transactional tool surface, exposed identically over MCP, the CLI and the SDKs.

The competitive gap is real. Zoo's engine is closed and cloud-only (https://zoo.dev/docs/faq). SolidCraft runs on the young `truck` kernel, which has no upstream fillets (https://raw.githubusercontent.com/tangency-labs/solidcraft/main/docs/architecture.md, https://github.com/ricosjp/truck). FreeCAD MCP servers need the GUI and run arbitrary Python (https://github.com/neka-nat/freecad-mcp). build123d-mcp has one shared, unauthenticated HTTP session (https://raw.githubusercontent.com/pzfreo/build123d-mcp/main/README.md). No open project combines local-first OCCT, a persistent editable design document with stable references, sandboxed execution, and evidence-grade verification.

---

## 1. Kernel strategy

### 1.1 Primary B-rep kernel: OCCT 8.0.1, native, dynamically linked

- **Version.** OCCT V8_0_1 (30 Jul 2026) is current. It followed 8.0.0 (7 May 2026) and 8.0.0p1 (17 Jun 2026) (https://github.com/Open-Cascade-SAS/OCCT/releases). Version 8 requires C++17. It adds **BRepGraph**, a typed graph topology with history and mutation guards edited through a single `EditorView` (https://github.com/Open-Cascade-SAS/OCCT/discussions/1275). STEP reading and writing are thread-safe under a one-reader-or-writer-per-thread contract.
- **Licence.** OCCT is LGPL-2.1 with the Open CASCADE exception (https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt). We ship it as replaceable shared libraries (`.so`/`.dylib`/`.dll`) with a prominent notice. The Open3DJ code itself stays permissive.
- **Binding.** We write our own C++ shim (`o3dj-occt-shim`, about 3-5k lines, `extern "C"` plus the `cxx` crate) and do not take a general binding. opencascade-rs still targets OCCT 7.8, and 8.x support there is an open issue (https://github.com/bschwind/opencascade-rs/issues/237). A narrow shim is also the right engineering choice. It exposes only the operations the feature graph uses, and every call returns `(shape, history, BOP report, validity report)`.
- **No WASM kernel on the desktop.** taucad libcascade 3.1.0 (OCCT 8.0.1) runs between parity and about 2x native on fuse, fillet, loft and sweep. It is about 3.2x slower on small fuses and about 9x slower on sub-millisecond primitives. It is also capped at 4 GB on WebKit (https://github.com/taucad/libcascade, https://raw.githubusercontent.com/WebAssembly/website/main/features.json). The WASM build (libcascade or occt-wasm 5.8.1) is kept for an optional zero-install browser viewer and evaluator in a later phase, behind the same shim API.

### 1.2 Secondary kernels behind the same trait

```rust
trait Kernel {
  fn eval(&self, op: &OpNode, inputs: &[ShapeRef], ctx: &EvalCtx) -> OpResult; // shape + history + diagnostics
  fn check(&self, s: ShapeRef, level: CheckLevel) -> ValidityReport;            // BRepCheck_Analyzer, BOPAlgo_ArgumentAnalyzer
  fn measure(&self, s: ShapeRef, q: MeasureQuery) -> Measurement;               // GProp, BRepExtrema
  fn tessellate(&self, s: ShapeRef, tol: Tolerance) -> MeshWithIds;             // face/edge IDs preserved
  fn exchange(&self, s: ShapeRef, fmt: Format, opts: &ExportOpts) -> Bytes;
}
```

- **Manifold 3.5.4** (Apache-2.0) handles mesh CSG, mesh-native imports (STL, 3MF, generated meshes), and fast printability checks such as watertightness and minimum feature size via level sets. Results have been deterministic across platforms since 3.5.0 (https://github.com/elalish/manifold). It runs in-process.
- **NVIDIA USD BRep 1.0.1** (Apache-2.0, SMLib) gets a research slot in phase 4, as a second boolean, fillet and offset engine and as a cross-check oracle. It has OCCT converters in both directions but no documented STEP I/O, and NVIDIA does not accept contributions (https://github.com/NVIDIA-Omniverse/usd-brep). We do not depend on it before benchmarking it on our corpus.
- **Not adopted.** truck and monstertruck have no upstream fillets. Fornjot was archived in June 2026. CADmium is under ELv2 and archived. SolveSpace and CGAL algorithm packages are GPL. Sources: https://github.com/ricosjp/truck, https://fornjot.app/blog/shutting-down-fornjot/, https://doc.cgal.org/latest/Manual/license.html.

### 1.3 Robustness policy (the core of the rigor angle)

1. **Precondition checks.** Before every boolean we run `BOPAlgo_ArgumentAnalyzer` (self-interference, small edges, continuity). OCCT requires BRepCheck-valid, non-self-interfering arguments with at least C1 continuity (https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html).
2. **Retry ladder, deterministic and logged.** The ladder runs: default, then safe-input (non-destructive) mode, then a fuzzy-value sweep over `[1e-7, 1e-6, 1e-5, 1e-4] x model scale`, then glue mode for coplanar cases, then `ShapeFix_Shape` healing of the inputs, then a structured failure. We treat fuzzy behaviour as non-monotonic in principle and try every value. The historical tracker evidence for that is unverified, which is exactly why the ladder does not assume monotonicity. The step that succeeded is recorded in the op result and in the evidence pack, so a "repaired" success is never silent.
3. **Post-condition checks.** After every op we run `BRepCheck_Analyzer` and assert closed shells for solids, a positive signed volume, and a volume-change sanity check against the op's intent. For example, a cut must not increase volume, and a fillet's volume change must have the right sign and be below a bound.
4. **Fillets.** Fillets are historically the weak point, so they get special handling. The edge set is applied as a group first. On failure we fall back to edge subsets ordered by convexity and length and report which edges failed and why, which is enough for an agent to fix the radius. Chamfers get the same treatment.
5. **Tolerance discipline.** Each document records `linear_tol` (default 1e-6 mm, scaled to the model), `angular_tol` and `import_tol`. Imported STEP keeps its tolerances and is healed only when the user or agent explicitly opts in. Healing is an op in the graph, never a silent mutation.
6. **Determinism.** Kernel workers run single-threaded per op by default (`SetRunParallel(false)`), so results are bit-reproducible on one platform. A content hash of `(op graph, kernel version, platform tuple)` keys the shape cache. Parallelism comes from evaluating independent graph branches in parallel, never from nondeterministic intra-op threads, unless a document sets `perf_mode`.

---

## 2. Native model format and parametric history

### 2.1 The `.o3j` project (text-first, git-friendly)

```
part.o3j/
  o3j.toml                 # format version, units (mm), kernel pins, tolerances, project UUID
  graph.o3j.json           # canonical feature DAG (sorted keys, stable ordering, UUIDv7 ids)
  sketches/<uuid>.json     # sketch geometry + constraints + solver status
  scripts/<uuid>.o3js      # script features (Open3DJ JS DSL), .py (build123d/CadQuery provider), .scad
  params.json              # named parameters, units, ranges, confidence labels
  refs.json                # persistent named references (query + fingerprint + label)
  evidence.json            # Evidence Pack v2 (gates, measurements, confidence)
  tests/*.o3jt.json        # executable spec assertions (CADTests-style)
  provenance.jsonl         # append-only PROV-O shaped ledger (agent, activity, entity, hashes)
  AGENTS.md                # project conventions for agents (Zoo pattern)
  .cache/                  # .brep / tessellation / renders, content-addressed, gitignored
```

The format follows several precedents. CADmium's JSON-lines op log and KCL's "code is the model" principle informed the overall shape (https://mattferraro.dev/posts/cadmium, https://github.com/KittyCAD/modeling-app). FreeCAD users have long asked for a git-friendly format (issues #11936 and #9432, https://github.com/FreeCAD/FreeCAD/issues). PROV-O provides the ledger vocabulary (https://www.w3.org/TR/prov-o/). Binary formats are never the source of truth. A `.o3jz` zip is just a packaging of the same directory.

### 2.2 Feature graph semantics

- Each node has the form `{id: uuidv7, kind, inputs:[ref], params:{…}, outputs:{role→body}, name}`. Node kinds are: `sketch`, `extrude`, `revolve`, `loft`, `sweep`, `boolean`, `fillet`, `chamfer`, `shell`, `draft`, `pattern`, `mirror`, `hole`, `thread_cosmetic`, `lib_part`, `import`, `script`, `heal`, `assembly_instance`, `mate`.
- A **script is one node, not the whole model.** A script node runs in a sandbox and emits either a sub-graph of primitive ops (preferred, because each op stays editable and diffable) or an opaque solid with a declared output contract. Agents can write code freely, and humans still get an editable tree. The terminal-only failure that CADWorld identified ("wrong document structure") cannot happen (https://arxiv.org/html/2609.16251v2).
- Evaluation is incremental. Only nodes downstream of a changed parameter re-evaluate, and their results are cached by content hash.

### 2.3 Topological naming: the hard problem

We combine three proven ideas.

1. **Element map from history.** Every OCCT op returns `Generated` / `Modified` / `IsDeleted` history. We mint element names as `opId:role:index-of-generator` and chain them through history, in the style of FreeCAD 1.x op-code prefixes. Long names are hashed (https://github.com/realthunder/FreeCAD_assembly3/wiki/Topological-Naming). With BRepGraph's typed node IDs and mutation counters, we can track identity inside an op rather than only across ops.
2. **Query references.** A reference stores criteria rather than an entity, as Onshape's FeatureScript does (https://cad.onshape.com/FsDoc/modeling.html). Examples:
   - `createdBy(op=extrude_7, role=cap_end)`
   - `adjacent(face=ref:top, dir=+X)`
   - `edgesBetween(ref:a, ref:b)`
   - `largestPlanarFace(normal≈+Z)`

   Each reference also carries a **geometric fingerprint** (surface type, normal or axis, area, centroid, bounding box) that is used only for disambiguation.
3. **Resolution report.** Every regeneration returns `{exact, disambiguated(score), ambiguous(candidates), broken(reason)}` per reference. Agents see this report in the `run` result, and the UI marks disambiguated references amber and broken ones red. No CAD MCP server exposes this today. It turns topological naming from a silent corruption into a reviewable event.

The reference token grammar is shared by viewport picks, chat chips, scripts and MCP. A token looks like `@ref:<uuid>|<label>`, and `make_ref` / `resolve_ref` are tools. This is 3dj.app's `withReferences` / `attachTo` semantics, made persistent and auditable.

### 2.4 Semantic diff

`diff(revA, revB)` returns:

- graph changes: added, removed or modified ops, and parameter deltas;
- reference re-resolutions;
- numeric deltas: volume, area, bounding box, mass, centre of mass, and face, edge and solid counts;
- a geometric diff: symmetric-difference solids computed by OCCT booleans, Hausdorff and Chamfer distances on the tessellation, and changed-face IDs;
- optional ghosted renders (Onshape Compare colours: base blue, target red; https://cad.onshape.com/help/Content/compare.htm).

---

## 3. Constraint solving

- **2D sketches, MVP: PlaneGCS** (LGPL-2.1-or-later), built from source from the standalone FreeCAD-1-1 extraction, pinned to a FreeCAD minor version and loaded as a separate shared library (https://github.com/2wiceUponATime/PlaneGCS). We build from source because the PyPI package's metadata conflicts with its stated licence (SSPL vs LGPL).
- **Evaluation: ezpz** (MIT, Zoo, used in Design Studio 1.2) is a long-term candidate for a fully permissive default (https://github.com/KittyCAD/ezpz). Its method and coverage are under-documented, so we run a 500-constraint benchmark before switching.
- **Solver contract.** Every sketch reports its DOF count, the status of each entity (under-constrained, well-constrained, over-constrained or conflicting) and the conflicting constraint set. Redundancy detection comes from the Jacobian rank. Agents get `sketch_status` in structured form. "Under-constrained" is treated as a manufacturing-readiness warning, not merely a UI colour.
- **SolveSpace is excluded** because it is GPL-3 and tightly coupled to its application (https://solvespace.com/library.pl).
- **3D assembly mates, phase 3: in-house solver.** No permissive option exists. The design:
  - rigid bodies with 6 DOF;
  - mates as residual functions (coincident, concentric, distance, angle, planar, revolute, prismatic, cylindrical, fastened);
  - a Levenberg-Marquardt solver with analytic Jacobians;
  - DOF analysis per joint, and mate frames bound to persistent references so mates survive part edits.

  Tolerance stacks (worst case and RSS) build on the same mate graph. This is the gap every competitor leaves. MUSE shows that 99% code execution does not imply correct interfaces (https://arxiv.org/html/2605.28579v3).

---

## 4. STEP fidelity and interchange

| Format | Direction | Engine | Notes |
|---|---|---|---|
| STEP AP242 DIS (default), AP214 IS, AP203 | R/W | OCCT XDE (`write.step.schema=5`) | Writes validation properties (volume, area, centroid), user-defined attributes keyed by feature UUID, CAx-IF `V5_UUID_ATTRIBUTE` persistent IDs, colours and names, and semantic GD&T where authored. AP242 must be selected explicitly because OCCT defaults to AP214 (https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html). |
| 3MF (core + materials + production) | R/W | lib3mf 2.5 (BSD-2) | Uses namespaced `o3j:` metadata with `preserve="true"` and a MustPreserve `Metadata/o3j_evidence.json` part (https://3mf.io/spec/). |
| STL (binary) | W (+R via Manifold) | OCCT / Manifold | Ships with a SHA-256-keyed `.evidence.json` sidecar. |
| glTF/GLB | W | OCCT RWGltf_CafWriter | Embeds KHR_xmp_json_ld evidence packets. |
| BREP (OCCT native) | R/W | OCCT | Used for the cache and debugging only. |
| DXF R12/R2018, SVG | W | own + ezdxf-equivalent | Sections and flat patterns. |
| IGES | R only | OCCT | Legacy import. Kept in a separate worker because IGES reading is not concurrency-safe. |

**Fidelity programme.** A STEP regression suite runs in CI (`bench/step-roundtrip`) and covers:

- **Round-trip.** Every corpus part goes Open3DJ to STEP to Open3DJ. We assert matching volume, area and bounding box within 1e-6 relative, identical face, edge and vertex counts, and validity, and we check that persistent IDs survive.
- **Cross-reader checks.** Exports are re-read by FreeCAD 1.1 (in a subprocess, via `freecadcmd`) and by build123d/OCP 8.0.1 with the same assertions. The NIST PMI test models run through the reader and writer.
- **Validation properties.** We read back the validation properties written into the STEP file and compare them with our own measurements.
- **Pending upstream work.** Tessellated AP242 PMI and companion streams were merged into OCCT's integration branch on 19 Oct 2026 but have not been released yet (https://github.com/Open-Cascade-SAS/OCCT/pull/1647). They stay out of scope until a tagged release ships them.

**Confidence vocabulary.** `measured ±0.15 / observed ±0.35 / inferred ±0.80 / assumed` is attached per parameter and per feature UUID. It is carried into STEP as AP242 plus/minus tolerances plus user attributes, into 3MF metadata, and into glTF XMP. We co-publish this with 3dj.app as **Design Evidence Pack v2**.

---

## 5. Manufacturing readiness (DfM and DfAM gates)

The gates run on the B-rep wherever possible and fall back to the mesh otherwise. Each one returns `pass | fail | unevaluated` together with its evidence and confidence.

| Gate | Method | Default (3dj.app EP v1 parity) |
|---|---|---|
| Valid solid / watertight | BRepCheck + Manifold `IsManifold` | required |
| Minimum wall | Medial sampling via `BRepExtrema_DistShapeShape` on face-pair candidates, cross-checked by a Manifold SDF level set | 0.8 mm (nozzle-safe) |
| Overhang | Face normal vs build direction with tessellated area accounting | 45° |
| Build volume | Oriented bounding box vs printer profile | 220×220×250 mm |
| Mass | GProp volume × material density | PLA 1.24 g/cm³ |
| Draft (moulding) | Face normal vs pull direction | profile |
| Trapped volume | Cavity detection on the shell graph | profile |
| Hole / fastener fit | lib.* tolerance tables (ISO 273 clearance classes) | profile |
| Interference (assemblies) | Pairwise `BRepAlgoAPI_Common` volume + clearance via BRepExtrema | 0 mm³ / profile clearance |

No permissive library implements wall-thickness, overhang or draft checks (https://github.com/mikedh/trimesh), so these gates are Open3DJ core IP and are tested against hand-measured golden parts.

Slicing goes through OrcaSlicer, Bambu Studio and PrusaSlicer **as subprocess providers only**, because all three are AGPL (https://github.com/SoftFever/OrcaSlicer). FEA (CalculiX) is a phase-4 provider.

---

## 6. Process and daemon architecture

```
┌──────────────────────── Desktop shell (Tauri 2.12) ───────────────────────┐
│  React UI + three.js r186 (WebGPURenderer, WebGL2 fallback)              │
│  feature tree · sketcher · viewport · diff/review · evidence · agent log │
└─────────────▲───────────── WebSocket + REST (loopback, token) ───────────┘
              │
┌─────────────┴──────────────── o3djd (Rust, one per user) ────────────────┐
│ API router  ── MCP (stdio via `o3dj mcp`, Streamable HTTP 127.0.0.1)      │
│             ── REST/OpenAPI + WS events      ── CLI (same commands)       │
│ Doc manager (graph, refs, revisions, branches, transactions, locks)       │
│ Scheduler (op DAG eval, job queue, cancellation, budgets)                 │
│ Evidence engine (gates, tests, diff)   Provider host (local + cloud)      │
│ Audit/provenance ledger                Secrets (OS keychain via keyring)  │
└──────┬──────────────┬──────────────────┬─────────────────┬────────────────┘
       │ IPC (capnp/  │                  │                 │
       │ flatbuffers) │                  │                 │
┌──────▼─────┐ ┌──────▼───────┐ ┌────────▼───────┐ ┌───────▼────────┐
│ kernel-    │ │ script-      │ │ render-worker  │ │ provider       │
│ worker xN  │ │ worker       │ │ (wgpu headless │ │ workers        │
│ OCCT 8.0.1 │ │ wasmtime 50  │ │ PNG, section,  │ │ (python b123d, │
│ + Manifold │ │ + QuickJS-   │ │ ID buffers)    │ │ openscad, gen3d│
│ + PlaneGCS │ │ WASM; emits  │ │                │ │ slicers, cloud)│
│ OS-sandbox │ │ op subgraphs │ │                │ │ OS-sandboxed   │
└────────────┘ └──────────────┘ └────────────────┘ └────────────────┘
```

**Design decisions:**

- **Crash isolation.** OCCT can segfault or hang on pathological input, so kernel workers are separate processes, one pool per document. Each has a watchdog and memory caps (cgroups/rlimit, Job Objects, macOS `setrlimit`). A crash returns a structured `KernelCrash` result with a replay bundle (the op plus input `.brep` files), and the daemon survives. smlibpy's per-session process isolation and crash replay is the precedent (https://smlibpy.classcad.ch/).
- **Script sandbox.** Scripts run in QuickJS (2026-06-04, MIT) compiled to WASM under wasmtime 50, with epoch interruption, fuel in "reproducible" mode, a `ResourceLimiter` memory cap and `max_wasm_stack` (https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html, https://bellard.org/quickjs/). The worker process runs under an OS sandbox: bubblewrap+seccomp or Landlock on Linux, Seatbelt on macOS, AppContainer plus a Job Object on Windows. Profiles follow Anthropic's sandbox-runtime, with RFC 1918 ranges explicitly denied (https://github.com/anthropic-experimental/sandbox-runtime). Scripts reach geometry only through a **deterministic capability membrane**: no clock, RNG, network, filesystem or dynamic import, following Onshape's determinism principle. Static "prohibited API" lint is not a security control. A live probe showed 3dj.app's validator accepting `eval`, `fetch` and `while(true)`.
- **Python (build123d 0.13 / CadQuery 2.8 on OCP 8.0.1)** is a trusted-tier provider. It runs in the OS-sandboxed worker with no network, and its output enters the graph as a `script` node with an attached STEP and the source. Its purpose is benchmark compatibility (CADBench, CAD-bench, cadrille) and the existing ecosystem (https://github.com/gumyr/build123d/releases).
- **Transport security.** stdio is the default MCP transport. Streamable HTTP binds to 127.0.0.1 or a Unix socket/named pipe, validates Origin and Host (returning 403), and requires a per-install bearer token stored in the OS keychain. It never binds 0.0.0.0. Remote mode uses OAuth 2.1 with PKCE, RFC 8707 and RFC 9728, with no token passthrough. Tool descriptions are static and hashed so clients can pin them. These rules follow the MCP spec and best practices (https://modelcontextprotocol.io/specification/2026-07-28/changelog, https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices) and close the classes behind CVE-2025-49596 and CVE-2025-53109/53110.
- **Untrusted file content.** STEP header fields, 3MF metadata and SCAD comments are parsed in the sandboxed worker and returned to agents inside untrusted-content delimiters.

---

## 7. Agent interface (MCP 2026-07-28)

### 7.1 Principles

- **Protocol baseline.** We target MCP revision 2026-07-28: stateless, `server/discover`, explicit server-minted handles, `ttlMs`/`cacheScope` on list results, and deterministic tool order (https://modelcontextprotocol.io/specification/2026-07-28/changelog). We use the Rust SDK `rmcp`, which reached Tier 1 in August 2026 (https://modelcontextprotocol.io/docs/2026-07-28/sdk).
- **Handles are bound to users.** Every call carries `doc_id` and, where relevant, `rev` or `txn_id`. Handles are bound to the authenticated principal and are never themselves treated as authentication.
- **Structured results.** Every mutating call returns a **GeometryReport** in `structuredContent` with an `outputSchema`. Images are opt-in and always captioned with the camera, scale and bounding-box digest. A `detail: concise|full` switch keeps results under Claude Code's 25k-token cap (https://code.claude.com/docs/en/mcp).
- **Errors are results.** Errors come back as `isError` tool results with `{code, op_id, location, cause, suggestion, retry_ladder_trace}`.
- **Long work.** Long jobs use the Tasks extension where the client supports it and a `job_get` polling fallback everywhere else. No call blocks for longer than Codex's 60 s default timeout.
- **One schema everywhere.** The same JSON schemas back `o3dj <cmd> --json` (exit codes 0 ok, 1 geometry failure, 2 gate failure, 3 usage error) and the TypeScript and Python SDKs. Token-cost evidence favours CLIs plus skills for coding agents (https://www.scalekit.com/blog/mcp-vs-cli-use).

### 7.2 Tool surface (18 tools)

| Tool | Input | Output |
|---|---|---|
| `doc_open` | `{path? , template?, new_name?}` | `{doc_id, rev, units, kernel_pins, params[], tree_summary}` |
| `doc_list` | `{cursor?}` | `{docs[{doc_id,name,rev,dirty}], next}` |
| `txn_begin` | `{doc_id, intent:string, branch?}` | `{txn_id, base_rev}`: opens a proposal branch |
| `txn_commit` / `txn_abort` | `{txn_id, message?}` | `{rev, diff_summary}` / `{ok}` |
| `run` | `{doc_id, txn_id?, ops?:OpPatch[] , script?:{lang:"o3js"\|"py"\|"scad", source}, dry_run?:bool}` | `GeometryReport {ok, rev, bodies[{name,volume_mm3,area_mm2,bbox,com,valid,closed,solids,faces,edges}], ref_resolution{exact,disambiguated,ambiguous,broken}, diff_vs_prev, warnings[], errors[{code,op_id,line?,cause,suggestion}], retry_trace[]}` |
| `params_set` | `{doc_id, txn_id?, values:{name:value_with_unit}}` | `GeometryReport` |
| `tree_get` | `{doc_id, rev?, node_ids?, depth?}` | `{nodes[{id,kind,name,params,inputs,status}], sketches[{id,dof,status,conflicts[]}]}` |
| `inspect` | `{doc_id, rev?, target:ref\|body, queries:["mass","bbox","faces","edges","distance","angle","section","geometryInfo"], material?}` | `{measurements[], confidence}` |
| `ref_make` / `ref_resolve` | `{doc_id, selector:query\|pick{view,pixel}, label}` / `{doc_id, ref}` | `{ref_token, fingerprint}` / `{status, entity, candidates[]}` |
| `render` | `{doc_id, rev?, views:["iso","front","top","right","section:z=10"], style, highlight_refs?, size}` | images + `{camera, scale, bbox_digest}` captions |
| `check` | `{doc_id, rev?, gates?:[...], profile?:"fdm_0.4"\|..., tests?:bool}` | `EvidencePack {gates[{id,status,value,threshold,evidence,confidence}], tests[{id,pass,message}]}` |
| `diff` | `{doc_id, from_rev, to_rev, geometric?:bool, render?:bool}` | `{graph_delta, param_delta, ref_changes, numeric_delta, hausdorff_mm, changed_faces[], images?}` |
| `export` | `{doc_id, rev?, format:"step-ap242"\|"step-ap214"\|"3mf"\|"stl"\|"glb"\|"dxf", bodies?, options?}` | `{path\|resource_link, sha256, evidence_embedded:bool, gates_snapshot}` (refused or warned when required gates fail, per policy) |
| `import` | `{doc_id?, path\|url, format?, heal?:bool}` | `{doc_id, bodies[], validity, header_untrusted{…}}` |
| `lib_search` / `lib_get` | `{query, kind?, standard?}` / `{id, params}` | paginated parts (ISO fasteners, pockets, snap fits, T-slot) / `{op_template, ports}` |
| `docs_search` | `{query, k?}` | DSL docs, starters and error explanations (RAG material) |
| `job_get` / `job_cancel` | `{job_id}` | `{state, progress, result?}` |
| `providers_list` | `{capability?}` | `{providers[{id, capabilities, license, territory, local\|cloud, cost_model, health}]}` |
| `generate` | `{capability:"text-to-mesh"\|"image-to-mesh"\|"scan-to-cad"\|"text-to-cad-draft", inputs, provider?, budget_usd?, egress:"local"\|"cloud-anon"\|"cloud-full"}` | `{job_id}` leading to `{asset, provenance, license}` |

These are 18 logical tools, with paired verbs counted once.

**Annotations** follow the spec: `readOnlyHint` for inspect, render, check, diff and tree_get, and `destructiveHint` for commit, export-overwrite and abort. Server instructions are under 512 characters.

**Clarification** is built in rather than left to the agent. `run` with `dry_run` plus `check{tests}` lets an agent validate a spec before building it. `docs_search` can return a `spec_gaps` template, following ProCAD, where a clarification step cut invalidity from 4.8% to 0.9% (https://arxiv.org/abs/2602.03045).

**Packaging:**

- a SKILL.md under 5k tokens, also served via Skills over MCP;
- a Claude Code plugin with a PreToolUse hook that blocks `export` when gates fail;
- an MCPB bundle;
- a Codex `config.toml` snippet;
- registry `server.json` entries;
- an MCP App viewer (`ui://open3dj/viewer`, three.js) for hosts that render apps.

---

## 8. Desktop client stack

- **Shell.** Tauri 2.12.x (MIT/Apache) using the OS webviews. The daemon ships as a sidecar binary (https://v2.tauri.app/blog/tauri-2.12/).
- **UI.** React 19 + Vite + TypeScript. The bundle is shared verbatim with the web viewer and the MCP App, and host calls sit behind a thin `HostApi` interface.
- **Viewport.**
  - three.js r186 WebGPURenderer with automatic WebGL2 fallback and TSL materials for the CAD edge and face shaders (https://github.com/mrdoob/three.js/releases).
  - GPU ID-buffer picking keyed on kernel-stable face and edge IDs, plus a BVH for snapping and measuring.
  - Tessellation is decoupled from regeneration and streamed per body.
  - Onshape-style pixel culling for assemblies.
  - Target: 60 fps orbit of a 100k-triangle part on Intel Iris Xe / RTX 3060 class hardware.
- **Linux.** WebKitGTK has no WebGPU and can silently software-render WebGL2 (https://v2.tauri.app/develop/debug/linux-graphics/). We force WebGL2 there, probe frame time, and apply the NVIDIA workarounds only when they are detected as needed. An Electron 45 Linux build is the escape hatch if measurements fail. The Tauri 3 CEF runtime is not adopted while it is alpha.
- **UX essentials in the MVP:**
  - the feature tree with reference-status badges;
  - a sketcher with DOF colouring;
  - Onshape-style compare;
  - an evidence panel;
  - an **agent proposal review**: per-op accept, reject or edit, with the user's edits reported back to the agent;
  - navigation presets (SolidWorks, Onshape, NX, Creo, Fusion-like, Blender, trackpad);
  - a command palette, view cube and section view.
- **Distribution.**
  - GitHub Releases (NSIS + MSI, universal DMG, AppImage + deb + rpm).
  - Windows signing through SignPath Foundation (free for OSS). Apple Developer ID plus notarisation ($99/yr), which Homebrew casks need (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options, https://developer.apple.com/programs/).
  - Native arm64 builds on all three OSes. Installer budget is 60-120 MB, against Zoo's Electron build at 211-341 MB and FreeCAD at 495-783 MB.

---

## 9. Compute-provider abstraction

```rust
trait Provider {
  fn manifest(&self) -> ProviderManifest; // capabilities, models, per-dependency SPDX licences,
                                          // territory exclusions, MAU/revenue caps, min VRAM,
                                          // backends (cuda/rocm/metal/cpu), egress class, cost model
  fn estimate(&self, req: &JobReq) -> Estimate;      // time, VRAM, USD
  fn submit(&self, req: JobReq) -> JobId;            // async; mirrors 3dj modelId/poll/download
  fn poll(&self, id: &JobId) -> JobState;
  fn cancel(&self, id: &JobId);
}
```

- **Router.** The router enforces the egress policy (`local-only` by default), USD caps with pre-submission estimates, licence and territory gating, and failover from local to cloud on OOM or a missing backend. A content-addressed model cache accepts weights only as safetensors.
- **Providers in MVP order:**
  1. `local-python` (build123d/CadQuery);
  2. `local-gen3d` with TripoSG (8 GB, MIT) and TRELLIS (16 GB);
  3. `provider:3dj` with gen3d, OpenSCAD compile and print quotes over OAuth 2.1 + PKCE;
  4. `runpod` / `modal` BYO-container running one `open3dj-worker` image;
  5. `fal` per-call;
  6. the Shapeways and JLC 3D-printing APIs for print services.
- **Licence gates.**
  - Hunyuan3D 2.x, Omni and Part are opt-in and geo-gated, excluding the EU, UK and KR (https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE).
  - TRELLIS and TRELLIS.2 are flagged for an audit of their per-dependency licences: diffoctreerast and nvdiffrast are non-commercial.
  - cadrille (Apache-2.0) is the first scan-to-CAD provider. Its output always lands as an *editable op subgraph* plus evidence with `inferred` confidence (https://github.com/col14m/cadrille).
- **Heavy geometry stays local.** Unlike Zoo, Fusion Compute and 3dj.app, the kernel never needs the cloud. Only generative 3D, FEA and rendering bursts go to providers.

---

## 10. Repository layout (monorepo)

```
open3dj/
  crates/
    o3dj-core/         # graph model, ops schema, refs, revisions, txns, diff (pure Rust)
    o3dj-kernel/       # Kernel trait + OCCT backend (FFI to shim) + Manifold backend
    o3dj-occt-shim/    # C++17 shim over OCCT 8.0.1 (CMake), LGPL boundary, own NOTICE
    o3dj-sketch/       # PlaneGCS binding (dylib), solver status, ezpz eval
    o3dj-mates/        # 3D assembly solver (phase 3)
    o3dj-evidence/     # gates, tests runner, Evidence Pack v2 schema
    o3dj-exchange/     # STEP/3MF(lib3mf)/STL/GLB/DXF, metadata mapping
    o3dj-script/       # wasmtime host, QuickJS-WASM, capability membrane, o3js stdlib
    o3dj-sandbox/      # OS sandbox profiles (bwrap/landlock, seatbelt, appcontainer)
    o3dj-render/       # wgpu headless renderer, ID buffers, sections
    o3dj-providers/    # provider trait, router, manifests, adapters
    o3djd/             # daemon: API router, scheduler, workers, MCP (rmcp), REST/WS
    o3dj-cli/          # `o3dj` CLI (same schemas), `o3dj mcp`, `o3dj skill install`
  packages/
    schema/            # JSON Schemas (ops, GeometryReport, EvidencePack) -> TS/Py codegen
    sdk-ts/ sdk-py/    # thin clients
    ui/                # React app (tree, sketcher, viewport, review, evidence)
    viewer-mcp-app/    # ui://open3dj/viewer
  apps/desktop/        # Tauri shell
  library/             # o3dj-stdlib: ISO fasteners, pockets, snap fits, T-slot (from ISO tables + bd_warehouse, Apache-2.0)
  workers/python/      # build123d/CadQuery provider image
  bench/               # golden corpus, STEP round-trip, CADGenBench/CADBench/MUSE harness, perf
  docs/ rfcs/ skills/  # docs-as-RAG, RFC process, SKILL.md
```

**Licence.** We recommend relicensing to `Apache-2.0 OR MIT` now, while there is a single copyright holder, to gain the patent grant. The OCCT and PlaneGCS shims keep LGPL notices and dynamic linking, and a CI licence gate fails the build if GPL, AGPL or Tencent-licensed dependencies enter the core.

---

## 11. MVP (first public release, v0.1 "Trustworthy Part")

**In scope:**

1. The `o3djd` daemon with OCCT 8.0.1 native on Windows x64/arm64, macOS universal and Linux x64/arm64, with crash-isolated kernel workers.
2. The `.o3j` text format: feature graph, params, refs, provenance ledger, revisions and branches (`txn_*`).
3. Ops: sketch (PlaneGCS: lines, arcs, circles, splines; coincident, tangent, parallel, perpendicular, equal, distance, angle, radius, fix), extrude, revolve, loft, sweep, boolean, fillet, chamfer, shell, draft, linear/circular pattern, mirror, hole (ISO clearance and tapped cosmetic), lib_part, import, heal.
4. Query references with resolution reports, and semantic diff (numeric plus graph plus Hausdorff).
5. The Open3DJ JS DSL (`o3js`), source-compatible with 3dj.app's Param/lib/withReferences surface where feasible, running in wasmtime+QuickJS and emitting op subgraphs.
6. The trusted-tier Python provider (build123d 0.13) for benchmark parity.
7. Exports: STEP AP242/AP214 with UUIDs, validation properties and evidence attributes; 3MF with evidence; STL plus sidecar; GLB. Imports: STEP, IGES, STL, 3MF.
8. The Evidence Pack v2 gates from section 5 for FDM, plus executable spec tests.
9. The MCP tool surface from section 7, the CLI with schema parity, SKILL.md, the Claude Code plugin and MCPB.
10. The Tauri desktop app: tree, sketcher, viewport, compare, evidence panel and agent proposal review.
11. Providers: `local-python`, `provider:3dj` (gen3d and print quote) and `local-gen3d` (TripoSG/TRELLIS, Linux/Windows NVIDIA only).
12. A published benchmark: a golden corpus of 150 parts (STEP round-trip and gate accuracy), a CADGenBench submission and a CADBench subset, with the harness run in CI.

**Explicitly out of scope for v0.1:**

- assemblies and mates, and tolerance stacks (v0.3);
- drawings/TechDraw and GD&T authoring UI (v0.4, though GD&T *pass-through* on import and export is in);
- CAM, FEA and sheet metal;
- the browser/WASM kernel mode;
- the USD BRep backend;
- multi-user real-time collaboration;
- OpenSCAD (v0.2 as a subprocess provider);
- scan/photogrammetry (v0.3 via COLMAP and cadrille);
- hosted relay for ChatGPT;
- plugin marketplace;
- the Fidget/libfive implicit kernel.

---

## 12. Roadmap (team of 3 engineers + 1 part-time UX, with AI agents)

| Phase | Weeks | Deliverables |
|---|---|---|
| P0 Foundations & kernel spike | 4 | OCCT 8.0.1 shim builds on all 6 targets. Benchmark corpus v0 (60 parts). Native vs libcascade timings and peak RSS. Kernel trait. Crash-isolated worker. CI matrix with licence gate. Relicense, GOVERNANCE.md, RFC process. Decision RFCs on IPC format and PlaneGCS vs ezpz. |
| P1 Graph, refs, exchange | 6 | `.o3j` format v1, op evaluator with incremental caching, element map + query refs + resolution report, retry ladder, STEP AP242/AP214 + 3MF + STL + GLB, round-trip suite green on 150 parts. |
| P2 Agent contract & sandbox | 5 | `o3djd` with MCP (rmcp) stdio + loopback HTTP, CLI parity, GeometryReport/EvidencePack schemas, wasmtime+QuickJS `o3js` runtime, OS sandbox profiles on 3 OSes, Python provider, headless wgpu renders, `diff`, `check` gates, SKILL.md, plugin. CADGenBench harness running. |
| P3 Sketcher & desktop UI | 6 (overlaps P2 by 3) | Tauri app, viewport with ID picking, PlaneGCS sketcher with DOF status, tree with ref badges, compare view, evidence panel, proposal review, signed installers, Linux WebGL2 probe. |
| P4 Hardening → v0.1 public | 3 | Fuzzing of STEP/3MF/STL readers, security regression suite (DNS rebinding, symlink, config rug-pull), docs-as-RAG, providers 3dj + local-gen3d, benchmark publication, Show HN leading with the licence and the evidence story. |
| **Subtotal to v0.1** | **~21** | (P2 and P3 run in parallel; 24 weeks with buffer) |
| P5 v0.2 Robustness & ecosystem | 6 | OpenSCAD (Manifold nightly) subprocess provider, CadQuery provider, ezpz evaluation, fillet subset fallback, cloud providers (RunPod/Modal/fal), Shapeways/JLC print providers, MCP App viewer, browser read-only viewer. |
| P6 v0.3 Assemblies | 8 | Mate solver (LM, DOF analysis), interference/clearance, worst-case/RSS stacks, multi-part 3MF/STEP assemblies, MUSE benchmark, scan-to-CAD (COLMAP 4.2 + cadrille) landing as editable ops. |
| P7 v0.4 Drawings & GD&T | 8 | AP242 semantic PMI authoring, 2D drawings (HLR via OCCT), DXF/SVG/PDF, QIF 3.0 results export, sheet metal basics. |
| P8 Research track (continuous) | — | USD BRep second backend and oracle, BRepGraph-native element naming, implicit (Fidget) lattices, CalculiX FEA provider, fine-tuning dataset of execution-verified op graphs. |

---

## 13. Differentiators

| vs | Open3DJ advantage |
|---|---|
| **Zoo (KCL/Zookeeper)** | Geometry runs locally on an open kernel and works offline. Zoo's engine is closed and streamed as video, and its community threads are dominated by connection failures (https://community.zoo.dev/top). Open3DJ allows many sessions per daemon with per-user handles, where Zoo MCP has one session per process. It adds evidence gates and STEP provenance. |
| **Onshape FeatureScript MCP** | Full document read and write, assemblies on the roadmap, local and free. PTC's server only writes custom features (https://develop3d.com/cad/onshape-featurescript-mcp-lets-users-build-custom-cad-features-fast/). Open3DJ has comparable query-reference semantics, plus a resolution report that Onshape does not expose. |
| **Fusion MCP trio** | Open3DJ is authenticated, sandboxed, documented, statically schema'd and needs no licence. Fusion's local server is unauthenticated with undocumented dynamic tools, and Compute is capped at 2 sessions and 1-hour sessions (https://help.autodesk.com/view/fusion360/ENU/?guid=FMCP-OVERVIEW). |
| **FreeCAD-MCP / Blender MCP** | Open3DJ is headless-capable and does not need a GUI. It has no arbitrary host Python and no unauthenticated socket (https://github.com/ahujasid/mcp-for-blender). It offers transactional proposals with rollback and is designed for references from day one rather than retrofitted. |
| **SolidCraft** | OCCT 8 maturity (fillets, lofts, shells, AP242 with PMI pass-through) against `truck`, with an SMLib port still experimental. Open3DJ adds evidence and confidence vocabulary, the standard-parts library, the print loop and Python benchmark compatibility. |
| **build123d/text-to-cad** | A persistent, editable design document and a desktop app, with no telemetry by default. Open3DJ runs their scripts unmodified as a provider instead of competing with them. |

**Unique combination:** an open, local-first B-rep kernel, an edit-surviving reference model with explicit re-resolution reports, sandboxed deterministic scripts that compile to editable features, evidence-carrying AP242 and 3MF, and a single schema across MCP, CLI and SDK, all measured in public benchmarks.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OCCT boolean and fillet failures on real parts erode trust | Precondition analysis, a logged retry ladder and fillet subset fallback. A golden corpus grows from every bug report (each crash replay bundle becomes a test). We consider an Open Cascade support contract after v0.1. |
| Topological naming still breaks on large edits | Query references with fingerprints, a resolution report, and agent and UI warnings rather than silent corruption. A reference-stability benchmark of parameter sweeps over the corpus is published per release. |
| OCCT 8.x API churn (final Geom classes, removed handles) breaks 3dj.app script compatibility | The narrow shim isolates the API. An `o3js` compatibility layer has its own test suite built from 3dj.app's 18 starters. |
| LGPL obligations violated in bundling | Dynamic linking only, NOTICE files, relinkable shim build documentation, and a CI licence gate. The WASM build is deferred until legal review. |
| Scope explosion (assemblies, drawings, CAM) delays a trustworthy part modeller | A hard v0.1 scope (single-part, FDM gates). The roadmap gates each phase on benchmark thresholds rather than feature counts. |
| Constraint solver licence or quality (PlaneGCS LGPL, ezpz immature) | Solver trait, PlaneGCS dynamically loaded, ezpz benchmarked in P5. The in-house 3D mate solver is planned rather than borrowed. |
| Sandbox overhead hurts interactivity (wasmtime + OS sandbox + IPC) | Scripts emit op graphs, so heavy geometry runs natively in kernel workers and only orchestration runs in WASM. Prewarmed worker pools. Latency budget of 50 ms overhead per run, measured in CI. |
| Linux WebKitGTK rendering is poor | A frame-time probe, the forced WebGL2 path, and an Electron Linux build as the escape hatch. |
| A fast competitor (SolidCraft ships daily releases at about 11k stars) captures the narrative | Lead with measurable rigor (published STEP round-trip and benchmark scores). Offer interop (STEP plus MCP federation) rather than a feature race, and track it weekly. |
| Generative-model licence traps (Hunyuan territory, TRELLIS non-commercial deps) | Per-dependency licence manifests, geo gating, MIT/Apache defaults (TripoSG), and the cloud via 3dj.app for the rest. |
| Benchmarks reward the wrong thing (IoU survivorship) | Gate releases on executable spec tests and STEP validity as well as IoU. Report invalidity and failure rates alongside the scores. |
| Name collision (Intel ISL "Open3D") and unsigned-binary distrust | Counsel trademark search before launch. Signed and notarised builds from v0.1 (SignPath, Apple Developer ID). |
| Small team burnout and sustainability | Monetise scarcity through 3dj.app (GPU credits, print quotes, enterprise), never the local kernel. Use DCO, CODEOWNERS and an RFC process to distribute review. |

---

## 15. Success criteria for v0.1

- STEP round-trip: 100% of a 150-part corpus passes the volume, area and topology assertions, and FreeCAD and OCP read 100% of exports.
- Reference stability: at least 95% of references resolve as `exact` across a 1,000-edit parameter sweep. Zero silent mis-resolutions: every non-exact resolution is reported.
- DfM gates: the wall and overhang gates agree with hand-measured golden values within ±0.05 mm or 1°.
- Agents: on CADGenBench, Claude Opus 5.5 via Open3DJ's MCP beats its own result via the build123d-mcp baseline (0.457) with the same model budget. Validity reaches 100%.
- Ops: no daemon crash under the fuzzing corpus (kernel workers may crash and must recover). Median `run` overhead stays at or below 50 ms over raw kernel time.
