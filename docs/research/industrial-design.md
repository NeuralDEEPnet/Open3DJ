# Industrial product design pipeline for Open3DJ

Research date: 28 Oct 2026. Method: vendor release notes, reference manuals, licence files and model cards were fetched directly. Where only secondary coverage existed, it says so. Numbers in brackets point to the source list at the end. This builds on formats-interop-manufacturing.md, compute-local-and-cloud.md, gap-4.md and gap-9.md, and does not repeat them.

## Bottom line

- **Professional teams still run about 15 stages**, from brief to tooling. Commercial tools own the hardest stages: Class-A form work (Alias, Rhino, Plasticity), CMF and rendering (KeyShot, VRED), moulding simulation (Moldflow) and drop testing. Open source is strong in rendering (Cycles is Apache-2.0 [17]), structural FEA (CalculiX 2.23, GPL-2.0 [19]), sheet metal (FreeCAD SheetMetal, LGPL-2.1 [20]), CAM (Kiri:Moto, MIT) and mesh booleans (Manifold). It is weak at Class-A surfacing and has no usable moulding simulator.
- **AI helps most at the two ends of the pipeline.** At the front it generates concept images and variants (Vizcom, KeyShot AI Shots, Alias Form Explorer). At the back it drafts drawings, checks DFM and builds quotes (SolidWorks LEO drawings in beta, Fusion automated drawings, Protolabs ProDesk AI DFM, Moldflow 2027 Assistant). In the middle (Class-A surfacing, GD&T intent, simulation set-up) every vendor still ships AI as a beta or "starting point" that a professional must review [5][9][10][13][14].
- **OCCT 8.0.1 has more industrial-design primitives than the earlier plan assumed.** It has N-sided filling with G2 constraints and a measured `G2Error` [2], the new `GeomFill_Gordon` curve-network surfaces [3], curvature through new `GeomProp`/`BRepProp` packages [4], draft angles on planar, cylindrical and conical faces [1], and exact and polygonal hidden-line removal [6]. build123d already wraps `draft()`, `thicken()`, `project_to_viewport()` and `TechnicalDrawing` [7][8].
- **Surface quality can be made legible to an agent.** Agents cannot judge highlights in a zebra render, but they can read numbers: positional gap, tangent angle and curvature jump along each shared edge. A continuity table added to the GeometryReport is a cheap, distinctive feature.
- **The smallest useful slice is "brief to printed prototype".** It needs no new geometry. The 3dj DSL already has `lib.screwBoss` (with ribs), `lib.snapFit`, `lib.heatSetPocket`, `minWall`, `loft` and `Shape.fromSlices`, plus Evidence Pack v1 gates [27]. The gap is quoting: 3dj quotes accept only models saved on 3dj and have no file or evidence field (gap-9 §4).
- **Agents can own these early:** brief capture, parametric housings, DfAM gates, rule-based injection-moulding DFM (draft, wall, rib ratio, undercuts, parting-line candidates), BOM and RFQ packs. **These need years, or should stay with partners:** Class-A surfacing at automotive quality, moulding flow and warp simulation, validated drop and thermal results, and tool design.
- **Licence traps** are concentrated in the AI and human-factors stages. SMPL-X bodies are non-commercial [24]. Hunyuan3D excludes the EU, UK and South Korea. TripoSG is not clean (gap-4). Pantone libraries are licensed [26]. Free-plan Vizcom outputs may be used for training [11]. OpenRadioss, the only open explicit drop solver, was retired by Siemens in October 2026 [21].

## 1. The pipeline as practised in 2026

