# Assemblies and multi-part products for Open3DJ

Researched 28 Oct 2026. Sources: vendor help pages, specifications, source code (CadQuery master, OndselSolver at commit 4be80ee) and the type definitions shipped in the npm tarballs of occt-wasm 5.8.1, brepjs 20.11.1, manifold-3d 3.5.4 and three-mesh-bvh 0.9.16. Two new spikes ran on the same 4-vCPU Linux sandbox as [spike-assemblies.md](spike-assemblies.md); scripts and raw JSON are in [spike/asm2/](spike/asm2/). The note follows the founder's constraints and the request that Open3DJ calculates on both CPU and GPU, and builds on the gap notes, lean-stack.md and industrial-design.md.

## Bottom line

1. **The document is an assembly graph from the first release.** A single part is a root assembly with one occurrence. The kernel already carries this: occt-wasm's XCAF document holds shared definitions, placed components, sub-assemblies, names and colours, and round-trips them through STEP (spike-assemblies.md).
2. **Structure lives in data, geometry lives in scripts.** Part geometry stays in scripts (the 3dj DSL, later build123d). The assembly is a declarative JSON graph of definitions, occurrences, connectors and mates. Agents patch it, humans edit it in the UI, and changing a mate never re-runs a script.
3. **Mates bind named connectors, never raw faces.** A connector is a frame (origin, Z axis, X axis) on a part definition, anchored to a named reference, so it inherits the five-state reference report (exact, re-resolved, disambiguated, ambiguous, broken). This matches 3dj's `connector.male/female` with `matchTo` and Onshape's mate connectors.
4. **Solve in three tiers.** Fixed transforms and fastened mates are closed form. Tree-shaped joints (each occurrence placed by one mate to an already placed parent, joint value as a parameter) are closed-form forward kinematics and cover most products. Only loops and multiply-mated occurrences need a numeric solver, which ships later. DOF must come from the Jacobian rank, not from counting.
5. **brepjs 20.11.1 has an assembly layer, but its solver cannot diagnose.** It ships assembly trees, instancing, five joint types with limits, forward and inverse kinematics, trajectories and URDF. Measured here: its mate solver places each dependent from one mate and silently ignores a second, conflicting mate (`converged: true, dof: 0`), and its DOF counter reports 4 for a four-bar linkage whose mobility is 1. Reuse its instancing, joint maths and URDF; do not use its mate solver for reports.
6. **Interference has three outcomes: clash, contact and clearance.** Distance alone cannot separate them (brepjs's `checkInterference` counts touching as interference). Measured: an AABB filter cut 10,440 pairs to 144; Manifold mesh booleans found both seeded clashes at 5.4 ms a pair, within 0.3% of the exact OCCT volume, which costs 19 to 29 ms a pair.
7. **CPU is the reference; GPU is an accelerator.** Every assembly computation has a CPU path in WebAssembly that runs in Node and the browser. GPU paths (rendering, broad-phase, motion sweeps, cloud dynamics) are optional, must agree with the CPU path within tolerance, and every result records which backend produced it.
8. **Licences are workable.** OCCT and OndselSolver are LGPL-2.1 and stay separate, replaceable `.wasm` files. SolveSpace (GPL-3) stays out of the process. CasADi (LGPL-3) with IPOPT (EPL-2.0) belongs only in the optional Python tier.

## 1. How professional CAD models assemblies in 2026

**Definitions and occurrences.** Every serious system separates a definition (part or sub-assembly) from its placed occurrences. OCCT's XDE guide states it directly: shapes carry no location, and each component references one shared shape with its own location [1]. A sub-assembly is a definition whose content is occurrences. An occurrence is addressed by its path from the root (`gearbox/planet#2`); BOM lines, overrides and mates key on that path.

**Top-down and bottom-up.** Bottom-up means parts designed alone and then mated. Top-down means parts derived from a skeleton or layout, or edited in context. Onshape's multi-part Part Studios put related parts in one feature list, and an in-context edit captures an "assembly context": a snapshot of geometry and positions that updates only when the user asks, never automatically [2]. That rule suits agents: an in-context reference is pinned to a revision and updated explicitly, with a diff.

**Configurations.** Onshape, SOLIDWORKS and Fusion all drive variants from a parameter table. Each unique parameter set behaves as its own definition for BOM, caching and mass properties.

**Mates and joints across systems**

| System | Mechanism | Types | Diagnosis and extras |
|---|---|---|---|
| Onshape | Mates between two mate connectors (frames with Z, X, Y); implicit connectors at centroids and axes [3][4] | Fastened (0 DOF), Revolute (Rz), Slider (Tz), Cylindrical (Rz, Tz), Pin slot (Rz, Tx), Planar (Tx, Ty, Rz) [5], Ball (3R), Parallel (3T, Rz), Tangent, Width; gear, rack and pinion, screw, linear relations | Limits, offsets, flip, 90-degree reorientation. Group, Composite parts and Replicate cut redundant mates in large assemblies [6] |
| SOLIDWORKS | Mates between faces, edges, planes, axes [7] | Standard: coincident, parallel, perpendicular, tangent, concentric, lock, distance, angle. Advanced: profile centre, symmetric, width, path, linear coupler, limit. Mechanical: cam, slot, hinge, gear, rack and pinion, screw, universal joint | (+) marks over-defined, (?) unsolvable; MateXpert finds the over-defining mate groups [8] |
| Fusion | Joints between joint origins; as-built joints for parts already in place [9][10] | Rigid, revolute, slider, cylindrical, pin-slot, planar, ball | Motion limits, contact sets, rigid groups |
| FreeCAD 1.0/1.1, 26.3 due | Joints between local frames, solved by OndselSolver [11][12] | Fixed, revolute, cylindrical, slider, ball, distance, parallel, perpendicular, angle, rack and pinion, screw, gears, belt; grounding | Exploded views and BOM since 1.0; Simulation since 1.1 (24 Mar 2026); rigid groups, snapshots and link arrays in 26.3 (branched 30 Sep 2026) [13] |
| build123d 0.13 | Joints on parts; `connect_to` is "a one time re-position" with no solver [14] | RigidJoint, RevoluteJoint, LinearJoint, CylindricalJoint, BallJoint with ranges | Out-of-range values raise |
| CadQuery 2.8 | Constraints as cost terms, minimised by CasADi with IPOPT and MUMPS [15][16] | Point, Axis, Plane, PointInPlane, PointOnLine, FixedPoint, FixedRotation, FixedAxis | A sum of squares never says which constraint failed |
| 3dj DSL | `connector.male/female(type, {origin, axis, up})`; `moving.matchTo(target, a, b)` seats male on female, anti-aligned; `attachTo` on named points [17] | One-time placement; joint poses are parameters (the gripper's opening angle) | No persistent mates, DOF or interference |
| brepjs 20.11.1 | `AssemblyNode` tree with mates and joints [18] | Mates: coincident, concentric, distance, angle, fixed. Joints: revolute, prismatic, cylindrical, planar, spherical | Sequential analytic solver; FK, IK, trajectory, URDF |

**Motion, interference, exploded views, BOM and patterns.** Joints carry a value and limits that motion studies drive. Interference reports list pairs and overlap volume. Exploded views are ordered steps that move occurrences without touching mates. BOMs are derived, flat or structured, keyed on part number, with fasteners from standard libraries. Replicate copies one fastener and its mates onto every matching hole [6].

## 2. Data formats

| Format | Assembly content | Open3DJ status today |
|---|---|---|
| STEP AP214 / AP242 through OCCT XCAF | Product structure, part and instance names, colours, layers, validation properties (volume, area, centroid), semantic PMI in AP242 [1]. OCCT 7.6 added reading of STEP kinematics entities [19] | occt-wasm writes AP214 (`AUTOMOTIVE_DESIGN` in the file header). brepjs's `exportSTEPConfigured` accepts `schema: 242`, but its occt-wasm adapter ignores the options. AP242 needs a small upstream facade change. Kinematics are not exposed |
| glTF 2.0 | A node per occurrence; several nodes may share one mesh. `EXT_mesh_gpu_instancing` (ratified, Khronos vendor extension) adds per-instance TRS, must be listed in `extensionsRequired`, and has no per-instance materials [20] | occt-wasm's `exportGLTF` wrote 6 meshes for 3 definitions (spike), so Open3DJ writes glTF itself from per-definition tessellation |
| 3MF Core 1.4.0 | Objects hold a mesh or components (object id plus 3x4 transform). Build items carry transform and `partnumber`. References stay within one file; consumers may rearrange items [21] | brepjs's `exportThreeMF` writes one mesh object. Use `@3mfconsortium/lib3mf` 2.5.0 (BSD-2-Clause, Emscripten WASM) [22] or a small own writer |
| URDF / MJCF / SDFormat | URDF is tree-only, with no kinematic loops [23]. MJCF adds equality `connect`, "a ball joint outside the kinematic tree" [24]. SDFormat allows loops [23] | brepjs exports URDF for revolute and prismatic joints only. MuJoCo is Apache-2.0 with an official WASM package, `@mujoco/mujoco` 3.17.0 |
| OpenUSD | Composition and instancing for visualisation and digital twins. Core Specification 1.0 was ratified by AOUSD (announced Jan 2026) [25] | Later |

**occt-wasm 5.8.1 XCAF (read from `dist/xcaf-document.d.ts`).** `createXCAFDocument()` and `importXCAFFromSTEP(step)` return an `XCAFDocument` with `addShape(shape, {name, color, assembly})`, `addChild(parent, shape, {name, color, location})`, `getChildren`, `getRoots`, `getReferredLabel`, `getLocation` (3x4 row-major), `getSubShapes`, `addSubShape`, `setName`, `setColor`, `exportSTEP`, `exportGLTF` and `close`. Gotchas found:

- `addChild` takes Euler angles `rx, ry, rz` in radians, not a matrix. The spike confirmed R = Rz·Rx for X and Z; Y was not tested. Store quaternions or matrices in Open3DJ and convert at the boundary.
- Giving a part its first child turns it into an assembly and moves its geometry into a first component. Keep the root a pure assembly label.
- Definition names need `setName` on the referred label; otherwise STEP shows "ASSEMBLY" and "SOLID" (spike).
- Colours did not come back on labels after re-import (spike). This stays open.
- `located(shape, matrix)` shares topology, so a placed copy is O(1). `distanceBetween` gives the minimum distance; `common` plus `getVolume` gives overlap.

**3dj's approach (public `cad_get_starters`, called 28 Oct 2026).** Connectors are frames with a gender and a type tag (`"press"`, `"seat"`). `matchTo` performs a one-time anti-aligned seat. `withReferences` stores named points without orientation. Scripts return named descriptors `[{name, shape, color}]`. The planetary-gearbox starter clones one planet three times as three separate descriptors, so an importer must recover shared definitions from provenance (`clone`) or a geometry hash, and label that recovery "inferred".

## 3. Solvers

**From mates to equations.** Each free occurrence has six unknowns (translation plus a rotation, held as a quaternion with a unit-norm constraint or as a local rotation vector). A mate between connector frames A and B removes a fixed set of DOF. Coincident origins give 3 equations, aligned Z axes 2, and aligned X axes 1. That gives fastened 6, revolute 5, slider 5, cylindrical 4, pin slot 4, planar 3, ball 3 and parallel 2. These counts reproduce Onshape's remaining-DOF list [3][5].

**Analytic cases.** When each occurrence is placed by one mate to an already placed parent (a tree), its pose is closed form: `T_child = T_parent · F_A · J(q) · F_B⁻¹`, where `J(q)` is the joint motion (rotation by q about Z, slide by d along Z). Fastened mates are J = identity. Enclosures, brackets, fastener stacks, hinges and drawer slides fit this tier.

**Numeric cases.** Loops (four-bars, linkage grippers, a part held to two different parents) need simultaneous solving: Newton or Levenberg-Marquardt on the residual vector. DOF = 6n − rank(J). A constraint row that does not raise the rank is redundant: harmless if its residual is zero, a conflict if not. Counting rules fail. The Kutzbach formula gives 6·3 − 5·4 = −2 for a planar four-bar built from four revolute joints, yet its mobility is 1 because the axes are parallel [26]. Loops also have several solutions (elbow up or down, flipped connectors). Solvers keep the one nearest the previous pose, so a branch change must be reported, never hidden.

| Library | Licence | Runtime | Fit for Open3DJ |
|---|---|---|---|
| Own closed-form plus Levenberg-Marquardt with analytic Jacobian and rank-revealing QR | MIT OR Apache-2.0 | TypeScript | Tiers 1 to 3 for small assemblies; a few hundred lines; fully explainable reports |
| brepjs solver | Apache-2.0 | TypeScript | Reuse joint transforms, FK, IK and URDF; not the mate solver (measured) |
| OndselSolver 1.0.1 (FreeCAD) | LGPL-2.1 [27] | C++17, standard library only, about 42,000 lines | Strongest open option: FreeCAD's assembly and multibody solver, with many joint types (gear, rack and pinion, screw, universal, constant velocity). Candidate separate WASM module for a later tier. A native build in this sandbox was refused by the permission system, so it is unmeasured |
| ml-levenberg-marquardt 5.1.0 | MIT | JavaScript | Curve-fitting API; a test oracle, not the core |
| PlaneGCS (`@salusoft89/planegcs` 1.3.0) | LGPL | WASM | 2D sketches only |
| CasADi with IPOPT | LGPL-3 and EPL-2.0 | C++ and Python | CadQuery's route; Python tier only |
| Ceres | BSD-3 | C++ | Excellent least squares, but needs a WASM build plus Eigen |
| NLopt | MIT when built without the `luksan` code, otherwise LGPL [28] | C | General optimisation; no diagnosis |
| SolveSpace libslvs | GPL-3 | C++ | Out of the core; subprocess only |

## 4. Measurements (spike 2, 28 Oct 2026)

| Check | Result |
|---|---|
| Pin with 0.15 mm radial clearance in a hole | distance 0.150 mm, overlap 0: **clearance** (16 ms distance, 10 ms common) |
| Oversize pin | overlap 23.89 mm³: **clash** |
| Box resting on the plate | distance 0, overlap 0: **contact** |
| 144 screws plus a 144-hole plate: candidate pairs | 10,440 possible; **144** after an AABB filter (5.5 ms) |
| Exact OCCT `common` on the candidates | 2.8 to 4.1 s over two runs (19 to 29 ms a pair); found both screws sunk 1 mm (14.68 mm³ each) |
| Manifold 3.5.4 mesh boolean on the same pairs | 0.78 s, 5.4 ms a pair, same two clashes at 14.64 mm³; one-off tessellate and weld 0.79 s |
| three-mesh-bvh `intersectsGeometry` | 0.9 ms a pair, but flagged all 144 because seated heads touch the plate: surface tests cannot tell contact from clash |
| brepjs conflicting mates | Second mate ignored, `converged: true`, `dof: 0` |
| brepjs four-bar `mechanismDOF` | 4 reported, true mobility 1 |

The check is therefore tiered: AABB filter, then a mesh volume (confidence "observed"), then exact OCCT on flagged or critical pairs (confidence "measured"). Pairs joined by a fastened or planar mate expect contact, and press fits are declared interference with an intended value.

## 5. Large assemblies (1,000 to 100,000 occurrences)

- **Tessellate per definition, once.** The cache key is definition id, configuration and tolerance. One hundred screws cost one tessellation. brepjs's `instancedMesh` already returns "one tessellation, N placements".
- **Draw per definition.** three.js `InstancedMesh` for repeated definitions, `BatchedMesh` for many distinct parts sharing a material, with per-object frustum culling and sorting [29]. `BatchedMesh` does not support negatively scaled matrices, so mirrored parts become their own "handed" definitions, which is also right for the BOM. `LOD` swaps coarser tessellations by screen size.
- **Graphics-only mode.** Open from the mesh cache without starting the kernel, like SOLIDWORKS Large Design Review, which loads display data only, or Lightweight mode, which loads components on demand [30]. Selecting an occurrence for editing loads its definition into a kernel worker.
- **Reduce the mates.** Groups, composite parts and Replicate, as in Onshape [6]. Sub-assemblies solve once and move as one rigid body unless flexible.
- **Lazy loading and a scale guard.** Stream definitions by on-screen size from the content-hashed `.o3j-cache`. The wasm32 kernel heap is capped at 4 GiB (lean-stack.md), so large assemblies stay mesh-first and only edited definitions hold B-rep in memory.

## 6. Calculating on CPU and GPU

**Contract.** Every assembly computation takes `compute: "auto" | "cpu" | "gpu"`, defaulting to `auto`. The CPU path is mandatory, deterministic and used in CI and golden tests. A GPU path is added only where it pays, returns the same schema, and records `backend` and `device` in the result and in provenance. When no GPU adapter exists (Linux browsers often lack WebGPU [31]; containers usually have no GPU), `auto` falls back silently, and an explicit `gpu` request fails with a structured error. CI samples GPU results against CPU results; a mismatch beyond tolerance stops the line.

| Workload | CPU path (reference) | GPU path (optional) |
|---|---|---|
| Exact clash, distance, mass properties | OCCT in WASM, a worker per pair batch | None: B-rep stays on the CPU |
| Mate solving and DOF | TypeScript solver; later OndselSolver WASM | None needed at assembly sizes |
| Mesh clash and clearance | Manifold `intersect`, `volume`, `minGap`; three-mesh-bvh `bvhcast` and `closestPointToGeometry` | three-mesh-bvh's WebGPU `BVHComputeData` (marked unstable, needs three.js r185 or later) for broad-phase and distance fields at 1,000+ occurrences [32] |
| Motion sweep (N poses times M pairs) | Worker pool over poses | WebGPU compute batch; cloud GPU through the provider router (MuJoCo Warp, NVIDIA Warp, both Apache-2.0) for dynamics |
| Rendering | occt-wasm HLR PNG and SVG (deterministic, CI) | three.js WebGPURenderer with WebGL2 fallback; Node needs the optional `webgpu` package (Dawn, MIT, about 137 MB unpacked) |

## 7. Agent-facing design

**Declarative graph.** `assembly.o3j.json` sits next to the part scripts:

```json
{"definitions": {"base": {"script": "scripts/base.o3j.js", "partNumber": "ENC-001"},
                 "screw": {"lib": "iso4762", "params": {"size": "M3", "length": 10}}},
 "occurrences": [{"id": "base#1", "def": "base", "fixed": true},
                 {"id": "screw#1", "def": "screw"}],
 "mates": [{"id": "m1", "type": "fastened", "a": "base#1.hole_tl", "b": "screw#1.head_seat"}],
 "patterns": [{"source": "screw#1", "replicateOn": "base#1.hole_*"}]}
```

**Report after every change (extends the GeometryReport).** It contains:

- the tree with occurrence paths;
- per-occurrence free DOF named in connector terms ("rotation about Z of `shaft`");
- mate status: satisfied, redundant, conflicting with its residual, or broken reference with candidates;
- a solution-branch change flag;
- a clash, contact and clearance table with confidence labels;
- the BOM (flat and structured);
- mass and centre of gravity;
- an exploded-view render and N motion-sample renders.

**Tool surface.** Keep the four lean-stack tools. `run` accepts graph patches (`add_occurrence`, `add_mate`, `set_joint`, `pattern`, `replace_definition`) with a `base_rev` token. `inspect` gains `tree`, `dof`, `clashes` and `bom` fields. `render` gains `exploded` and `motion`. `export` gains `3mf`, `urdf` and `mjcf`. Everything works over plain `tools/list` and `tools/call` (gap-6).

**Pitfalls and countermeasures (poka-yoke)**

| Pitfall | Countermeasure |
|---|---|
| References break after a part edit | Connectors sit on named references; a broken one marks its mates "broken" with ranked candidates. The tool never silently re-attaches |
| Solver flips or switches branch | Store flip and reorientation flags in the mate; keep the solution nearest the last pose; report a branch change as a warning with before and after renders |
| Ambiguous or missing mates | Report free DOF by name so the agent can tell an intended revolute from a forgotten fastener |
| Over-constraint | Rank analysis separates redundant from conflicting mates and names them |
| False interference alarms | Separate clash, contact and clearance; exempt mated contacts; declare press fits |
| Euler angles and gimbal lock | Quaternions or matrices in the file; Euler only at the occt-wasm boundary |
| BOM double counting or merging | BOM groups by definition and configuration, not geometry alone. Geometry-hash grouping for imported 3dj scripts is labelled "inferred" |
| In-context edits that cascade | Pin context snapshots to a revision; update only on request, with a diff |

## 8. Recommendation

**Data model.** Project → definitions (part, assembly, standard part) → occurrences (stable UUIDv7 id, name, definition plus configuration, transform as translation plus quaternion, suppressed, BOM include, colour override) → connectors (frames on definitions, anchored to named references, 3dj gender and type tags) → mates (type, two connector paths, offset, limits, value bound to a `Param`) → patterns, groups, explode states and motion studies. The BOM, DOF and clash tables are always derived, never stored. A single part is a root assembly with one occurrence.

**Steps (each a small, usable release that fits the lean ladder)**

| Step | Ships | Exit check |
|---|---|---|
| A0 with R0/R1 | Assembly-first file; 3dj descriptors and `matchTo` map to occurrences and fastened mates; XCAF STEP with names at both levels; per-definition glTF; BOM CSV; tiered clash, contact and clearance; exploded multiview render | The nine multi-part 3dj starters import, export and report; every reported clash is confirmed by the exact check or waived |
| A1 | Tree joints (revolute, slider, cylindrical) with limits as Params; motion-sample renders and swept clash; named-DOF report; 3MF components and build items; viewer instancing | A hinge and a drawer slide animate; a seeded swept clash is caught |
| A2 | Numeric tier (LM plus rank) for loops; planar, ball, pin slot, parallel, distance, angle; redundancy and conflict diagnosis; branch keeping; URDF and MJCF; Replicate; ISO fastener library with BOM fields; configurations | A four-bar reports mobility 1; a seeded conflicting mate is named |
| A3 | Large-assembly mode (BatchedMesh, LOD, graphics-only, lazy load); GPU broad-phase; in-context references pinned to revisions; OndselSolver WASM spike; AP242 STEP via an occt-wasm facade contribution | 10,000 occurrences orbit at the frame-time gate on the reference laptop |
| Later | Gear, rack and pinion and screw relations; tolerance stacks (ID-4); MuJoCo WASM on the CPU and MuJoCo Warp on cloud GPU for dynamics; OpenUSD | Pulled by real use |

**Cash cost is zero.** Every library above is free. Cloud GPU dynamics is an opt-in provider with the user's own budget cap.

## Sources

1. OCCT XDE user guide: https://occt3d.com/dev/doc/overview/html/occt_user_guides__xde.html
2. Onshape, Modeling in context: https://cad.onshape.com/help/Content/in-context.htm
3. Onshape, Mate connectors blog: https://www.onshape.com/en/blog/build-assemblies-faster-mate-connectors
4. Onshape, Mates help: https://cad.onshape.com/help/Content/mate.htm
5. Onshape, Planar mate: https://cad.onshape.com/help/Content/mate-planar.htm
6. Onshape, Large assembly performance: https://www.onshape.com/en/blog/large-assembly-performance-cloud-native-cad-pdm
7. SOLIDWORKS, Types of mates: https://help.solidworks.com/2021/english/SolidWorks/sldworks/r_Types_of_Mates_SWassy.htm
8. SOLIDWORKS, Mate errors: https://help.solidworks.com/2017/English/SolidWorks/sldworks/c_Solving_Mate_Problems.htm
9. Fusion, Joint types: https://help.autodesk.com/cloudhelp/ENU/Fusion-Assemble/files/GUID-8818AE31-958A-4A59-989B-9875A174C67A.htm
10. Fusion, As-built joint: https://help.autodesk.com/cloudhelp/ENU/Fusion-Assemble/files/ASM-CREATE-AS-BUILT-JOINT.htm
11. FreeCAD Assembly workbench (wiki mirror; wiki.freecad.org blocked the fetch): https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/Assembly_Workbench.html
12. FreeCAD release notes 1.0 and 1.1: https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/Release_notes_1.0.html ; https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/Release_notes_1.1.html
13. FreeCAD versioning: https://blog.freecad.org/2026/06/26/new-freecad-versioning-scheme-and-development-cycle/
14. build123d joints: https://build123d.readthedocs.io/en/latest/joints.html
15. CadQuery assemblies: https://cadquery.readthedocs.io/en/latest/assy.html
16. CadQuery solver source: https://github.com/CadQuery/cadquery/blob/master/cadquery/occ_impl/solver.py
17. 3dj MCP `cad_get_starters` (public), dslReference and starters, called 28 Oct 2026
18. brepjs 20.11.1 (`dist/operations/assemblyFns, mateFns, jointFns, instanceFns, urdfFns, ikFns`, `dist/measurement/interferenceFns`): https://www.npmjs.com/package/brepjs
19. OCCT 7.6.0 release (STEP kinematics reading): https://manufacturingtomorrow.com/news/2021/11/08/open-cascade-technology-760-released/17850
20. EXT_mesh_gpu_instancing: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing/README.md
21. 3MF Core Specification 1.4.0: https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
22. lib3mf WASM: https://www.npmjs.com/package/@3mfconsortium/lib3mf
23. URDF+ (URDF has no loops; SDF allows them): https://arxiv.org/abs/2411.19753
24. MuJoCo XML reference, equality/connect: https://mujoco.readthedocs.io/en/stable/XMLreference.html ; licence: https://github.com/google-deepmind/mujoco/blob/main/LICENSE ; WASM: https://www.npmjs.com/package/@mujoco/mujoco
25. OpenUSD Core Specification 1.0: https://digitalproduction.com/2026/01/05/aousd-releases-openusd-core-specification-1-0/ ; https://www.linuxfoundation.org/press/aousd_prmarch2026
26. Chebychev-Grübler-Kutzbach criterion: https://en.wikipedia.org/wiki/Chebychev%E2%80%93Gr%C3%BCbler%E2%80%93Kutzbach_criterion
27. OndselSolver (LICENSE, CMakeLists.txt, sources): https://github.com/FreeCAD/OndselSolver
28. Solver licences: https://github.com/casadi/casadi/blob/main/LICENSE.txt ; https://github.com/coin-or/Ipopt/blob/stable/3.14/LICENSE ; https://github.com/stevengj/nlopt/blob/master/COPYING ; https://github.com/ceres-solver/ceres-solver/blob/master/LICENSE ; https://github.com/solvespace/solvespace/blob/master/COPYING.txt ; https://github.com/Salusoft89/planegcs ; https://github.com/mljs/levenberg-marquardt
29. three.js BatchedMesh: https://threejs.org/docs/pages/BatchedMesh.html
30. SOLIDWORKS opening modes: https://support.hawkridgesys.com/hc/en-us/articles/203486053
31. WebGPU support: https://web.dev/blog/webgpu-supported-major-browsers ; Node package: https://www.npmjs.com/package/webgpu
32. three-mesh-bvh README, API.md and WEBGPU_API.md: https://github.com/gkjohnson/three-mesh-bvh
33. GPU physics licences: https://github.com/google-deepmind/mujoco_warp/blob/main/LICENSE ; https://github.com/NVIDIA/warp/blob/main/LICENSE.md
34. Manifold `minGap` and booleans (manifold-3d 3.5.4 type definitions): https://www.npmjs.com/package/manifold-3d
35. Spike scripts and output: [spike/asm2/](spike/asm2/) `asm2_spike.mjs`, `asm3_meshpath.mjs`, `asm2.json`, `asm3.json`
