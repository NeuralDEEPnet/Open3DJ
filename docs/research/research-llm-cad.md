# State of the art: LLM/VLM-driven CAD generation, reconstruction and agentic iteration (2024-2026)

Research dimension for Open3DJ. Date of review: 2026-10-27. Everything below was checked against primary sources (arXiv pages/HTML, GitHub LICENSE files, Hugging Face cards, vendor docs) on that date; where only a secondary summary was available this is flagged.

## Executive summary

Between 2024 and 2026 the field converged on one practical answer to "how should a language model talk to a CAD kernel": **executable script code over an OpenCascade (OCCT) kernel, mostly CadQuery or build123d Python, run in a sandbox, with the kernel's own measurements fed back to the model**. Every major 2025-2026 reconstruction model (CAD-Recode, cadrille, CAD-Coder, CADEvolve, CADFit), every major agent paper (CADSmith, CADDesigner, ProCAD, CAD-Assistant) and every serious benchmark (CADBench, BenchCAD, Text2CAD-Bench, MUSE, CADTestBench, CAD-bench) uses this form; Text2CAD-Bench's ablation shows frontier LLMs produce 1.5-2x more invalid outputs when forced into DeepCAD-style command sequences instead of CadQuery. Token-sequence models (Text2CAD, CADFusion, CAD-GPT) achieve very low invalidity but poor fidelity on real prompts and cannot escape the sketch-extrude vocabulary; direct B-rep diffusion (BrepGen, HoLa) reaches only 50-82% validity and produces non-parametric shapes, so it is a reverse-engineering prior, not an agent interface. Measured success is still low: the best frontier VLM on CADBench reaches 0.31 IoU with 81% valid-shape rate (vs 0.90 IoU for the optimization-based CADFit); on Text2CAD-Bench the best models fail 68-70% of hard (L3) prompts; GUI agents in FreeCAD (CADWorld) succeed on 17.5% of tasks vs 87% for humans; and the top agentic score on Parametric CAD Bench V3 is 61/100 at $574 per run. What moves the needle is feedback: exact kernel measurements plus a VLM judge in a loop cut mean Chamfer distance from 28.4 to 0.74 (CADSmith), a clarification step cut invalidity from 4.8% to 0.9% (ProCAD), FEA feedback raised Box-IoU from 0.44 to 0.59 (Hephaestus), and executable requirement tests beat Chamfer-based metrics (CADTests). The licensing picture is mixed: cadrille (Apache-2.0), CADmium (Apache-2.0 models, MIT data), DeepCAD/ABC/Omni-CAD (MIT), CADBench and CAD-bench (MIT) are safe to ship with; CAD-Recode weights, Text2CAD, CADFit are CC BY-NC; Fusion 360 Gallery is non-commercial research only; Hunyuan3D 2.1 excludes the EU, UK and South Korea. For Open3DJ this implies: a deterministic script DSL over OCCT as the primary agent surface, a parallel JSON feature-tree/IR for editing and diffs, a tiered feedback stack (structured errors, geometry info, multi-view renders and sections, geometric diffs, spec tests, optional physics) exposed as MCP tools, and a CadQuery/build123d-compatible local runtime so the open model zoo runs unmodified.

## 1. The four families of approaches and where each stands

### 1.1 Token/command-sequence models (2021-2025)

DeepCAD (Wu et al., ICCV 2021) defined the modern "CAD as a sequence of sketch+extrude commands" representation and released 178,238 sequences parsed from Onshape public documents via the ABC dataset; code is MIT, the data carries no explicit license beyond Onshape's terms (github.com/ChrisWu1997/DeepCAD). Text2CAD (Khan et al., NeurIPS 2024 spotlight, DFKI) added ~660K text annotations (generated with Mistral + LLaVA-NeXT) to ~170K DeepCAD models and trained an autoregressive transformer; code, annotations and a v1.0 checkpoint are public but under a "Text2CAD Community License" that is CC BY-NC-SA 4.0 (github.com/SadilKhan/Text2CAD/blob/main/LICENSE). CAD-GPT (AAAI 2025; LLaVA-1.5-7B with explicit 3D position/rotation tokens) reports image-to-CAD invalidity 1.61% / median CD 9.77 vs GPT-4's 64.4% / 62.6, and text-to-CAD invalidity 7.43% vs GPT-4's 77%; weights were "planned" for release but are not confirmed (arxiv.org/html/2412.19663v2). CAD-MLLM (2024) and its Omni-CAD dataset (~450K instances with text, multi-view images, point clouds and command sequences; MIT on Hugging Face) is useful data, but inference/training code is still unreleased and the repo has no license. CADFusion (Microsoft, ICML 2025) alternated sequence learning with visual-feedback RL; CAD-Llama (CVPR 2025) wrapped sequences in a code-like "Structured Parametric CAD Code".

