# Gap 4: Licence audit of the TripoSG and TRELLIS inference chains

Audited 2026-10-27 against TripoSG `main` @ fc5c409 and TRELLIS `main` @ 193e050 (shallow clones), current PyPI metadata and the Hugging Face model APIs. This is an engineering audit, not legal advice.

## Bottom line

- **TripoSG's official pipeline is not licence-clean.** "MIT" applies only to the top-level LICENSE and the weights card. The code that has to run is under different terms:
  - The `triposg/` package ships a **Tencent Hunyuan FlashVDM Community License** that "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA".
  - The DiT file's header embeds the **Tencent Hunyuan Community License**, which also excludes the EU.
  - The default decoder imports `diso`, which is **CC BY-NC 4.0**.
  - The script always downloads **RMBG-1.4**, which is non-commercial.
  - The script imports **pymeshlab**, which is GPL-3.0.
- **TRELLIS (v1) is cleaner than TripoSG for geometry.** Its code and weights are MIT, and the generation plus FlexiCubes mesh-decode path uses only permissive dependencies. The non-commercial and copyleft dependencies (nvdiffrast, diffoctreerast, Inria's diff-gaussian-rasterization, pymeshfix, igraph) are needed only for rendering and GLB texture baking. Those renderers are imported lazily.
- **TRELLIS.2 is not clean by default either.** Its pipeline config pulls **briaai/RMBG-2.0** (CC BY-NC 4.0), **DINOv3** (a custom licence with a trade-control/ITAR clause, gated), plus nvdiffrast and nvdiffrec (NVIDIA non-commercial).

So the earlier compute research's warning about TRELLIS renderer dependencies was correct, but it applied only to texturing. The plan's reasoning in favour of TripoSG falls apart once its own dependency chain is checked.

## TripoSG: everything installed or downloaded

| Item | How it enters | Licence |
|---|---|---|
| `triposg/` package (pipeline, VAE, `flash_extract_geometry`) | repo code | **Tencent Hunyuan FlashVDM Community License** (`triposg/LICENSE`): excludes EU/UK/KR, >1M MAU needs a Tencent licence, outputs may not be used to improve other AI models |
| `triposg_transformer.py` | repo code "copied or adapted from HunyuanDiT" | **Tencent Hunyuan Community License** (header): excludes EU |
| `scripts/briarmbg.py` + `briaai/RMBG-1.4` weights | `snapshot_download` in the default script, always | **bria-rmbg-1.4, non-commercial**; commercial use needs a BRIA agreement |
| `diso` (DiffDMC) | requirements; imported at module level; used by the default `use_flash_decoder=True` | **CC BY-NC 4.0** |
| `pymeshlab` | requirements; top-level import; `--faces` decimation | **GPL-3.0** |
| `VAST-AI/TripoSG` weights (DiT, VAE) | `snapshot_download` | MIT (card) |
| bundled `facebook/dinov2-large` encoder | inside the TripoSG repo | Apache-2.0 |
| `VAST-AI/TripoSG-scribble` (+ CLIP text encoder) | scribble script only | MIT (card); OpenAI CLIP is MIT |
| diffusers, transformers, huggingface_hub, peft, opencv-python, safetensors | requirements | Apache-2.0 |
| einops, trimesh, jaxtyping, typeguard | requirements | MIT |
| omegaconf, scikit-image, numpy, scipy, torchvision | requirements / transitive | BSD |
| torch | user-installed | BSD-style / Apache mix |
| torch-cluster (optional, VAE encoder only) | README tip | MIT |
| NOTICE also credits HunyuanDiT + FlashVDM | | Tencent community licences |

## TRELLIS (v1): everything installed or downloaded

| Item | Path used | Licence |
|---|---|---|
| TRELLIS code, `microsoft/TRELLIS-image-large` / `-text-*` weights | core | MIT |
| DINOv2 via `torch.hub` | core | Apache-2.0 |
| rembg + `u2net` session | core preprocessing | MIT / Apache-2.0 |
| spconv | core | Apache-2.0 |
| xformers / flash-attn | core | BSD |
| kaolin (via FlexiCubes fork) | mesh decode | Apache-2.0 |
| FlexiCubes (modified) | mesh decode | Apache-2.0 |
| utils3d, xatlas, pyvista, open3d, trimesh, onnxruntime | core / post | MIT |
| easydict | core | LGPL-3.0 |
| imageio(-ffmpeg) | video | BSD-2 |
| **nvdiffrast** | MeshRenderer, `to_glb` texture bake + hole fill | **NVIDIA Source Code License, "1-Way Commercial"**: "research or evaluation purposes only", NVIDIA alone may use it commercially |
| **diffoctreerast** | OctreeRenderer (radiance-field render) | **Inria/MPII-derived, research/evaluation only** |
| **diff-gaussian-rasterization** (mip-splatting) | GaussianRenderer, multiview render for `to_glb` | **Inria Gaussian-Splatting License, non-commercial** |
| **pymeshfix** | `to_glb` hole fill | **GPL-3.0** (repo) / AGPL-3.0 (PyPI classifier) |
| **python-igraph** | `to_glb` min-cut | **GPL-2.0+** |
| gradio | demo only | Apache-2.0 |

## Permissive substitutes

- **Background removal:**
  - BiRefNet (code and `ZhengPeng7/BiRefNet` weights are MIT).
  - rembg (MIT) with `u2net` (Apache-2.0).
  - transparent-background / InSPyReNet (MIT).
  - Accepting an image the caller has already masked (RGBA), which agents can often supply.
- **Iso-surface extraction (replacing diso):**
  - `skimage.measure.marching_cubes` (BSD), which TripoSG already uses in `hierarchical_extract_geometry` (`use_flash_decoder=False`).
  - PyMCubes (BSD-3).
  - FlexiCubes/kaolin (Apache-2.0).
  - PyTorch3D marching cubes (BSD).
- **Decimation and repair (replacing pymeshlab and pymeshfix):**
  - fast-simplification (MIT), used by trimesh.
  - pyfqmr (MIT).
  - Open3D quadric decimation (MIT).
  - manifold3d (Apache-2.0) for making meshes manifold.
- **Rasterisation (replacing nvdiffrast, diffoctreerast and Inria splatting):**
  - gsplat (Apache-2.0) for Gaussians.
  - PyTorch3D rasteriser (BSD) or an OpenGL/moderngl bake for UV textures.
- **Graph min-cut (replacing igraph):** networkx (BSD) or `scipy.sparse.csgraph.maximum_flow`.
- **TripoSG's Tencent-derived DiT code:** no drop-in replacement. A clean-room rewrite (possibly based on diffusers' Apache-2.0 `HunyuanDiT2DModel`) plus legal review would be needed. It is unresolved whether the MIT weights count as Tencent "Model Derivatives".

