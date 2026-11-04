# Spike: 3dj-compatible DSL on brepjs and occt-wasm (2026-10-28)

One agent ran this spike, and a second, independent agent then reran and challenged it. Both sections are below. The machine was a shared 4-vCPU Linux x64 container with other agents running, so treat timings as noisy medians. The agents were not allowed to write report files, so this report was assembled from their structured results. Source code is in [dsl-brepjs/src/](dsl-brepjs/src/). Paths starting with `spikes/` or `scratchpad/` refer to the working folders where the spikes ran; outputs and installed packages are not in the repository.

**Question:** Can Open3DJ own the ~150-entry 3dj DSL as a thin facade on brepjs 20.11.1 + occt-wasm 5.8.1 (Node 22) and faithfully run the published 3dj starters (tapered-cup, bolt-flange, vented-enclosure, lathe-profile, twisted-vase, lego-brick)? What breaks, and how much work is the full surface?

**Note:** the 3dj starter scripts used as test inputs are not included. They belong to the closed 3dj.app product. Fetch them from 3dj's public `cad_get_starters` MCP tool to rerun the starter tests.

## Original run

**Verdict:** works-with-caveats

### Results

- REPORT.md was NOT written: the harness blocked report-file writes for subagents. The full report content is summarised in these fields.
- Versions: Node v22.22.0; brepjs 20.11.1 (Apache-2.0; declares engines node>=24, so npm warned EBADENGINE, but it worked on Node 22 for everything tested); occt-wasm 5.8.1 (OCCT 8.0.1; tooling MIT OR Apache-2.0, wasm LGPL-2.1); transitive deps flatbush 4.6.2, flatqueue 3.1.0, opentype.js 1.3.4, comlink 4.4.2. All installed with --ignore-scripts.
- Facade src/dsl.mjs is 389 lines of ESM. Conformance against hand-computed values: 47/47 pass, covering primitives, cone, 2D profiles, extrude with twist/scaleTop, revolve, loftTo, booleans, transforms, fillet/chamfer edge queries (atZ/atX/atY/parallel/perpendicular/minLength/maxLength), shell, patterns, cutPlane, withReferences/attachTo, connector matchTo and geometryInfo.
- All 6 required starters run, valid, 1 solid each, matching an independent kernel-free oracle (volumes in mm3): tapered-cup 54,558.992 (oracle 54,558.992), 6.8 ms warm median; bolt-flange 43,506.283 (= analytic rim+bore chamfer), 36.6 ms; vented-enclosure 21,138.826 (oracle 21,138.826), 86.9 ms; lathe-profile 27,179.016 (oracle 27,179.016), 86.7 ms; twisted-vase 32,288.437 (oracle 32,288.439), 319 ms; lego-brick 2,652.454 (oracle 2,652.454), 112 ms. Medians are of 18 warm runs over 3 fresh processes on a noisy shared 4-vCPU machine. Mesh volume vs B-rep volume within 3.1e-4.
- BBoxes (min..max): tapered-cup [-35,-35,0]..[35,35,80]; bolt-flange [-45,-45,0]..[45,45,8]; vented-enclosure [-35,-25,0]..[35,25,28]; lathe-profile [-34,-34,0]..[34,34,90]; twisted-vase [-28.08,-30,0]..[28.08,30,120]; lego-brick [-15.9,-7.9,0]..[15.9,7.9,11.4].
- Determinism: the B-rep text SHA-256 was byte-identical across 3 fresh processes for all 13 runnable starters, including shell and the swept twist. Sample size is small.
- All 18 published starters (fetched verbatim from the public 3dj cad_get_starters): 13/18 run without lib. The other 5 fail only at lib.* (heatSetPocket, screwCutter, fastener, profile2020BSlot6, remoteCradle). With a 35-line lib using guessed ISO dimensions, 16/18 run. Multi-part, connectors/matchTo and the faucet's withReferences/attachTo assertions all pass.
- Runtime: kernel+brepjs init 190 to 244 ms. RSS 363 to 445 MB after 18 starters x 7 reps. cutAll+fuseAll are about 75% of operation time.
- Memory: the brepjs occt-wasm handle delete() is a no-op. The arena grows 38 shapes per bolt-flange rebuild (7,600 after 200), and gc() does not reclaim them. Per-run kernel.checkpoint()/releaseSince() keeps the arena at 0 and builds stay correct over 1,000 rebuilds. RSS still creeps: 174 to 283 MB with checkpoint (about 0.11 MB/rebuild) vs 171 to 349 MB without (about 0.18 MB/rebuild).
- STEP export prints to stdout through brepjs exportSTEP: 11,628 bytes per process (34 'Statistics on Transfer' banners). STL, mesh and BREP export print 0 bytes.
- Coverage: about 87/146 cheat-sheet entries implemented (60%), or 95 (65%) with guessed lib, plus the undocumented .color/.name/cutPlane. Effort to cheat-sheet parity is about 6 to 9 engineer-weeks: easy about 30 entries (1 to 1.5 weeks); medium hole/onFace/cutout/text2d/wire-backed sketch (1.5 to 2 weeks); hard minWall, lib content, face/edge persistent refs (2 to 4 weeks); infrastructure for sandbox, types, memory, stdout and golden corpus (2 to 3 weeks).