Verdict: on Text2CAD-Bench (May 2026), the dedicated sequence models (Text2CAD, CADFusion, Text2CADQuery) score mean CD of roughly 190-280 (x10^3) across all tiers while general LLMs writing CadQuery score 44-150; Text2CAD's invalidity is low (2-11%) but CADFusion's is 51-70%. These models are stuck in a sketch-extrude vocabulary and do not transfer to fillets, shells, patterns, lofts or assemblies.

### 1.2 Code-generating models (2024-2026): the winning family

- CAD-Recode (Rukhovich et al., ICCV 2025; Luxembourg + Artec3D) is the key result. A Qwen2-1.5B decoder with a tiny point-cloud projector (256 FPS points, Fourier encoding, one linear layer), trained on procedurally generated CadQuery programs (1M in the abstract, 11M in Table 1), trained in ~12 h on one H100. Results on DeepCAD: mean CD 0.30, IoU 92.0%, invalidity 0.4% (vs CAD-SIGNet 3.43 / 77.6% / 0.9%); on real-world CC3D scans: mean CD 0.76, IoU 74.2% (vs 42.6%). Test-time best-of-10 with CD scoring is what drives invalidity to near zero. The generated code is also readable by other LLMs: GPT-4o answers CAD questions 76.5% correctly from CAD-Recode code vs 42.3% for PointLLM. Code and the ~2B-parameter weights are released but CC BY-NC 4.0 (github.com/filaPro/cad-recode, huggingface.co/filapro/cad-recode-v1.5).
- cadrille (ICLR 2026 oral, same group): Qwen2-VL-based, takes point clouds, images and text, outputs CadQuery; SFT on procedural data, then online RL (GRPO) with programmatic geometric reward; SOTA on 10 benchmarks. Apache-2.0 with SFT and RL weights on Hugging Face (github.com/col14m/cadrille). On CADBench: IoU 0.555, CD 0.062, valid-shape rate 94.5%.
- CAD-Coder (MIT, Doris et al., 2025): LLaVA-style 13B VLM fine-tuned on GenCAD-Code (163K image/CadQuery pairs); 100% syntax validity on its 100-sample test and better solid similarity than GPT-4.5 and Qwen2.5-VL-72B; code Apache-2.0, HF weights have no model card license. A different, same-named CAD-Coder (NeurIPS 2025, arXiv 2505.19713) does text-to-CadQuery with SFT + GRPO using a Chamfer-based reward and reports invalidity 1.45% vs Text2CAD 3.75% (figures from the AlphaXiv summary; not verified in the paper body).
- CADEvolve (Feb 2026): evolves ~8K CadQuery parametric generators into 1.3M scripts via VLM-guided edits and reports SOTA Image2CAD on DeepCAD/Fusion360/MCB; the dataset license was not verifiable.
- CADFit (MIT + Siemens, ICML 2026): not a neural generator but an IoU-driven hybrid optimizer that fits CadQuery operations (extrude, revolve, fillet, chamfer) step by step with kernel feedback. It tops CADBench (IoU 0.895, CD 0.038, VSR 1.000) but is CC BY-NC 4.0 with a provisional patent (github.com/ghadinehme/CADFit).
- CADmium (Mila, TMLR 2026) is the counter-example that tested a minimal JSON feature format: Qwen2.5-Coder 1.5B-14B LoRA on 176K DeepCAD models re-captioned by GPT-4.1 from JSON plus 10 Blender renders. On CADPrompt its 14B model gets slightly better median CD than Text2CAD (116.8 vs 127.7) but worse invalidity (6.3% vs 1.6%) and watertightness (83.8% vs 95.7%). Dataset MIT, models Apache-2.0 (github.com/chandar-lab/CADmium).

### 1.3 Direct B-rep generation

