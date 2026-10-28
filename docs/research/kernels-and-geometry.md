# Open3DJ research: geometry kernels, constraint solvers and CAD language layers (as of 2026-10-27)

## Executive summary

There is still exactly one open-source B-rep kernel with production-grade STEP I/O, fillets, lofts and booleans: Open CASCADE Technology (OCCT), now at 8.0.1 (30 July 2026) under LGPL-2.1 plus the OCCT exception, with a new graph-based topology layer (BRepGraph) that is directly useful for stable element naming. Every serious open language layer (CadQuery, build123d, Replicad, FreeCAD, Dune3D, 3dj.app) sits on it, and the WASM story has matured in 2026: `occt-wasm` ships OCCT 8.0.1 at about 4.5 MB brotli versus 9.1 MB for the old opencascade.js full build, whose upstream has been idle since March 2023. The Rust-native alternatives are not ready: Fornjot was shut down and archived on 19 June 2026, CADmium (built on truck) was archived in September 2025 under a non-OSI licence, and truck itself (Apache-2.0, active) has booleans but no fillets upstream. For meshes, Manifold (Apache-2.0, v3.5.4) is the clear choice: it is the engine behind Blender 4.5's new boolean solver and the default OpenSCAD development backend since 17 August 2025, and it is deterministic across platforms since v3.5.0. For implicit/SDF modelling, Fidget (MPL-2.0, JIT + wgpu, v0.5.1 Sept 2026) and libfive (MPL-2.0, still maintained Oct 2026) are permissively licensed, while nTop and Parasolid v39 remain closed. For sketch constraints, FreeCAD's PlaneGCS (LGPL-2.1-or-later, available as standalone and WASM builds) and Zoo's ezpz (MIT, young, 2D) are usable; SolveSpace's solver is GPL-3 and therefore off-limits for an MIT core. On history: Onshape's query-based references, FreeCAD 1.x's element maps, KCL's tags and CADmium's append-only op log all converge on the same lesson for agents: references must be semantic (derived from operation IDs and provenance), never positional indices. The recommendation is a hybrid kernel behind one kernel-neutral "geometry IR": OCCT 8 for B-rep (dynamically linked / separate WASM module), Manifold for mesh CSG and tessellated-domain operations, Fidget or libfive for implicit fields, PlaneGCS or ezpz for 2D constraints, with an element-map plus query layer owned by Open3DJ itself so that agents can edit features non-destructively.

## 1. B-rep kernels

### 1.1 Open CASCADE Technology (OCCT)