### Failures and caveats

- The REPORT.md deliverable could not be written: the harness refused the Write ('Subagents should return findings as text'). I did not try to get around it, so the report content is in this output.
- brepjs bug: Drawing.offset(-2) on ngon(6,30) returned an asymmetric, malformed outline (9 vertices, 6 stray CIRCLE edges, corners about 1 mm out). The extruded solid failed B.isValid (false), with volume 1991.48 vs the exact 1992.125. Fixed in the facade by routing through OCCT B.offsetWire2D, which is exact (1992.125, valid). The consequence is that sketch ops after offset() are not available, because a brepjs Drawing cannot wrap a kernel wire.
- minLength edge-query ambiguity: bolt-flange's comment says 'Chamfer only the outer rim', but {atZ:8, minLength:45} with curve-length semantics also chamfers the bore's top circle (circumference 94.2 >= 45). That gives 43,506.283, which equals the analytic rim+bore value. Bbox-extent semantics chamfer the rim only, giving 43,554.454, which equals the analytic rim-only value. 3dj's real semantics are unpublished.
- STEP stdout pollution (OCCT transfer statistics) confirmed through brepjs exportSTEP. It would corrupt MCP stdio.
- brepjs convention traps the facade must normalise: revolve angle is in RADIANS while rotate is in degrees; box({at}) means centre; cylinder(r,h) takes the opposite argument order to 3dj's cylinder(h,r); shell rejects negative thickness ('INVALID_THICKNESS: Shell thickness must be positive').
- ellipse(6,3) extrude volume has relative error 2e-5 (113.0995 vs 113.0973) from curve approximation.
- toMultiviewPNG(shape.wrapped) threw 'OcctError: toMultiviewPNG: getBoundingBox: Invalid shape ID: 0'. Passing shape.wrapped.id works.
- planetary-reducer 'Planet Carrier Hub' is 2 solids. This is a fault in the starter itself: the output shaft r7 sits inside the r14 carrier bore and never touches the disc. The facade reproduces it faithfully.
- Not implemented: text2d, path() and its 7 methods, union2d/difference2d/intersection2d, loft([...]), onFace, sketch.onFace, cutout, hole, face(), group, connectorDistance, tolerance, chamferBottomEdges, minWall, Point2D/Rectangle2D/spline2d/Shape.fromSlices, and lib snapFit/screwBoss/mountingTab/cableAnchor/remoteCradle/profile2020*/tSlotProfile. extrusion-foot and remote-anchor-mount still fail on these.
- The script runner uses new Function with full Node access, so there is no sandbox. Acceptable for this spike only.

### Recommendations for Step 1

