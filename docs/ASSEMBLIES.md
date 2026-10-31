# Open3DJ assembly architecture

Status: assembly design of record from 28 Oct 2026, paired with [PLAN.md](PLAN.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Step numbers S0 to S12 are the plan's. CPU and GPU placement rules are in [COMPUTE.md](COMPUTE.md). Evidence: [research/assemblies.md](research/assemblies.md) (survey, solver licences, fit and solver spike) and [research/spike-assemblies.md](research/spike-assemblies.md) (occt-wasm XCAF spike). Numbers marked "proposed" or "hypothesis" are starting points to measure, not facts.

## 1. Rules

1. **Every design is an assembly.** A single part is a root assembly with one occurrence. There is no part-only file, tool, report or export.
2. **Structure is data, geometry is script.** `assembly.o3j.json` holds the graph. Part geometry lives in DSL scripts. Changing a mate or a transform never re-runs a script.
3. **Mates bind connectors, never raw faces.** A connector is a frame on a definition, anchored to a named reference, so it inherits the five reference states.
4. **Nothing is silently ignored or auto-picked.** Conflicting mates are named with their residual. Ambiguous references and multiple solutions come back as candidates.
5. **The CPU decides, the GPU screens.** Every assembly computation has a deterministic CPU path. GPU paths display, pre-filter and preview, and every result records `backend` and `device`.
6. **Every number carries a confidence label:** measured, observed, inferred or assumed.

## 2. Document model

### 2.1 Objects

| Object | Key fields | Notes |
|---|---|---|
| Definition | id, name, kind, `partNumber`, params, connectors, BOM fields | Kinds: `script` (a `parts/*.o3j.js` file, optionally one named export of it), `lib` (standard part plus parameters), `assembly` (content is occurrences), `imported` (STEP geometry stored in the project, references by fingerprint only). A mirrored part is its own "handed" definition (`handedOf`) |
| Configuration | definition id plus configuration name, or a params hash for library parts | Each unique key is its own entry for tessellation, mass and BOM |
| Occurrence | UUIDv7 id, name, definition key, transform, `fixed`, `suppressed`, `bom`, colour override | Addressed by path; mates and overrides key on the id |
| Connector | name, origin, Z axis, X axis, gender (`male`, `female`, none), type tag (`insert_m3`, `press`), anchor reference | 3dj-compatible |
| Mate | id, type, connector paths `a` and `b`, offset, `flip`, limits, value bound to a `Param`, owner (`script` or `graph`) | Status is derived |
| Declared fit | pair or connector types, kind (`press`, `thread`), expected overlap range, reason, author | Turns an intended overlap into a checked expectation |
| Pattern | source, `replicateOn` connector glob, type filter | Replicate fasteners onto every matching hole |
| Group | occurrence ids | Moves and solves as one rigid body |
| Explode state | ordered steps | Display only |
| Motion study | joints, ranges, samples | S6 |

**Always derived, never stored:** BOM, DOF, mate status, the clash, contact and clearance table, mass and centre of mass. The last solved pose of each mated occurrence is stored as a seed, because keeping the nearest solution needs it.

### 2.2 Addressing

- **Occurrence ids** are UUIDv7 and never change. Renames keep the id.
- **Paths** are built from names: `handheld/pcb_assy/led#1`. Agents may write paths; the daemon resolves them to ids when it accepts the write.
- **Connector paths** add the connector name: `top_shell#1.boss_2`.
- **Element addresses** (faces, edges) use the `@elem:` form from [ARCHITECTURE.md](ARCHITECTURE.md) section 9, prefixed by the occurrence path: `<path>@elem:face:<n>`, for example `lid@elem:face:5` or `pcb_assy/standoff#2@elem:face:3`, where `face:<n>` is the kernel's face number in the definition (1-based, as in `refs`). In S2 the viewer gives faces this form; edges have no address yet (the display mesh does not carry the kernel's edge numbers), so the viewer names an edge by the faces it bounds.

### 2.3 Transforms

- An occurrence transform is a translation in mm plus a unit quaternion `[x, y, z, w]` (glTF order), relative to its parent. Units are mm and the project is Z-up.
- No scale and no shear. Mirroring uses a handed definition, which keeps BOM lines honest and suits `BatchedMesh` (no negative scale).
- A quaternion whose norm differs from 1 by more than 1e-6 (proposed) is rejected with a structured error.
- Euler angles exist only at the occt-wasm `addChild` boundary, which takes `rx, ry, rz`. The spike measured R = Rz·Rx for X and Z; the Y axis is to verify with a property test before S1 ships.

### 2.4 Sub-assemblies

- A sub-assembly is a definition whose content is occurrences. It can be reused, so `pcb_assy` placed twice shares one definition.
- **Rigid by default:** it solves once in its own frame and moves as one body. `flexible: true` exposes its joints to the parent (S6).
- **Promoted connectors:** a sub-assembly can expose a child connector under its own name (`pcb_assy.mount_1` maps to `pcb#1.mount_1`), so a parent mates to it without reaching inside.

### 2.5 Configurations