BrepGen (SFU + Autodesk, SIGGRAPH 2024) diffuses a structured latent tree of faces/edges/vertices; code GPL-3.0 with DeepCAD and ABC checkpoints. HoLa (SIGGRAPH 2025 / TOG) encodes geometry and topology in one latent and reaches 82% validity vs ~50% for prior methods, conditioned on point clouds, images, sketches or text; only a Hugging Face Space exists, no license found. These produce non-parametric B-rep without a feature history, so they are candidates for a "shape prior" in reverse engineering, not for agent iteration.

### 1.4 Agentic, tool-augmented systems

- 3D-GPT (2023) and blender-mcp (now ahujasid/mcp-for-blender, MIT, 32.5K stars) established the "LLM writes Python against a live 3D app, then looks at renders" pattern. mcp-for-blender exposes nine tools: execute_blender_code, get_scene_info, look (viewport/camera/multi-angle renders), search/import assets (Poly Haven, Sketchfab, Poly Pizza), and generate_3d via Tripo/Hunyuan3D/Hyper3D/Meshy. This is the most-adopted 3D MCP server and the UX bar for Open3DJ.
- CAD-Assistant (ICCV 2025): training-free GPT-4o planner over the FreeCAD Python API with sketch parameterizer, renderers and 2D cross-section tools; adapts subsequent steps to how geometry actually changed.
- CADCodeVerify (ICLR 2025) introduced CADPrompt (200 expert CadQuery programs) and VLM self-question-answer verification; it improved GPT-4's point-cloud distance by 7.3% and compile rate by 5.5%. The authors explicitly chose CadQuery over OpenSCAD because Python is better covered in pretraining and yields more concise code.
- CADDesigner (2025): six multi-view snapshots, a visual question generator and feedback generator, RAG over API docs, and a new explicit-state API (ECIP/SimpleCADAPI) with structured errors (cause, location, suggested fix).
- CADSmith (CMU, Mar 2026): CadQuery with RAG, an inner loop on execution errors and an outer loop on exact OpenCASCADE measurements (bbox, volume, solid validity) plus an independent VLM judge. On 100 prompts in three tiers: execution 95% to 100%, median IoU 0.81 to 0.96, mean CD 28.37 to 0.74. The paper states that visual feedback alone cannot resolve numeric errors.
- ProCAD (Feb 2026): a clarifying agent that asks about missing/conflicting dimensions before a CadQuery coding agent runs; mean CD -79.9%, invalidity 4.8% to 0.9%, beating Claude Sonnet 4.5 (github.com/BoYuanVisionary/Pro-CAD).
- Seek-CAD (2025): fully local, DeepSeek-R1 writing a "Sketch, Sketch-based feature, Refinements" program, with step-wise renders reviewed by a VLM.
- LLMForge (Jul 2026): JSON-schema parametric designs for 97 simple engineering problems; compares an analytic ray-trace critic (silhouette IoU, hole visibility, edge clearance) with a Qwen2.5-VL-72B critic. Four open models (DeepSeek-V3.2, Qwen3-235B-A22B, Llama-3.3-70B, GLM-4.5 family) cluster at 0.885-0.890 with 99% mesh success; the VLM critic fails most on rotationally symmetric parts.
- Hephaestus / FEA feedback (May 2026): Codex (GPT-5.5) and Claude Code (Opus 4.7) produce multi-part STEP assemblies from briefs with a text blueprint schema, a 21-view renderer and FEA. No first-attempt strict passes; with feedback tools Box-IoU rose 0.444 to 0.592 (S2O) and 0.397 to 0.505 (Fusion360).
- LLM4CAD-Editor (Jun 2026): a 32B model fine-tuned on 35K instruction/program pairs in a DSL where geometry is referenced by feature name, not coordinates; parameter-level edits reach 0.935 IoU, functional edits 0.708, and the DSL is 1.4x more robust for editing than Python scripting. CADIR (Aug 2026) goes further with an OCCT/OCP intermediate representation that records a construction graph and uses "Geometric Signature Matching" to re-identify faces/edges across parameter changes and across FreeCAD/SolidWorks/Fusion backends.
- Zoo Zookeeper (shipped Jan 2026 in Zoo Design Studio v1.1): plan-act-observe loop that writes, executes and debugs KCL, inspects multi-view snapshots and computes mass, volume, surface area and centre of mass; the same tools are exposed via zoo-mcp (PyPI; tools zoo_execute_kcl, text_to_cad; needs ZOO_API_TOKEN). The Design Studio client is MIT but the geometry engine is a hosted service streaming video over WebSockets, so it cannot run offline. No accuracy numbers are published.

