# Open3DJ research: file formats, interoperability, provenance and the manufacturing pipeline

Research date: 2026-10-27. Method: official documentation, specification repositories, release pages and vendor sites fetched directly (the shared web-search budget was exhausted, so no search-engine queries were run; every claim below is tied to a fetched URL, and anything that could not be fetched is flagged as unverified).

## Executive summary

Open3DJ should make a **plain-text, git-diffable feature tree with embedded scripts** its source of truth, and treat every binary CAD format as a derived export. OCCT 8.0.1 (LGPL-2.1) gives the kernel-level export matrix for free: STEP AP203/AP214/AP242DIS with semantic GD&T, validation properties, user attributes and tessellated geometry; glTF 2.0 (with Draco), OBJ, STL, PLY (write-only), VRML and IGES. 3MF is not in OCCT but lib3mf (BSD-2) covers it, and 3MF is now ISO/IEC 25422:2025 with a Boolean Operations extension (CSG inside the container), Production extension (UUIDs on every object/build item) and a metadata model with vendor namespaces and MustPreserve parts, which makes 3MF the best interchange carrier for Open3DJ's evidence data. Among slicers, OrcaSlicer and Bambu Studio share one headless CLI contract (`--slice`, `--export-3mf`, `--load-settings`, `--load-filaments`); PrusaSlicer has the Slic3r-lineage CLI; all three are AGPL-3.0 and must be driven as separate processes. Among print services, only Shapeways (relaunched by Manuevo BV after the July 2024 Chapter 7) publishes a usable public API today; Xometry, Craftcloud, PCBWay, Protolabs Network and JLC3DP expose web quoting only (JLC3DP advertises a "JLCAPI" whose scope could not be verified). For measurement confidence (measured/observed/inferred/assumed), the recommended representation is a single `o3j` JSON vocabulary that is emitted natively, injected into STEP as AP242 plus/minus tolerances and user-defined attributes with CAx-IF persistent UUIDs, into 3MF as namespaced metadata plus a MustPreserve evidence part, into glTF as KHR_xmp_json_ld packets, and exported as QIF 3.0 (ISO 23952:2020) for metrology tools. Standard parts should be sourced from Apache-2.0 collections (bd_warehouse, cq_warehouse) and ISO tables, never from GPL libraries linked into the core or from McMaster-Carr's gated CAD API.

## 1. 3D B-Rep interchange: STEP AP203 / AP214 / AP242

What OCCT actually does (version 8.0.1, released 30 Jul 2026; 8.0.0 on 7 May 2026):

- **Reading**: AP214 (CC2, CD and DIS schemas), AP203 and "some parts of AP242". **Writing** is controlled by `write.step.schema`: `1`/`AP214CD` (default), `2`/`AP214DIS`, `3`/`AP203`, `4`/`AP214IS`, `5`/`AP242DIS`. `STEPControl_Writer::Model(true)` must be called after changing it.
- **GD&T / semantic PMI**: dimensions with qualifiers, plus/minus bounds, ranges, tolerance classes, datums (with datum features and targets), geometric tolerances with modifiers and datums. Everything the reader imports can be exported, but AP242 must be selected manually because the default is AP214; AP214 GD&T handling is marked obsolete.
- **Graphical PMI**: polyline and tessellated-wireframe presentations are partially implemented; styling (colour, curve style, filled characters) is lost; saved views are read but not written.
- **Validation properties** (area, volume, centroid) and **user-defined attributes** at product, instance and geometry level are read and written; product names are kept unique on write.
- **Tessellated geometry**: `read.step.tessellated` (0/1/2, default 1) and `write.step.tessellated` (0/1/2, default 2 = write tessellation only when no B-Rep), with TESSELLATED_SHELL / TESSELLATED_SOLID / TRIANGULATED_FACE entities.
- **Kinematics**: not mentioned in the OCCT STEP guide excerpts read; treat as unsupported until verified.
- OCCT 8.0 made STEP read/write thread-safe with one instance per thread (IGES read must be serialised), and 8.0.1 fixed oversized STEP string records.