Parameters exist from S1: two library screws with different lengths are two definition keys. Named configuration tables per definition, and root configurations that pick child configurations (for example "with display" and "without display"), ship in S4 with the BOM, their first consumer.

### 2.6 Graph sketch

```json
{"root": "handheld",
 "definitions": {
   "handheld":    {"kind": "assembly", "partNumber": "HH-0000"},
   "top_shell":   {"kind": "script", "script": "parts/shells.o3j.js", "export": "top_shell", "partNumber": "HH-0002"},
   "insert_m3":   {"kind": "lib", "lib": "heat_set_insert", "params": {"thread": "M3"}},
   "screw_m3x10": {"kind": "lib", "lib": "iso4762", "params": {"size": "M3", "length": 10}}},
 "occurrences": [
   {"id": "0193..a1", "name": "bottom_shell#1", "def": "bottom_shell", "fixed": true},
   {"id": "0193..a2", "name": "top_shell#1", "def": "top_shell"}],
 "mates": [{"id": "m1", "type": "fastened", "a": "bottom_shell#1.rim", "b": "top_shell#1.rim", "owner": "graph"}],
 "patterns": [{"id": "p1", "def": "insert_m3", "connector": "seat", "replicateOn": "top_shell#1.boss_*"}]}
```

## 3. How the 3dj DSL maps onto the model

| 3dj construct | Open3DJ object | Label and notes |
|---|---|---|
| Named descriptor return `[{name, shape, color}]` | One definition (`script` plus `export: name`) and one occurrence per descriptor | Shape in world coordinates gives an identity transform |
| Identical clones (`clone` then move) | One shared definition, several occurrences | "measured" when recovered from `clone` provenance; "inferred" when recovered from a geometry hash |
| `connector.male/female(type, {origin, axis, up})` | Connector with gender and type tag | Built from a named reference: inherits its state. Built from literal coordinates: reported `exact` with `anchor: "literal"`, so reviewers know it does not follow geometry. Library parts must anchor to references (C6 checker) |
| `moving.matchTo(target, a, b)` | Script-owned fastened mate, male seated anti-aligned on female (`flip: true`) | Re-derived on every script run. An op that tries to delete it gets an error naming the script line |
| `attachTo` | Fastened mate on an implicit connector at the named point, axes from the target's frame | Reported `anchor: "implicit"` |
| `withReferences`, `onFace`, `hole` | Named references on the definition | Points have no orientation; a connector built on one takes its Z from `onFace` normals or an explicit axis. The facade adds a female connector on each `hole` result |
| `lib.*` | `lib` definitions under the Library Convention (C6) | Connectors, declared fits and BOM fields included |
| Native `asm.part(name, fn)`, `asm.place(def, {at \| mate})` | Definitions and graph-owned occurrences | For scripts written for Open3DJ |

**Conformance.** The multi-part 3dj starters run through both engines. Per descriptor: same occurrence count, same definition count after clone recovery, volumes and bounding boxes within the C2 tolerances, and world poses within 1e-6 mm (proposed; to verify against OpenCascade.js 7.7.2 output).

## 4. Mates and joints

### 4.1 Types and their constraints

Each free occurrence has six unknowns. A mate between connector frames A and B is a set of constraint primitives:

- **P**: origins coincide (3 equations)
- **Z**: Z axes aligned (2)
- **X**: X axes aligned (1)
- **L**: B's origin on A's Z line (2)
- **N**: B's origin on A's XY plane (1)
- **D**: a distance (1)
- **A**: an angle (1)

| Type | Primitives | Equations | Free motion | Step | Solving |
|---|---|---|---|---|---|
| Fastened | P, Z, X | 6 | none | S1 (script `matchTo`), S4 (agent ops) | Closed form |
| Revolute | P, Z | 5 | Rz | S6 | Closed form in a tree |
| Slider | Z, X, L | 5 | Tz | S6 | Closed form in a tree |
| Cylindrical | Z, L | 4 | Rz, Tz | S6 | Closed form in a tree |
| Planar | Z, N | 3 | Tx, Ty, Rz | S6 | Closed form in a tree |
| Pin slot | Z, origin on A's X line | 4 | Rz, Tx | S11 | Numeric |
| Ball | P | 3 | Rx, Ry, Rz | S11 | Numeric |
| Parallel | Z | 2 | Tx, Ty, Tz, Rz | S11 | Numeric |
| Distance, angle | D or A | 1 | 5 DOF remain | S11 | Numeric |
| Gear, rack and pinion, screw | Relation between two joint values | 1 | couples two joints | Pull board | OndselSolver trigger |