- Own the 3dj DSL facade on a KernelAdapter-style seam and use brepjs only as the kernel layer. Pin brepjs and occt-wasm to exact versions, and treat brepjs's 2D engine as untrusted until it is tested.
- Route 2D offset, and any 2D operation that matters for correctness, through OCCT wires (offsetWire2D). Back the sketch with a kernel wire so sketch ops still work after offset.
- Every facade entry gets a conformance test with an analytic oracle plus an isValid check. Every starter gets a golden record (volume, bbox, solids, B-rep hash) and a kernel-free oracle where one is practical. Volume-only checks miss invalid geometry.
- Run each script in a worker (or child process) with stdout captured, call kernel.checkpoint() before the build and releaseSince() after it, recycle the worker at an RSS cap, and run the script in a sandbox (QuickJS or equivalent), not new Function.
- Batch booleans: make variadic add/subtract map to fuseAll/cutAll, then add automatic batching of sequential x = x.subtract(t) chains, since cutAll+fuseAll are about 75% of runtime.
- Publish a semantics spec that 3dj leaves open: edge-query tolerance (1e-3 used here), whether minLength means curve length or extent, rotate pivot forms, shell defaults (openTop=true), how patterns return disjoint multi-solids, and failure behaviour. Define parity as 'runs, valid, matches our oracle', not bit-equality with 3dj (which runs OCJS 7.7.2).
- Make the first release ship the 13 lib-free starters. Treat lib.* (fastener tables, 2020 profile, cradle/tab/anchor, snapFit, screwBoss) as a separate content workstream with its own dimension sources and tests. Defer minWall as an analysis feature.
- Resolve Node 22 vs brepjs engines>=24: either target Node 24 or add CI on Node 22 that runs the full conformance and starter suite.
- Use kernel.toMultiviewPNG(handle.id) as the agent-facing render. It visually confirmed all 6 required starters.

### Commands used

```
S=spikes/dsl-brepjs
mkdir -p $S/deps $S/out && cd $S/deps && echo '{"name":"deps","private":true}' > package.json && timeout 300 npm install --ignore-scripts brepjs@20.11.1 occt-wasm@5.8.1
cd $S/src && timeout 300 node conformance.mjs $S/deps $S/out
cd $S/src && for i in 1 2 3; do timeout 600 node run_starters.mjs $S/deps $S/out $S/src/starters 7 > $S/out/stdout-run$i.txt 2> $S/out/run7-$i.log; wc -c < $S/out/stdout-run$i.txt; done
cd $S/src && timeout 60 node aggregate.mjs $S/out $(ls -t $S/out/starters-[0-9]*.json | head -3)
cd $S/src && WITH_LIB=1 timeout 600 node run_starters.mjs $S/deps $S/out $S/src/starters 3 project-box,table-corner-bracket,studio-bolt-hinge,extrusion-foot,remote-anchor-mount > /dev/null
cd $S/src && timeout 120 node analytic.mjs
cd $S/src && timeout 300 node probe_starters.mjs $S/deps $S/src/starters
cd $S/src && timeout 120 node probe_offset.mjs $S/deps && timeout 120 node probe_offset2.mjs $S/deps
cd $S/src && timeout 900 node --expose-gc memory.mjs $S/deps $S/src/starters bolt-flange 1000 checkpoint && timeout 900 node --expose-gc memory.mjs $S/deps $S/src/starters bolt-flange 1000 none
cd $S/src && NO_STEP=1 WITH_LIB=1 timeout 600 node run_starters_nostep.mjs $S/deps $S/out $S/src/starters 1 > $S/out/stdout-nostep.txt 2>/dev/null; wc -c < $S/out/stdout-nostep.txt
cd $S/src && timeout 300 node render.mjs $S/deps $S/out $S/src/starters tapered-cup,bolt-flange,vented-enclosure,lathe-profile,twisted-vase,lego-brick
```

## Independent reproduction

**Verdict:** works-with-caveats

### Results