| # | Stage | Commercial tools (verified 2026 state) | Best open options | Where AI genuinely helps now | Open3DJ horizon |
|---|---|---|---|---|---|
| 1 | Brief and requirements | Docs, PLM (Windchill, Arena) | Plain text, git | LLMs structure briefs, list missing requirements | **Early**: `brief` plus executable assertions |
| 2 | User and market research | Interviews, teardown, scanning | COLMAP, gsplat (Apache-2.0) | Summaries, competitor scan to mesh | Reuse v0.7 Reconstruct; not core |
| 3 | Ideation and sketching | Vizcom (Sketch, Render, Iterate, "Make it real", New View 0-315 deg) [11]; Gravity Sketch (VR); Alias 2027 paint layers [9] | FLUX.1 schnell (Apache-2.0, 12B) [15]; Qwen-Image (Apache-2.0, 20B) [16] | **Strong**: sketch to render, form and colour variants | **Early** as a provider; taste stays human |
| 4 | Concept 3D | Alias 2027 Form Explorer (2D images to 3D meshes) [9]; Plasticity; Gravity Sketch | TRELLIS v1 geometry-only (MIT runner, gap-4); Blender SubD | Image to massing mesh | **Early** for massing; meshes are "assumed" geometry |
| 5 | Form development (SubD, NURBS, Class-A, G2/G3, zebra, curvature) | Alias 2027 Enhanced Diagnostics [9]; Rhino 9 beta GlobalEdgeContinuity (G0-G2) and new zebra styles [12]; Plasticity 2026.2 curvature shader and Project Align G0/G1/G2 (Studio, $299) [13] | OCCT MakeFilling G2, Gordon, GeomPlate, curvature [2][3][4]; Blender (OpenSubdiv) | Little: Navasto AI aero plugin in Alias [9] | **Analysis early; Class-A modelling years** |
| 6 | CMF | KeyShot Studio, VRED, Substance, Vizcom swaps | MaterialX (Apache-2.0) [25], glTF KHR_materials_variants | **Strong**: colour and material variants of renders | **Early**: CMF file and variant renders |
| 7 | Ergonomics and human factors | Digital-human manikin tools | ANSUR II public data [23]; MPFB (GPL-3.0 code, CC0 assets) [24] | Weak; physical mock-ups rule | **Medium**: percentile envelope checks |
| 8 | Visualisation | KeyShot Studio 2026.1 (AI Shots, OpenPBR in USD, $1,299/yr rental) [14]; VRED 2027 Gaussian splats [9] | Cycles (Apache-2.0, standalone or Hydra) [17]; three.js; gsplat | **Strong**: AI restyle, upscaling, backgrounds | **Early**: deterministic renders exist; add Cycles provider |
| 9 | Prototyping | Slicers, Protolabs, Xometry, JLC3DP, Shapeways | OrcaSlicer/PrusaSlicer (AGPL, subprocess), Kiri:Moto (MIT) | Instant quotes, orientation | **Early**: first slice |
| 10 | DFM/DFA (moulding, sheet metal, CNC, casting, DfAM) | SolidWorks/Creo/NX draft and thickness analysis; Moldflow 2027 [10]; Protolabs ProDesk AI DFM (Feb 2026) [18] | OCCT DraftAngle [1]; build123d `draft()` [7]; FreeCAD SheetMetal V0.8.26 [20]; openInjMoldSim (GPL-3.0) [22] | **Moderate**: rule checks with cited rules; vendor DFM on upload | **Rules early; simulation years** |
| 11 | Engineering detail (tolerances, GD&T, assemblies, BOM) | SolidWorks, Creo, NX, Fusion | OCCT XCAF semantic PMI; FreeCAD Assembly | BOM extraction; GD&T suggestions only | **Medium**: assemblies, BOM, stacks |
| 12 | Validation (FEA, drop, thermal) | Ansys, Abaqus, Simcenter; Moldflow | CalculiX 2.23 [19]; Elmer (GPL-2.0 and LGPL-2.1) | Study set-up, result reading | **Medium for linear FEA; drop years** |
| 13 | Drawings and handoff | SolidWorks 2026 LEO Drawing Creation (beta) [5]; Fusion automated drawings (no notes or GD&T) [6b] | OCCT HLRBRep [6]; build123d drawings [8]; FreeCAD TechDraw | **Moderate**: view layout and first dimensions | **Medium**: AP242 PMI plus HLR sheets |
| 14 | Supplier RFQ | Protolabs ProDesk, Xometry (web only), Shapeways API | Package standards (STEP, PDF, CSV, QIF) | **Strong**: pack assembly, quote comparison | **Early to medium**: never auto-order |
| 15 | Tooling and production | Mould makers; Moldflow cooling optimisation [10]; PPAP and first-article inspection | QIF 3.0 for inspection data | Weak | **Years**; partner-owned |

