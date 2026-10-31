# Open3DJ industrial product design pipeline

Status: pipeline of record from 28 Oct 2026, paired with [PLAN.md](PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ASSEMBLIES.md](ASSEMBLIES.md) and [COMPUTE.md](COMPUTE.md). Step numbers S0 to S12 and slice names ID-0 to ID-6 are the plan's. The survey of commercial and open tools, the moulding rules and their sources are in [research/industrial-design.md](research/industrial-design.md); formats and suppliers in [research/formats-interop-manufacturing.md](research/formats-interop-manufacturing.md); model licences in [research/gap-4.md](research/gap-4.md); the 3dj.app quote gap in [research/gap-9.md](research/gap-9.md). Anything unchecked is marked "to verify".

## 1. How the pipeline works

1. **Agents prepare, measure and draft. Humans approve taste, money and anything that leaves the machine.** Every stage except three ends in a daemon-owned approval on the nonce-protected local page: Research is folded into the brief approval; Visualisation has no approval object, because sharing a render is the human's own act (section 2); and RFQ and production has none, because sending an RFQ and placing an order are the human's own acts outside Open3DJ. An MCP elicitation `accept` is never consent.
2. **Every product is an assembly from the first sketch.** Concepts, massing, prototypes and production designs all live in one `.o3j` project with definitions, occurrences, connectors and mates ([ASSEMBLIES.md](ASSEMBLIES.md)). A single part is a one-occurrence assembly.
3. **The CPU decides, the GPU accelerates.** Geometry, report numbers and gate verdicts come from occt-wasm on the CPU. GPUs display, screen, render and generate. Each stage below says where its heavy work runs, following the workload table in [COMPUTE.md](COMPUTE.md) section 2.
4. **Every number carries a confidence label:** measured, observed, inferred or assumed. Generated geometry is always "assumed"; concept images are "concept, not geometry"; rule checks are "rule check, not simulation"; FEA is "simulation, not test".
5. **No new tools.** The pipeline uses the five tools (`run`, `inspect`, `render`, `export`, `docs`) with the ops, fields, views and formats listed in [ARCHITECTURE.md](ARCHITECTURE.md) section 9. Stage playbooks are `docs` pages, so SKILL.md stays under 5k tokens.
6. **Stage state is derived, never stored.** The approvals ledger (`inspect fields=[approval]`) says which stages are signed off, which were skipped (a `stage_skip` approval with a reason) and which simulations a human has read (`sim_reading`). Approval and provenance timestamps give lead time and rework per stage (PLAN.md section 4.3).
7. **One product family first:** small electronics enclosures and handheld products, where public ABS and PC rules apply and the 3dj starters already cover boxes, snap fits and heat-set bosses.
8. **A stage may be skipped, never faked.** A maker going from brief to print skips ideation and CMF; each skip is a human `stage_skip` approval with a reason, so the ledger shows them as skipped.

## 2. The pipeline at a glance

| # | Stage | Slice and step | Heavy work runs on | Human approves |
|---|---|---|---|---|
| 1 | Brief | ID-0: playbook S0, formal S5 | CPU (light) | Brief |
| 2 | Research | ID-0 input, S0 and S5 | CPU (light); reconstruction on the pull board | Which findings enter the brief |
| 3 | Ideation | ID-1, S8a | Local GPU sidecar; CPU (stable-diffusion.cpp, slow preview); cloud GPU with approval | Directions to develop |
| 4 | Concept 3D | ID-1, S8b | Generation on local CUDA GPU or cloud; without either, DSL massing (or TripoSR, once audited) on the CPU; rebuild on CPU | Direction |
| 5 | Form and surfacing | ID-2, S9 | CPU (record); GPU viewer shading | Form |
| 6 | CMF | ID-2, S9 | Cycles on GPU, or CPU | CMF |
| 7 | Ergonomics | Pulled into S8b by a handheld brief | CPU | Ergonomics, from a printed mock-up |
| 8 | Visualisation | S1, S2, S4, S6, S9 | CPU HLR; GPU viewer; Cycles GPU or CPU | Hero renders (no approval object) |
| 9 | Prototyping | ID-0, S3 and S5 | CPU gates and slicer; GPU screening from S7a | Design freeze, quote |
| 10 | DFM and DFA | FDM S3, DFA S4, moulding ID-3 S10 | CPU verdicts; GPU-screened ray casts | Human-only waivers |
| 11 | Engineering detail | ID-4, S4, S6, S11 | CPU only | Tolerance scheme |
| 12 | Validation | ID-4, S11 | CPU (CalculiX); GPU simulation on the pull board | Reading of results |
| 13 | Drawings and handoff | ID-5, S12 | CPU (HLR) | Each drawing |
| 14 | RFQ and production | ID-5 S12; ID-6 research lane | CPU (light) | Every RFQ and every order |

