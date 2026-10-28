# Open3DJ research: local compute vs pluggable cloud GPU for generative 3D, reconstruction and LLMs

*Research date: 2026-10-27. All product facts below were checked against official repos, model cards, license files or pricing pages on that date; anything that could not be verified is marked as such. Note: the shared web-search budget was exhausted early in this pass, so verification was done by fetching primary sources directly rather than by search; a few second-tier claims (Vast.ai live prices, AMD Strix Halo specs, Meshy/Rodin open releases) could not be confirmed and are flagged.*

## Executive summary

Every heavy workload an agentic CAD app needs in late 2026 can run on a consumer PC, but the usable tier differs sharply by task. Image-to-mesh generation is solved locally on 8-16 GB NVIDIA cards with MIT-licensed models (TripoSG 8 GB, TRELLIS 16 GB, Hunyuan3D-2 shape 6 GB); only the newest high-resolution model (TRELLIS.2, 24 GB, Linux-only) and full PBR-texture pipelines (Hunyuan3D-2.1 at 29 GB, Step1X-3D at 27-29 GB) exceed a single 4090/5090. Photogrammetry (COLMAP 4.2.1 with the former GLOMAP global mapper merged in, nerfstudio/gsplat at 6-12 GB) is BSD/Apache and CPU-tolerant, but the strongest feed-forward reconstructors (DUSt3R/MASt3R) are CC BY-NC-SA and must stay optional, with VGGT-1B-Commercial as the commercially usable alternative. Mesh-to-B-rep is still research-grade (Point2CAD, cadrille Apache-2.0; CAD-Recode non-commercial). For the "brain", published benchmarks from 2025-2026 show that execution-verified iterative loops matter more than raw model size: a fine-tuned 3B model hits 69.3% on Text-to-CadQuery and a multi-agent CadQuery pipeline reaches 100% execution / 0.96 median IoU, while frontier models alone score only 0.57-0.81 executability on industrial FreeCAD tasks (RealCADBench). Cloud GPUs are cheap and commoditised (A100-80GB from ~$1.2-2.5/h, H100 from ~$2.5-4/h, L4 spot at $0.63/h; per-call 3D generation at $0.02-0.35), and every major provider accepts a bring-your-own container. The architecture should therefore be local-first with a uniform "compute provider" plug-in interface, where 3dj.app's managed fleet is one provider among RunPod/Modal/fal/Replicate/Baseten/HF, selected by capability discovery, cost caps and egress policy. The biggest non-technical constraint is licensing: the Tencent Hunyuan3D family excludes the EU, UK and South Korea outright, so an MIT project with EU users cannot ship Hunyuan3D as a default.

## 1. Generative 3D: text/image to mesh, image to CAD

### 1.1 Model-by-model (verified from official README / model card / LICENSE)