The CAx Interoperability Forum (MBx-IF) maintains the recommended practices for AP242 PMI (graphic to semantic), tessellated geometry, kinematics, composites, user-defined attributes and **persistent IDs** (`V5_UUID_ATTRIBUTE` in STEP, `EntityExternalIds` in QIF), with "100% traceability success" claimed when implemented. ap242.org and iso.org returned 503/403 during this research, so the edition number of ISO 10303-242 (Edition 3 published 2022 to my recollection; Edition 4 in progress) is **unverified**.

Decision: default export is **AP242DIS with semantic GD&T, validation properties and `V5_UUID_ATTRIBUTE` persistent IDs**; AP214 remains an explicit compatibility option for older CAM/ERP importers. AP203 is only worth keeping for legacy tooling.

## 2. 3MF

The 3MF Consortium registry (3mf.io/spec) lists: Core v1.3.0 (**ISO/IEC 25422:2025**, latest revision PDF 1.4.0, updated 2025-02-27), Materials & Properties 1.2.1, Beam Lattice 1.2.0, Production 1.1.2, Secure Content 1.0.2, **Boolean Operations 1.1.1** (2025-04-03), Volumetric 0.8.0 and **Toolpath 1.0.0** (2026-09-17; the GitHub repo still calls it a draft "laser toolpath" extension covering layer-by-layer toolpath parts, process settings, multi-axis paths and laser source metadata). All specs are freely available with royalty-free patent commitments. Slice and Displacement extensions are no longer listed.

Metadata model (core spec): a `<metadata name=...>` element under `<model>`, nine reserved names (Title, Designer, Description, Copyright, LicenseTerms, Rating, CreationDate, ModificationDate, Application); any other name **must be prefixed with a declared XML namespace**; optional `preserve="true"` asks editors to keep values across re-saves; `type` names an XML simple type; `<metadatagroup>` is allowed on `<object>` and `<item>`; `requiredextensions` / `recommendedextensions` gate processing; and custom OPC parts survive re-saves only if linked through a **MustPreserve** relationship.

Reference implementation: **lib3mf 2.5.0** (PyPI release 2026-02-23), BSD-2-Clause, bindings for C, C++, C#, Python, Go, Node.js and Pascal.

Slicer dialects (verified from Bambu Studio source `bbs_3mf.cpp`): Bambu/Orca 3MF projects add `Metadata/model_settings.config`, `Metadata/project_settings.config`, `Metadata/print_profile.config`, `Metadata/slice_info.config`, `Metadata/filament_sequence.json`, `Metadata/assembly_*.json`, `Metadata/layer_config_ranges.xml`, `Metadata/custom_gcode_per_layer.xml`, `Metadata/cut_information.xml`, `Metadata/plate_N.png` / `.gcode`, `Auxiliaries/`, and model-level keys `BambuStudio:3mfVersion`, `BambuStudio:FdmSupportsPaintingVersion`, `BambuStudio:SeamPaintingVersion`, `BambuStudio:MmPaintingVersion`, `Title`, `Designer`, `DesignId`, `License`, `Application`, plus MakerLab/Profile keys; they still read the legacy `slic3rpe:shape` tag. PrusaSlicer's `3mf-import-matrix.md` states that 3MFs from Bambu Studio, OrcaSlicer or modelling tools import **geometry only** ("Imported geometry only. 3MF settings ignored"), and only PrusaSlicer-authored 3MFs restore print/filament/printer settings. (PrusaSlicer's own part names `Metadata/Slic3r_PE.config` and `Metadata/Slic3r_PE_model.config` are from prior knowledge; the source file has moved and could not be fetched.) Conclusion: slicer settings are not portable across slicer families; Open3DJ should emit a **clean core 3MF** plus optional per-slicer projects generated by the slicer's own CLI.

## 3. glTF 2.0, OpenUSD, OBJ/PLY