### Notes on the stages that matter most

**Form development.** Class-A means surfaces whose reflections stay unbroken across boundaries. In practice that means G2 (curvature-continuous) joins at least, G3 on visible automotive panels, controlled control-point layouts and clean highlight lines. Tools check this with zebra stripes, curvature combs and heat maps, highlight lines and deviation analysis. In 2026 the leaders are still adding analysis rather than AI. Rhino 9's beta adds a tool that "quickly analyzes the continuity (G0, G1, and G2) between surfaces" and five new zebra styles [12]. Plasticity 2026.2 adds a Gaussian, Mean and Max curvature shader and an xNURBS "Project Align" with G0, G1 and G2 options [13]. Alias 2027 bundles "advanced shading, angle analysis, and higher-precision deviation tools" [9].

OCCT 8.0.1 gives Open3DJ the building blocks:
- `BRepOffsetAPI_MakeFilling` accepts C0, G1 and G2 edge constraints and reports `G2Error()`, "the greatest curvature difference between the result and the constraints" [2].
- `GeomFill_Gordon` interpolates N x M profile and guide networks. It refuses to fall back silently unless `AllowApproximateFallback` is set, so `IsApproximate()` must be checked [3].
- In 8.0, curvature moved to `GeomProp`/`BRepProp`, which return `IsDefined` flags instead of throwing exceptions [4].

There is no open Class-A modeller. Building one is a multi-year effort that needs expert human users, not just agents.

**Injection moulding DFM.** These are the public rules suppliers apply:
- **Draft.** About 1 degree per inch (25 mm) of cavity depth [18b]. More is needed on textured faces: Fathom's guide says at least 1 degree on polished faces and 3 degrees on textured ones (secondary) [18c]. Boss walls take 0.5 to 3 degrees [18d].
- **Wall thickness by resin** [18b]:
  - ABS 1.14 to 3.56 mm
  - PC 1.02 to 3.81 mm
  - PP 0.64 to 3.81 mm
  - Nylon 0.76 to 2.92 mm
- **Ribs and bosses.** Ribs are 40 to 60% of the adjacent wall [18b]. Boss walls are also 40 to 60% of the wall they rise from, strengthened with gussets. Bosses taller than five times their outside diameter cause filling problems [18d].
- **Other features.** Undercuts need side actions. Tab gates leave a vestige within 0.005 in [18b]. Thick sections cause sink, warp and voids.
- **Tolerances.** Moulded-part tolerances are now in ISO 20457:2026, edition 2, published 6 Aug 2026. It explicitly does not cover sink marks, flow lines or joint lines [28].

Every one of these rules is a measurable geometric predicate on a B-rep with a pull direction. That makes them ideal agent gates. OCCT's `BRepOffsetAPI_DraftAngle` drafts only planar, cylindrical and conical faces. It propagates the draft to tangent-continuous neighbours and reports a `ProblematicShape()` on failure [1]. Freeform faces therefore need draft built into the surface itself, which is a stage 5 problem.

**Simulation.** Moldflow 2027 adds an Autodesk Assistant (tech preview, on by default with an opt-out) and a Python API inside the Synergy shell. It drops the Process Optimization and Shrink analyses and no longer supports Windows 10 [10]. The only open moulding solver, openInjMoldSim (GPL-3.0, OpenFOAM 7, filling, packing and cooling), calls itself "prohibitively inconvenient for typical industrial use" [22]. CalculiX 2.23 handles static, modal, contact, thermomechanical and explicit dynamics under GPL-2.0 [19]. OpenRadioss, the AGPL explicit crash and drop solver, is being wound down. openradioss.org now redirects to a Siemens page that says "OpenRadioss is transitioning to a new phase" and "The OpenRadioss website is being retired". The GitHub repo returns 404, and secondary reports from 3 Oct 2026 say the repository was deleted [21]. Do not plan on it.