## 3. Stage by stage

### 3.1 Brief (ID-0; playbook in S0, formal in S5)

- **Agent:** turns the conversation into `brief.o3j.yaml`: purpose, environment, interfaces, critical dimensions, process, material and quantities. A clarify pass lists what is missing before anyone models. Each requirement that can be measured becomes an executable assertion, for example a minimum PCB clearance or a maximum envelope.
- **Human approves:** the brief.
- **Tools:** `run ops=[{op: "set_brief"}]` (returns the clarify list); `inspect fields=[assertions]` after every later change; `run ops=[{op: "request_approval", kind: "brief"}]`.
- **Evidence:** the brief with a confidence label on every input dimension and a `sources` list; the approval record with its payload hash.
- **Open source:** none beyond the core. Before S5 the brief is a Markdown file in the 3dj.app playbook (S0).

### 3.2 Research (input to ID-0)

- **Agent:** summarises what the human supplies (interviews, competitor pages, teardown photos) into the brief's cited `sources`. Dimensions taken from photos are "observed" or "assumed", never "measured".
- **Human approves:** which findings enter the brief, within the brief approval.
- **Tools and compute:** the agent's own search tools; no new Open3DJ feature; CPU only. Scan reconstruction waits on the pull board: COLMAP sparse reconstruction on the CPU; dense MVS and gsplat on a GPU or a cloud provider with approval.

### 3.3 Ideation (ID-1, S8a)

- **Agent:** writes prompts from the approved brief, generates N concept images, and lays them out as a concept board. A scanned hand sketch can be passed as a reference image where the model supports it (to verify per model).
- **Human approves:** one to three directions to develop. Taste stays human.
- **Tools:** `run ops=[{op: "generate", kind: "gen.image"}]`; `render view=board`. Hosted tools such as Vizcom only through the user's own account and an egress approval.
- **Evidence:** every image records prompt, model, licence manifest, seed and backend, labelled "concept, not geometry".
- **Open source:** FLUX.1 schnell and Qwen-Image (Apache-2.0) in the `uvx` Python sidecar with PyTorch, or as quantised GGUF weights in stable-diffusion.cpp (MIT) on the CPU. Each GGUF file, and other checkpoints and LoRAs in these families, need their own manifest check.
- **Compute:** local GPU sidecar (CUDA, MPS, ROCm, XPU). Without a capable GPU, the `cpu.sdcpp` backend runs the same models on the CPU; it is slow, so its images are an advisory `preview` and the approval card shows a time estimate. `auto` picks it when no capable GPU exists and egress is `never`, or when the user prefers it; otherwise a cloud GPU with approval is an option ([COMPUTE.md](COMPUTE.md) section 2).

### 3.4 Concept 3D and massing (ID-1, S8b)