## 2. Which representation works best for LLMs in practice?

| Representation | Evidence | Practical verdict |
|---|---|---|
| Python script over OCCT (CadQuery / build123d) | Used by CAD-Recode, cadrille, both CAD-Coders, CADEvolve, CADFit, ProCAD, CADSmith, CAD-Assistant (FreeCAD API), CADTests, CADBench, BenchCAD, MUSE, Text2CAD-Bench, CAD-bench. Text2CAD-Bench ablation: forcing command sequences raised L2 invalidity for GPT-5.2 from 20% to 34% (CD 60 to 105), Qwen3-max 33% to 72%, Claude 4.5 44% to 38% (CD 72 to 125). | Best for generation. Pretraining exposure to Python and to OCCT concepts is the dominant factor. |
| build123d vs CadQuery | CADDesigner (200 DeepCAD models, text only): build123d Pass@1 0.59 / 363 s, CadQuery 0.50 / 541 s, explicit-state ECIP 0.46 but best IoU 0.304 and lowest CD. CAD-bench (ICML 2026) standardises on build123d 0.10.0. CADIR reports build123d 0.985 vs CadQuery 0.915 execution (secondary summary, not verified in abstract). | build123d executes more reliably and faster; explicit state and named returns improve geometric fidelity. Fluent/implicit-stack APIs hurt. |
| JSON feature tree / DSL | CADmium (JSON) roughly matches Text2CAD on CD but has higher invalidity; LLMForge's JSON schema works for simple families; LLM4CAD-Editor's named-feature DSL is 1.4x more robust for edits; CADIR's construction graph enables cross-backend edits. | Best for editing, diffing, and round-tripping to a GUI feature tree; weaker for free generation. |
| Command/sequence tokens | Text2CAD, CAD-GPT, CADFusion, CAD-Llama: very low invalidity in-distribution, CD 190-280 on Text2CAD-Bench, no transfer beyond sketch-extrude. | Dead end for a general agent surface; still fine as a training target for small specialised models. |
| Direct B-rep latent | BrepGen; HoLa 82% validity. | Reverse-engineering prior only; not editable, not parametric. |
| OpenSCAD | No peer-reviewed benchmark found; CADCodeVerify authors rejected it; only blog/HN anecdotes claim it is easier for simple shapes. A TUM thesis benchmark exists with 900 designs. | Keep for the mesh/CSG audience (3dj.app already has it); GPL-2 with CGAL exception complicates bundling. |
| KCL | No public benchmark; engine is hosted. | Not adoptable offline. |

A nuance from the LLM4CAD study (UT Austin, JCISE 2025): GPT-4V did better with text only than text plus image on simple parts, and images only helped for complex gears/springs. Image inputs must be presented deliberately (canonical views, sections, drawings), not just dumped in.

## 3. Measured success rates (what "state of the art" actually means in numbers)