**Handoff.** STEP AP242 is now ISO 10303-242:2025, Edition 4 (Aug 2025) [29]. OCCT writes the older AP242DIS schema, with semantic GD&T, validation properties and user attributes (formats report). 3dj's Evidence Pack v1 still lists only AP203/AP214 [27]. Vendors are honest that AI drawings are drafts. SolidWorks calls LEO's Drawing Creation output "a starting point that requires professional review" [5]. Autodesk says Fusion's automated drawings will not add notes or GD&T [6b].

## 2. Which stages an agent-first open CAD can own

A stage is agent-ownable early when it meets four tests:
1. Its output can be measured by the kernel.
2. Its rules are public.
3. A wrong answer costs a cheap reprint, not a steel mould.
4. Taste can be separated out and left to a human approval.

| Own early (months) | Assist only, human-led | Years, or leave to partners |
|---|---|---|
| Brief and spec capture with assertions | Concept selection and styling (taste) | Class-A surfacing, G3 panels |
| Parametric housings, fasteners, inserts, snaps | CMF selection | Moulding flow, pack and warp simulation |
| DfAM gates and print quotes | Ergonomic sign-off | Validated drop and impact results |
| Rule-based moulding, sheet-metal and CNC DFM | GD&T scheme and datum choice | Mould design: cooling, ejection, slides |
| Surface continuity and curvature reports | FEA interpretation | PPAP and first-article inspection |
| Variant renders, BOM, RFQ pack, quote comparison | Supplier choice and ordering | Certification (food contact, UL, CE) |

## 3. Proposed Open3DJ industrial design (ID) pipeline

Each slice is a small, usable release. It runs as a PDCA cycle with one main measure. Any false "pass" on a gate stops the line until the root cause is found and a regression test is added. Every slice starts with one product family, **small electronics enclosures and handheld consumer products**. The 3dj starters already cover it (project box, vented enclosure, snap fits, heat-set bosses), and ABS and PC moulding rules apply to it.

### ID-0: brief to printed prototype (first slice)

- **Scope:**
  1. A `brief.o3j.yaml` with purpose, environment, interfaces (for example a 60 x 40 mm PCB on M3 standoffs), critical dimensions with confidence labels, process, material and quantity.
  2. The agent writes the part in the DSL using `lib.*`.
  3. The usual GeometryReport and Evidence Pack FDM gates run (watertight, 0.8 mm nozzle-safe wall, 45 degree overhang, 220 x 220 x 250 mm bed).
  4. Snap renders are produced, plus STEP and 3MF exports.
  5. The output is a print quote.
- **Human approvals (daemon-owned):** the brief, the design, and acceptance of the quote.
- **Quoting gap:** 3dj quotes need a saved 3dj `modelId` and take no file or evidence hash (gap-9). Until the founder adds an upload tool and a hash field to 3dj, there are two options. Dogfood ID-0 on 3dj itself through its MCP server, or give local Open3DJ parts a free local estimate from an OrcaSlicer subprocess (AGPL, so never linked).
- **Measure:** first-print success, meaning the part fits and works on the first print. Volunteers print and handle every part ("go and see"). Each failure is root-caused (five whys) and becomes a gate test or a `lib` fix.
- **Cash cost:** none beyond filament or a print order.

### ID-1: concept board