| Model (org) | Params | License | Min VRAM (official) | Speed / notes | Platform |
|---|---|---|---|---|---|
| Hunyuan3D-2.0 (Tencent, Jan 21 2025) | DiT 1.1 B + Paint 1.3 B; 2mini 0.6 B; 2mv 1.1 B; Turbo variants | Tencent Hunyuan 3D 2.0 Community License: **not valid in EU, UK, South Korea**; >1 M MAU needs a separate license; outputs may not train other models | 6 GB shape, 16 GB shape+texture | Turbo/FlashVDM: "within 1 second" demo on HF | README says macOS/Windows/Linux; CUDA in install |
| Hunyuan3D-2.1 (Tencent, Jun 13 2025) | Shape 3.3 B, Paint (PBR) 2 B | Tencent Hunyuan 3D 2.1 Community License, same EU/UK/KR exclusion and 1 M MAU clause | 10 GB shape, 21 GB texture, 29 GB both | time not stated | macOS/Windows/Linux claimed; community MLX conversion exists (15.1 GB weights) |
| Hunyuan3D-Omni (Sep 25 2025) | built on 2.1 | Tencent Hunyuan 3D Omni Community License (same exclusions) | 10 GB | control by point cloud / voxel / bbox / pose - useful for "image to CAD-ish" control | CUDA |
| Hunyuan3D-Part (P3-SAM + X-Part, Sep 23 2025) | not stated | Tencent Hunyuan 3D-Part Community License (same exclusions) | not stated | part segmentation + decomposition; "light version" only, full in Studio | CUDA |
| Hunyuan3D 2.5 / 3.0 / Buffalo 1.0 | - | - | - | **No open weights found**: 2.5 and 3.0 have no repo on the Tencent-Hunyuan org or HF; Buffalo 1.0 (Aug 5 2026) is paper + project page only | hosted/API |
| TRELLIS (Microsoft, Dec 2024) | image-large 1.2 B; text up to 2.0 B | MIT (some submodules own licenses) | 16 GB | - | "tested only on Linux", CUDA 11.8/12.2 |
| TRELLIS.2 (Microsoft, Dec 16 2025) | 4 B | MIT (nvdiffrast/nvdiffrec own licenses) | **24 GB**, verified on A100/H100 | H100: 512^3 ~3 s, 1024^3 ~17 s, 1536^3 ~60 s; PBR output; 2.58 M HF downloads/month | Linux only; no inference provider hosts it on HF |
| TripoSG (VAST, Mar 2025) | 1.5 B rectified flow | MIT | 8 GB | geometry only (no texture); scribble variant Apr 2025 | CUDA |
| TripoSR (VAST/Stability, Mar 2024) | small | MIT | ~6 GB | "<0.5 s on A100" | CUDA; CPU via torchmcubes fallback |
| Stable Fast 3D / SF3D (Stability, Aug 2024) | - | Stability AI Community License: free **under $1 M annual revenue**, registration + "Powered by Stability AI" | ~6 GB | - | CUDA; **MPS experimental** (needs >=32 GB unified); **CPU mode** (`SF3D_USE_CPU=1`); Windows experimental |
| Hi3DGen / Stable3DGen (Stable-X, Mar 2025) | TRELLIS-derived | MIT; NVIDIA deps (kaolin, nvdiffrast, flexicube) removed "so it can be used commercially" | not stated | normal-bridged geometry | CUDA |
| Direct3D-S2 (DreamTech, May 30 2025) | not stated | MIT | 10 GB @512, ~24 GB @1024 | authors say 512 output is low quality | CUDA |
| PartCrafter (Jun-Jul 2025, NeurIPS 2025) | TripoSG DiT fine-tune | MIT | 8 GB | multi-part generation from one image | CUDA |
| PartPacker (NVIDIA, Jun 2025) | - | **NVIDIA Source Code License - non-commercial only** | ~10 GB fp16 | part-level generation | CUDA |
| Step1X-3D (StepFun, May 13 2025) | geometry 1.3 B + texture 3.5 B | **Apache-2.0** | 27-29 GB (geometry + texture) | 152 s / 50 steps | CUDA |
| Meshy, Rodin | - | - | - | **No open-weight release located in this pass** (unverified) | - |

Sources: Hunyuan3D-2 README and LICENSE, Hunyuan3D-2.1 README and LICENSE, Hunyuan3D-Omni License.txt, Hunyuan3D-Part LICENSE, Tencent-Hunyuan org listing, HF search; TRELLIS README; TRELLIS.2 README and HF card; TripoSG, TripoSR READMEs; SF3D README and LICENSE.md; Hi3DGen README; Direct3D-S2 README; PartCrafter README; PartPacker license.md; Step1X-3D README (URLs in Sources).

### 1.2 What runs on which consumer GPU

RTX 50-series VRAM (Wikipedia, launch MSRP): 5060 8 GB $299; 5060 Ti 8/16 GB $379/$429; 5070 12 GB $549; 5070 Ti 16 GB $749; 5080 16 GB $999; 5090 32 GB $1,999.

- **8 GB (5060, 5060 Ti 8 GB, 4060)**: TripoSR, SF3D, Hunyuan3D-2 shape (6 GB), TripoSG and PartCrafter (8 GB, borderline). Textures mostly out of reach.
- **12 GB (5070, 4070)**: adds Hunyuan3D-2.1 shape (10 GB), Hunyuan3D-Omni (10 GB), PartPacker (10 GB, non-commercial), Direct3D-S2 at 512.
- **16 GB (5070 Ti, 5080, 4080, 5060 Ti 16 GB)**: adds TRELLIS (16 GB) and Hunyuan3D-2.0 shape+texture (16 GB).
- **24 GB (4090, 3090)**: adds TRELLIS.2 (24 GB, Linux), Direct3D-S2 at 1024, Hunyuan3D-2.1 texture stage (21 GB).
- **32 GB (5090)**: adds Hunyuan3D-2.1 full (29 GB) and Step1X-3D (27-29 GB).
- **Workstation / unified memory**: Apple M5 Max up to 128 GB, M5 Ultra up to 512 GB unified (Apple Mac Studio specs); NVIDIA DGX Spark 64/128 GB unified, "up to 1 PFLOP FP4", Ubuntu-based DGX OS. (AMD Ryzen AI Max+ 395 with 128 GB is widely reported but the AMD page returned 404 in this pass; treat as unverified.)