- NOTE: REPORT.md was not written or appended to. The harness blocks report .md files, which is also why the original was never written. The '## Independent reproduction' section is this structured output; report_path is the intended location only.
- Install reproduced. npm install --ignore-scripts brepjs@20.11.1 occt-wasm@5.8.1 pulls 8 packages (32 MB). A fresh --save-exact install into a separate directory is byte-identical (sha256 of every file). NEW: brepjs@20.11.1 declares engines node>=24, so npm prints EBADENGINE on Node v22.22.0 / npm 10.9.4. Everything below still ran on Node 22, but that combination is unsupported upstream. The original deps/package.json also uses caret ranges (^20.11.1).
- Conformance reproduced: 47/47 PASS with values identical to the original. Caveat: the suite is self-graded against the author's own reading of the DSL, and several checks are bounds only (fillet atZ checks 'volume < 12000'; chamfer checks 'volume < 12000').
- Starters at default parameters reproduced exactly. Without lib.*, 13/18 run and the 5 lib starters fail with DslNotImplemented. With WITH_LIB=1, 16/18 run (project-box, table-corner-bracket and studio-bolt-hinge now pass); extrusion-foot (lib.profile2020BSlot6) and remote-anchor-mount (lib.remoteCradle) still fail. All per-part volumes and STEP byte sizes match the original. All 34 per-part BREP sha256 values (non-lib run) match the original session's hashes across sessions.
- The independent analytic volumes reproduced exactly: vented-enclosure 21138.826, lathe-profile 27179.016, twisted-vase 32288.439 vs kernel 32288.437, lego-brick 2652.454, tapered-cup 54558.992, bolt-flange rim+bore chamfer 43506.283.
- Timing reproduced within noise. Warm medians over 18 runs (3 processes x 6 warm reps), mine vs original, in ms: tapered-cup 5.3/6.8, studio-contour-bowl 10.5/9.6, multi-part 19.4/18.2, curtain-lift-hook 50.0/59.7, bolt-flange 52.2/36.6, vented-enclosure 82.1/86.9, lathe-profile 86.2/86.7, faucet 88.5/100, lego-brick 109.4/112.3, planetary 117.7/117.5, mini-robot 123.5/125.3, robotic-gripper 152.7/173.3, twisted-vase 304/319. Kernel init 212-215 ms (original 190-244). RSS after a full run 407-432 MB (original 363-445).
- STEP stdout reproduced. 11,628 bytes of OCCT 'Statistics on Transfer (Write)' banners reach stdout in each of 3 runs, byte-identical to the original; that is about 342 bytes per exportSTEP call. The NO_STEP run gives 0 bytes. NEW: three mitigations each verified at 0 stdout bytes while still exporting STEP. (a) OcctKernel.init({createModule: opts => factory({...opts, print, printErr})}), the cleanest; 333 chars swallowed for one export. (b) Patching process.stdout.write around exports. (c) Running the kernel in worker_threads with stdout:true, which captured all 3,078 bytes.
- NEW, STEP round-trip: export then importSTEP for 9 parts from 4 starters gives worst relative volume error 2.15e-13, and every re-imported part is valid.
- Determinism confirmed beyond the original's 'same order, fresh process' test. BREP hashes for 42/42 parts are identical under reversed starter order, every starter built twice in one process (84/84), after 200 unrelated lego-brick builds, under checkpoint/releaseSince, and inside a worker thread.
- CORRECTION on content hashing: toBREP embeds mesh triangulations once a shape has been meshed. The same solid gives 3,525 bytes before meshing and 53,262 bytes (30 triangulations) after, and its hash also changes between a fine and a coarse remesh. The original's hashes were taken after meshVolume(), so 'BREP identical' holds only when the pipeline is identical. A cache key must be computed before meshing or with triangulations stripped.
- Parameter sweep (NEW, a different input set): every number parameter at its min and max one at a time, every bool and choice value, plus 6 seeded random vectors per starter. 280/284 cases build with all parts valid (16 starters). The failures: vented-enclosure 3/18 (SHELL_FAILED), and bolt-flange 1/20 (CHAMFER_FAILED, faulty edges) at outer 57.8 / bore 39.05 / PCD 42.85 / bolt r 2.96 / chamfer 2.62, which fails under both minLength modes.
- CORRECTION, shell robustness: B.shell (OCCT MakeThickSolid) fails whenever wall >= corner radius on a roundedRect prism. On a 9x4 grid of corner 0-6 by wall 1.2-4, 16/36 combinations fail. Corner=0, which is inside the official parameter range, fails at every wall thickness. Changing the raw kernel tolerance (1e-6 or 1e-3) or the joinType (Arc or Intersection) does not help. Building the inner cavity as roundedRect.offset(-wall).extrude, then subtracting, succeeds and stays valid for all three failing cases tried.
- CORRECTION, memory: checkpoint/releaseSince does bound the WASM heap. Linear memory was measured directly (the original reported wasm_heap_mb: null) and stays flat at 134 MB over 3,000 bolt-flange builds. Without checkpoint it grows to 193 MB, with shapeCount at 114,000. But RSS still grows about 0.09 MB per build even with checkpoint (171 to 435 MB over 3,000 builds) because the V8 heap grows: heapUsed went 18 to 218 MB with gc every 50 builds. Isolated growth per build: about 69 KB for the facade, 22 KB with the chamfer step off, 12-16 KB for an edge scan, 4.5 KB for a raw brepjs cut, about 1.8 KB for a single box, and 0 for the raw occt-wasm kernel.
- Root cause of the JS leak: brepjs's FinalizationRegistry never reclaims handles. getDisposalStats() shows gcCollected=0 and liveHandles=38,090 after 1,000 builds with forced GC. A plain loop of 2,000 B.box() calls still has 2,000 live handles and kernel shapeCount 2,000 after 5 GC cycles. Kernel ids are not reused after releaseSince (1 then 2), and a shape kept across 1,000 churned builds still measures correctly (2652.454 before and after). The original memory.mjs result that checkpoint mode was slower (59 s vs 22 s for 1,000 builds, re-measured here) is an artefact of calling gc() every iteration; with gc every 50 builds, both modes take about 22 ms per build.
- Held-out DSL test (NEW, a different input set): 45 cases I wrote from the public 3dj dslReference (fetched live via cad_get_starters), using entries the 18 starters do not exercise, each with an expected value. Results: 26 PASS, 1 silently WRONG, 1 THROW (TypeError), 17 NOT_IMPL. The WRONG case: sketch.mirror([1,0]) treats the vector as the mirror line rather than the normal, so a rect at x=+5 stays at +5 instead of going to -5. The THROW: Rectangle2D.fromDimensions raises a TypeError instead of DslNotImplemented. NOT_IMPL: path, text2d, loft(array), union2d, hole, onFace, cutout, group, tolerance, chamferBottomEdges, minWall, spline2d, Shape.fromSlices, any sketch op after offset(), and lib.screwBoss/snapFit/mountingTab. Starter coverage (16/18) therefore overstates DSL coverage (about 58% of the held-out cases correct).
- Fidelity context: per cad_get_starters, the live 3dj kernel is 'OpenCascade.js / Replicad B-Rep'. The local src/starters match the 18 public starter ids, and the text matched on the four checked (bolt-flange, twisted-vase, vented-enclosure, studio-contour-bowl). No 3dj geometry ground truth was available without an account, so the conformance results are agreement with the author's interpretation, not with 3dj.app outputs.
- Edge-query semantics remain ambiguous. bolt-flange says it chamfers 'only the outer rim', but with curve-length minLength the bore edge (94.2 mm, longer than minLength 45) is chamfered too (43506.283; rim only would be 43554.454). Extent mode gives rim only at defaults but not once the bore diameter exceeds outerR.
- geometryInfo surfaced design bugs in the 3dj starters themselves, not in the facade. The planetary 'Planet Carrier Hub' is 2 disjoint solids in every one of the 18 sweep cases: the r=7 output shaft floats inside the r=sunR+2 carrier bore. lathe-profile splits into 2 solids at Height 40 or Belly 60. multi-part's plate breaks into 4 pieces when the post radius approaches half the plate width.
- Renders reproduced byte-identical: all 6 PNGs match the originals and twisted-vase.png was inspected visually and looks correct.