Khronos registry status: ratified KHR_xmp_json_ld (metadata), KHR_materials_variants, KHR_draco_mesh_compression, KHR_mesh_quantization, KHR_texture_basisu, EXT_meshopt_compression, EXT_mesh_gpu_instancing, KHR_interactivity, KHR_node_visibility / selectability / hoverability, KHR_animation_pointer, KHR_gaussian_splatting. In review: **KHR_accessor_float64** (relevant for large CAD assemblies, since glTF accessors are float32), KHR_collision_shapes, KHR_physics_rigid_bodies. Multi-vendor: EXT_mesh_manifold. There is **no KHR CAD extension**; Cesium's EXT_structural_metadata (draft) offers schema-driven property tables indexed per feature, vertex or texel, which is the only standard-ish way to carry per-face attributes. KHR_xmp_json_ld attaches JSON-LD packets to `asset`, `scene`, `node`, `mesh`, `material`, `image`, `animation`, using XMP (ISO 16684-1) namespaces such as dc, xmp, xmpRights, xmpMM.

OCCT's `RWGltf_CafWriter` writes JSON or binary GLB, supports Draco (`SetCompressionParameters`), face merging with 16-bit index preference, parallel export, compact transformation format, embedded textures and configurable node/mesh naming; OCCT's DE wrapper also reads glTF. OBJ is read/write, **PLY is write-only**, STL and VRML are read/write.

OpenUSD: latest 26.11.1 (21 Oct 2026); licensed under the **Tomorrow Open Source Technology License 1.0**, an Apache-2.0 derivative differing only in its trademark clause. OCCT markets a separate "USD Import & Export" component that reads/writes .usd/.usda/.usdz **as meshes only** (CAD surfaces are meshed first); whether it is open source is not stated on the page, so treat it as commercial. USD is therefore a phase-2 visualisation/DCC export via the OpenUSD library itself, not a CAD carrier.

## 4. 2D: DXF and SVG; AEC: IFC

DXF: ezdxf (MIT) reads/writes R12, R2000, R2004, R2007, R2010, R2013 and R2018; R12 remains the lowest common denominator for laser and CNC controllers. OCCT's own DXF translator is a commercial component. FreeCAD CAM ships `dxf_post.py`, `svg_post.py` and `generic_sheet_cutting_post.py` for 2D cutting, in addition to grbl, linuxcnc, mach3_mach4, marlin, fanuc, heidenhain, centroid, dynapath, estlcam, masso_g3, opensbp, smoothie and ~20 legacy posts. CadQuery exports DXF and SVG; build123d imports SVG; JSCAD exports DXF/SVG.

IFC: IfcOpenShell 0.9.0.post1 (15 Oct 2026, LGPL-3.0-or-later; Bonsai is GPL-3.0-or-later) parses IFC2X3 TC1, IFC4 Add2 TC1, IFC4x1, IFC4x2 and IFC4x3 Add2, with extensive geometry only for IFC2x3 and IFC4; ifcJSON-4 is still an in-development spec tracking IFC4.3, with IFC5 only "followed". The ISO status of IFC 4.3 (ISO 16739-1:2024 from prior knowledge) could not be verified because buildingSMART pages returned 403. IFC should be an optional plugin, not part of the core.

## 5. Script formats

| Format | Engine | License | Notes |
|---|---|---|---|
| OpenSCAD | CGAL / Manifold | GPL-2.0 with CGAL exception | Stable release is still 2021.01; nightlies expose the Manifold engine as an opt-in preference and `--backend=manifold` / `--export-format=binstl` flags. 3MF export since 2019.05, lib3mf v2 API since 2021.01. |
| Manifold | mesh CSG | Apache-2.0 | Guaranteed-manifold booleans; WASM `manifold-3d` (npm) and `manifold3d` (PyPI); used by OpenSCAD, Blender, Godot, trimesh, BRL-CAD, Kiri:Moto. |
| CadQuery | OCCT via OCP | Apache-2.0 | 2.8.0 (21 Jun 2026); exports STEP, DXF, STL, VRML, AMF, 3MF. |
| build123d | OCCT via OCP | Apache-2.0 | 0.13.0 (21 Sep 2026); STEP/STL import-export, SVG import. |
| replicad | OpenCascade.js (WASM) | MIT | STEP and STL export; the 3dj.app scripting layer builds on it. |
| JSCAD | CSG (JS) | MIT | 3MF, AMF, DXF, OBJ, STL, SVG, X3D. |
| KCL (Zoo Design Studio) | hosted engine | app MIT | Everything is stored as KCL text, but "the 3D view is just a video stream from our hosted geometry engine", so KCL cannot be executed locally. |