### 1.3 Apple Silicon and CPU-only

Only SF3D officially supports MPS (experimental, recommends >=32 GB unified) and a CPU mode. Hunyuan3D-2/2.1 READMEs claim macOS support, and a community MLX conversion of Hunyuan3D-2.1 (`dgrauet/hunyuan3d-2.1-mlx`, 15.1 GB, shape pipeline example only) exists on HF, but no timings are published. TRELLIS, TRELLIS.2, gsplat and nerfstudio are CUDA-only (custom kernels, nvdiffrast/flash-attn). Practically: on Macs, generative 3D should default to a cloud provider, with SF3D/TripoSR as the local fallback; CPU-only generation is feasible only for TripoSR/SF3D-class small models and should be treated as a degraded mode, not a design target.

### 1.4 Per-call cloud pricing for the same models (reference points)

- Replicate `tencent/hunyuan3d-2`: ~$0.15/run on L40S, "typically within 3 minutes".
- Replicate `firtoz/trellis`: ~$0.036/run on A100-80GB, ~26 s.
- fal: Trellis $0.02/generation; Trellis-2 $0.25 (512p) / $0.30 (1024p) / $0.35 (1536p); Hunyuan3D v2.1 endpoint $0.30/generation (now marked deprecated); "Hunyuan 3D Pro" $0.015/unit.

These are the numbers a cost-cap and a "local vs cloud" router should be calibrated against: a 4090 at $0.34-0.89/h on RunPod produces a TRELLIS asset for about a cent of GPU time, so cloud generation is cheap enough to be the default for machines below 16 GB.

## 2. Reconstruction from photos, and mesh to CAD

### 2.1 Photogrammetry and radiance fields

- **COLMAP**: new BSD license; latest release 4.2.1 (Sep 29); pre-built Windows binaries, Docker, conda, `pycolmap` and `pycolmap-cuda12` wheels; CUDA optional, AMD HIP/ROCm from source. 4.2.0's "global mapper" is the former GLOMAP: the GLOMAP repo (BSD-3, ETH Zurich) was archived on Mar 9 2026 with the note that it "has been fully migrated to COLMAP", and claims 1-2 orders of magnitude speedup over incremental SfM.
- **nerfstudio**: Apache-2.0; requires an NVIDIA CUDA GPU; `splatfacto` (~6 GB) and `splatfacto-big` (~12 GB) export `.ply` splats. **gsplat**: Apache-2.0, CUDA rasteriser, wheels for Linux and Windows, PyTorch 2.7+, no Metal/CPU path documented.
- **DUSt3R / MASt3R (Naver)**: code and checkpoints **CC BY-NC-SA 4.0** ("non-commercial use only") plus dataset licenses; CPU Docker exists. Cannot be a default component of a commercially usable open project; keep as an opt-in research plug-in.
- **VGGT (Meta)**: code moved to a commercial-friendly license on Jul 29 2025 (excluding military); only `facebook/VGGT-1B-Commercial` weights (gated, `vggt-aup-license`) allow commercial use; "typically reconstructs a scene in less than 1 second"; a May 15 2026 fix lets it run on ~2-3x more frames per GB; successor VGGT-Omega (May 18 2026) has no stated license yet. VGGT exports to COLMAP format with optional bundle adjustment, which is the right bridge into the COLMAP/splatfacto pipeline.

### 2.2 Mesh/point cloud to B-rep ("reverse engineering")

- **Point2CAD**: LICENSE file is Apache-2.0 but the README says CC-BY-NC 4.0 "personal and research use only" (conflict; ask authors before relying on it); reconstructs surfaces/edges/corners from segmented point clouds; "running without a GPU is also very feasible"; needs ParseNet/HPNet segmentation first.
- **CAD-Recode** (Qwen2-1.5B -> CadQuery code from point clouds, v1.5 Mar 2025): **CC BY-NC 4.0** - research only.
- **cadrille** (May 2025): point cloud / image / text -> CadQuery, Qwen2-VL-based, **Apache-2.0**, SFT and RL checkpoints on HF, claims SOTA on DeepCAD/Fusion360/CC3D. This is the most promising open, commercially usable mesh-to-CAD starting point.
- **BRepNet** (Autodesk, CVPR 2021): CC BY-NC-SA 4.0, B-rep face segmentation on OCCT/pythonOCC - research only.

Takeaway: a credible "scan -> parametric CAD" path today is COLMAP/VGGT -> mesh -> cadrille-style code generation -> execution in the B-rep kernel with measurement feedback, exactly the Design Evidence Pack shape 3dj.app already uses (measured/observed/inferred/assumed dimensions). Nothing in the open ecosystem produces production-grade B-rep directly from scans; the agent loop with geometric verification is the product.