### Failures and caveats

- REPORT.md could not be written or appended: report .md files are blocked for subagents, the same reason the original was never written. The reproduction section is returned here instead.
- vented-enclosure shell(t) throws 'SHELL_FAILED Shell operation failed: shellWithHistory: operation failed' (wall 3.473 vs corner 1.261, and corner 0.01 with wall 2.4) or a failure with an empty message (wall 4 vs corner 4) whenever wall >= corner radius. On the raw kernel the same inputs give 'shell: shellWithJoin: BRep_Tool:: no par...' and fail at every tolerance and joinType tried.
- bolt-flange at {Outer radius 57.792, Bore radius 39.054, Thickness 10.948, Bolt holes 13, Bolt radius 2.964, Pitch circle 42.853, Edge chamfer 2.62}: 'chamfer failed: CHAMFER_FAILED Chamfer operation failed: chamferWithHistory: operation failed [faulty edges: ...]' under both minLength modes. The ligament between the bore and the bolt holes is only about 0.84 mm.
- sketch.mirror([nx,ny]) returns silently wrong geometry: the vector is used as the line direction, not the normal (rect at x=+5 mirrored by [1,0] gives a centre at x=5.000; expected -5).
- Rectangle2D.fromDimensions raises 'TypeError: Rectangle2D.fromDimensions is not a function' instead of DslNotImplemented.
- 17 of 45 held-out reference entries raise DslNotImplemented (path, text2d, loft, union2d, hole, onFace, cutout, group, tolerance, chamferBottomEdges, minWall, spline2d, Shape.fromSlices, sketch.translate after offset(), lib.screwBoss, lib.snapFit, lib.mountingTab).
- The extrusion-foot and remote-anchor-mount starters still fail with DslNotImplemented: lib.profile2020BSlot6 and lib.remoteCradle.
- The V8 heap grows about 67 KB per facade build even with checkpoint/releaseSince, because brepjs 20.11.1 FinalizationRegistry handles are never collected (gcCollected=0). RSS goes from 171 to 435 MB over 3,000 builds.
- npm warns 'EBADENGINE Unsupported engine { package: brepjs@20.11.1, required: { node: >=24 }, current: { node: v22.22.0 } }'. No Node 24 binary is available in this container to test with.
- Comparing my un-meshed BREP hashes with the original's hashes gave 0/42 identical. This is caused by the original hashing after meshing (embedded triangulation), not by non-determinism; my own baselines agree 42/42 under every condition.