- **Agent:** turns the chosen image into a massing mesh, then rebuilds it as an editable assembly: shells, window, buttons and battery door as separate definitions and occurrences, using `loft`, `Shape.fromSlices` and splines. It reports the Hausdorff distance between the rebuild and the mesh. For simple boxes it skips generation and writes the massing directly from the brief.
- **Human approves:** the direction.
- **Tools:** `run ops=[{op: "generate", kind: "gen.massing"}]`; `run` with scripts; `inspect fields=[measure, tree]`; `render view=multiview`.
- **Evidence:** mesh hash, model manifest, Hausdorff distance, all labelled "assumed".
- **Open source:** TRELLIS v1 geometry-only through the clean runner. Its licence manifest lists every component from the [research/gap-4.md](research/gap-4.md) audit: TRELLIS code and weights MIT; DINOv2, spconv, kaolin and FlexiCubes Apache-2.0; rembg MIT with u2net Apache-2.0; easydict LGPL-3.0 (an unmodified Python dependency in the sidecar process); the rest MIT, BSD or Apache-2.0; no territory limits found by the four-layer gate. TripoSR (MIT) is a candidate local mesh backend for machines without CUDA, once a gap-4-style four-layer audit of its chain passes (to verify). TripoSG, TRELLIS.2 and Hunyuan3D only as opt-in restricted packs.
- **Compute:** TRELLIS v1 needs CUDA, and its upstream minimum is a 16 GB card. It places locally only where its declared peak fits within 90% of free VRAM, in practice a 24 GB or larger card, or a 16 GB card only if its measured peak fits (to verify in S8b) ([COMPUTE.md](COMPUTE.md) section 3.3), so most laptops place it on the user's own cloud endpoint (Modal, RunPod) or 3dj.app with approval. 3dj.app takes text, or an image at a public HTTPS URL; publishing a local board there is its own egress approval until proposal P-1's upload ships ([PLAN.md](PLAN.md) section 9). With no capable GPU and no cloud allowed, the agent builds the massing directly in the DSL from the approved board on the CPU pool, labelled "assumed", as it does for simple boxes. Once audited, TripoSR can produce a mesh on the CPU instead, labelled `preview` and "assumed". A structured refusal comes back only when the user insists on a generated mesh and no local mesh backend is cleared. The rebuild runs on the CPU pool.

### 3.5 Form development and surfacing (ID-2, S9)