- **CADBench** (MIT, May 2026; 18,000 samples, six families from DeepCAD/Fusion360/ABC/MCB/Objaverse, 5 input modalities, 1.4M generated programs, CadQuery output): CADFit IoU 0.895 / VSR 1.000; cadrille 0.555 / 0.945; CAD-Recode 0.506 / 0.919; CAD-Coder 0.288 / 0.951; Claude Opus 4.7 0.306 / 0.807; Gemini 3.1 Pro 0.295 / 0.737; GPT-5.4 0.124 / 0.517; Qwen 3.5 27B 0.011 / 0.336; Qwen 3.5 9B 0.000 / 0.099. Specialised models beat frontier VLMs on fidelity; small open VLMs are unusable without fine-tuning. Code MIT; the 78 GB HF dataset card has no license.
- **Text2CAD-Bench** (May 2026; 600 curated prompts, L1-L3; CadQuery 2.4, 3 error-feedback retries, 60 s timeout): GPT-5.2 L1 CD 44.3 / IR 11.1% rising to L3 CD 93.5 / IR 68%; Claude 4.5 Sonnet best on L3 CD (70.1) but IR 70%; Gemini-3-Flash has the lowest L3 IR (12.8%). Not yet released.
- **BenchCAD** (May 2026; 17,900 verified CadQuery programs across 106 industrial families; VQA, code QA, image-to-code, editing): frontier models "recover coarse outer geometry but fail to produce faithful parametric CAD programs"; fine-tuning/RL helps in-distribution but not on unseen families.
- **MUSE** (May 2026, v3 Oct 2026; 106 multi-part assembly briefs, CadQuery to STEP + drawings, scored on execution, validity, Physical Assembly Graph fidelity and function): joint success gpt-6-astra 57.6%, gpt-5.5 34.9%, claude-opus-4.7 23.6%, gemini-3.1-pro 22.6%; best open model glm-5.1 15.1%; qwen-2.5-72b 0.9%, llama-3.1-70b 0.0%. Execution success (99% for the top model) does not imply correct interfaces.
- **CADWorld** (Sept 2026; 200 FreeCAD GUI tasks across 11 categories): GPT-5.4 CUA 17.5%, Opus 4.8 16.0%, Kimi K2.6 7.5%, OpenCUA 1.5%, others 0-0.5%; human 87%; every agent 0% on CAM, FEM and TechDraw. A terminal-only ablation failed mostly on "wrong document structure" because scripted builds are not editable like native projects.
- **Parametric CAD Bench V3** (gNucleus; 100 FreeCAD tasks: 30 text, 30 text+edit, 40 from drawings; deterministic Apache-2.0 grader on geometry, parameters, topology, workflow): Claude Opus 5.5 + Claude Code 61.03 overall (Create 50.9, Create+Edit 39.7, Image-to-CAD 84.7) at $574 per run; Opus 5.5 + mini-swe-agent 57.96; GPT-6 Astra + Codex 56.87; Claude Fable 5.1 + Claude Code 56.75.
- **CAD-bench** (ICML 2026; MIT; build123d 0.10.0; 17 public tasks + 7 access-controlled functional tasks graded with deterministic checks or Blender rigid-body simulation): strongest standalone model 59.9% (ICML listing; not reproduced on the repo page).
- **CADTestBench** (May 2026): replaces Chamfer with executable CadQuery assertions per prompt; Text2CAD has near-zero invalidity but low requirement pass; Claude beats GPT as planner; using the tests as guidance beats existing methods.
- **CADPrompt/CADCodeVerify** (ICLR 2025): 200 prompts; VLM self-verification gives +5.5% compile rate.

## 4. Open models and datasets that can run locally, and their licenses

| Asset | What | License | Local footprint |
|---|---|---|---|
| cadrille | PC/image/text to CadQuery, Qwen2-VL base | Apache-2.0 (code + HF weights) | ~2B params; consumer GPU |
| CADmium | text to JSON CAD, Qwen2.5-Coder 1.5B-14B | Apache-2.0 models, MIT data | 1.5B-14B |
| CAD-Recode v1.5 | PC to CadQuery, Qwen2-1.5B | CC BY-NC 4.0 (code and weights) | ~2B params |
| CAD-Coder (MIT) | image to CadQuery, 13B LLaVA-style | code Apache-2.0; weights unlabelled | 13B |
| CADFit | mesh to CadQuery optimiser | CC BY-NC 4.0 + provisional patent | CPU/kernel bound |
| Text2CAD | text to sequence transformer | CC BY-NC-SA 4.0 | small |
| GenCAD | image to sequence, diffusion prior | no LICENSE file | small |
| BrepGen | B-rep diffusion | GPL-3.0 | GPU |
| HoLa | B-rep diffusion | none found | GPU |
| DeepCAD data | 178K sequences | code MIT; data via Onshape/ABC | 
| ABC | 1M B-rep models | MIT release; models owned by creators (Onshape ToU 1.g.ii) | 
| Omni-CAD | 450K multimodal | MIT | 
| Fusion 360 Gallery | 8,625 sequences, 8,251 assemblies, 35,680 segmented parts | Autodesk custom: non-commercial research only, no redistribution | 
| CADBench | 18K eval samples | code MIT; data card unlabelled | 78 GB |
| CAD-bench | 17 build123d tasks | MIT | 
| freecad-validator | Parametric CAD Bench grader | Apache-2.0 (needs FreeCAD 1.1.0; CalculiX optional) | 
| TRELLIS | image to 3D mesh | MIT (some submodules differ) | 16 GB VRAM |
| Hunyuan3D 2.1 | image to textured mesh | Tencent Hunyuan 3D 2.1 Community License: does not apply in EU, UK, South Korea | ~10 GB shape / 21 GB texture (secondary sources) |
| CadQuery / build123d | OCCT Python front-ends | Apache-2.0 | CPU |
| replicad | OCCT (OpenCascade.js) JS front-end | MIT (QuaroTech) | WASM, CPU |
| OCCT | kernel (Version 8.0 docs current) | LGPL-2.1 + exception | CPU |
| OpenSCAD | CSG mesh CAD, Manifold backend | GPL-2 with CGAL linking exception | CPU |
| mcp-for-blender | Blender MCP server | MIT | 