Implication: Open3DJ can legally embed Manifold, replicad/OpenCascade.js (LGPL dynamic or WASM, see open question) and the Apache/MIT script ecosystems in-process; OpenSCAD must be executed as a subprocess (GPL-2.0), which is exactly what 3dj.app already does with its isolated engine.

## 6. Machine-readable model representations and git-friendliness

- **CADmium** invented `.cadmium`, a JSON project format (projects, workspaces, sketches, extrusions, constraints) on the Rust `truck` kernel, licensed Elastic License 2.0, and was **archived on 5 Sep 2025**; nothing to adopt, but a useful cautionary example (non-OSI license plus immature kernel).
- **Dune 3D** (GPL-3.0) uses Open CASCADE for STEP and fillets and the SolveSpace solver as a library; its documentation has a "File versions" page (format details unverified, believed JSON).
- **FreeCAD FCStd** (verified from `Document.cpp`): a ZIP whose first entry is `Document.xml` (`SchemaVersion="4"`, `ProgramVersion`, `FileVersion`, StringHasher table, object type list, per-object data), with a `CompressionLevel` preference (default 7), an optional `SaveBinaryBrep` mode, and timestamped `.fcbak` backups (`CountBackupFiles` default 1). FreeCAD 1.1.4 (28 Sep 2026) patched FCStd parsing vulnerabilities; 26.3 RC2 (18 Oct 2026) starts calendar versioning. Zipped XML plus binary BREP is not diffable and has been a security surface.
- **Onshape FeatureScript** defines every built-in feature (Extrude, Fillet, Helix) as a function in a public "std" document; the license of that library is not stated on the FsDoc page.
- **SolveSpace** (GPL-3.0-or-later) keeps a text `.slvs` format (prior knowledge).

Lesson: the formats that age well are text, ordered, and identify entities by stable IDs; the ones that hurt are zipped XML with binary blobs and pointers by index.

## 7. Provenance and versioning for agent-made changes