- **Scope:** a `concept` provider capability that turns the brief into N image variants. Local Apache-2.0 models (FLUX.1 schnell, Qwen-Image) serve as the clean default. KeyShot made the same move in 2026.1, switching its AI Shots from FLUX.1 schnell to a modified Qwen [14].
- **Hosted tools:** Vizcom or other SaaS only through the user's own account, with egress consent.
- **Massing:** the chosen image becomes a massing mesh through TRELLIS v1 (geometry-only clean runner) or the 3dj fleet. The agent rebuilds it as editable DSL (`loft`, `Shape.fromSlices`, `spline2d`), labelled "assumed".
- **Board:** a concept board records prompts, model, licence and seed for every image.
- **Human approval:** picks the direction.
- **Measure:** hours from brief to chosen direction, and the Hausdorff distance between the rebuilt parametric part and the massing mesh.

### ID-2: form and CMF

- **Scope:**
  1. Expose surface operations in the op set and DSL: filling with G1/G2 constraints, Gordon networks, sweeps and lofts with continuity options. Check `IsApproximate()` and `G2Error()` before anything is accepted.
  2. Add a **continuity table** to the GeometryReport. For each shared edge, sample the maximum gap (G0), maximum tangent angle (G1) and maximum relative curvature jump (G2). Add a curvature range per face. Produce deterministic zebra and curvature heat-map renders for humans.
  3. Add `cmf.o3j.json`. It records colour per body or face as sRGB or Lab, the resin grade, the finish class as free text (for example an SPI or VDI 3400 class), and the texture depth, which feeds the draft rule in ID-3. Variants export as glTF KHR_materials_variants, with an optional Cycles render provider.
- **Human approval:** form and CMF.
- **Measure:** the continuity numbers match analytic test surfaces (for example a plane-to-cylinder tangent blend should report a G1 angle of 0 and a known G2 jump). Volunteers who own Rhino or Plasticity can cross-check them.

### ID-3: moulding-ready DFM gates

- **Scope:** a gate profile `im.<resin>.v1`. Given a pull direction, it computes:
  - draft per face, against a depth- and texture-aware minimum;
  - a wall-thickness map, against the resin range;
  - rib-to-wall ratio (0.4 to 0.6) and boss wall, draft and height-to-diameter rules;
  - undercuts (faces reachable from neither the core side nor the cavity side by ray casting);
  - parting-line candidates (silhouette edges along the pull direction from HLR);
  - sharp internal corners and thick-section sink risk.
- **Draft fixes:** a `draft` op wraps `BRepOffsetAPI_DraftAngle`. Freeform faces it cannot draft are flagged for form rework.
- **Rules:** each rule is written from public guidance with a citation and a version, never copied from paid ISO text. Waivers are recorded with a reason.
- **Measure:** a golden corpus of about 30 parts with seeded defects. A false negative stops the line. False positives are tracked and cut by small rule changes.

### ID-4: engineering detail and validation

- **Scope:**
  - Assemblies, mates and interference (from the old v0.8 plan).
  - A fastener and insert BOM as CSV.
  - Worst-case and RSS tolerance stacks, with a general-tolerance callout. The user enters an ISO 20457 class name; the standard's text is not shipped.
  - CalculiX (static, modal, thermomechanical) and Elmer (thermal) as GPL subprocess providers. Each result carries mesh-convergence evidence and the label "simulation, not test".
- **Drop testing:** physical drop tests of printed or cast prototypes are the honest answer for now.
- **Measure:** analytic benchmarks (cantilever, plate, fin) within 2%.

### ID-5: handoff and RFQ

- **Scope:**
  - An AP242 export with semantic PMI for critical dimensions, taken from the spec assertions.
  - Drawing sheets (SVG and PDF) from OCCT HLR, with title block, views and the critical dimensions only.
  - An **RFQ pack** containing STEP, the drawing, the CMF sheet, the BOM, quantities, the Evidence Pack and an open-questions list.
- **Who acts:** the agent compares quotes that come back in a table. A human sends every RFQ and places every order.
- **Measure:** supplier clarification questions per RFQ.

### ID-6: tooling liaison and Class-A (multi-year research track)

- **Scope:**
  - Exchanging DFM reports with the moulder, and entering T1 sample measurements as QIF with "measured" labels. This includes the engineering-change loop.
  - A Class-A research track with volunteer designers.
  - Moldflow interop for users who hold their own licence.
  - openInjMoldSim for research only.