## 5. What VLM-in-the-loop render-critique-refine actually buys

Across CADCodeVerify, CADDesigner, Seek-CAD, CADSmith, LLMForge and the Hephaestus FEA paper the pattern is consistent: (1) execution-error feedback with 3 retries is table stakes and is what every benchmark gives for free; (2) exact kernel measurements (bounding box, volume, surface area, centre of mass, solid validity, face/edge counts) are the single most effective signal, because the model can compare numbers to the spec, and CADSmith shows visual critique alone cannot fix numeric errors; (3) multi-view renders plus a VLM judge catch topological and intent errors (missing holes, wrong orientation) but are unreliable on rotationally symmetric parts, and analytic render metrics (silhouette IoU, hole visibility) match the VLM for simple families at a fraction of the token cost; (4) executable requirement tests (CADTests) and assembly-graph checks (MUSE) are better success criteria than Chamfer distance, since prompts admit many valid shapes; (5) physics (FEA, rigid-body) feedback adds a further 0.1-0.15 IoU and is the only way to judge function; (6) best-of-N with a geometric scorer (CAD-Recode) and a clarification turn before generation (ProCAD) are cheap, large wins; (7) GUI-level agents fail mostly because the saved document structure is wrong, so geometry must be produced as a native, editable feature tree.

## 6. Implications: how Open3DJ should expose geometry to agents