### Recommendations for Step 1

- Keep the decision to own the 3dj DSL facade, but gate it in CI on more than the 47 self-graded checks. Add the 45-case held-out suite derived from the public dslReference and the 284-case parameter sweep, and treat 'silently wrong' (for example sketch.mirror) as a release blocker, worse than NotImplemented.
- Fix sketch.mirror to use the normal, matching 3D mirror and the reference wording. Make every missing entry (including Rectangle2D and point) throw a typed DslNotImplemented. Keep 2D ops usable after offset(), for example by keeping offset results as Drawings or wrapping the wire.
- Implement shell() with a fallback chain: for prismatic or extruded bodies, use a profile offset (inner = profile.offset(-t).extrude); fall back to MakeThickSolid otherwise. When both fail, return an actionable DslError such as 'wall >= corner radius'. The official vented-enclosure parameter range (corner 0) currently fails.
- Memory policy for a long-lived MCP server: wrap each request in kernel.checkpoint()/releaseSince(), which keeps the WASM heap flat. Also recycle the kernel worker or process after N builds or a heap threshold, because brepjs wrappers are never finalized (about 67 KB of JS heap per build). Alternatively, call the raw occt-wasm kernel in hot paths such as edge queries and bounds, which showed 0 growth. Report the FinalizationRegistry issue upstream to brepjs.
- Keep stdout clean by design: initialise OcctKernel with createModule wrapping print/printErr to a stderr logger, and also run the geometry kernel in a worker_thread with stdout:true as defence in depth. Add a CI test asserting 0 stdout bytes across every export path (STEP, STL, BREP, PNG).
- Content-addressed caching: hash the script, parameters and the pinned kernel and facade versions, or hash BREP before any meshing or with triangulations stripped. Never hash post-mesh toBREP output.
- Runtime: either target Node 24 LTS (brepjs engines >=24) or knowingly pin Node 22 with a CI matrix. Use --save-exact plus a committed lockfile, not caret ranges.
- Decide and document edge-query semantics (minLength as curve length vs extent). The bolt-flange intent ('outer rim only') is not met by curve length; consider a radius- or position-based query and record any divergence from 3dj.
- Surface geometryInfo (solid count, validity) in agent-facing results, and warn when a named part has more than one solid. It caught real design bugs in 3dj's own starters (planetary carrier hub, lathe-profile and multi-part at extreme parameters).
- Prioritise the next facade entries by agent value: hole/onFace/cutout, path(), loft(array), group(), tolerance/chamferBottomEdges/minWall, and real lib.* tables in place of the ISO guesses.

### Commands used