**Dependencies.**
- ID-0 can start now on 3dj or on the first Open3DJ preview.
- ID-1 needs the provider router.
- ID-2 needs the expanded op set and analysis.
- ID-3 builds on ID-2's draft work.
- ID-4 needs assemblies.
- ID-5 needs the PMI writer and HLR.
- Each slice ships before the next one starts (small batches). Kaizen events run between slices to cut steps that agents or volunteers repeatedly route around.

## 4. Licence constraints

- **Concept images.** FLUX.1 schnell [15] and Qwen-Image [16] are Apache-2.0. Other variants in both families carry different terms, so check every checkpoint and LoRA separately in the provider manifest. Vizcom's paid plans are not used for training, but free-plan generations may be [11].
- **3D generation.** TRELLIS v1 geometry-only is the clean default. TripoSG, TRELLIS.2 and Hunyuan3D are opt-in restricted packs (gap-4). Hunyuan3D excludes the EU, UK and South Korea.
- **Human models.** SMPL-X forbids "any use for commercial ... purposes" [24]. MPFB code is GPL-3.0 and its assets are CC0, so it should run as a Blender-side plugin. ANSUR II is public but describes US military personnel, not civilians, and its 3D scans are withheld [23].
- **Colour.** Adobe dropped most Pantone books in 2022 over licensing, and full access needs a paid Pantone Connect licence [26]. Store numeric colour; let users attach their own reference names.
- **Solvers and tools.** CalculiX (GPL-2.0), Elmer (GPL-2.0 and LGPL-2.1), openInjMoldSim (GPL-3.0 on GPL OpenFOAM), Blender (GPL) and the slicers (AGPL) run only as subprocess providers. Cycles, MaterialX, gsplat, Manifold and Kiri:Moto are permissive and can be bundled. FreeCAD SheetMetal is LGPL-2.1 and runs inside FreeCAD.
- **Standards.** ISO 20457, ISO 10303-242 and ISO 2768 are paid documents. Rules may cite them by number but must be written from public sources.
- **Commercial tools as optional sidecars.** Moldflow, KeyShot, Rhino and Plasticity should only ever be optional, user-licensed sidecars. None is required for any slice.

## 5. Open questions

- Should 3dj gain a presigned upload tool and an evidence-hash field for quotes? The founder controls both sides, so this is the cheapest unblocker for ID-0.
- Can OCCT 8.0.1 reliably draft or offset Gordon and filled faces? This is untested here and should be spiked before ID-2 promises freeform draft.
- Can CalculiX's explicit solver give a useful drop-test screen once OpenRadioss is gone? This is unvalidated.
- Has the GPU-accelerated OpenRadioss code survived in a public fork? Not found in this pass.

## Sources