- **Agent:** develops the massing into production form with lofts and sweeps with continuity options, N-sided filling with G1 or G2 constraints, and Gordon networks. It reads the continuity table and fixes edges over threshold. It declares a pull direction early and reads the advisory draft and wall overlays, so draft is designed into freeform faces rather than added later.
- **Human approves:** the form, from zebra and curvature views in the viewer.
- **Tools:** DSL entries `fill` and `gordon` in part scripts; `inspect fields=[continuity]`; `inspect fields=[maps] maps=[draft, wall] pull=[0,0,1]`; `render view=zebra | curvature | map`.
- **Evidence:** per shared edge, the G0 gap, G1 angle and G2 curvature jump; curvature range per face; `G2Error` and `IsApproximate` results (a surface is rejected if either check fails).
- **Open source:** OCCT 8.0.1 through occt-wasm (LGPL-2.1, separate `.wasm`); three.js (MIT) shaders. Whether the occt-wasm facade already exposes MakeFilling and Gordon is to verify; if not, the S9 work includes a facade contribution. Guided and binormal sweeps give wrong volumes on OCCT 8.0.1 (OCCT #1681, unfixed; [research/gap-3.md](research/gap-3.md)), so until a fix ships those modes return a structured warning and a seeded regression test checks their expected volume.
- **Compute:** surfaces, continuity numbers and map verdicts on the CPU. Zebra and curvature shading on the GPU viewer is advisory; CPU renders serve CI.

### 3.6 CMF (ID-2, S9)

- **Agent:** writes `cmf.o3j.json` per occurrence: colour as sRGB or Lab, resin grade, finish class as text (an SPI or VDI 3400 class name), texture depth. It proposes three to five variants and renders them. Texture depth feeds the draft rule in S10.
- **Human approves:** CMF, checked against physical sample chips recorded in the prototype record as "measured".
- **Tools:** `run ops=[{op: "set_cmf"}]`; `render view=cmf`; `export format=gltf` with `KHR_materials_variants`.
- **Evidence:** CMF sheet, variant renders with scene hash and renderer version.
- **Open source:** Cycles inside an official Blender build, run in background mode (`blender -b`) as a GPL subprocess from the user's install or an on-demand download (Cycles code is Apache-2.0; the Cycles repository publishes no binaries, so Open3DJ does not build it, [ARCHITECTURE.md](ARCHITECTURE.md) section 11); glTF. No Pantone libraries: users attach their own reference names to numeric colours. STEP exports carry colours, but colours did not read back on STEP import in the spike ([ASSEMBLIES.md](ASSEMBLIES.md) section 12), so the CMF sheet, not STEP colour, is the supplier's reference.
- **Compute:** Cycles on CUDA, OptiX, HIP, oneAPI or Metal, otherwise Cycles on the CPU; a cloud render only with approval. Official Blender builds cover Windows x64 and ARM64, macOS arm64 and Linux x64; on Linux ARM64 a `cmf` render needs a distribution's Blender package (to verify), otherwise CMF review uses the viewer's glTF material variants.

### 3.7 Ergonomics (pulled into S8b by a handheld brief)

- **Agent:** checks grip and reach envelopes against ANSUR II percentiles under an advisory `ergo.ansur2.v1` gate profile (name proposed), recording dataset and population on every result. Results are "inferred", because ANSUR II describes US military personnel, not civilians.
- **Human approves:** ergonomics, after holding a printed mock-up from the S5 loop. Physical mock-ups decide; the envelope check only flags.
- **Open source:** ANSUR II public data (terms to verify). MPFB (GPL-3.0 code, CC0 assets) only as a Blender-side tool. SMPL-X never.
- **Compute:** CPU.

### 3.8 Visualisation (S1, S2, S4, S6, S9)

- **Agent:** renders multiview, section, highlight, exploded (S4) and motion (S6) views for its own checks and CI, and photoreal views from S9. Each render records revision, view, CMF variant and backend.
- **Human approves:** picks hero renders; sharing them is the human's act.
- **Tools and open source:** `render`; the viewer (S2); occt-wasm HLR, three.js r186 `WebGPURenderer`, Cycles.
- **Compute:** HLR on the CPU (byte-identical, record); viewer on WebGPU, then WebGL2, then the CPU HLR image view; Cycles on the GPU or CPU.

### 3.9 Prototyping (ID-0; gates S3, loop S5)

- **Agent:** runs `fdm.v1` gates on each printable definition, fixes or waives agent-waivable failures with a reason, lays out per-part 3MF print plates, and gets a slicer estimate. After printing it records photos and calliper readings. Each failed fit drafts an eval task and a 5-whys stub.
- **Human approves:** design freeze (pins the revision and Evidence Pack hash; lists declared fits and waivers), quote acceptance; prints, measures and handles the part.
- **Tools:** `inspect fields=[gates] gates=fdm.v1`; `run ops=[{op: "waive"}]`; `run ops=[{op: "request_approval", kind: "freeze"}]`; `export format=plates`; `export format=quote`; `run ops=[{op: "record_prototype"}]`.
- **Evidence:** Evidence Pack, freeze record, quote, prototype record.
- **Open source:** OrcaSlicer (AGPL-3.0, subprocess only, never linked); lib3mf (BSD-2-Clause) or an own 3MF writer; three-mesh-bvh (MIT) for wall rays.
- **Compute:** gate verdicts on the CPU pool; wall maps screened on the GPU from S7a with CPU confirmation; slicer as a CPU subprocess. A 3dj.app operator quote needs proposal P-1 (upload and evidence-hash fields) and the S7b provider router with its egress approval; until then the OrcaSlicer estimate covers ID-0 ([research/gap-9.md](research/gap-9.md)).

### 3.10 DFM and DFA, by process

- **Agent:** runs the gate profile for the target process, fixes defects, uses the `draft` DSL entry on planar, cylindrical and conical faces, sends freeform draft failures back to stage 5, and waives only agent-waivable gates with a reason.
- **Human approves:** human-only waivers.
- **Evidence:** each verdict names its profile version, the cited public rule and a confidence label, under "rule check, not simulation".
- **Compute:** verdicts on the CPU; dense ray casts screened by WGSL kernels in `@open3dj/accel-webgpu` with CPU confirmation inside the guard band. A verdict that rests on GPU-cleared samples is a `preview` until a `record` request (design freeze, export gates, RFQ) recomputes those samples on the CPU ([COMPUTE.md](COMPUTE.md) section 6).

| Process | Profile and checks | Step | Open components |
|---|---|---|---|
| FDM | `fdm.v1`: watertight, 0.8 mm wall, 45 degree overhang, 220 x 220 x 250 mm bed | S3 | three-mesh-bvh (MIT), Manifold (Apache-2.0) |
| Injection moulding | `im.abs.v1`, `im.pc.v1`, `im.pp.v1`, `im.pa.v1`: draft against depth and texture, wall range per resin, ribs 40 to 60% of wall, boss rules, undercuts by ray casting, parting-line candidates from HLR silhouettes, sharp corners, sink risk | S10 | occt-wasm (`BRepOffsetAPI_DraftAngle`, HLR); own rules from cited public guides |
| Assembly (DFA) | From the graph: part count, fastener count and variety, Replicate patterns, exploded steps as assembly order, declared fits, thread engagement | S4 | own code |
| SLA, SLS, MJF, CNC, sheet metal | No profile yet; added through the gate-profile plugin point when a named project pulls it. CAM via Kiri:Moto (MIT) or FreeCAD CAM (GPL, subprocess); sheet metal via FreeCAD SheetMetal (LGPL-2.1, inside FreeCAD); DXF via ezdxf (MIT) | Pull board | as listed |
| Casting, tooling | No profile; ID-6 research lane | none | none |

Rules are written from public guidance with a citation and version, never copied from paid ISO text. Each new profile ships with a seeded-defect corpus; a false pass is a red andon.

### 3.11 Engineering detail (ID-4; S4, S6, S11)

- **Agent:** mates connectors, replicates fasteners onto bosses, declares press and thread fits, keeps part numbers, resolves every under-constrained occurrence, adds joints for lids and buttons (S6), and runs worst-case and RSS tolerance stacks along mate chains (S11) using the ISO 20457 class name the user enters.
- **Human approves:** the tolerance scheme and datum choice.
- **Tools:** `run ops=[add_mate, pattern, declare_fit, set_joint, set_bom]`; `inspect fields=[dof, fits, bom, tolerances]`; `render view=exploded | motion`.
- **Evidence:** DOF and mate status, the clash, contact and clearance table, BOM CSV, tolerance stack report.
- **Open source:** own solver (Open3DJ's own code: MIT today; MIT OR Apache-2.0 proposed, [PLAN.md](PLAN.md) section 11 decision 2); occt-wasm; Manifold.
- **Compute:** CPU only: closed-form and LM solving, exact fits. The S7a GPU fit pre-check is advisory and pays off only on large assemblies (hypothesis H2 in [ASSEMBLIES.md](ASSEMBLIES.md)).

### 3.12 Validation (ID-4, S11)

- **Agent:** sets up static, modal and thermal studies with mesh-convergence evidence, compares them with analytic benchmarks, and writes a physical drop-test protocol whose results go into the prototype record.
- **Human approves:** the reading of every simulation (a `sim_reading` approval); performs drop tests.
- **Tools:** `inspect fields=[sim]` (a job; poll with `inspect fields=[job]`); `export format=mjcf` for mechanisms with loops.
- **Evidence:** convergence table and results labelled "simulation, not test"; drop-test records labelled "measured".
- **Open source:** CalculiX 2.23 (GPL-2.0) and Elmer (GPL-2.0 and LGPL-2.1) as subprocesses. The volume mesher is to verify (Gmsh is a candidate; its licence is to verify).
- **Compute:** CalculiX on the CPU, or on a cloud provider with approval. GPU simulation (Warp FEM, PETSc) waits on the pull board for its trigger: CalculiX p95 over budget on real studies.

### 3.13 Drawings and handoff (ID-5, S12)

- **Agent:** generates HLR drawing sheets with title block and only the critical dimensions taken from brief assertions, and AP242 with semantic PMI for the same dimensions.
- **Human approves:** each drawing.
- **Tools:** `export format=drawing` (SVG, PDF); `export format=ap242`.
- **Evidence:** drawings and AP242 tied to the design-freeze hash.
- **Open source:** occt-wasm HLR. AP242 PMI needs an occt-wasm facade contribution, because today's writer emits AP214.
- **Compute:** CPU.

### 3.14 RFQ and production (ID-5 in S12; ID-6 research lane)

- **Agent:** builds the RFQ pack only from a design freeze: STEP, drawings, CMF sheet, BOM, quantities, Evidence Pack and an open-questions list. It compares returned quotes in a table and turns every supplier question into a failure report, so the next pack answers it.
- **Human approves:** sends every RFQ, chooses the supplier, places every order. Open3DJ never orders.
- **Tools:** `export format=rfq`; `inspect fields=[quotes]`.
- **Evidence:** RFQ pack hash, quote table, supplier questions.
- **Open source and compute:** CPU only. Only Shapeways publishes a public quoting API; most suppliers take web uploads, so the human uploads the pack ([research/formats-interop-manufacturing.md](research/formats-interop-manufacturing.md)). Tooling liaison, T1 sample measurements as QIF 3.0 and Moldflow interop for licence holders stay in ID-6.

## 4. Worked example: a handheld remote, brief to moulding handoff

This uses the handheld enclosure from [ASSEMBLIES.md](ASSEMBLIES.md) section 16. Numbers are illustrative. Part A runs at S5 capability; part B needs S12.

### Part A: brief to printed prototype (S5)

The founder asks Claude Code for a two-button handheld remote around a client's 60 x 40 mm PCB, three FDM prototypes, then 5,000 in ABS.

```yaml
# brief.o3j.yaml (excerpt)
product: handheld remote, two buttons, status LED
quantity: {prototype: 3, production: 5000}
process: {prototype: fdm, production: injection_moulding}
material: {production: ABS}
interfaces:
  pcb: {size_mm: [60, 40, 1.6], source: client drawing, confidence: measured}
assertions:
  - {id: A1, check: clearance, a: pcb#1, b: top_shell#1, min_mm: 0.3}
  - {id: A2, check: envelope, max_mm: [120, 50, 25]}
  - {id: A3, check: mass, max_g: 90}
```

| # | Agent does | Result | Human | Runs on |
|---|---|---|---|---|
| 1 | `set_brief`; clarify pass asks for battery type and button travel | Two answers added; brief approval pending | Approves brief | CPU |
| 2 | Writes `parts/shells.o3j.js` from the enclosure template with `lib.screwBoss`, `lib.heatSetPocket`, `lib.snapFit`; buttons, light pipe | Assembly of 14 occurrences, 7 definitions | none | CPU pool |
| 3 | `run` ops from ASSEMBLIES.md section 16: mates, Replicate inserts and screws | Report: light pipe clashes with PCB by 0.9 mm³; button gap 0.08 mm | none | CPU, exact fits |
| 4 | Sets `lp_length` 8.6 mm, `btn_gap` 0.25 mm; mates `button#2` | No clashes; A1 to A3 pass | none | CPU |
| 5 | `inspect fields=[gates] gates=fdm.v1` | Boss rim wall 0.72 mm fails; agent sets it to 1.0 mm | none | CPU verdict (GPU screen if S7a pack installed) |
| 6 | `request_approval kind=freeze` | Freeze page shows BOM, fit table, two declared fits, zero waivers | Approves freeze | CPU |
| 7 | `export format=plates`, `export format=quote` | Two plates; OrcaSlicer estimate 3 h 10 min, 41 g | Accepts estimate, prints | CPU subprocess |
| 8 | `record_prototype` from photos and calliper readings | Button sticks: hole measured 0.12 mm undersize | Measures and handles | CPU |

`lib.heatSetPocket` in step 2 is a DSL feature cut into the shell; `heat_set_insert`, placed by Replicate in step 3, is the C6 library part that sits in it. DSL calls keep the 3dj camelCase names and library part ids are snake_case ([ASSEMBLIES.md](ASSEMBLIES.md) section 8).

Step 8 is a failure, so it becomes learning: the 5-whys stub traces it to FDM hole shrinkage that `fdm.v1` does not model; the root cause is a missing hole-compensation check. A bench task and a proposed `fdm.v1` hole allowance (with citation) land before the issue closes, and the second print fits.

### Part B: concept, form and moulding handoff (S8a to S12)

| # | Stage | Agent does | Human | Runs on |
|---|---|---|---|---|
| 9 | Ideation | Eight FLUX.1 schnell boards from the brief | Picks two directions | `cloud.modal` with approval: the 12B model's declared peak VRAM does not fit within 90% of the laptop's 8 GB RTX 4060 ([COMPUTE.md](COMPUTE.md) section 3.3, rule 5); with egress `never`, `cpu.sdcpp` on the CPU as a slow preview |
| 10 | Concept 3D | TRELLIS v1 massing for direction 2; rebuild as shells plus buttons; Hausdorff 1.8 mm | Approves direction | `cloud.modal` with approval (TRELLIS does not fit the 8 GB card); rebuild on CPU |
| 11 | Form | Replaces the box top with a G2 filled surface; continuity table shows a 3.1 degree G1 break at the button island; fixed to 0.2 degrees | Approves form in the zebra view | CPU numbers, GPU shading |
| 12 | CMF | Three variants: matte black ABS with VDI 3400 texture class, two colourways | Approves variant 1 against chips | Cycles OptiX |
| 13 | Moulding DFM | `im.abs.v1`, pull along Z: textured side wall has 0.4 degree draft, one rib is 75% of wall, one snap hook is an undercut. Draft raised in the form script, rib thinned, the snap listed as a side-action question for the moulder | Approves one human-only waiver (cosmetic sink risk at a boss) | Draft on CPU; wall and undercut rays on GPU, CPU-confirmed |
| 14 | Engineering | Tolerance stack on button-to-shell gap: worst case 0.05 to 0.45 mm, RSS 0.16 to 0.34 mm with the entered ISO 20457 class | Approves tolerance scheme | CPU |
| 15 | Validation | CalculiX static on the snap hook with convergence over three meshes; drop-test protocol for a printed set | Reads results; drops prototypes | CPU subprocess |
| 16 | Handoff | Two drawing sheets with five critical dimensions; AP242 with PMI | Approves drawings | CPU |
| 17 | RFQ | RFQ pack with the snap undercut listed as an open question | Sends to three moulders; later chooses | CPU |

Every supplier question in step 17 becomes a failure report, and the next pack answers it. That is the G9 measure.

## 5. What open tools cannot do yet

| Gap | Today | What Open3DJ does instead |
|---|---|---|
| Class-A surfacing (G3, highlight-line control, control-point layout) | No open Class-A modeller; Alias, Rhino and Plasticity lead | Continuity numbers and zebra views; ID-6 research lane with volunteer designers; users may round-trip through their own licensed tools via STEP |
| Draft on freeform faces | OCCT `DraftAngle` handles planar, cylindrical and conical faces only; drafting Gordon and filled faces is untested | Flag the face, send it back to form development with the pull direction |
| Moulding flow, pack, warp and cooling | openInjMoldSim (GPL-3.0) calls itself impractical for industrial use; Moldflow is commercial | Rule checks labelled "rule check, not simulation"; Moldflow only as a user-licensed sidecar (ID-6) |
| Drop and impact | OpenRadioss is being wound down by Siemens: its website is being retired and its GitHub repository returned 404 in October 2026 ([research/industrial-design.md](research/industrial-design.md)); CalculiX explicit is unvalidated for drop | Physical drop tests on prototypes |
| Mould design (gates, cooling, ejection, slides) | No open tool | Open questions in the RFQ; the moulder owns it |
| Human models | SMPL-X is non-commercial; ANSUR II is military and its scans are withheld | Percentile envelopes, labelled "inferred"; physical mock-ups decide |
| Colour standards | Pantone is licensed | Numeric colour only |
| AP242 semantic PMI | occt-wasm writes AP214 today | Facade contribution in S12 |
| Image-to-3D on non-NVIDIA machines | TRELLIS v1 is CUDA-only, upstream minimum a 16 GB card; no PyTorch wheel for Windows ARM64. TripoSR (MIT, about 6 GB on CUDA) has a CPU fallback through torchmcubes ([research/compute-local-and-cloud.md](research/compute-local-and-cloud.md)), but its chain is not yet licence-audited | Cloud placement with approval, or the agent builds the massing in the DSL on the CPU ("assumed"); TripoSR on the CPU (or MPS, to verify) as a `preview` mesh once its four-layer audit passes; a structured refusal only if that audit fails and the user insists on a generated mesh with no GPU and no cloud allowed |
| Certification (UL, CE, food contact) | Out of scope for any CAD tool | Open questions for the human |

## 6. Kaizen: one metric per stage

Each metric joins the Friday scorecard once its step ships, as a secondary indicator, not a gate; step gates are in PLAN.md section 6. Lead times, review rounds and render minutes come from approval and provenance timestamps; fit rates, test results and corpus counts come from the prototype record, the bench and failure reports. Four metrics need a human, so each is a single field, not a form: requirement changes (a count on the brief re-approval page), handling problems (a field in the prototype record), drawing corrections (a count on the drawing approval page) and supplier questions (one line each, entered with the returned quote). The S0 baseline on 3dj.app has no Open3DJ timestamps, so it is filled in by hand in the value-stream template from [PLAN.md](PLAN.md) section 12, issue 16 (stage, start, end, rework count). The Wednesday gemba walks one real project stage by stage.

| # | Stage | Kaizen metric | Andon trigger (PLAN.md section 4.4) |
|---|---|---|---|
| 1 | Brief | Requirement changes after brief approval, per project | An assertion that passes while its measured value breaks it |
| 2 | Research | Share of critical brief dimensions labelled measured or observed at approval | A dimension labelled "measured" with no measurement behind it |
| 3 | Ideation | Hours from approved brief to chosen directions (S8a) | Output from a restricted model without opt-in; egress without approval |
| 4 | Concept 3D | Hours from approved brief to approved direction (S8b) | Generated geometry not labelled "assumed" |
| 5 | Form | Review rounds until form sign-off (S9) | A surface accepted with a failed `G2Error` or `IsApproximate` check |
| 6 | CMF | Review rounds per CMF variant set (S9); render minutes are tracked as context, not as the metric | A CMF render used as evidence of a physical finish |
| 7 | Ergonomics | Handling problems found on the printed mock-up that the envelope check missed | A check with no dataset or population recorded |
| 8 | Visualisation | Viewer-only defects per week (S2) | A non-deterministic CPU render in CI |
| 9 | Prototyping | First-print fit rate (S5, at least 80% over 10 prints) | A false gate pass found on a printed part |
| 10 | DFM and DFA | Share of seeded DFM defects fixed by the agent without help (S10); DFM escapes reported by suppliers are tracked as context from S12, when RFQs reach suppliers | Any false pass on a seeded corpus; a verdict of record resting on GPU output |
| 11 | Engineering | Seeded mate and fit faults named (S4) | A conflicting mate ignored; a silent reference mis-resolution |
| 12 | Validation | Share of the S11 validation corpus reported correctly (S11, the same metric as [PLAN.md](PLAN.md) S11); divergence between prototype tests and simulation is tracked as context | A simulation result without convergence evidence |
| 13 | Drawings | Corrections requested by the human before drawing approval | A drawing not tied to the freeze hash |
| 14 | RFQ | Supplier clarification questions per RFQ (S12, G9) | An RFQ pack built from an unfrozen revision |

These triggers belong to the single andon list in [PLAN.md](PLAN.md) section 4.4. Inside a user's project each one is a project andon: the daemon raises it where a check can detect the fault, or the agent or a human raises it; the project's design freeze, exports and RFQ are blocked until it is fixed or waived by a human, and a failure report is filed for triage. The same fault found in CI or on a seeded corpus is a repo andon, and egress without an approval is always also a repo andon, because it is a security failure.

Failures follow PLAN.md section 4.5 (reproduce, ask why until a missing check appears, add the check). Failed prints, rejected renders and supplier questions count, and finding one is thanked. From S5 the stage with the longest lead time or most rework may reorder S8a to S12 (PLAN.md section 5).