Standards worth reusing rather than inventing: W3C **PROV-O** (Recommendation, 30 Apr 2013: Entity / Activity / Agent, `wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`, `used`, `wasAssociatedWith`); XMP via **KHR_xmp_json_ld** in glTF; CAx-IF **persistent UUIDs** (`V5_UUID_ATTRIBUTE`) in STEP; the 3MF **Production extension** (`p:UUID` on objects, build items and paths, already present in Bambu's files) and namespaced `<metadata>`; and **QIF 3.0 = ISO 23952:2020**, the XML framework for measurement plans, results, PMI and resources that pairs with STEP via `EntityExternalIds`.

## 8. Manufacturing integration

Slicer CLIs (all AGPL-3.0):

- **Bambu Studio** 2.8.2.61 (21 Aug 2026): `bambu-studio [files] --slice 0|N --export-3mf out.3mf --load-settings "machine.json;process.json" --load-filaments "f1.json;f2.json" --outputdir dir --arrange --orient --export-settings --export-slicedata`; one machine and one process file, full configs only; CLI `--key=value` overrides beat loaded files, which beat 3MF-embedded settings.
- **OrcaSlicer** 2.4.2 (2.5.0 alpha): same contract plus `--export-stl`, `--export-stls dir`, `--min-save`, `--mtcpp`, `--mstpp`, `--no-check`, `--normative-check`, `--info`, `--uptodate`, `--pipe name` for progress; 43 keys (print-host credentials etc.) are blocked; no dedicated G-code flag because sliced output is the `.gcode.3mf` package. Imports STL, 3MF, STEP, DRC, OBJ, AMF, SVG, ZIP; exports STL, DRC, generic 3MF, G-code, gcode.3mf, toolpath OBJ and `.statistics.json`.
- **PrusaSlicer** 2.9.6 (25 Jun 2026; 3.0.0-alpha12 21 Sep 2026): Slic3r-lineage CLI (`--export-gcode`, `--export-3mf`, `--export-stl/obj/amf`, `--export-sla-svg`, `--info`, `--repair`, `--merge`, `--load config.ini`, `--output`, `--center/--scale/--rotate/--cut/--split`); GUI presets are ignored, so presets must be exported to `.ini`. (Verified against the Slic3r manual; PrusaSlicer-specific additions not re-verified.)
- **CuraEngine** (AGPL-3.0): `CuraEngine help`; slicing needs a settings definition JSON from the Cura repo; `CuraEngine connect host:port` links to a frontend over Arcus/protobuf.

CAM: **FreeCAD CAM** (GPL-2.0 workbench inside LGPL FreeCAD) with the post-processor list above, runnable headless with FreeCADCmd; **Kiri:Moto** (MIT, 4.x) covers FDM, CAM and laser and exposes a JavaScript slicing/G-code engine API that runs in a web worker, plus an iframe messaging API, i.e. embeddable in-process under MIT; **pycam** (GPL-3.0) does 3-axis toolpaths with a `run_cli.py FLOW_SPECIFICATION_FILE` scripted mode. ESPRIT (Hexagon) is proprietary and was not researched further.

DfM/DfAM tooling: **trimesh** 5.2.0 (24 Oct 2026, MIT) for watertightness, winding and hole repair with STL/OBJ/PLY/glTF/3MF/OFF/3DXML import; Manifold for guaranteed-manifold booleans; Blender's 3D-Print Toolbox 1.5.0 (GPL-3.0-or-later, "Make Manifold", volume/area); PrusaSlicer `--repair`. Wall thickness, overhang, draft-angle and trapped-volume checks are not available as a reusable permissive library and should be implemented on OCCT (`BRepExtrema` distance, face normal vs build/pull direction, cavity detection on the shell graph). PCBWay and Xometry both advertise automated DfM feedback in their quoting tools as a reference for which checks customers expect.

Print-service APIs:

| Service | Programmatic access | Evidence |
|---|---|---|
| Shapeways | Public API v1 (materials, model upload with printability check, orders, cart/shipping; "API access is free") at developers.shapeways.com. Company filed Chapter 7 on 2 Jul 2024; Manuevo BV (Eindhoven) bought the assets on 29 Jul 2024, reopened 1 Aug 2024, bought the US IP on 3 Dec 2024 and acquired Thangs on 18 Dec 2024. | shapeways.com, developers.shapeways.com, Wikipedia |
| Xometry | No public developer API found; free CAD add-ins for SOLIDWORKS, Autodesk Fusion and Onshape; accepts STEP, STP, SLDPRT, STL, DXF, IPT, X_T, X_B, 3DXML, CATPART, PRT, SAT, 3MF, JT. | xometry.com |
| Craftcloud (All3DP) | 150+ partners, 35+ formats, no API link anywhere. | craftcloud3d.com |
| JLC3DP | Instant quotes from $0.30 (SLA), $1 (MJF/FDM/SLS), $8 (SLM); footer links "JLCAPI" (scope unverified). | jlc3dp.com |
| PCBWay | Instant quote with automated DfM; no API; integration contact 3dcnc@pcbway.com. | pcbway.com |
| Protolabs Network (ex-Hubs) | No API on site; uploads STEP, STP, IGES, IGS, SLDPRT, 3DM, SAT, X_T. | hubs.com |
| Sculpteo | Site returned 403; status unverified. | — |

## 9. Standard-parts libraries

- **bd_warehouse** and **cq_warehouse** (Apache-2.0, gumyr): parametric fasteners/threads and related parts generated on demand; permissive, Python, OCCT-based.
- **BOLTS** (boltsparts/boltsparts, GPL-3.0): YAML-driven data with FreeCAD, OpenSCAD and SolidWorks backends.
- **FreeCAD Fasteners Workbench** (GPL-2.0, V0.5.67 on 10 Sep 2026): the broadest coverage (ISO 4762/4032/7049/1478/2342/8733-8752/14581, DIN 933/985/6912/7984/471/472/6330/6340, ASME B18.6.1/B18.6.3/B18.2.1.6, GOST, NFE, EJOT, GN T-slot nuts, BSP).
- **McMaster-Carr Product Information API**: approved customers only (eprocurement@mcmaster.com), per-customer client certificate on every request, 24-hour bearer tokens, per-product subscriptions with daily caps, a rate-limited `/v1/cad/` endpoint delivering 2-D DWG and 3-D STEP, and **no stated license** for CAD reuse.

## Recommendations for Open3DJ

1. **Native format: an `.o3j` project directory (zip-able), text first.** `model.o3j.json` is a canonical, deterministically serialised feature tree: every feature, parameter and topological reference carries a UUIDv7; selectors are stored as named references plus a geometric fingerprint (centroid, normal, area, bounding box) so that renames and rebuilds stay diffable. Script features (`.js` replicad, `.py` build123d/CadQuery, `.scad`) are first-class nodes with their source inlined or referenced, so 3dj.app scripts drop in unchanged. Derived data (`cache/*.brep`, `*.step`, `*.glb`) is reproducible and excluded from git by default (LFS optional). This is what CADmium, Dune 3D and FeatureScript got right and FCStd got wrong.
2. **Provenance ledger in the project**: `provenance.jsonl`, append-only PROV-O-shaped records (`agent` = model id and MCP client, `activity` = tool call with argument hash, `entity` = feature UUID + content hash, `wasDerivedFrom`). Every export embeds the project UUID and ledger head hash.
3. **Export matrix** (phase 1 unless noted): STEP AP242DIS default + AP214 option (OCCT, GD&T + validation properties + user attributes + `V5_UUID_ATTRIBUTE`); binary STL; 3MF core + materials + production UUIDs + `o3j:` namespaced metadata + MustPreserve `Metadata/o3j_evidence.json` (lib3mf), with Boolean Operations when the consumer supports it; GLB/glTF via OCCT with KHR_xmp_json_ld packets, optional Draco and EXT_mesh_gpu_instancing; OBJ, PLY (write), DXF R12/R2018 and SVG (mm) for 2D; `.gcode.3mf` through slicer providers; script source export (`.scad`, `.py`, `.js`). Phase 2: OpenUSD (mesh, via OpenUSD library), IFC (IfcOpenShell plugin), QIF 3.0 results.
4. **Measurement confidence in files**: one vocabulary `o3j:confidence ∈ {measured, observed, inferred, assumed}` with `tolerance_mm`, `method`, `instrument`, `source_asset`, `timestamp`, `agent`, stored per parameter and per feature UUID in `evidence.json` (defaults: ±0.15 / ±0.35 / ±0.80 / unbounded, matching 3dj.app's Evidence Pack). Carriers: STEP as plus/minus dimensional tolerances (semantic AP242 PMI) and user-defined attributes keyed by the same UUIDs; 3MF as `<metadata name="o3j:confidence" preserve="true">` at model level, `<metadatagroup>` per object, and the evidence part; glTF as per-node XMP packets (coarse) with EXT_structural_metadata property tables when per-face data matters; STL and other dumb formats get a sidecar `<name>.evidence.json` containing the file's SHA-256. Publish the JSON Schema jointly with 3dj.app as "Design Evidence Pack v2".
5. **Manufacturing providers behind one interface** (`prepare`, `quote`, `slice`, `post`, `submit`): local slicer providers for OrcaSlicer/Bambu Studio (identical CLI), PrusaSlicer and CuraEngine, always as subprocesses with explicit config files so no AGPL code is linked into the MIT core; CAM providers for Kiri:Moto (in-process, MIT), FreeCAD CAM (headless subprocess) and pycam; print providers starting with Shapeways API v1 and 3dj.app's operator-quote workflow, with "package and hand-off" adapters (open the vendor upload page with a prepared STEP/3MF) for Xometry, Craftcloud, PCBWay, JLC3DP and Protolabs until they expose APIs.
6. **DfM gate as a native tool**: watertight (Manifold/trimesh), minimum wall (OCCT BRepExtrema sampling), overhang angle and bridging vs build direction, draft angle vs pull direction, trapped volumes, bed-volume fit, nozzle-safe feature size, returning machine-readable pass/fail with the evidence vocabulary above; reuse the 3dj.app gate defaults (0.8 mm wall, 45 deg, 220x220x250 mm).
7. **Standard parts**: ship a permissive `o3j-stdlib` generated from bd_warehouse/cq_warehouse (Apache-2.0) and ISO/DIN tables; wrap FreeCAD Fasteners and BOLTS only as opt-in GPL plugins running out of process; never cache or redistribute McMaster-Carr CAD, but allow users to bring their own API certificate.
8. **Licensing hygiene**: Open3DJ core MIT; OCCT via dynamic linking on desktop; for the WASM build, follow OpenCascade.js/replicad practice and ship relinkable object files or a clearly separated LGPL bundle to satisfy LGPL-2.1 section 6; keep GPL/AGPL engines (OpenSCAD, slicers, FreeCAD CAM, pycam) in subprocesses.

## Open questions

- Does OCCT 8.x read or write AP242 kinematics and Edition 3/4-specific entities? The STEP guide sections read did not say.
- Is the OCCT USD component open source? The page does not state a license.
- What does JLC3DP's "JLCAPI" cover, and does Sculpteo still operate an API (site returned 403)?
- Exact current PrusaSlicer 3MF part names (source moved; not re-verified) and whether PrusaSlicer 3.0 changes them.
- Whether KHR_accessor_float64 will ratify (matters for assemblies beyond ~10 m at sub-micron precision).

## Sources

- OCCT STEP user guide: https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html
- OCCT DE wrapper guide: https://occt3d.com/dev/doc/overview/html/occt_user_guides__de_wrapper.html
- OCCT XDE guide: https://occt3d.com/dev/doc/overview/html/occt_user_guides__xde.html
- OCCT RWGltf_CafWriter reference: https://occt3d.com/dev/doc/refman/html/class_r_w_gltf___caf_writer.html
- OCCT documentation index (8.0.1, components): https://occt3d.com/dev/doc/overview/html/index.html
- OCCT USD component: https://occt3d.com/components/usd-exchange/
- OCCT releases: https://github.com/Open-Cascade-SAS/OCCT/releases
- OCCT LGPL-2.1 text: https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt
- CAx-IF / MBx-IF: https://www.mbx-if.org/home/cax/
- 3MF specifications registry: https://3mf.io/spec/
- 3MF core specification: https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
- 3MF toolpath extension repo: https://github.com/3MFConsortium/spec_toolpath
- lib3mf: https://github.com/3MFConsortium/lib3mf and https://pypi.org/project/lib3mf/ and https://lib3mf.readthedocs.io/en/latest/
- Bambu Studio 3MF writer source: https://raw.githubusercontent.com/bambulab/BambuStudio/master/src/libslic3r/Format/bbs_3mf.cpp
- Bambu Studio CLI: https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
- Bambu Studio repo and releases: https://github.com/bambulab/BambuStudio and https://github.com/bambulab/BambuStudio/releases
- OrcaSlicer CLI: https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_mode and https://github.com/OrcaSlicer/OrcaSlicer/wiki/cli_actions
- OrcaSlicer import/export: https://github.com/OrcaSlicer/OrcaSlicer/wiki/import_export
- OrcaSlicer releases: https://github.com/OrcaSlicer/OrcaSlicer/releases
- PrusaSlicer 3MF import matrix: https://github.com/prusa3d/PrusaSlicer/blob/master/doc/3mf-import-matrix.md
- PrusaSlicer repo and releases: https://github.com/prusa3d/PrusaSlicer and https://github.com/prusa3d/PrusaSlicer/releases
- Slic3r command-line manual: https://manual.slic3r.org/advanced/command-line
- CuraEngine: https://github.com/Ultimaker/CuraEngine and https://github.com/Ultimaker/CuraEngine/wiki/Building-CuraEngine-From-Source
- Khronos glTF extensions registry: https://github.com/KhronosGroup/glTF/tree/main/extensions
- KHR_xmp_json_ld: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_xmp_json_ld
- EXT_structural_metadata: https://github.com/CesiumGS/glTF/tree/3d-tiles-next/extensions/2.0/Vendor/EXT_structural_metadata
- OpenUSD releases and license: https://github.com/PixarAnimationStudios/OpenUSD/releases and https://github.com/PixarAnimationStudios/OpenUSD/blob/release/LICENSE.txt
- IfcOpenShell: https://github.com/IfcOpenShell/IfcOpenShell and https://pypi.org/project/ifcopenshell/
- ifcJSON: https://github.com/buildingSMART/ifcJSON
- ezdxf: https://github.com/mozman/ezdxf
- OpenSCAD: https://github.com/openscad/openscad, https://github.com/openscad/openscad/blob/master/COPYING, https://github.com/openscad/openscad/releases, https://openscad.org/downloads.html
- Manifold: https://github.com/elalish/manifold
- CadQuery: https://github.com/CadQuery/cadquery and https://pypi.org/project/cadquery/
- build123d: https://github.com/gumyr/build123d and https://pypi.org/project/build123d/
- replicad: https://github.com/sgenoud/replicad
- JSCAD: https://github.com/jscad/OpenJSCAD.org
- Zoo modeling app / KCL: https://github.com/KittyCAD/modeling-app and https://zoo.dev/docs/kcl-lang
- CADmium: https://github.com/CADmium-Co/CADmium
- Dune 3D: https://github.com/dune3d/dune3d and https://docs.dune3d.org/en/latest/
- FreeCAD Document.cpp: https://raw.githubusercontent.com/FreeCAD/FreeCAD/main/src/App/Document.cpp
- FreeCAD releases: https://github.com/FreeCAD/FreeCAD/releases
- FreeCAD CAM post-processors: https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/CAM/Path/Post/scripts
- Onshape FeatureScript: https://cad.onshape.com/FsDoc/
- SolveSpace: https://github.com/solvespace/solvespace
- W3C PROV-O: https://www.w3.org/TR/prov-o/
- QIF standards: https://qifstandards.org/
- Kiri:Moto: https://github.com/GridSpace/grid-apps
- pycam: https://github.com/SebKuzminsky/pycam
- trimesh: https://github.com/mikedh/trimesh and https://pypi.org/project/trimesh/
- Blender 3D-Print Toolbox: https://extensions.blender.org/add-ons/print3d-toolbox/
- Shapeways: https://www.shapeways.com/, https://developers.shapeways.com/, https://en.wikipedia.org/wiki/Shapeways
- Xometry: https://www.xometry.com/ and https://www.xometry.com/cad-add-ins/
- Craftcloud: https://craftcloud3d.com/
- JLC3DP: https://jlc3dp.com/
- PCBWay: https://www.pcbway.com/rapid-prototyping/
- Protolabs Network: https://www.hubs.com/
- BOLTS: https://github.com/boltsparts/BOLTS and https://github.com/boltsparts/boltsparts
- bd_warehouse: https://github.com/gumyr/bd_warehouse
- cq_warehouse: https://github.com/gumyr/cq_warehouse
- FreeCAD Fasteners Workbench: https://github.com/shaise/FreeCAD_FastenersWB
- McMaster-Carr API: https://www.mcmaster.com/help/api/