Every mate has an offset (translation plus rotation about Z), a `flip` flag (half turn about B's X) and, for joints, a value bound to a `Param` with limits.

### 4.2 Solving tiers

1. **Closed form (S1, S4, S6).** The daemon builds a mate graph with grounded occurrences as roots. When each occurrence is placed by one mate to an already placed parent, its pose is `T_child = T_parent · F_A · J(q) · Flip · F_B⁻¹`, where `J(q)` is the joint motion and identity for fastened mates. Rigid sub-assemblies and groups collapse to one body first.
2. **Extra mates in the closed-form tier (from S1).** A mate that closes a cycle is evaluated at the closed-form pose. A zero residual makes it "redundant" (named, harmless). A non-zero residual makes it "conflicting", with the residual in mm and degrees and both mates named. The occurrence keeps the pose from its older mate, the report says so, and export gates fail. This is the case where brepjs reported `converged: true, dof: 0` and ignored the second mate. **Precedence for loops (S6 to S11):** a cycle-closing joint whose primitives leave free motion (a four-bar's fourth revolute, for example) is reported as `loop_unsolved`, not `conflicting`, with its free motion named, because a non-zero residual there may only mean the loop has not been solved yet. Only the numeric tier in S11 decides whether such a loop is satisfiable. A cycle-closing fastened mate has no free motion, so it stays redundant or conflicting.
3. **Numeric (S11).** Levenberg-Marquardt over all unknowns, with poses parameterised as translation plus a rotation-vector step about the current pose, an analytic Jacobian, and length scaled by the assembly's bounding-box diagonal so mm and radians mix (proposed). Rank comes from column-pivoted QR or SVD with a relative threshold. **DOF = 6n − rank(J)** at the solution. A row that does not raise the rank is redundant. If the residual stays above tolerance, a deletion filter drops one mate at a time to find a minimal conflicting set, which the report names. The seed is the last solved pose. If the solution jumps beyond a continuity bound, the report flags a branch change with before and after renders.

### 4.3 Solver libraries and licences

| Library | Licence | Use |
|---|---|---|
| Own TypeScript solver (closed form, then LM with rank) | Open3DJ's own code: MIT today; MIT OR Apache-2.0 proposed ([PLAN.md](PLAN.md) section 11, decision 2) | All tiers, S1 to S11 |
| brepjs 20.11.1 | Apache-2.0 | Joint transforms, forward kinematics, URDF. Not its mate solver or `mechanismDOF` (measured: conflict ignored; 4 DOF for a four-bar of mobility 1) |
| ml-levenberg-marquardt 5.1.0 | MIT | Test oracle only |
| OndselSolver 1.0.1 | LGPL-2.1 | Separate WASM module on its pull-board trigger; build unmeasured; spike needs founder approval |
| SolveSpace libslvs | GPL-3 | Never in process |
| CasADi with IPOPT | LGPL-3, EPL-2.0 | Python tier only |

### 4.4 DOF report and diagnostics

`inspect fields=[dof]` returns:

```json
{"mobility": 1,
 "occurrences": [
   {"occ": "top_shell#1", "state": "fully_constrained"},
   {"occ": "button#2", "state": "placed", "free": 6, "note": "placed by transform, no mate"},
   {"occ": "lid#1", "state": "under_constrained", "free": ["rotation about Z of lid#1.hinge (m4)"]}],
 "mates": [
   {"id": "m2", "status": "satisfied"},
   {"id": "m7", "status": "redundant", "with": ["m3"]},
   {"id": "m9", "status": "conflicting", "residual_mm": 0.40, "residual_deg": 0.0, "with": ["m5"]},
   {"id": "m11", "status": "broken", "connector": "pcb#1.mount_3", "reason": "reference deleted", "candidates": [...]},
   {"id": "m12", "status": "ambiguous", "candidates": [...]}]}
```

Occurrence states: `grounded`, `fully_constrained`, `under_constrained` (free motions named in connector terms), `placed` (pose given as data, no mate; a forgotten fastener shows up here), `over_constrained`. Mobility is the total of named free motions of mated (non-placed) occurrences. Placed occurrences are listed separately and do not count toward it, which is why `button#2` above, with 6 free motions, leaves mobility at 1.

**Mate status enum.** This is the single list; [PLAN.md](PLAN.md) and the other documents point here.

| Status | Meaning | From |
|---|---|---|
| `satisfied` | The mate holds at the solved pose | S1 (script `matchTo`), S4 |
| `redundant` | Closes a cycle with zero residual; named with the mates it duplicates, harmless | S1 |
| `conflicting` | Closes a cycle with a non-zero residual; residual in mm and degrees, both mates named; export gates fail | S1 |
| `broken` | An anchor reference is broken; the last pose is held and ranked candidates are listed | S1 |
| `ambiguous` | Several solutions or anchors; the seed pose is held and `candidates[]` returned (section 4.5) | S1 (anchors, seats without an X axis), S4 (Replicate patterns), S11 (loops with several solutions) |
| `loop_unsolved` | A cycle-closing joint with free motion, before the S11 solver (section 4.2); its free motion is named, and `mobility` is marked incomplete while any loop is unsolved | S6 to S11 |

A choice made with `set_mate {id, choose: k}` is recorded as a `disambiguated` reference state on the mate's connector (section 4.5); the mate then reports `satisfied` or one of the other statuses.

### 4.5 Ambiguity returns candidates

Ambiguity has four sources: a connector anchor that matches several features; a seat on a connector without an X axis, which leaves rotation about Z free; a loop with several first solutions; and a Replicate pattern with equally good matches. In every case:

- the mate status is `ambiguous`, and the occurrence stays at its seed pose, marked `pose: "held"`;
- `candidates[]` lists each option with its pose, its distance from the seed and a highlight render id;
- the agent or human chooses with `set_mate {id, choose: k}`, which records a `disambiguated` state with the chosen candidate's fingerprint, so replay repeats the choice.

A missing X axis is reported as a free rotation, never filled in with zero.

## 5. Reference stability across part edits

- **Resolution.** Connectors resolve through their anchor reference. S1 uses geometric fingerprints (exact, ambiguous, broken). S3 adds occt-wasm history operations (re-resolved, disambiguated).
- **Mates inherit the state.** `exact` and `re-resolved` mates solve. A re-resolved connector also reports its frame shift in mm and degrees. `ambiguous` returns candidates and holds the last good pose. `broken` holds the last pose and lists ranked candidates. Nothing re-attaches silently.
- **Ripple report.** Every change returns `moved[]`: the occurrences whose world pose changed and by how much. An agent editing a boss height sees that four inserts and four screws moved 1.5 mm.
- **Patterns re-match.** After an edit, Replicate re-matches its glob and reports `pattern_changed {added, removed}`.
- **Gauge.** The 1,000-edit sweep (PLAN.md section 2, G4) includes assembly edits. A silent mis-resolution is a red andon.

## 6. Interference, contact and clearance

### 6.1 Three outcomes

| Outcome | Rule | Default tolerance |
|---|---|---|
| Clash | Overlap volume above `v_tol` | 1e-3 mm³ (proposed) |
| Contact | Minimum distance at or below `d_tol`, no overlap | 1e-4 mm (proposed) |
| Clearance | Distance above `d_tol` and below the watch distance | Watch distance 0.5 mm per project (proposed); minimum clearances per pair type come from the brief |

Distance alone cannot separate these, and surface tests cannot either: three-mesh-bvh flagged all 144 seated screws because touching heads look like hits ([research/assemblies.md](research/assemblies.md) section 4).

### 6.2 Tiers

| Tier | Method | Measured cost | Label | Step |
|---|---|---|---|---|
| 0 | AABB filter, boxes inflated by the watch distance | 145 occurrences: 10,440 pairs to 144 in 5.5 ms | none (filter) | S1 |
| 1 | Manifold `intersect`, `volume`, `minGap` on cached meshes | 5.4 ms a pair; volumes within 0.3% of exact | observed | S3 |
| 2 | Exact OCCT `common` plus `getVolume`, `distanceBetween` | 19 to 29 ms a pair | measured | S1 |

From S3, tier 1 screens and tier 2 confirms every flagged pair and every critical pair (mated pairs and pairs named in the brief).

### 6.3 Expected contact and declared fits

- Contact between mated pairs is expected and not listed as a finding. A clash between mated pairs is still a clash.
- A pair that touches or nearly touches can hold several gaps, and each distinct one is its own clearance line (S1): a lid seated on its rim (a mated contact, not listed) whose lip clears the inner wall by 0.25 mm shows that 0.25 mm; a screw in a counterbored hole shows its head contact, its 0.2 mm shank gap and its 0.5 mm head gap. A gap is a pair of faces that face each other across empty space: planes whose outward normals point at each other, or a convex and a concave round face on parallel axes (a pin in a hole). Two faces turned the same way have one part's material between them and are not a gap. Two planes that face each other are a gap only when the slab the smaller face sweeps across the gap shares no volume with either part, so a gap is never measured through a thin fin of one part. Distances between faces that only meet at an edge or a corner are not features. The pair's closest relation keeps its own line; each further gap is a clearance line marked `extra: true` (so counting pairs by relation means skipping extra lines). At most 3 extra gaps per pair, smallest first. Clashing pairs are not searched for gaps, because a face inside the other part measures its distance to that part's skin. On the 145-occurrence reference plate this costs about 15% more fit time (17.7 s to 20.4 s on a fresh worker).
- **Declared fits** turn intended overlaps into checks: a heat-set insert in its pocket (`press`), a screw in an insert (`thread`). Each has an expected overlap range; outside the range it is a clash. Library parts declare their own fits. Agents may declare others with a reason. All declarations are listed for human review at design freeze (S5).
- Design freeze requires zero undeclared clashes.

### 6.4 Incremental and parallel

Pair results are cached by (definition key A, definition key B, relative transform, tolerance set). Editing one part re-checks only its pairs. Pairs spread across batch-lane workers. If exact checks exceed the interactive budget (1 s, proposed), the report returns the tier 0 result and a `job_id`.

### 6.5 CPU and GPU

| Work | CPU path (reference) | GPU path | Step |
|---|---|---|---|
| Broad phase | AABB filter in workers; three-mesh-bvh `bvhcast` | WGSL pre-check (three-mesh-bvh WebGPU `BVHComputeData`, marked unstable upstream, or own kernel) in `@open3dj/accel-webgpu` | S1 CPU, S7a GPU |
| Mesh fit tier | Manifold in workers | WGSL BVH distance screening | S3 CPU, S7a GPU |
| Exact fit | occt-wasm | none (OCCT is CPU only) | S1 |

The GPU pre-check may only drop pairs that are farther apart than the watch distance plus a guard band. Its output is "observed" and never a verdict. A nightly job reruns the CPU twin on `corpora/reference-assemblies` (built in S0); any pair the GPU dropped but the CPU kept is a red andon. Calls take `compute: "auto" | "cpu" | "gpu"`. `auto` uses device profiles, so at enclosure size, where the AABB filter takes milliseconds, it will usually stay on the CPU. That is why the S7a gate is measured per kernel on the generated assembly of 1,000 or more occurrences, with no slowdown allowed on the enclosure corpus ([PLAN.md](PLAN.md) S7a). An explicit `gpu` with no capable device returns a structured error. The kernel merges only with a CPU twin, a fixed-seed tolerance test, a lavapipe CI job and a 3x gain on a real GPU (COMPUTE.md).

## 7. BOM and part numbering

- **Derived from the graph.** Lines group by definition key (definition plus configuration), never by geometry alone. Handed definitions get their own lines. Geometry-hash grouping exists only for imported 3dj scripts and is labelled "inferred".
- **Part numbers.** A definition carries `partNumber`. If it has none, the daemon assigns `<prefix>-<nnnn>` on first appearance and stores it; numbers are never reused, even after deletion. Library parts keep their designation ("ISO 4762 M3x10") as the description; manufacturer part numbers are optional fields.
- **Columns:** item, level, part number, description, quantity, source (`make`, `buy`, `lib`), material, finish, mass in g (measured on the CPU, density from the material; "assumed" if the material is assumed), definition key, notes.
- **Views:** flat and structured (indented by sub-assembly). Sub-assembly modes: normal, `phantom` (children roll up) and `bom: false` (reference geometry).
- **Where it goes:** `inspect fields=[bom]`; `export format=bom` (CSV); product names in STEP; `partnumber` on 3MF objects and build items; the RFQ pack (S12).

## 8. Standard parts and fasteners

Library parts are ordinary definitions with a C6 manifest: the cited standard by number, parameters, connectors (`head_seat`, `axis`, `tip` for screws; `seat`, `thread` for inserts), declared fits, BOM fields and licence. Dimensions come from the cited standard or vendor datasheet, checked by the Library Convention checker.

- **Features and parts are separate entries.** `lib.heatSetPocket` is a DSL feature cut into the shell; `heat_set_insert` is the C6 library part that Replicate places in that pocket. DSL calls keep the 3dj camelCase names (`lib.heatSetPocket`, `lib.screwBoss`); library part ids are snake_case, like every id in `assembly.o3j.json` (`heat_set_insert`, `iso4762`).
- Threads are modelled as plain cylinders with a thread attribute, so a screw in an insert is a declared `thread` fit, not a clash.
- **Replicate** places one fastener with its mate onto every matching connector. Four screws are one pattern, not four calls.
- **Engagement check:** for each `thread` fit, the report gives engagement length against the library part's stated minimum.

## 9. Exploded views

- An explode state is an ordered list of steps. Each step moves a set of occurrences along a direction (a vector or `mate_axis`) by a distance.
- Exploded transforms are display only. They never change mates, fits or exports.
- `run ops=[{op: "explode", mode: "auto"}]` proposes steps from the mate graph: reverse mating order, each occurrence moving along its fastened connector's Z axis, fasteners first. In S4 the agent proposes and edits the steps, and a human asks it for changes. From S5 a human can also adjust them in the viewer's step editor, which writes through `run` with `base_rev` and the page nonce.
- `render view=exploded` gives a deterministic CPU HLR multiview with trail lines. The viewer animates the steps on the GPU.

## 10. Motion sampling and joint limits (S6)

- Joint values are `Param`s with limits. `set_joint` outside its limits returns a structured error naming the limit.
- A motion study names joints, ranges and a sample count. Poses come from the closed-form tier, so each sample is cheap.
- **Swept clash** checks only pairs whose relative transform changes, spread over the batch lane. Where the minimum distance drops below the watch distance between two samples, the sweep bisects.
- The result says "sampled: N poses, largest step X mm or Y degrees". It is not continuous collision detection.
- `render view=motion` returns N frames.
- **GPU:** batched pose sweeps in WGSL are not S7a scope. They are a later candidate kernel that enters through an A3 and the CPU-twin merge rule ([COMPUTE.md](COMPUTE.md) sections 2 and 6), when the S6 indicator (swept-clash time per sampled pose) shows the batch lane is the bottleneck on real mechanism projects. Dynamics (MuJoCo, MuJoCo Warp, both Apache-2.0) stay on the pull board.

## 11. Large assemblies

| Technique | Step | Runs on |
|---|---|---|
| Tessellation once per definition key and tolerance in `.o3j-cache` | S1 | CPU workers |
| `InstancedMesh` per definition in the viewer | S2 | GPU; WebGL2, then CPU image view |
| Incremental fit cache; rigid sub-assemblies solve once | S1, S4 | CPU |
| `EXT_mesh_gpu_instancing` in glTF | S6 | file |
| GPU fit pre-check | S7a | GPU, CPU twin |
| `BatchedMesh`, LOD by screen size, graphics-only open from the mesh cache, lazy loading of B-rep for edited definitions only | Pull board | GPU display, CPU kernel |

The wasm32 kernel heap is capped at 4 GiB, so large assemblies stay mesh-first.

**Hypotheses to measure (S0 and S2 set the baselines):**

| # | Hypothesis | Measured in |
|---|---|---|
| H1 | Report time after a one-part edit grows with changed definitions, not occurrences: under 2 s on 4 cores for 1,000 occurrences of 50 definitions | S4 |
| H2 | The GPU pre-check beats the CPU broad phase by 3x only above about 1,000 occurrences | S7a, on the generated 1,000-occurrence assembly in `corpora/reference-assemblies` |
| H3 | 10,000 occurrences of 200 or fewer definitions orbit at 30 fps or better on a reference laptop with instancing and LOD | Pull board |
| H4 | A graphics-only open of 10,000 occurrences from the mesh cache takes under 5 s without starting the kernel | Pull board |
| H5 | Holding B-rep only for edited definitions keeps each worker under the 1.5 GiB recycle limit at 10,000 occurrences | Pull board |

The pull-board trigger is a real project over 1,000 occurrences, or a real project missing the S2 frame-time gate (PLAN.md S2 and section 7).

## 12. File formats

| Format | Assembly content | Step |
|---|---|---|
| STEP AP214 out | XCAF product structure: pure assembly root, shared definitions, colours. Names are set explicitly at both levels: `addChild` names only the instance, so the writer also calls `setName` on each referred definition label, including sub-assemblies and library parts. In the spike, definitions left unnamed came back as "ASSEMBLY" and "SOLID" | S1 |
| STEP in | Imported structure becomes `imported` definitions and occurrences. Known gap: the spike's STEP file held 5 colour records, but `getLabelInfo` reported no colour on any label after import (the colours are probably attached to shapes, not labels). Until a follow-up fixes the reader, imported definitions carry no colour, the report says so, and Open3DJ does not promise a colour round trip | S1 |
| STEP AP242 with PMI | Same structure plus semantic PMI, after an occt-wasm facade contribution | S12 |
| 3MF | Objects with components (3x4 transforms) and build items; `partnumber` from the definition's stored `partNumber` where set (S1), daemon-assigned numbers from S4; per-part print plates | S1, S5 |
| glTF 2.0 | A node per occurrence, one mesh per definition (own writer; occt-wasm wrote 6 meshes for 3 definitions). `EXT_mesh_gpu_instancing` must be listed in `extensionsRequired`, so it is opt-in | S1, S6 |
| STL | Per definition | S1 |
| URDF | Links are rigid groups joined by fastened mates; revolute and prismatic joints. URDF has no loops: a loop returns a structured error pointing to MJCF | S6 |
| MJCF | Loops via equality `connect` | S11 |

Round trips must keep definition sharing: four screws stay one definition after STEP export and re-import, as the spike showed.

## 13. Agent tool surface

Assemblies use the five tools in [ARCHITECTURE.md](ARCHITECTURE.md) section 9, the single canonical C1 list of every op, field, view, format and input, with the step each lands in. Assemblies add ops, fields and views, not tools. Everything works over plain `tools/list` and `tools/call` ([research/gap-6.md](research/gap-6.md)). `run` results add `moved[]`, mate status, fits and `next`; `inspect fields=[measure]` measures between connectors or occurrences; `render` and `export` take occurrence paths as `targets[]` and `scope`.

Ops apply atomically against `base_rev`. `replace_definition` keeps mates whose connector names exist on the new definition and reports the rest as broken with candidates. In S1 `inspect fields=[tree]` already gives occurrence counts per definition, which is a flat parts list without part numbers.

## 14. Human review UI

- **Tree** (S2): occurrence paths with status icons for reference state, mate status and fits; isolate, hide and section.
- **Fit list:** click a row to highlight the pair and fly to it; declared fits shown separately.
- **DOF:** free motions drawn as arrows on hover; conflicting mates in red with their residual.
- **Picking:** picking gives an element address for the agent (S2: a CPU ray cast; `C` copies it).
- **Shared selection and agent highlights** (S2): what the person selects is shared with agents (`inspect fields=[selection]`: occurrence, element address, a named reference and its fingerprint when one resolves to that face, observed numbers, revision); an agent points at parts and faces with `render view=highlight`, and the viewer tints and frames them with the agent's note until the person dismisses it ([ARCHITECTURE.md](ARCHITECTURE.md) sections 9 and 12).
- **Exploded slider** (S4, read-only); **step editor** (S5, the first page write with the approval panel, through `run` with `base_rev` and the page nonce); motion scrubber (S6).
- **BOM table** with part numbers (S4).
- **Approvals** (S5): design freeze shows the BOM, fit table, declared fits and waivers with their hashes. Approval is on the nonce page, never via MCP.

## 15. Testing

- **Assembly conformance corpus** (in `corpora/`):
  - the multi-part 3dj starters;
  - seeded fits: the 0.15 mm clearance pin, the oversize pin, the resting box, the 145-occurrence plate with two sunk screws;
  - `corpora/reference-assemblies` (S0): the 145-occurrence plate, the 10 enclosure briefs, a generated assembly of 1,000 or more occurrences and dense wall-thickness maps of about 1M rays or more on the enclosure parts, used for timing in S3 and S7a;
  - seeded mates: a conflicting fastened pair, a redundant pair, a missing X axis, a broken reference after an edit, and a four-bar from S6, when revolute joints exist (S6 to S10 report its closing joint as `loop_unsolved` with the free motion named; S11 reports mobility 1).
- **Rule:** every seeded fault must be named, and any false pass is a red andon.
- **Round trips:**
  - STEP out, in and out again: definition and occurrence counts, names at both levels (a definition named "ASSEMBLY" or "SOLID" fails the test), sharing, transforms within 1e-9 mm and per-part volumes within C2 tolerance; colours are checked in the exported file only, until the import gap in section 12 closes;
  - 3MF re-read through lib3mf;
  - glTF checked with the Khronos glTF Validator.
- **Property tests:** quaternion to Euler conversion over random rotations (closes the Y-axis question); closed-form poses against the LM solver once it exists.
- **Determinism:** the same project is expected to give the same report hash across runs on one platform. This is hypothesis H-det, not yet a requirement. On native OCCT, PR #1600's pointer-keyed maps let one input succeed in only 11 of 20 fresh processes ([research/gap-8.md](research/gap-8.md)). On occt-wasm, a single spike that has not been reproduced yet ([research/spikes/endurance.md](research/spikes/endurance.md)) found fresh processes and fresh kernel instances bit-identical, while reusing a warm instance broke bit-identity for offset and shell. S0 re-runs H-det on every tier-1 OS before the DSL facade exists, with 20 fresh processes and 20 warm reuses on the 3 starters that the S0 facade spike runs plus a shell and offset corpus written as raw occt-wasm scripts. If it fails, the fallbacks in order are: run record requests (goldens, evidence hashes, replay) on a fresh kernel instance (about 30 ms with a shared compiled Module); carry the PR #1600 or libcascade patch through an occt-wasm contribution; or compare measures by tolerance for the affected ops ([ARCHITECTURE.md](ARCHITECTURE.md) section 8). Until it passes, shell and offset results compare by tolerance.
- **CPU and GPU parity:** the nightly CPU-twin check of the fit pre-check (section 6.5).
- **Bench:** the 10 multi-part enclosure briefs of bench v0, then the mechanism briefs in S6.

## 16. Worked example: a handheld device enclosure

Illustrative calls and numbers at S4 capability. At S1 the same design works with script `matchTo` and transforms, without Replicate or a BOM.

**1. Write the parts.** The agent writes `parts/shells.o3j.js` (bottom and top shell from one shelled body split at a parting plane), `parts/pcb.o3j.js` (a 1.6 mm board placeholder with keep-out boxes for two tactile switches and an LED), `parts/button.o3j.js` and `parts/light_pipe.o3j.js`. Connectors: `rim` on both shells, `boss_1..4` (female, `insert_m3`, each boss cut with `lib.heatSetPocket("M3")`) on the top shell, `cbore_1..4` on the bottom shell, `pcb_seat`, `btn_1..2` and `lp_window` on the top shell, and `sw_1..2`, `led_1` on the PCB.

**2. Assemble.**

```json
{"tool": "run", "project": "handheld.o3j", "base_rev": "r_07", "ops": [
  {"op": "add_occurrence", "def": "bottom_shell", "fixed": true},
  {"op": "add_occurrence", "def": "top_shell", "mate": {"type": "fastened", "a": "bottom_shell#1.rim", "b": "top_shell#1.rim"}},
  {"op": "add_occurrence", "def": "pcb", "mate": {"type": "fastened", "a": "top_shell#1.pcb_seat", "b": "pcb#1.mount"}},
  {"op": "add_occurrence", "def": "button", "mate": {"type": "fastened", "a": "top_shell#1.btn_1", "b": "button#1.axis"}},
  {"op": "add_occurrence", "def": "button", "transform": {"t": [18, 0, 11], "q": [0, 0, 0, 1]}},
  {"op": "add_occurrence", "def": "light_pipe", "mate": {"type": "fastened", "a": "top_shell#1.lp_window", "b": "light_pipe#1.top"}},
  {"op": "pattern", "def": {"lib": "heat_set_insert", "params": {"thread": "M3"}}, "connector": "seat", "replicateOn": "top_shell#1.boss_*"},
  {"op": "pattern", "def": {"lib": "iso4762", "params": {"size": "M3", "length": 10}}, "connector": "head_seat", "replicateOn": "bottom_shell#1.cbore_*"}]}
```

**3. Read the report.** Fourteen occurrences of seven definitions give 91 pairs; the AABB filter keeps about 20 for exact checks on the pool.

```json
{"status": "ok", "rev": "r_08", "assembly": {"occurrences": 14, "definitions": 7},
 "dof": [{"occ": "button#2", "state": "placed", "free": 6, "note": "placed by transform, no mate"}],
 "fits": [
   {"a": "light_pipe#1", "b": "pcb#1", "kind": "clash", "volume_mm3": 0.9, "confidence": "measured"},
   {"a": "button#1", "b": "top_shell#1", "kind": "clearance", "gap_mm": 0.08, "min_mm": 0.2, "confidence": "measured"},
   {"a": "heat_set_insert#1", "b": "top_shell#1", "kind": "declared", "fit": "press", "within_range": true}],
 "compute": {"backend": "cpu.wasm", "device": "cpu x3", "placement_reason": "auto: exact fits are cpu only"},
 "next": ["run ops=[add_mate button#2]", "render view=highlight targets=[light_pipe#1,pcb#1]"]}
```

**4. Fix.** The agent mates `button#2` to `top_shell#1.btn_2`, sets `lp_length` from 9.0 to 8.6 mm and `btn_gap` from 0.1 to 0.25 mm. The new report shows no clashes, a 0.3 mm light-pipe-to-LED clearance (above the 0.2 mm minimum), screw engagement within the insert's stated minimum, and every occurrence fully constrained. `moved[]` lists `button#2`, which its new mate moved by 0.4 mm.

**5. BOM.** `inspect fields=[bom]`:

| Item | Part number | Description | Qty | Source |
|---|---|---|---|---|
| 1 | HH-0001 | Bottom shell | 1 | make |
| 2 | HH-0002 | Top shell | 1 | make |
| 3 | HH-0003 | PCB placeholder (client board) | 1 | buy |
| 4 | HH-0004 | Button cap | 2 | make |
| 5 | HH-0005 | Light pipe | 1 | make |
| 6 | HH-0006 | Heat-set insert M3 | 4 | lib |
| 7 | HH-0007 | ISO 4762 M3x10 | 4 | lib |

**6. Exploded view.** `run ops=[{op: "explode", mode: "auto"}]` proposes: screws out along their axes, bottom shell down, PCB up, buttons and light pipe up out of the top shell. `render view=exploded` returns a four-view PNG with trail lines.

**7. Export.** `export {format: "step", rev: "r_10", gates: "fdm.v1"}` returns `handheld.step` (one root, seven named definitions, fourteen named instances, part numbers as product names) and `handheld.evidence.json`. From S5, a human-only gate failure returns `approval_pending{url, id}`; at S4 it blocks the export with a structured error.

About eight calls, with no human needed until design freeze. Every fault the report named becomes a bench mutant.

## 17. Staged roadmap

Each step's one Kaizen metric and exit are in [PLAN.md](PLAN.md) section 6. The assembly indicator below is tracked on the Friday scorecard alongside it; it is not a gate.

| Step | Assembly capability | Secondary scorecard indicator (not a gate) |
|---|---|---|
| S0 | Graph schema in C4; bench briefs are assemblies; seeded fit corpus from the spikes; `corpora/reference-assemblies` | Enclosure briefs passing task-lint, of 10 |
| S1 | Definitions, configurations by params, occurrences, sub-assemblies, connectors, script `matchTo` as fastened mates with redundancy and conflict check, fingerprint references, tier 0 and 2 fits, per-definition and whole-assembly reports, multi-part STEP, 3MF, glTF, STL | STEP round trips that lose structure, and false fit passes (each is already a regression failure or a red andon) |
| S2 | Viewer tree, `InstancedMesh` per definition, fit and reference overlays, picking | Viewer-only assembly defects per week |
| S3 | Five-state references with history; tier 1 fits; `moved[]` ripple report | Silent mis-resolutions in the assembly edits of the sweep (any is a red andon) |
| S4 | Graph-owned fastened mates, declared fits, Replicate, named DOF, BOM and part numbers, named configurations, exploded steps, fastener and insert library | Agent calls to a fully constrained enclosure assembly |
| S5 | Enclosure templates as assemblies; per-part print plates; freeze shows the fit table | Printed fit failures the fit table did not flag |
| S6 | Tree joints with limits, motion samples, swept clash, glTF instancing, URDF, flexible sub-assemblies; `loop_unsolved` status and the four-bar regression test | Joint-limit and swept-clash failures the agent fixes within 2 further calls |
| S7a | GPU fit pre-check behind a CPU twin (pose sweeps are a later candidate, section 10) | Fit pre-check time `auto` against `cpu` on the generated 1,000-occurrence assembly in `corpora/reference-assemblies` |
| S8b | Massing rebuilt as an assembly ("assumed"), from a generated mesh or written directly in the DSL on the CPU | Share of concept parts that become separate occurrences |
| S9 | CMF per occurrence | Review rounds to CMF sign-off |
| S10 | Moulding gates per moulded definition | Seeded DFM defects fixed by the agent |
| S11 | LM solver with rank, loops, ball, pin slot, parallel, distance, angle; tolerance stacks along mate chains; MJCF | LM solver failures on real assemblies (the OndselSolver trigger) |
| S12 | Assembly drawings, AP242, RFQ BOM | Supplier questions about structure or BOM per RFQ |
| Pull | Large-assembly mode, in-context design pinned to revisions, OndselSolver, gear and screw relations, dynamics | Trigger in PLAN.md section 7 |

## 18. Open questions (to verify)

- The rotation order for the Y axis at the occt-wasm boundary.
- Colour round trip on STEP re-import.
- Whether OCCT writes the label name to both PRODUCT id and name in STEP.
- Real cost of the S1 exact tier on the 10 enclosure briefs with the pool.
- Every hypothesis in section 11.