- **Version and cadence.** OCCT 8.0.0 was released on 7 May 2026 after five RCs and three betas (>500 changes since 7.9.0); a hot patch 8.0.0p1 followed on 17 June 2026 and 8.0.1, the first maintenance release, on 30 July 2026. Minimum C++ standard is now C++17. [OCCT 8.0.0 discussion](https://github.com/Open-Cascade-SAS/OCCT/discussions/1275), [releases](https://github.com/Open-Cascade-SAS/OCCT/releases)
- **Licence.** LGPL-2.1 with the OCCT exception: object code of a "work that uses the Library" that incorporates header material may be distributed "under terms of your choice", provided prominent notice is given that it uses OCCT. The library itself stays LGPL-2.1, so an MIT application should load OCCT as a separate shared library or WASM module and keep it replaceable, rather than treating it as MIT code. A commercial licence is also offered. [OCCT_LGPL_EXCEPTION.txt](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt), [LICENSE_LGPL_21.txt](https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt), [repo](https://github.com/Open-Cascade-SAS/OCCT)
- **BRepGraph (8.0).** A new graph representation of topology plus geometry that complements `TopoDS_Shape`: flat entity vectors, each entity stored once, parent/child refs carrying orientation and location, reverse indices for upward navigation, first-class CoEdge/Product/Occurrence nodes, RAII mutation guards with per-node mutation counters, typed `BRepGraph_NodeId`, multiple views, an `EditorView` as the single mutation surface and round-trip conversion to/from `TopoDS_Shape`. Early benchmarks: adjacency queries 97% faster, sewing up to 58% faster (parallel), deduplication 43% faster (no hardware stated). This is the most agent-relevant OCCT change in years because it gives a cheap, stable, typed handle layer to build element maps on. [BRepGraph announcement (23 Mar 2026)](https://occt3d.com/dev/content/brepgraph-new-topology-geometry-graph-coming-occt-80/index.html), [8.0 release notes](https://github.com/Open-Cascade-SAS/OCCT/discussions/1275)
- **Multithreading.** Boolean operations have an explicit parallel mode (`SetRunParallel(true)`, default off); 8.0 made the error-handler stack `thread_local`, replaced `Standard_Mutex` with `std::mutex`, made `NCollection_IncAllocator` lock-free on its fast path, parallelised `GeomFill_Gordon` via `OSD_Parallel`, and documents STEP read/write as safe with one reader/writer per thread (IGES read is not). [Boolean ops guide](https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html), [8.0 notes](https://github.com/Open-Cascade-SAS/OCCT/discussions/1275)
- **Robustness of booleans and fillets.** The Boolean Operations algorithm exposes fuzzy value, glue, non-destructive mode, inverted-solid checks, error/warning reporting and full history (`Generated`/`Modified`/`IsDeleted`), but requires valid, non-self-interfering arguments with at least C1 continuity. Historical tracker issues show fuzzy values are not monotonic (0.001 and 0.00001 succeed while 0.0001 fails on the same case) and that fillet-heavy shapes have produced empty results. 8.0 notes list crash/hang fixes for fillets/chamfers near ellipses but publish no boolean/fillet benchmark numbers. In practice OCCT booleans are robust enough for the CadQuery/build123d/FreeCAD ecosystems, but an agent-facing kernel must surface warnings and retry with tolerance/fuzzy strategies automatically. [Boolean ops guide](https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html), [OCCT tracker 26243](https://tracker.dev.opencascade.org/view.php?id=26243), [tracker 32443](https://tracker.dev.opencascade.org/view.php?id=32443), [CadQuery #697](https://github.com/CadQuery/cadquery/issues/697)
- **STEP / AP242.** The STEP translator writes AP203, AP214 IS or AP242 DIS (`write.step.schema`), and GD&T handling in AP214 is documented as obsolete, so AP242 is the path for PMI. 8.0 adds duplicate-entity removal (about 20% smaller files on average), General Attributes as `property_definition`, visual material reflectance entities and PMI unit scaling in STEPCAF. PR #1647 (merged into the IR branch 19 Oct 2026) adds AP242 tessellated draughting-model complex entities, fixes GD&T units/runout/presentation contexts and adds named companion streams for STEP/glTF/OBJ/VRML. [STEP translator guide](https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html), [PR 1647](https://github.com/Open-Cascade-SAS/OCCT/pull/1647), [XDE wiki](https://github.com/Open-Cascade-SAS/OCCT/wiki/xde)
- **Bindings and footprint.**
  - Python: `cadquery-ocp` 8.0.1.1.0 (5 Oct 2026); wheels are 47.7 to 68.2 MB per platform (Windows x86-64 smallest, macOS/Linux x86-64 largest). [PyPI files](https://pypi.org/project/cadquery-ocp/#files)
  - WASM, upstream `opencascade.js`: full build is 48.9 MB uncompressed, about 9.1 MB brotli; a custom build for the docs site is 7.1 MB uncompressed / 2.4 MB compressed; disabling exceptions cuts about 45%. The upstream README still pins OCCT 7.6.2 and the last commits on master are from 27 March 2023 (942 stars). [ocjs file size](https://ocjs.org/docs/getting-started/file-size), [commits](https://github.com/donalffons/opencascade.js/commits/master), [repo](https://github.com/donalffons/opencascade.js)
  - WASM, `taucad/opencascade.js` v3: OCCT 8.0.1 (1,085+ upstream commits), ESM-only, and a pthread build that needs COOP/COEP headers and `SetParallelMode(true)`. [taucad fork](https://github.com/taucad/opencascade.js)
  - WASM, `occt-wasm` (andymai): OCCT 8.0.1, about 4.5 MB brotli ("roughly 2x smaller than opencascade.js"; its table lists opencascade.js at ~9 MB and replicad-opencascadejs at ~5 MB), single-threaded per kernel instance with an `OcctWorker` for off-main-thread work, 170+ facade methods (primitives, booleans, sweeps, fillets, healing, XCAF assemblies, STEP/STL/BREP/glTF, IGES excluded), tooling MIT OR Apache-2.0 with the compiled WASM LGPL-2.1. `brepjs` is a friendlier parametric layer on top with pluggable kernels. [occt-wasm](https://github.com/andymai/occt-wasm), [brepjs getting started](https://raw.githubusercontent.com/andymai/brepjs/main/docs/getting-started.md)
  - Rust: `opencascade-rs` (cxx bindings, crate 0.3.0) still requires OCCT 7.8; issue #237 for 8.x support is open; `occt-rs` is an early alternative that dynamically links because of the LGPL. [opencascade-rs](https://github.com/bschwind/opencascade-rs), [issue 237](https://github.com/bschwind/opencascade-rs/issues/237), [occt-rs](https://github.com/occt-rs/occt-rs)
- **Community.** 3.1k stars, 729 forks, 7,193 commits, 203 open issues, 88 open PRs. [repo](https://github.com/Open-Cascade-SAS/OCCT)
- **Not verified:** peak memory per operation and native binary size; I found no published figures. Treat as an open benchmark task.

### 1.2 truck (Rust) and its derivatives

truck (ricosjp) is an Apache-2.0 Rust B-rep kernel with crates for geometry (NURBS), topology, modeling, shapeops (booleans, shape healing), meshalgo (tessellation), stepio and a JS wrapper; 1.7k stars, 2,886 commits, and still active (commits on 19 and 26 Oct 2026). `truck-shapeops` is at 0.4.0 (20 Sept 2024); the upstream README mentions no fillets. The `monstertruck` fork (37 stars, Apache-2.0) exists because "getting PRs accepted upstream was proving to be a challenge" and adds a rolling-ball fillet/chamfer engine, assembly STEP output, a hardened STEP parser and `Result`-returning booleans, but reverted one boolean rewrite after it regressed cases. CADmium, the best-known truck application, was archived on 5 Sept 2025 under the Elastic License 2.0. Verdict: promising for a pure-Rust future, not a 2026 production kernel for fillets, lofts or STEP round-tripping. [truck](https://github.com/ricosjp/truck), [commits](https://github.com/ricosjp/truck/commits/master), [truck-shapeops](https://docs.rs/crate/truck-shapeops/latest), [monstertruck](https://github.com/virtualritz/monstertruck), [CADmium](https://github.com/CADmium-Co/CADmium), [CADmium post](https://mattferraro.dev/posts/cadmium)

### 1.3 Fornjot

Shut down on 19 June 2026 ("Fornjot is ending; unfinished, incomplete"); the repository is archived and read-only. It never reached 1.0 (highest version 0.49.0). Not an option. [shutdown post](https://fornjot.app/blog/shutting-down-fornjot/), [repo](https://github.com/hannobraun/fornjot)

### 1.4 SolveSpace's kernel

SolveSpace is GPL-3.0-or-later (4.2k stars; Wikipedia lists 3.3 released 21 Oct 2026, unverified against GitHub). It has its own NURBS surface kernel with union/difference/intersection that "may occasionally fail", no fillets/chamfers on 3D solids as of 3.0 and no extrude-along-path. The library form (libslvs) is GPLv3 and "heavily coupled with the rest of the program". GPL-3 makes it incompatible with an MIT in-process core. [SolveSpace repo](https://github.com/solvespace/solvespace), [library page](https://solvespace.com/library.pl), [Wikipedia](https://en.wikipedia.org/wiki/SolveSpace)

### 1.5 Closed kernels for reference

- **Parasolid (Siemens).** v39.0 (31 July 2026 per Wikipedia; Siemens blog post 25 Aug 2026) expands core modelling, mesh processing, implicit geometry and performance. Plasticity "exposes the full power of Parasolid and xNURBS", is direct-modelling ("Modify CAD data instantly with no history tree required"), runs on Windows 10+/macOS 12+/Ubuntu 22+, and sells perpetual node-locked licences at $175 (Indie) and $299 (Studio). Plasticity 25.3 (15 Dec 2025) added live instances. [Siemens blog](https://blogs.sw.siemens.com/plm-components/tag/implicit-geometry/), [Parasolid Wikipedia](https://en.wikipedia.org/wiki/Parasolid), [plasticity.xyz](https://plasticity.xyz/), [25.3](https://www.cgchannel.com/2025/12/plastic-software-releases-plasticity-2025-3/)
- **Zoo (KittyCAD).** The Design Studio app is MIT (1.3k stars) but "our CAD geometry engine is not open source"; the 3D view "is just a video stream from our hosted geometry engine" and "an internet connection is required for modeling, rendering, Zookeeper". This is the opposite of Open3DJ's local-first goal, but Zoo's KCL design is instructive (section 4). [Zoo FAQ](https://zoo.dev/docs/faq), [modeling-app](https://github.com/KittyCAD/modeling-app), [KCL part 0](https://www.ncameron.org/blog/kcl-part-0/)

## 2. Mesh kernels

### 2.1 Manifold

Apache-2.0; guarantees manifold output ("without caveats or edge cases"); boolean, hull, SDF level-set, smooth refinement, per-face IDs for provenance; parallel via TBB (`MANIFOLD_PAR`), serial fallback for small inputs; bindings for C, C++, Python (`manifold3d`), JS/WASM (`manifold-3d`), plus Rust (`manifold-csg` and a native port claimed to pass the full test suite). Release history: 3.0.0 (Nov 2024, double precision, MeshGL64), 3.4.0 (27 Feb 2025, Minkowski sum/difference), 3.5.0 (23 May 2025, cross-platform determinism with CI check, progress/cancellation, ray casting), 3.5.4 (25 Sept 2025, latest). Users include OpenSCAD, Blender, Godot, trimesh, BRL-CAD, PyVista. Caveats: inputs must be manifold (a `Merge` helps slightly broken meshes), the WASM build is serial-only and parallel WASM is discouraged, triangulation is serial, STL output discouraged in favour of 3MF/glTF with `EXT_mesh_manifold`. 2.4k stars. [README](https://github.com/elalish/manifold), [releases](https://github.com/elalish/manifold/releases)

Adoption signals: Blender 4.5 LTS (15 July 2025) added a Manifold boolean solver in the modifier, node and sculpt trim tools, "usually fastest" and replacing the old Fast/Float option for manifold meshes. OpenSCAD switched its default backend to Manifold in development snapshots on 17 Aug 2025 (CGAL still selectable), but the last stable OpenSCAD release is still 2021.01 per GitHub and the news page. [Blender 4.5 manual](https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/booleans.html), [cgchannel on 4.5](https://www.cgchannel.com/2025/07/blender-4-5-lts-is-out-check-out-its-5-key-features), [OpenSCAD mailing list](https://lists.openscad.org/empathy/thread/TMJEJCZINIJNYJX2YF7IDNBAPQY66KIF), [OpenSCAD releases](https://github.com/openscad/openscad/releases), [OpenSCAD news](https://openscad.org/news.html)

### 2.2 CGAL

6.2.1; dual-licensed: the foundation layer is LGPL-3.0-or-later and nearly all higher-level packages (including the Nef polyhedra OpenSCAD historically used) are GPL-3.0-or-later, with commercial licences from GeometryFactory. Only the LGPL foundation packages are MIT-compatible in-process; the GPL packages are not. With Manifold available, CGAL is not needed for CSG. [CGAL licence](https://doc.cgal.org/latest/Manual/license.html), [package overview](https://doc.cgal.org/latest/Manual/packages.html)

## 3. Implicit / SDF kernels

- **libfive.** Kernel, stdlib and Python bindings MPL-2.0; Guile bindings and Studio GPL-2+. C API, watertight/manifold feature-preserving meshing, 1.7k stars, still maintained (Qt 6.11 and MSVC fixes merged 13 to 16 Oct 2026). nTopology hosts a fork. [libfive](https://github.com/libfive/libfive), [commits](https://github.com/libfive/libfive/commits/master), [libfive.com](https://libfive.com/)
- **Fidget.** MPL-2.0, v0.5.1 (27 Sept 2026), Rust: expression manipulation, tape simplification, JIT with hand-written aarch64/x86_64 back ends, interpreter fallback, 2D/3D rendering, optional `fidget-wgpu` GPU back end and `fidget-mesh` (Manifold Dual Contouring). Explicitly "experimental infrastructure": "expect to fork it and make local modifications". The author also states he avoids LLM/agentic tooling in the project, which matters for an agent-first consumer only in terms of upstream expectations. [docs.rs fidget](https://docs.rs/crate/fidget/latest), [fidget project page](https://mattkeeter.com/projects/fidget)
- **nTop (closed).** GPU acceleration arrived in nTopology 3.0 as an opt-in feature with vendor-claimed 10x to 100x speedups on NVIDIA (up to 100x on an RTX A5000 vs a 32-core CPU); nTop 5 (24 June 2024) introduced a rebuilt implicit kernel with booleans on large primitive lists >90% faster on average. Shows what a GPU-resident implicit evaluator can do; Fidget's wgpu back end is the open analogue. [nTop 5](https://www.ntop.com/resources/blog/ntop-5/), [nTop GPU docs](https://docs.ntop.com/Product-Documentation/ntop/_getting_started/_system_requirements/gpu_acceleration), [develop3d](https://develop3d.com/cad/ntopology-adds-gpu-to-bring-the-boom/)

## 4. Constraint solvers

- **PlaneGCS (FreeCAD).** LGPL-2.1-or-later, 2D only. Standalone extractions exist: `2wiceUponATime/PlaneGCS` (extracted from the FreeCAD-1-1 branch, warns that minor bumps may break ABI), `Salusoft89/planegcs` (a WebAssembly wrapper), `planegcs` on PyPI (0.9.6; body text says LGPL-2.1-or-later but the metadata field says SSPL-1.0, a conflict to resolve before use), and CoCAD ships it under an LGPL source offer. Dynamic linking or a separate WASM module keeps the MIT core clean. [2wiceUponATime/PlaneGCS](https://github.com/2wiceUponATime/PlaneGCS), [Salusoft89/planegcs](https://github.com/Salusoft89/planegcs), [planegcs PyPI](https://pypi.org/project/planegcs/), [CoCAD LGPL sources](https://github.com/Overlord1691/cocad-lgpl-sources)
- **ezpz (Zoo).** MIT "open-source geometric constraint solver" built for Zoo Design Studio; examples are 2D point/line constraints; the `kcl-ezpz` crate was last updated 31 Dec 2025. Attractive licence, limited maturity; solver method undocumented. [ezpz](https://github.com/KittyCAD/ezpz), [docs.rs ezpz](https://docs.rs/ezpz)
- **SolveSpace solver.** GPL-3; Dune3D uses it directly (patched for speed) and is therefore GPL-3 itself. Excluded for an MIT core unless run as a separate process. [Dune3D README](https://github.com/dune3d/dune3d), [SolveSpace library](https://solvespace.com/library.pl)
- **3D constraints.** None of the permissive options cover 3D assembly constraints; this is a gap Open3DJ would have to fill (or reuse OCCT's assembly placement with a small Newton solver of its own).

## 5. Language layers

| Layer | Kernel | Licence | Current version | Notes |
|---|---|---|---|---|
| CadQuery | OCCT via OCP | Apache-2.0 | 2.8.0 (21 Jun 2026), 6.0k stars | OCP 8 support planned after the June release; Python-only |
| build123d | OCCT via OCP | Apache-2.0 | 0.13.0 (21 Sep 2026) on OCP 8.0.1, 3.5k stars | Derived from CadQuery, builder/algebra API |
| Replicad | opencascade.js custom build (~5 MB brotli) | MIT | 0.23.x on npm (npm page blocked; version unverified), 709 stars | The model for 3dj.app's DSL |
| JSCAD | own JS CSG | MIT | V2 stable; V3 still alpha (2 Aug 2026 alpha), 3.3k stars | No B-rep, no STEP |
| OpenSCAD | CGAL/Manifold | GPL-2.0 (per COPYING; version not verified) | stable 2021.01; Manifold default in snapshots since Aug 2025, 10.5k stars | GPL means subprocess only |
| KCL (Zoo) | closed cloud engine | MIT (client) | continuous | Tags for edge references, UI edits rewrite code |
| FeatureScript (Onshape) | Parasolid, cloud | std library viewable in a public document, not OSI | continuous | Query-based references |

Sources: [CadQuery PyPI](https://pypi.org/project/cadquery/), [CadQuery May 2026 update](https://www.patreon.com/posts/159658527), [build123d releases](https://github.com/gumyr/build123d/releases), [build123d repo](https://github.com/gumyr/build123d), [replicad](https://github.com/sgenoud/replicad), [JSCAD](https://github.com/jscad/OpenJSCAD.org), [JSCAD forum](https://openjscad.nodebb.com/recent?page=1), [OpenSCAD repo](https://github.com/openscad/openscad), [KCL edge functions](https://docs.zoo.dev/docs/kcl/getOppositeEdge), [FeatureScript](https://cad.onshape.com/FsDoc/)

## 6. Parametric history structures and non-destructive agent editing

- **FreeCAD 1.x (element maps).** FreeCAD 1.0 (Nov 2024) merged realthunder's topological-naming mitigation; 1.1 (24/25 Mar 2026) and 1.1.1 (15 Apr 2026) extend it. Mechanism: every object gets a document-unique integer Tag; `mapSubElement(shape, op)` copies element names from inputs into outputs prefixed by an operation code; boolean and feature ops use OCCT's `BRepBuilderAPI_MakeShape` history (Generated/Modified) to propagate names; long names are SHA1-hashed above a threshold; `PropertyLinkSub` stores both the mapped name and a shadow index-based name so old versions can still open files; a version string (algorithm + OCCT + hasher) forces recompute on upgrade. Known limitations: copy/paste loses mapped names, names grow with history, renames can break downstream references, coverage is full only for Sketcher/Part/PartDesign, and the 1.1 milestone still lists TNP hangs. [realthunder TNP wiki](https://github.com/realthunder/FreeCAD_assembly3/wiki/Topological-Naming), [FreeCAD 1.1 blog](https://blog.freecad.org/2026/03/25/freecad-version-1-1-released/), [1.1.1](https://blog.freecad.org/2026/04/15/freecad-1-1-1-released/), [1.1 milestone](https://github.com/FreeCAD/FreeCAD/milestone/8), [Ondsel on TNP](http://www.ondsel.com/blog/freecad-topological-naming/)
- **Dune3D (ordered groups).** A document is an ordered list of groups solved in order; extrude/lathe/clone store a reference to the source group's workplane at creation; solid-model operations can combine any two groups; fillet/chamfer reference solid edges and are documented as "subject to the topological naming problem", so the manual recommends applying them last; chamfers made in 1.1 may land on the wrong edge in 1.2. v1.4.0 "Einstein" (28 Jan 2026), GPL-3, OCCT + patched SolveSpace solver, 2.1k stars. [Dune3D groups docs](https://docs.dune3d.org/en/latest/groups.html), [releases](https://github.com/dune3d/dune3d/releases), [repo](https://github.com/dune3d/dune3d)
- **CADmium (append-only op log).** Designed the file as an append-only JSON Lines operation log that is the single source of truth, with a `steps` array of `{type, id, data}` records, a time slider to rebuild any earlier state and git-like branching. Discontinued, but the design is the right shape for agents (diffable, replayable). [CADmium post](https://mattferraro.dev/posts/cadmium)
- **Onshape (query-based references).** Features are FeatureScript functions; references are Queries evaluated against the current history state. Per Onshape staff (Aug 2025): "for each topology created by an operation there is a record of its dependencies allowing us to identify this topology"; evaluation is "pattern matching of the query with current state of history", matching operation IDs first and using "external disambiguation" when dependency records tie. Custom features must therefore mint stable, meaningful IDs. [Onshape forum (staff)](https://forum.onshape.com/discussion/comment/120948), [FeatureScript docs](https://cad.onshape.com/FsDoc/)
- **Zoo KCL (tags in code).** The code is the model: point-and-click edits rewrite KCL, references are tag declarators on sketch segments, and functions such as `getOppositeEdge`, `getNextAdjacentEdge`, `getPreviousAdjacentEdge` derive edges from tags rather than indices. [KCL getOppositeEdge](https://docs.zoo.dev/docs/kcl/getOppositeEdge), [modeling-app README](https://github.com/KittyCAD/modeling-app)
- **Plasticity (no history).** Direct modelling on Parasolid; the native file stores geometry, not construction history. Fast for humans, poor for agents that need to re-run with changed parameters. [plasticity.xyz](https://plasticity.xyz/)

**Which design lets an agent edit non-destructively?** The common thread in the three designs that work (Onshape, FreeCAD 1.x, KCL) is that references are *derived from provenance* (operation ID + input element + op code), re-resolved at regeneration, and disambiguated geometrically only as a last resort. The common thread in the designs that fail (index-based FreeCAD < 1.0, Dune3D fillets) is positional indexing into OCCT explorer order. For an agent the ideal is a hybrid of KCL and CADmium: a textual, deterministic op log where every op has an explicit ID and every reference is a query expression (`createdBy(op:"boss1", kind:"face", filter: normal≈+Z`) that the kernel resolves using an element map; the agent can then insert, reorder, suppress or re-parameterise steps and get a structured diff of which references re-resolved, which were disambiguated and which broke.

## 7. Cross-cutting assessment

| Criterion | OCCT 8.0.1 | Manifold 3.5.4 | truck | libfive / Fidget | PlaneGCS / ezpz |
|---|---|---|---|---|---|
| Maturity | 25+ yrs, production (FreeCAD, CadQuery) | production (Blender, OpenSCAD) | research-grade | libfive mature, Fidget experimental | PlaneGCS production in FreeCAD; ezpz young |
| Licence vs MIT | LGPL-2.1 + exception: OK if dynamically linked / separate module | Apache-2.0: OK | Apache-2.0: OK | MPL-2.0: OK (file-level copyleft) | LGPL-2.1+ / MIT |
| WASM | yes: occt-wasm ~4.5 MB brotli; taucad pthread build; upstream 9.1 MB | yes (serial only) | yes (truck-js) | libfive C API compiles; Fidget wgpu/WASM: unverified | Salusoft89 WASM wrapper; ezpz is Rust |
| Threads | per-algorithm parallel flags; 8.0 thread-safety work; STEP one reader per thread | TBB | n/a | Fidget JIT + wgpu | n/a |
| Tessellation | BRepMesh with deflection control | refine/smooth, level-set | meshalgo | feature-preserving manifold DC | n/a |
| STEP AP242 | read/write, PMI via XDE, improving in 8.0.x | none (3MF/glTF) | truck-stepio basic | none | n/a |
| Footprint | 48.9 MB wasm raw / 9.1 MB brotli (full), 48 to 68 MB Python wheels | small (not measured) | small | small | small |
| Community | 3.1k stars, 729 forks | 2.4k stars | 1.7k stars | 1.7k stars (libfive) | FreeCAD 34.8k |

Figures not verified: Manifold/libfive/Fidget binary sizes and peak memory of OCCT operations.

## Recommendations for Open3DJ

1. **Primary B-rep kernel: OCCT 8.0.1, dynamically linked, behind a kernel-neutral interface.** Rationale: it is the only open kernel with fillets, lofts, shelling, STEP AP242 and XDE assemblies; it is what 3dj.app scripts already target (OpenCascade.js 7.7.2), so script compatibility is cheap; 8.0's thread-safety work and BRepGraph are exactly what an agent server needs. Trade-offs: LGPL obligations (ship OCCT as a replaceable shared library / separate `.wasm`, state the OCCT notice, never fold OCCT source into MIT files); boolean/fillet failures must be handled by an automatic retry ladder (fuzzy value, glue mode, shape healing) with structured warnings returned to the agent.
2. **Mesh kernel: Manifold 3.5.x.** Use it for mesh CSG, SDF level-sets, hull/Minkowski, 3MF/glTF export, OpenSCAD-compatible semantics and manufacturability checks (watertightness is guaranteed by construction). Trade-offs: input must be manifold, so OCCT tessellation must be sewn/merged before entering Manifold; WASM is serial-only.
3. **Implicit kernel: Fidget (Rust, MPL-2.0) first, libfive C API as fallback.** Implicit fields give agents a representation where "add a gyroid infill" or "blend these bodies with radius r" is one expression, and Fidget's JIT + wgpu back end is the open path to the GPU acceleration nTop sells. Mesh out through Manifold Dual Contouring into Manifold, then into OCCT only when a B-rep is required. Trade-off: experimental API, expect to vendor and patch.
4. **2D constraints: PlaneGCS (LGPL, separate module) now; evaluate ezpz (MIT) as the long-term default.** Exclude SolveSpace (GPL-3) from the process. Trade-off: PlaneGCS ABI churn between FreeCAD minors; ezpz immaturity. 3D assembly constraints are an Open3DJ build item.
5. **Own the history layer.** Implement an append-only, text-based op log (CADmium/KCL shape) with explicit op IDs, an element map built from OCCT BOP history and BRepGraph IDs (FreeCAD-style op-code naming), and query-based references (Onshape-style `createdBy`/`adjacentTo` with geometric disambiguation last). Expose a `resolveReferences` diff so an agent knows exactly what moved after an edit. This layer, not the kernel, is where Open3DJ can be "better for agents than anything that exists".
6. **Do not adopt**: Fornjot (dead), CADmium (archived, non-OSI), CGAL GPL packages, SolveSpace/OpenSCAD in-process (GPL). Run OpenSCAD as an optional external CLI if script compatibility is wanted; otherwise re-implement the OpenSCAD subset on Manifold (which is what OpenSCAD itself now does).
7. **Packaging targets.** Desktop: native OCCT + Manifold + Fidget with TBB/OSD_Parallel; browser/edge: `occt-wasm`-class custom builds (~4.5 MB brotli) plus `manifold-3d`, with one kernel instance per Web Worker and job-level rather than intra-op parallelism. Python surface via OCP/build123d is a bridge, not the core (48 to 68 MB wheels).
8. **Open benchmarks to run before freezing the design**: OCCT 8.0.1 native vs WASM boolean/fillet timings and peak RSS on a fixed corpus; Manifold vs OCCT tessellated booleans; Fidget wgpu availability under WebGPU; PlaneGCS vs ezpz on 500-constraint sketches.

## Sources

- https://github.com/Open-Cascade-SAS/OCCT/discussions/1275
- https://github.com/Open-Cascade-SAS/OCCT/releases
- https://github.com/Open-Cascade-SAS/OCCT
- https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt
- https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt
- https://occt3d.com/dev/content/brepgraph-new-topology-geometry-graph-coming-occt-80/index.html
- https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html
- https://occt3d.com/dev/doc/overview/html/occt_user_guides__step.html
- https://github.com/Open-Cascade-SAS/OCCT/pull/1647
- https://github.com/Open-Cascade-SAS/OCCT/wiki/xde
- https://tracker.dev.opencascade.org/view.php?id=26243
- https://tracker.dev.opencascade.org/view.php?id=32443
- https://github.com/CadQuery/cadquery/issues/697
- https://pypi.org/project/cadquery-ocp/#files
- https://ocjs.org/docs/getting-started/file-size
- https://github.com/donalffons/opencascade.js
- https://github.com/donalffons/opencascade.js/commits/master
- https://github.com/taucad/opencascade.js
- https://github.com/andymai/occt-wasm
- https://raw.githubusercontent.com/andymai/brepjs/main/docs/getting-started.md
- https://github.com/bschwind/opencascade-rs
- https://github.com/bschwind/opencascade-rs/issues/237
- https://github.com/occt-rs/occt-rs
- https://github.com/ricosjp/truck
- https://github.com/ricosjp/truck/commits/master
- https://docs.rs/crate/truck-shapeops/latest
- https://github.com/virtualritz/monstertruck
- https://github.com/CADmium-Co/CADmium
- https://mattferraro.dev/posts/cadmium
- https://fornjot.app/blog/shutting-down-fornjot/
- https://github.com/hannobraun/fornjot
- https://github.com/solvespace/solvespace
- https://solvespace.com/library.pl
- https://en.wikipedia.org/wiki/SolveSpace
- https://blogs.sw.siemens.com/plm-components/tag/implicit-geometry/
- https://en.wikipedia.org/wiki/Parasolid
- https://plasticity.xyz/
- https://www.cgchannel.com/2025/12/plastic-software-releases-plasticity-2025-3/
- https://zoo.dev/docs/faq
- https://github.com/KittyCAD/modeling-app
- https://www.ncameron.org/blog/kcl-part-0/
- https://docs.zoo.dev/docs/kcl/getOppositeEdge
- https://github.com/KittyCAD/ezpz
- https://docs.rs/ezpz
- https://github.com/elalish/manifold
- https://github.com/elalish/manifold/releases
- https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/booleans.html
- https://www.cgchannel.com/2025/07/blender-4-5-lts-is-out-check-out-its-5-key-features
- https://lists.openscad.org/empathy/thread/TMJEJCZINIJNYJX2YF7IDNBAPQY66KIF
- https://github.com/openscad/openscad/releases
- https://github.com/openscad/openscad
- https://openscad.org/news.html
- https://doc.cgal.org/latest/Manual/license.html
- https://doc.cgal.org/latest/Manual/packages.html
- https://github.com/libfive/libfive
- https://github.com/libfive/libfive/commits/master
- https://libfive.com/
- https://docs.rs/crate/fidget/latest
- https://mattkeeter.com/projects/fidget
- https://www.ntop.com/resources/blog/ntop-5/
- https://docs.ntop.com/Product-Documentation/ntop/_getting_started/_system_requirements/gpu_acceleration
- https://develop3d.com/cad/ntopology-adds-gpu-to-bring-the-boom/
- https://github.com/2wiceUponATime/PlaneGCS
- https://github.com/Salusoft89/planegcs
- https://pypi.org/project/planegcs/
- https://github.com/Overlord1691/cocad-lgpl-sources
- https://pypi.org/project/cadquery/
- https://www.patreon.com/posts/159658527
- https://github.com/gumyr/build123d/releases
- https://github.com/gumyr/build123d
- https://github.com/sgenoud/replicad
- https://github.com/jscad/OpenJSCAD.org
- https://openjscad.nodebb.com/recent?page=1
- https://cad.onshape.com/FsDoc/
- https://forum.onshape.com/discussion/comment/120948
- https://github.com/realthunder/FreeCAD_assembly3/wiki/Topological-Naming
- https://blog.freecad.org/2026/03/25/freecad-version-1-1-released/
- https://blog.freecad.org/2026/04/15/freecad-1-1-1-released/
- https://github.com/FreeCAD/FreeCAD/milestone/8
- https://github.com/FreeCAD/FreeCAD
- http://www.ondsel.com/blog/freecad-topological-naming/
- https://docs.dune3d.org/en/latest/groups.html
- https://github.com/dune3d/dune3d/releases
- https://github.com/dune3d/dune3d