## Implications for the plan

1. **Stop calling TripoSG the "licence-clean default".** At best it is "MIT weights, community-licensed code".
2. **The "Territory" clause is the decisive problem.** It forbids use, distribution and Hosted Services in the EU. That directly conflicts with an EU print-quote business and with EU desktop users. A CI licence gate based on pip metadata would *not* catch it, because the Tencent licence only appears in a subfolder LICENSE file and a file header.
3. **A safer default is TRELLIS v1 run geometry-only** through an Open3DJ-owned "clean runner":
   - rembg/u2net or BiRefNet for background removal
   - FlexiCubes mesh decode
   - fast-simplification and manifold3d for clean-up
   - no nvdiffrast/Inria renderers

   Texture baking would then be either a separate opt-in non-commercial plugin or a gsplat/PyTorch3D re-implementation. TripoSG, TRELLIS.2 and Hunyuan3D become opt-in "restricted licence" model packs, with region and commercial-use warnings shown up front.
4. **The licence gate has to scan four layers:**
   - pip metadata
   - LICENSE files of git-installed CUDA extensions
   - Hugging Face card `license`/`license_name` for every `snapshot_download`, `from_pretrained` or `torch.hub` target, including nested configs such as TRELLIS.2's `rembg_model`
   - in-file licence headers (for example with ScanCode)

## Sources

- TripoSG repo: https://github.com/VAST-AI-Research/TripoSG
  - requirements: https://github.com/VAST-AI-Research/TripoSG/blob/main/requirements.txt
  - inference script: https://github.com/VAST-AI-Research/TripoSG/blob/main/scripts/inference_triposg.py
  - `triposg/LICENSE`: https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/LICENSE
  - NOTICE: https://github.com/VAST-AI-Research/TripoSG/blob/main/NOTICE
  - transformer header: https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/models/transformers/triposg_transformer.py
  - `inference_utils.py`: https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/inference_utils.py
- TripoSG weights card: https://huggingface.co/VAST-AI/TripoSG
- RMBG-1.4: https://huggingface.co/briaai/RMBG-1.4
- RMBG-2.0: https://huggingface.co/briaai/RMBG-2.0
- diso: https://pypi.org/project/diso/ and https://github.com/SarahWeiii/diso/blob/main/LICENSE
- pymeshlab: https://pypi.org/project/pymeshlab/
- DINOv2: https://huggingface.co/facebook/dinov2-large and https://github.com/facebookresearch/dinov2/blob/main/LICENSE
- TRELLIS:
  - licence section: https://github.com/microsoft/TRELLIS#license
  - setup.sh: https://github.com/microsoft/TRELLIS/blob/main/setup.sh
  - postprocessing_utils.py: https://github.com/microsoft/TRELLIS/blob/main/trellis/utils/postprocessing_utils.py
- nvdiffrast: https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt
- nvdiffrec: https://github.com/NVlabs/nvdiffrec/blob/main/LICENSE.txt
- diffoctreerast: https://github.com/JeffreyXiang/diffoctreerast/blob/master/LICENSE
- diff-gaussian-rasterization: https://github.com/graphdeco-inria/diff-gaussian-rasterization/blob/main/LICENSE.md
- mip-splatting: https://github.com/autonomousvision/mip-splatting/blob/main/LICENSE.md
- FlexiCubes: https://github.com/nv-tlabs/FlexiCubes/blob/main/LICENSE.txt
- kaolin: https://github.com/NVIDIAGameWorks/kaolin/blob/master/LICENSE
- pymeshfix: https://github.com/pyvista/pymeshfix/blob/main/LICENSE and https://pypi.org/project/pymeshfix/
- python-igraph: https://pypi.org/project/igraph/
- TRELLIS.2:
  - repo: https://github.com/microsoft/TRELLIS.2
  - pipeline config: https://huggingface.co/microsoft/TRELLIS.2-4B/blob/main/pipeline.json
- DINOv3 licence: https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md
- BiRefNet: https://github.com/ZhengPeng7/BiRefNet and https://huggingface.co/ZhengPeng7/BiRefNet
- U-2-Net: https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE
- rembg: https://pypi.org/project/rembg/
- gsplat: https://github.com/nerfstudio-project/gsplat/blob/main/LICENSE
- PyTorch3D: https://github.com/facebookresearch/pytorch3d/blob/main/LICENSE
- fast-simplification: https://pypi.org/project/fast-simplification/
- manifold3d: https://pypi.org/project/manifold3d/