## 3. Local LLM/VLM for CAD code generation, and the cloud "brain"

### 3.1 Open-weight models that fit consumer hardware (Oct 2026)

| Model | Size | License | Notes |
|---|---|---|---|
| Qwen3.8-27B (Aug 2026) | 27 B dense, VLM, 262 K ctx (1 M with YaRN) | Apache-2.0 | ~1,589 community GGUF/MLX quants; FP8 checkpoint; vision input useful for drawing-to-CAD |
| Qwen3-Coder-30B-A3B-Instruct | 30.5 B total / 3.3 B active, 262 K ctx | Apache-2.0 | MoE: fast on 16-24 GB cards at 4-bit; Qwen3-Coder-Next (80B-A3B) and 480B-A35B for servers |
| Gemma 4 31B-it / 26B-A4B-it (Jul 2026) | 30.7 B dense / 25.2 B total, 3.8 B active; 256 K ctx; text+image | Apache 2.0 (per model card, separate Gemma 4 license doc linked) | explicitly positioned for "consumer GPUs and workstations" |
| Ministral 3 (3B/8B/14B, Instruct/Reasoning, GGUF) | 3-14 B | not verified in this pass | laptop tier |
| GLM-5.3-Flash | 320 B total / 18 B active | MIT | server or 128 GB unified-memory boxes only |
| DeepSeek-V4.1-Flash | 552 B backbone, 8-16 B active, 1 M ctx | MIT | server tier; GGUF quants listed |
| Kimi K3 | 2.8 T / 104 B active, 1 M ctx | Kimi K3 License (MaaS revenue >$20 M/12 mo needs agreement; >100 M MAU or >$20 M/mo revenue must display "Kimi K3") | cloud only |
| Llama 4 | - | Llama 4 Community License: >700 M MAU needs Meta license; "Built with Llama" required | - |

Runtimes: **llama.cpp** (MIT; CUDA, HIP, Metal, Vulkan, SYCL, OpenCL, WebGPU, CANN; 1.5-8-bit quantisation; `llama serve` is an OpenAI-compatible server). **Ollama** (MIT; macOS/Windows/Linux; NVIDIA compute capability 5.0+, AMD ROCm v7 on Linux, RX 7600-7900 on Windows, Apple Metal, Vulkan for Intel/others; REST API on :11434). **vLLM** (Linux only, "does not support Windows natively"; NVIDIA CC 7.5+, AMD ROCm 6.3+, Intel XPU, Apple via community vLLM-Metal plugin). **LM Studio** (proprietary app, "free to use both at home and at work" since Jul 8 2025). **MLX-LM** (MIT, Apple Silicon, quantise/serve, macOS 15+ for large models).

### 3.2 Realistic CAD-codegen quality at 1-32 B, and frontier baselines

- *Text-to-CadQuery* (arXiv 2505.06507, May 2025): six fine-tuned open models; Qwen2.5-3B reached 69.3% (Gemini-judged exact match, up from the 58.8% Text2CAD baseline), Mistral-7B LoRA had the lowest invalid rate (1.32%). Small fine-tuned models are viable for CadQuery when the task distribution is known.
- *ProCAD* (arXiv 2602.03045, Feb 2026): a clarify-then-code agent beats Claude Sonnet 4.5 alone, cutting mean Chamfer distance by 79.9% and invalidity from 4.8% to 0.9%.
- *CADSmith* (arXiv 2603.26512, Mar 2026): multi-agent CadQuery with geometric validation lifts execution 95% -> 100% and median IoU 0.81 -> 0.96 on 100 prompts.
- *Foundation Models for Automatic CAD Generation* (arXiv 2607.05573, Jul 2026): DeepSeek-V3.2, Qwen3-235B-A22B, Llama-3.3-70B, Gemma-3-27B, GLM-4.5 and others with iterative refinement reach 0.885-0.890 overall and 98.97% mesh success; a VLM critic (Qwen2.5-VL-72B) gets the leader to 100% watertight meshes.
- *BenchCAD* (arXiv 2605.10865, May 2026): 17,900 execution-verified CadQuery programs across 106 industrial part families; "10+ frontier models" often recover coarse geometry but "fail to produce faithful parametric CAD programs"; generalisation to unseen families is limited.
- *RealCADBench* (arXiv 2609.03773, Sep 2026): 12,632 industrial FreeCAD-API tasks; across six frontier models executability 0.565-0.812, Solid IoU 0.28-0.54, Surface IoU 0.11-0.22; GPT-5.5 inside Codex improves IoU but lowers the judge score.
- *neuralCAD-Edit* (arXiv 2604.16170): best foundation model (GPT 5.2) is 53 points below CAD experts in human-acceptance trials on editing.
- OpenSCAD specifically: arXiv has essentially no LLM benchmark for OpenSCAD; the only relevant paper (AIDL, arXiv 2502.09819) shows a solver-aided DSL outperforming OpenSCAD in the few-shot regime. CadQuery/B-rep code is where the research and datasets are.