```
S=spikes/dsl-brepjs
mkdir -p $S/deps $S/out && cd $S/deps && echo '{"name":"deps","private":true}' > package.json && timeout 300 npm install --ignore-scripts brepjs@20.11.1 occt-wasm@5.8.1
mkdir -p $S/repro/deps-fresh && cd $S/repro/deps-fresh && echo '{"name":"deps","private":true}' > package.json && timeout 300 npm install --ignore-scripts --save-exact brepjs@20.11.1 occt-wasm@5.8.1
cd $S/src && timeout 300 node conformance.mjs $S/deps $S/out
cd $S/src && for i in 1 2 3; do timeout 600 node run_starters.mjs $S/deps $S/out $S/src/starters 7 > $S/out/stdout-run$i.txt 2> $S/out/run7-$i.log; wc -c < $S/out/stdout-run$i.txt; done
cd $S/src && timeout 60 node aggregate.mjs $S/out $(ls -t $S/out/starters-[0-9]*.json | head -3)
cd $S/src && WITH_LIB=1 timeout 600 node run_starters.mjs $S/deps $S/out $S/src/starters 3 project-box,table-corner-bracket,studio-bolt-hinge,extrusion-foot,remote-anchor-mount > /dev/null
cd $S/src && timeout 120 node analytic.mjs && timeout 300 node probe_starters.mjs $S/deps $S/src/starters && timeout 120 node probe_offset.mjs $S/deps && timeout 120 node probe_offset2.mjs $S/deps
cd $S/src && timeout 900 node --expose-gc memory.mjs $S/deps $S/src/starters bolt-flange 1000 checkpoint && timeout 900 node --expose-gc memory.mjs $S/deps $S/src/starters bolt-flange 1000 none
cd $S/src && NO_STEP=1 WITH_LIB=1 timeout 600 node run_starters_nostep.mjs $S/deps $S/out $S/src/starters 1 > $S/out/stdout-nostep.txt 2>/dev/null; wc -c < $S/out/stdout-nostep.txt
cd $S/src && timeout 300 node render.mjs $S/deps $S/out $S/src/starters tapered-cup,bolt-flange,vented-enclosure,lathe-profile,twisted-vase,lego-brick
cd $S/repro/src && timeout 900 node param_sweep.mjs $S/deps $S/src $S/src/starters $S/repro/out/param_sweep.json 6 > $S/repro/out/param_sweep.stdout 2> $S/repro/out/param_sweep.log
cd $S/repro/src && timeout 600 node edge_cases.mjs $S/deps $S/src $S/src/starters && timeout 300 node shell_join.mjs $S/deps $S/src
cd $S/repro/src && timeout 300 node heldout.mjs $S/deps $S/src $S/repro/out/heldout.json
cd $S/repro/src && for m in plain patchWrite modulePrint worker; do timeout 300 node step_stdout.mjs $S/deps $S/src $S/src/starters $m > $S/repro/out/step-$m.stdout 2> $S/repro/out/step-$m.err; wc -c < $S/repro/out/step-$m.stdout; tail -1 $S/repro/out/step-$m.err; done
cd $S/repro/src && for m in checkpoint none; do timeout 900 node --expose-gc memory2.mjs $S/deps $S/src $S/src/starters bolt-flange 3000 $m; done
cd $S/repro/src && for v in facade facadeNoChamfer edgeScan edgeScanNoBounds boundsOnly brepjs brepjsBox kernel; do timeout 600 node --expose-gc jsleak.mjs $S/deps $S/src $S/src/starters $v 1000; done
cd $S/repro/src && timeout 600 node --expose-gc handles.mjs $S/deps $S/src $S/src/starters 1000 && timeout 300 node --expose-gc gccheck.mjs $S/deps
cd $S/repro/src && SAVE_HASHES=$S/repro/out/hashes-forward-A.json timeout 600 node det_order.mjs $S/deps $S/src $S/src/starters $S/out/starters-latest-lib.json forward; for v in forward reverse twice warm checkpoint worker; do timeout 600 node det_order.mjs $S/deps $S/src $S/src/starters $S/repro/out/hashes-forward-A.json $v; done
cd $S/repro/src && timeout 120 node brep_mesh.mjs $S/deps $S/src
```