1. **Primary surface = deterministic script over OCCT with explicit state and named references.** 3dj.app's Replicad-based DSL (Param.* declarations, withReferences/attachTo/onFace, named multi-part returns) is already closer to the ECIP/build123d style that wins in CADDesigner than CadQuery's fluent stack is. Keep it, but (a) make every operation return explicit values, (b) make errors structured triples (cause, location, suggested fix), and (c) keep all operations pure so the same script is reproducible across the WASM client, a native OCCT server and cloud workers.
2. **Ship a CadQuery/build123d-compatible local runtime as a second language.** Nearly every open model and benchmark emits CadQuery; cadrille (Apache-2.0) and CADmium (Apache-2.0) can then run unmodified as optional local "reverse-engineer from scan/photo" and "draft from text" providers, and Open3DJ can be scored on CADBench, CAD-bench, MUSE and BenchCAD without adapters. build123d 0.10.0 on Python 3.11 is the current benchmark pin.
3. **Maintain a JSON feature-tree/IR beside the script.** The evidence says code generates and IR edits: a CADIR-like construction graph with stable feature names and geometric-signature re-matching gives agents diffable, patchable models and gives humans a native feature tree in the GUI (which is also what CADWorld's graders check). Expose `get_feature_tree`, `patch_feature`, and `diff_models` tools.
4. **Tiered feedback stack as first-class MCP tools, cheapest first:** compile/exec errors; `geometry_info` (bbox, volume, area, COM, principal moments, face/edge/shell counts, is_valid, is_watertight, min wall, overhang) per named body; canonical six-view renders plus silhouettes and 2D cross-sections at requested planes; `compare` (IoU, Chamfer, Hausdorff) against a previous revision or a reference mesh/point cloud; a spec-test API where agents or users write CADTests-style assertions that run on every revision; optional physics/FEA plugin (CalculiX via FreeCAD-style adapter) and print-manufacturability gates (3dj's Evidence Pack already defines these).
5. **Build the clarification and best-of-N loops into the server, not the client.** A `validate_spec` tool that returns missing/conflicting dimensions (ProCAD) and a `generate_candidates(n)` mode that executes and ranks by geometric score (CAD-Recode) are cheap and generic.
6. **Design for small local models.** On CADBench Qwen 3.5 9B scores 0 IoU and 27B scores 0.011 zero-shot; local use will depend on fine-tuned specialists (cadrille-class 2B models) plus strong tool feedback, not on general small LLMs writing CAD unaided. Open3DJ's DSL docs, starters and error messages should be designed as RAG material (CADSmith, CADDesigner both rely on API-doc retrieval).
7. **Licensing guardrails.** Do not bundle CC BY-NC assets (CAD-Recode weights, Text2CAD, CADFit) or train on Fusion 360 Gallery for a shippable product; prefer Apache/MIT assets (cadrille, CADmium, Omni-CAD, DeepCAD/ABC); treat Hunyuan3D 2.1 as unavailable for EU/UK/KR users and default local mesh generation to TRELLIS (MIT).

## Recommendations for Open3DJ

1. Adopt "script generates, feature-tree IR edits" as the core data model; publish the DSL spec and an IR JSON schema in v0.1.
2. Implement the feedback stack from section 6.4 as MCP tools with per-body named results before adding any generative model; it is what every 2026 agent paper credits for its gains.
3. Provide a CadQuery/build123d execution provider so open models and benchmarks run as-is; score Open3DJ publicly on CADBench, CAD-bench, MUSE and Parametric CAD Bench (grader is Apache-2.0) and host the leaderboard.
4. Integrate cadrille (Apache-2.0) as the first local reverse-engineering provider and CADmium as a local text drafting provider; keep CAD-Recode/CADFit as research-only options behind a non-commercial flag.
5. Add spec tests (CADTests-style) and a clarification tool; these change measured success more than model choice.
6. Treat blender-mcp as the UX reference for tool naming (execute, inspect, look, import, generate) and Zookeeper as the product reference for an in-app engineer-style agent loop; Open3DJ's differentiator is that the whole loop runs offline on an open kernel.

## Sources

- Text2CAD: https://arxiv.org/abs/2409.17106 ; license: https://github.com/SadilKhan/Text2CAD/blob/main/LICENSE
- DeepCAD: https://arxiv.org/abs/2105.09492 ; https://github.com/ChrisWu1997/DeepCAD
- ABC dataset: https://archive.nyu.edu/handle/2451/44309 (NYU archive records, MIT release)
- Fusion 360 Gallery: https://github.com/AutodeskAILab/Fusion360GalleryDataset ; license: https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/master/LICENSE.md
- CAD-Recode: https://arxiv.org/abs/2412.14042 ; https://arxiv.org/html/2412.14042v2 ; https://github.com/filaPro/cad-recode ; https://huggingface.co/filapro/cad-recode-v1.5
- cadrille: https://arxiv.org/abs/2505.22914 ; https://github.com/col14m/cadrille ; https://www.iclr.cc/virtual/2026/oral/10006760
- CAD-Coder (image, MIT): https://arxiv.org/abs/2505.14646 ; https://github.com/anniedoris/CAD-Coder ; https://huggingface.co/CADCODER/CAD-Coder
- CAD-Coder (text, CoT + geometric reward): https://arxiv.org/abs/2505.19713 ; summary https://www.alphaxiv.org/overview/2505.19713v3
- CADmium: https://arxiv.org/abs/2507.09792 ; https://arxiv.org/html/2507.09792v3 ; https://github.com/chandar-lab/CADmium
- CAD-MLLM / Omni-CAD: https://arxiv.org/abs/2411.04954 ; https://github.com/CAD-MLLM/CAD-MLLM ; https://huggingface.co/datasets/jingwei-xu-00/Omni-CAD
- CAD-GPT: https://arxiv.org/abs/2412.19663 ; https://arxiv.org/html/2412.19663v2
- CAD-Llama: https://arxiv.org/abs/2505.04481
- CADFusion: https://arxiv.org/abs/2501.19054
- CAD-Editor: https://arxiv.org/abs/2502.03997 ; https://proceedings.mlr.press/v267/yuan25g.html
- GenCAD: https://arxiv.org/abs/2409.16294 ; https://github.com/ferdous-alam/GenCAD
- BrepGen: https://arxiv.org/abs/2401.15563 ; https://github.com/samxuxiang/BrepGen
- HoLa: https://arxiv.org/abs/2504.14257 ; https://huggingface.co/spaces/YuXingyao/HoLa-BRep
- CADFit: https://arxiv.org/abs/2605.01171 ; https://github.com/ghadinehme/CADFit ; https://meche.mit.edu/node/4540
- CADEvolve: https://arxiv.org/abs/2602.16317
- CADCodeVerify / CADPrompt: https://arxiv.org/abs/2410.05340 ; https://proceedings.iclr.cc/paper_files/paper/2025/file/81a934cd364e18ea6fdeaf57a93c17d4-Paper-Conference.pdf
- LLM4CAD: https://findanexpert.unimelb.edu.au/scholarlywork/2095911-llm4cad--multimodal-large-language-models-for-three-dimensional-computer-aided-design-generation ; https://par.nsf.gov/servlets/purl/10661921
- LLM4CAD-Editor: https://arxiv.org/abs/2606.20607
- CADIR: https://arxiv.org/abs/2608.00891
- CADDesigner: https://arxiv.org/abs/2508.01031 ; https://arxiv.org/html/2508.01031v6
- CADSmith: https://arxiv.org/abs/2603.26512
- ProCAD: https://arxiv.org/abs/2602.03045 ; https://github.com/BoYuanVisionary/Pro-CAD
- Seek-CAD: https://arxiv.org/abs/2505.17702
- CAD-Assistant: https://arxiv.org/abs/2412.13810 ; https://openaccess.thecvf.com/content/ICCV2025/html/Mallis_CAD-Assistant_Tool-Augmented_VLLMs_as_Generic_CAD_Task_Solvers_ICCV_2025_paper.html
- LLMForge: https://arxiv.org/abs/2607.05573
- FEA feedback agents: https://arxiv.org/abs/2605.17448
- Physics-in-the-Loop: https://arxiv.org/abs/2605.19717
- IterCAD: https://arxiv.org/abs/2606.13368
- 3D-GPT: https://arxiv.org/abs/2310.12945
- mcp-for-blender: https://github.com/ahujasid/blender-mcp (redirects to ahujasid/mcp-for-blender)
- Text2CAD-Bench: https://arxiv.org/abs/2605.18430 ; https://arxiv.org/html/2605.18430v1
- CADBench: https://arxiv.org/abs/2605.10873 ; https://arxiv.org/html/2605.10873v1 ; https://github.com/anniedoris/CADBench ; https://huggingface.co/datasets/DeCoDELab/CADBench
- BenchCAD: https://arxiv.org/abs/2605.10865
- MUSE: https://arxiv.org/abs/2605.28579 ; https://arxiv.org/html/2605.28579v3
- CADWorld: https://arxiv.org/abs/2609.16251 ; https://arxiv.org/html/2609.16251v2
- Parametric CAD Bench: https://cadbench.ai/ ; grader https://github.com/gNucleus-AI/freecad-validator
- CAD-bench (ICML 2026): https://github.com/CAD-bench/cad-bench ; https://icml.cc/virtual/2026/67851
- CADTestBench: https://arxiv.org/abs/2605.07807
- LLMs for CAD survey: https://arxiv.org/abs/2505.08137
- Zoo: https://zoo.dev/research/zookeeper ; https://zoo.dev/press/zoo-introduces-zookeeper ; https://github.com/KittyCAD/modeling-app ; https://pypi.org/project/zoo_mcp ; https://zoo.dev/blog/introducing-zoo
- Autodesk Project Bernini: https://develop3d.com/ai/autodesk-unveils-project-bernini-for-3d-generative-ai/
- TRELLIS: https://github.com/microsoft/TRELLIS
- Hunyuan3D 2.1 license: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE ; https://huggingface.co/tencent/Hunyuan3D-2.1
- Libraries: https://github.com/CadQuery/cadquery/blob/master/LICENSE ; https://github.com/gumyr/build123d/blob/dev/LICENSE ; https://github.com/sgenoud/replicad/blob/main/LICENSE ; https://github.com/openscad/openscad/blob/master/COPYING ; https://github.com/Open-Cascade-SAS/OCCT
- OpenSCAD anecdotes (non-rigorous): https://modelrift.com/blog/openscad-llm-benchmark ; https://news.ycombinator.com/item?id=41548945