Implication: Open3DJ's agent loop (generate -> execute in kernel -> measure -> critique with a VLM render -> repeat) is what closes the gap, and that loop works with a local 27-31 B model for routine parts while frontier cloud models handle hard parts, assemblies and ambiguous prompts.

### 3.3 Cloud LLM APIs (per 1 M tokens, verified Oct 27 2026)

- Anthropic: Claude Opus 5.5 $4 in / $20 out (cache read $0.20); Sonnet 5.5 $2 / $10; Haiku 5.5 $0.10 / $0.50 up to 100 K prompt; Fable 5.1 $10 / $50; batch and prompt caching available. (Anthropic's default recommendation for new integrations is `claude-opus-5-5` with adaptive thinking.)
- OpenAI: gpt-6.1-sol $2 / $10; gpt-6.1-terra $1 / $5; gpt-6-astra $10 / $50; gpt-5.3-codex $1.75 / $14; gpt-5-nano $0.05 / $0.40.
- Google: gemini-3.1-pro-preview $2 / $12 (<=200 K); gemini-3.8-flash $0.75 / $3.75 promo through Dec 31 2026 (then $1.50 / $7.50); gemini-4-argon $2 / $10 through Nov 30 2026 (then $4 / $20); 2.5 Flash/Pro have free tiers.

## 4. Cloud GPU plug-in providers (verified Oct 27 2026)

| Provider | Representative prices | Billing / cold start | BYO container | Fit for Open3DJ |
|---|---|---|---|---|
| **RunPod** | Pods: RTX 4090 $0.34 (community) / $0.89 (secure); RTX 5090 $0.69 / $1.19; A100-80 $1.19-1.79; H100 SXM $2.69-3.99; B200 $5.98-7.99. Serverless: 4090 $1.10/h, 5090 $1.58/h, A100 $2.72/h, H100 $4.79/h; storage $0.07-0.10/GB-mo | per-second, rounded up; idle timeout default 5 s; FlashBoot + model caching for cold starts (no published seconds); default spend limit $80/h | yes (Docker image or GitHub repo; handler or HTTP worker) | best $/GPU for consumer-class cards; natural first provider |
| **Modal** | T4 $0.59/h, L4 $0.80, A10 $1.10, L40S $1.95, A100-80 $2.50, H100 $3.95, H200 $4.54, B200 $6.25; CPU $0.047/core-h; $30/mo free credits | per-second; "spins containers up and down in 1-2 seconds" | yes (Python Image API; Dockerfile and registry images) | easiest developer ergonomics; good for Python-defined 3D pipelines |
| **fal.ai** | H100 $2.49-4.50/h, H200 $2.99-6.00, B200 $5.49-7.99; per-call: Trellis $0.02, Trellis-2 $0.25-0.35, Hunyuan 3D Pro $0.015/unit | per-call for hosted models | "deploy your own app on our GPU fleet" | cheapest zero-ops path for standard 3D models |
| **Replicate** | T4 $0.81/h, L40S $3.51, A100-80 $5.04, H100 $5.49; Hunyuan3D-2 ~$0.15/run, TRELLIS ~$0.036/run | per-second; private models billed for setup + idle + active | yes (Cog) | large public model zoo; pricier dedicated hardware |
| **Baseten** | per-minute: T4 $0.01052, L4 $0.01414, A10G $0.02012, A100 $0.06667, H100 MIG $0.0625, H100 $0.10833, B200 $0.16633 (= A100 ~$4.00/h, H100 ~$6.50/h) | "you do not pay for idle time", fast cold starts | yes (Truss) | enterprise-grade autoscaling |
| **Lambda** | A10 $1.29/h, A100-40 $1.99, A100-80 $2.79, H100 PCIe $3.29, H100 SXM $3.99-4.29, GH200 $2.29, B200 $6.69-6.99 | VM instances, self-serve | VM, bring anything | long-running jobs, training |
| **Vast.ai** | market-set, "prices set by supply and demand across 40+ data centers"; interruptible tier "50%+ cheaper" (live numbers not retrievable in this pass) | marketplace, preemptible | Docker images | cheapest for batch; least predictable |
| **Together** | dedicated H100 $5.49/h, B200 $8.99/h; clusters H100 $1.99 preemptible / $3.99 on-demand; serverless tokens e.g. GLM-5.3-Flash $0.15/$0.50, Qwen3.5-397B $0.60/$3.60 | per-token or per-GPU-hour | dedicated endpoints | open-weight LLM API for the "brain" |
| **HF Inference Endpoints** | T4 $0.50/h, L4 $0.80, L40S $1.80, A100 $2.50, H100 $4.50; ZeroGPU Spaces free (RTX Pro 6000, up to 96 GB; PRO $9/mo for 8x quota) | hourly instances with autoscaling | yes (custom images from Docker Hub/ECR/ACR/GCR; weights at `/repository`) | model-cache-native; ZeroGPU is a free demo tier |
| **AWS EC2 (spot)** | g6.xlarge (L4 24 GB) $0.805 on-demand / $0.626 spot; g6e.xlarge (L40S 48 GB) $1.861 / $1.564 spot | per-second | any AMI | enterprises with existing AWS accounts |

(GCP/Azure spot pages could not be parsed in this pass; expect comparable L4/A100/H100 rates.)

## 5. Proposed "compute provider" abstraction for Open3DJ

**Goal**: one interface the agent, the MCP server and the desktop client all use; local is just the first provider.

1. **Capability discovery.** Each provider exposes a signed manifest: `capabilities[]` (e.g. `gen3d.image_to_mesh`, `gen3d.text_to_mesh`, `recon.sfm`, `recon.splat`, `recon.feedforward`, `cad.mesh_to_brep`, `llm.chat`, `vlm.critique`), per-capability `models[]` with `license` (SPDX or named community license), `territory_exclusions[]`, `min_vram_gb`, `supports_mps/cpu`, `typical_latency`, `price_model` (per-second GPU, per-call, per-token), `egress_policy` (data leaves machine? which jurisdiction?). The local provider probes hardware at startup (CUDA compute capability, VRAM, ROCm/Metal/Vulkan presence, unified memory) using the same rules Ollama and llama.cpp use, and marks models installable vs runnable vs blocked-by-license (e.g. hide Hunyuan3D by default when locale is EU/UK/KR).
2. **Job queue.** Every heavy op is an async job (`jobId`, `status`, progress, artifacts, cost so far), mirroring 3dj.app's `modelId`/poll/download pattern so agents learn one shape. A local SQLite-backed queue with priorities; cloud providers are adapters that submit, poll and stream logs. Jobs carry a `budget` and a `deadline`; the router picks the cheapest provider that satisfies capability + privacy + deadline.
3. **Model cache.** Content-addressed cache (HF hub layout) shared by local runtimes and by cloud workers (network volume on RunPod/Modal/HF). Pre-warm on install for the "starter kit" (TripoSG, TRELLIS, Qwen3-Coder-30B-A3B Q4, Gemma 4 26B-A4B) and keep licenses next to weights; refuse to cache non-commercial weights unless the user opts into "research mode".
4. **Privacy / egress controls.** Policy levels: `local-only`, `cloud-anonymous` (geometry only, no prompts/images), `cloud-full`. Per-job redaction (strip EXIF, project names), audit log of every byte sent off-machine, provider region pinning, and a "no cloud for this project" flag enforced by the router, not the UI.
5. **Cost caps.** Per-project and per-day caps in USD; providers report unit prices from their manifests; the router estimates cost before submission (GPU-seconds x rate, or per-call) and refuses or downgrades (lower resolution, smaller model) when a cap would be exceeded; hard kill on runaway jobs (RunPod-style spend limit).
6. **Failover.** Local first when VRAM/license/time allow; on OOM, missing kernel (CUDA-only model on a Mac) or SLA miss, retry on the next provider in the user's ranked list; identical job spec and artifact schema so results are interchangeable; cold-start-aware scheduling (batch several generations into one warm worker).
7. **3dj.app as a provider.** Its MCP already offers `generate_from_text/image_url`, `list_providers`, allowances and operator-reviewed print quotes. Wrap it as `provider:3dj` exposing `gen3d.*`, `cad.validate`, `print.quote` with OAuth 2.1 + PKCE or API key, so a user with no GPU gets the managed fleet and quote workflow, while Open3DJ remains fully functional without it.

## Recommendations for Open3DJ

1. **Default local generative stack = MIT only**: TripoSG (8 GB) and TRELLIS (16 GB) for image-to-mesh, TRELLIS.2 (24 GB, Linux) as the high-end option, PartCrafter for part-aware generation, Step1X-3D (Apache-2.0) as the textured option for 32 GB cards. Ship Hunyuan3D-2/2.1/Omni/Part only as an opt-in plug-in with a territory check, because the Tencent licenses exclude the EU, UK and South Korea; exclude PartPacker (non-commercial) and DUSt3R/MASt3R/CAD-Recode/BRepNet (CC BY-NC) from defaults.
2. **Tier the UX by VRAM**: below 12 GB route generative 3D to cloud by default (a 4090-class worker costs about a cent per asset); 16-24 GB runs TRELLIS/TRELLIS.2 locally; Apple Silicon users get SF3D/TripoSR locally and cloud for the rest until MLX ports mature.
3. **Reconstruction pipeline**: COLMAP 4.2.1 (global mapper) + splatfacto/gsplat for photogrammetry, VGGT-1B-Commercial as the fast feed-forward front end (exports COLMAP format), cadrille (Apache-2.0) as the mesh/point-cloud-to-CadQuery seed; always finish in the B-rep kernel with measured evidence.
4. **Brain**: cloud frontier model by default (Claude Opus 5.5 at $4/$20 or Sonnet 5.5 at $2/$10 are the current price/quality sweet spot; OpenAI gpt-6.1-sol and Gemini 3.1 Pro are equivalents), with a local tier of Qwen3-Coder-30B-A3B / Qwen3.8-27B / Gemma 4 26B-A4B via llama.cpp or Ollama. Invest in the execution-verified, VLM-critiqued loop and in a CadQuery/B-rep fine-tuning dataset (BenchCAD-style, execution-verified) because benchmarks show the loop, not the model, drives correctness.
5. **Provider adapters, in order**: local (CUDA/ROCm/Metal/Vulkan), RunPod serverless, Modal, fal (per-call), HF Endpoints, Replicate, Baseten, then 3dj.app. All support bring-your-own containers, so one `open3dj-worker` image serves every adapter.
6. **Make licensing machine-readable**: every model entry in the registry carries license, territory exclusions, MAU/revenue thresholds and "may outputs train other models" flags; the agent can explain why a model is unavailable.
7. **Treat Hunyuan3D 3.x/Buffalo, Meshy and Rodin as cloud-only capabilities** reachable through fal/3dj.app, not as local models; re-check quarterly since Tencent's cadence is fast.

## Sources

- Hunyuan3D-2 README: https://github.com/Tencent-Hunyuan/Hunyuan3D-2 ; license: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2/main/LICENSE
- Hunyuan3D-2.1 README: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 ; license: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE
- Hunyuan3D-Omni: https://github.com/Tencent-Hunyuan/Hunyuan3D-Omni ; license: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-Omni/main/License.txt
- Hunyuan3D-Part: https://github.com/Tencent-Hunyuan/Hunyuan3D-Part ; license: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-Part/main/LICENSE
- Hunyuan3D-Buffalo1.0: https://github.com/Tencent-Hunyuan/Hunyuan3D-Buffalo1.0 ; Tencent org listing: https://github.com/orgs/Tencent-Hunyuan/repositories?q=3D&type=all&sort=updated ; HF search: https://huggingface.co/models?search=Hunyuan3D&sort=modified ; MLX conversion: https://huggingface.co/dgrauet/hunyuan3d-2.1-mlx
- TRELLIS: https://github.com/microsoft/TRELLIS ; TRELLIS.2: https://github.com/microsoft/TRELLIS.2 ; https://huggingface.co/microsoft/TRELLIS.2-4B
- TripoSG: https://github.com/VAST-AI-Research/TripoSG ; TripoSR: https://github.com/VAST-AI-Research/TripoSR
- SF3D: https://github.com/Stability-AI/stable-fast-3d ; license: https://raw.githubusercontent.com/Stability-AI/stable-fast-3d/main/LICENSE.md
- Hi3DGen: https://github.com/Stable-X/Hi3DGen ; Direct3D-S2: https://github.com/DreamTechAI/Direct3D-S2 ; PartCrafter: https://github.com/wgsxm/PartCrafter ; PartPacker license: https://raw.githubusercontent.com/NVlabs/PartPacker/main/license.md ; Step1X-3D: https://github.com/stepfun-ai/Step1X-3D
- COLMAP: https://github.com/colmap/colmap ; releases: https://github.com/colmap/colmap/releases ; GLOMAP: https://github.com/colmap/glomap
- nerfstudio: https://github.com/nerfstudio-project/nerfstudio ; splatfacto: https://docs.nerf.studio/nerfology/methods/splat.html ; gsplat: https://github.com/nerfstudio-project/gsplat
- DUSt3R: https://github.com/naver/dust3r ; MASt3R: https://github.com/naver/mast3r ; VGGT: https://github.com/facebookresearch/vggt ; VGGT-1B-Commercial: https://huggingface.co/facebook/VGGT-1B-Commercial
- Point2CAD: https://github.com/YujiaLiu76/point2cad ; LICENSE: https://raw.githubusercontent.com/YujiaLiu76/point2cad/main/LICENSE ; CAD-Recode: https://github.com/filaPro/cad-recode ; license: https://raw.githubusercontent.com/filaPro/cad-recode/main/LICENSE.md ; cadrille: https://github.com/col14m/cadrille ; BRepNet: https://github.com/AutodeskAILab/BRepNet
- Qwen3-Coder: https://github.com/QwenLM/Qwen3-Coder ; https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct ; Qwen3.8-27B: https://huggingface.co/Qwen/Qwen3.8-27B ; Qwen org: https://huggingface.co/Qwen
- Gemma 4: https://huggingface.co/google/gemma-4-31B-it ; https://huggingface.co/google/gemma-4-26B-A4B-it ; Gemma terms: https://ai.google.dev/gemma/terms
- GLM-5.3-Flash: https://huggingface.co/zai-org/GLM-5.3-Flash ; GLM-4.6: https://huggingface.co/zai-org/GLM-4.6 ; DeepSeek-V4.1-Flash: https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash ; DeepSeek org: https://huggingface.co/deepseek-ai
- Kimi K2: https://github.com/MoonshotAI/Kimi-K2 ; K2 license: https://huggingface.co/moonshotai/Kimi-K2-Instruct/raw/main/LICENSE ; K3: https://huggingface.co/moonshotai/Kimi-K3 ; K3 license: https://huggingface.co/moonshotai/Kimi-K3/raw/main/LICENSE
- Llama 4 license: https://raw.githubusercontent.com/meta-llama/llama-models/main/models/llama4/LICENSE ; Mistral org: https://huggingface.co/mistralai ; Ministral 3 list: https://huggingface.co/mistralai/models?search=Ministral-3
- llama.cpp: https://github.com/ggml-org/llama.cpp ; Ollama: https://github.com/ollama/ollama ; Ollama GPU support: https://docs.ollama.com/gpu ; vLLM GPU install: https://docs.vllm.ai/en/latest/getting_started/installation/gpu.html ; LM Studio free for work: https://lmstudio.ai/blog/free-for-work ; MLX-LM: https://github.com/ml-explore/mlx-lm
- CAD codegen papers: Text-to-CadQuery https://arxiv.org/abs/2505.06507 (tables: https://arxiv.org/html/2505.06507) ; BenchCAD https://arxiv.org/abs/2605.10865 ; RealCADBench https://arxiv.org/abs/2609.03773 ; Foundation Models for Automatic CAD Generation https://arxiv.org/abs/2607.05573 ; ProCAD arXiv:2602.03045, CADSmith arXiv:2603.26512, neuralCAD-Edit arXiv:2604.16170, AIDL arXiv:2502.09819 via https://arxiv.org/search/?query=CadQuery+large+language+model&searchtype=all and https://arxiv.org/search/?query=text-to-CAD+benchmark&searchtype=all
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing ; OpenAI pricing: https://developers.openai.com/api/docs/pricing ; Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- RunPod pricing: https://www.runpod.io/pricing ; serverless docs: https://docs.runpod.io/serverless/pricing , https://docs.runpod.io/serverless/overview ; Modal: https://modal.com/pricing , https://modal.com/docs/guide/custom-container ; fal: https://fal.ai/pricing , https://fal.ai/models/fal-ai/trellis-2 , https://fal.ai/models/fal-ai/hunyuan3d-v21 ; Replicate: https://replicate.com/pricing , https://replicate.com/tencent/hunyuan3d-2 , https://replicate.com/firtoz/trellis ; Baseten: https://www.baseten.co/pricing ; Lambda: https://lambda.ai/pricing ; Vast.ai: https://vast.ai/pricing ; Together: https://www.together.ai/pricing ; HF: https://huggingface.co/pricing , https://huggingface.co/docs/inference-endpoints/guides/custom_container ; AWS: https://instances.vantage.sh/aws/ec2/g6.xlarge , https://instances.vantage.sh/aws/ec2/g6e.xlarge
- Hardware: RTX 50 series https://en.wikipedia.org/wiki/GeForce_RTX_50_series ; Mac Studio https://www.apple.com/mac-studio/specs/ ; DGX Spark https://www.nvidia.com/en-us/products/workstations/dgx-spark/