1. OCCT 8.0.1 BRepOffsetAPI_DraftAngle: https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___draft_angle.html
2. OCCT 8.0.1 BRepOffsetAPI_MakeFilling: https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_filling.html
3. OCCT 8.0.1 GeomFill_Gordon: https://occt3d.com/dev/doc/refman/html/class_geom_fill___gordon.html
4. OCCT 8.0.0 release notes (Gordon, GeomProp/BRepProp curvature, HLR): https://newreleases.io/project/github/Open-Cascade-SAS/OCCT/release/V8_0_0
5. SOLIDWORKS 2026 LEO and AURA: https://discover.solidworks.com/meet-leo-aura-in-solidworks-2026 ; https://www.goengineer.com/en-us/blog/solidworks-2026-in-the-classroom-how-ai-driven-design-frees-up-your-office-hours
6. OCCT HLRBRep_Algo: https://occt3d.com/dev/doc/refman/html/class_h_l_r_b_rep___algo.html ; 6b. Fusion automated drawings: https://www.autodesk.com/products/fusion-360/blog/ai-in-manufacturing-automated-drawings-in-autodesk-fusion and https://fabbaloo.com/?p=228289
7. build123d operations (draft, thicken, sweep, loft): https://build123d.readthedocs.io/en/latest/operations.html
8. build123d technical drawing tutorial: https://build123d.readthedocs.io/en/latest/tech_drawing_tutorial.html
9. Alias and VRED 2027: https://blogs.autodesk.com/design-studio/2026/04/16/whats-new-in-alias-and-vred-2027/ ; https://develop3d.com/visualisation/alias-and-vred-2027-lessen-friction-between-surfacing-and-review/
10. Moldflow 2027 what's new: https://help.autodesk.com/cloudhelp/2027/ENU/MoldflowInsight-CLC-WhatsNew/files/MFLO-WHATS-NEW-2027-0.html
11. Vizcom: https://vizcom.com/ ; Fusion app: https://marketplace.autodesk.com/apps/cbb206eb-b594-4cc1-9d87-9ed186bcdc55
12. Rhino 9 beta newsletter (Aug 2026): https://www.rhino3d.com/en/e-news/0826beta2/
13. Plasticity 2026.2: https://80.lv/articles/3d-modeling-cad-software-plasticity-2026-2-has-been-released/ ; https://digitalproduction.com/2026/10/21/plasticity-2026-2 ; 2025.2 notes: https://doc.plasticity.xyz/release-notes/whats-new-2025.2
14. KeyShot Studio 2026.1: https://www.cgchannel.com/?p=174985 ; https://www.keyshot.com/blog/keyshot-studio-performance-updates-version-2026-1/
15. FLUX.1 schnell model card: https://huggingface.co/black-forest-labs/FLUX.1-schnell
16. Qwen-Image model card: https://huggingface.co/Qwen/Qwen-Image
17. Cycles: https://github.com/blender/cycles ; Blender 5.2.3 LTS (22 Oct 2026): https://www.blender.org/download/
18. Protolabs ProDesk (17 Feb 2026): https://www.digitalcommerce360.com/2026/02/17/protolabs-launches-prodesk-ai-quoting-production-management/ ; 18b. Protolabs moulding basics: https://www.protolabs.com/resources/design-tips/injection-molding-basics/ ; 18c. Fathom guide: https://fathommfg.com/app/uploads/2025/12/Design-Guidelines-for-Injection-Molding.pdf ; 18d. Protolabs bosses: https://www.protolabs.com/en-gb/resources/design-tips/choosing-the-right-boss-for-your-part-design/
19. CalculiX 2.23: https://www.dhondt.de/
20. FreeCAD SheetMetal: https://github.com/shaise/FreeCAD_SheetMetal
21. OpenRadioss status: https://www.siemens.com/en-us/products/simcenter/mechanical-simulation/radioss/rd/ ; https://foro3d.com/2026/octubre/siemens-cierra-openradioss-y-deja-sin-solver-abierto-al-sector.html
22. openInjMoldSim: https://github.com/krebeljk/openInjMoldSim
23. ANSUR II: https://www.openlab.psu.edu/ansur2/ ; https://www.army.mil/article/188601/for_good_measure_natick_releases_raw_data_from_army_wide_anthropometric_survey
24. SMPL-X licence: https://smpl-x.is.tue.mpg.de/modellicense.html ; MPFB: https://github.com/makehumancommunity/mpfb2
25. MaterialX: https://github.com/AcademySoftwareFoundation/MaterialX ; Elmer: https://github.com/ElmerCSC/elmerfem
26. Pantone in Adobe: https://appleinsider.com/articles/22/10/29/plugin-now-required-to-use-most-pantone-colors-in-adobe-products
27. 3dj MCP `cad_get_evidence_schema` and `cad_get_starters` (public tools, called 28 Oct 2026)
28. ISO 20457:2026: https://www.technickenormy.cz/en/iso-20457-2026-plastics-moulded-parts-tolerances-and-acceptance-conditions/
29. ISO 10303-242:2025: https://www.iso.org/standard/84300.html ; https://steptools.com/docs/stp_aim/notes_ap242e4.html
