# Build log

A credited log of what was built and measured, newest first. The Friday review adds the week's entry with the founder's hours ([PLAN.md](../docs/PLAN.md) section 4.2). Measurements name the date, the machine, the commit or state, and the command, so anyone can repeat them.

## 2026-10-31: Viewer and agents on one project, and the viewer frame-time benchmark

Built by neuraldeep.net design agents. Founder hours: to be filled in at the Friday review. Working tree of branch `ccr-1e979422-dguyci` on 2026-10-31 (uncommitted, on top of the three.js viewer rework).

What changed:

- **Selection sharing.** What the person selects in `open3dj view` (parts, faces as `<path>@elem:face:<n>`, edges by the faces they bound) goes to the view server through its one write route, `POST <nonce>/api/selection`, and is kept in `.o3j-view/selection.json`. Agents read it with `inspect fields=[selection]` (a new, additive field). The security model of that route is in ARCHITECTURE.md section 12.
- **Agent highlights.** `render view=highlight` with targets and an optional note writes `.o3j-view/highlight.json` without a kernel job. The view server polls it, checks it (schema, a time that is not in the future, and every target resolved again on its revision) and sends it on the event stream; the page fills the faces, tints parts named whole, shows hidden targets through the parts in front, and says "Pointed at in this project", with a dismiss button. It never moves the person's camera.
- **Both files are untrusted on read.** Any process of the same user, or a cloned project, can write them. The selection is rebuilt from its revision every time it is read, and `inspect` says it is what was clicked, not an approval.
- **The benchmark.** `npm run viewer:bench` (`scripts/viewer-bench.ts`).

### Viewer frame time

Command: `npm run viewer:bench -- --with-adaptive` (3 s orbits). Machine: a shared Linux container, Linux 6.18 x64, Intel Xeon at 2.80 GHz with 4 logical cores, 15.7 GB, Node 24.22.1, headless Chromium 153.0.8010.12 from Playwright, 1280 x 800. **There is no GPU.** WebGL2 runs on SwiftShader (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`), a software rasteriser on the CPU. Chromium offers a WebGPU adapter (`vendor=google architecture=swiftshader isFallbackAdapter=true`), but it fails at the first frame ("Instance dropped in popErrorScope") and the page falls back to WebGL2 by itself, so every row asked for WebGPU was drawn with WebGL2 too (those rows are in the script's output, not repeated here). Load average 2.0 at the start and 3.5 at the end of the run (another workflow shares the container).

**Every frame of the rows marked "full" is drawn at pixel ratio 1.** The page is opened with `adaptive=0`, so it never halves the resolution while the view moves, and the script fails a row whose probe or orbit saw another ratio or any low-resolution frame. An earlier version of this entry measured with adaptive resolution on (the page's default), so its frame times were drawn at pixel ratio 0.5 while the view moved; those numbers are replaced here. The rows marked "half while moving" are the same cases with adaptive resolution on, for comparison only; they never count for the gate. Each motion is warmed up first (a 0.8 s drag and a 0.8 s probe), because SwiftShader compiles a pipeline the first time it meets a new draw state, which showed as one frame of 500 to 1,000 ms in the p95 of the first run.

"Load first" is page navigation to the first drawn frame on the first open; for the first row of each case it includes the server making the GLB (and, for plate-145, the detailed report). "Reload" has the GLB cached. "Probe orbit" is `open3dj.probe(3000)` (one camera step per frame, no mouse); "mouse orbit" is a 3 s left drag. Draw calls and triangles are those of the last frame, with the cursor off the model.

| Case | Occurrences | Resolution while moving | Load first / reload (ms) | Probe orbit p50 / p95 (ms) | Mouse orbit p50 / p95 (ms) | Draw calls | Triangles | JS heap (MB) |
|---|---|---|---|---|---|---|---|---|
| enclosure | 6 | full (pixel ratio 1) | 1,815 / 281 | 49.9 / 50.1 | 66.6 / 66.8 | 6 | 5,724 | 14.8 |
| enclosure | 6 | half (adaptive) | 393 / 303 | 16.7 / 33.4 | 33.3 / 50 | 6 | 5,724 | 12.9 |
| plate-145 | 145 | full (pixel ratio 1) | 23,417 / 441 | 150.1 / 216.6 | 216.6 / 283.4 | 6 | 96,444 | 15.6 |
| plate-145 | 145 | half (adaptive) | 745 / 479 | 133.3 / 166.6 | 150 / 233.3 | 6 | 96,444 | 16 |
| grid-1025 | 1,025 | full (pixel ratio 1) | 3,152 / 370 | 150 / 183.3 | 166.6 / 200 | 6 | 72,716 | 20.2 |
| grid-1025 | 1,025 | half (adaptive) | 506 / 370 | 116.7 / 149.9 | 133.3 / 166.7 | 6 | 72,716 | 20.5 |

On a shared software rasteriser the frame times move with the machine's load: an earlier run the same afternoon, while another workflow's `npm run check` held the load average at about 9 on the 4 cores, gave plate-145 probe p95 967 ms. Draw calls, triangles and heap do not move. Read the frame times above as an upper bound for this container, not as a property of the viewer.

**The S2 gate is not judged here.** PLAN.md S2 asks for p95 under 33 ms with WebGPU and under 50 ms (proposed) with WebGL2 while orbiting plate-145 at full resolution, measured on the founder's GPU machine (an integrated GPU counts). This container's 217 ms p95 is software rendering and says nothing about a GPU. Target to check on real GPUs: `npm run viewer:bench -- --cases plate-145` on the founder's machine and on volunteer machines (Windows, macOS and Linux, integrated and discrete), recording the table and its machine block here; add `--dpr 2` on a high-density screen. The script needs Playwright with Chromium where Node can `require("playwright")`; it is not a dependency of the repository, and it skips without it. (One way is `npm install --no-save playwright` and `npx playwright install chromium`; not tried here, where Playwright was preinstalled.)

### Tests

- `packages/mcp/src/viewstate.test.ts` (9 tests, among them planted selection and highlight files), `packages/open3dj/src/view-share.test.ts` (5 tests, among them 25 refused write requests that leave the file unchanged and a planted selection read through `GET api/selection`), `packages/open3dj/src/view-agent.test.ts` (end to end with `open3dj mcp` in its own process and the viewer in Chromium; skips without Playwright), `packages/open3dj/src/format.test.ts` (the terminal layout of `inspect --fields selection`), and schema fixtures for the three new schemas.

## 2026-10-28: STEP determinism fallback

Built by neuraldeep.net design agents. Founder hours: to be filled in at the Friday review. Same machine as the Step 0 entry below, working tree of branch `ccr-1e979422-dguyci`.

The founder confirmed the fallback proposed in the H-det verdict below (ARCHITECTURE.md section 8, COMPUTE.md section 6). What changed:

- **STEP jobs run on a fresh kernel instance.** `Kernel.fresh()` (packages/kernel/src/occt.ts) makes a new instance from the thread's compiled WebAssembly module, with the same print sink, and `Kernel.dispose()` ends it. The job runner (packages/compute/src/job.ts) runs every job that exports STEP, and every job with `freshKernel: true`, on such an instance and disposes it afterwards; the worker's warm kernel is not touched. All kernels now instantiate one compiled module per thread instead of reading and compiling the binary each time.
- **Usage ids are renumbered.** The STEP exporter writes `NEXT_ASSEMBLY_USAGE_OCCURRENCE` ids as '1', '2', ... in file order (`renumberUsageIds`, packages/assembly/src/export/step.ts). The scan skips string literals; the round-trip check runs on the renumbered file.
- **Revision time as the STEP time stamp.** `ExportOptions.timestamp` and `ExportJob.timestamp` write an ISO 8601 time (UTC, to the second, the 19-character form OCCT writes) into FILE_NAME instead of the wall clock. The MCP `export` tool, and so `open3dj export`, pass the revision's `ts`. Exporting one revision again now gives the same STEP bytes, time stamp included. Direct library calls without the option keep the wall clock.
- **Regression tests, written first and seen failing:** packages/compute/src/step-determinism.test.ts (5 enclosure STEP exports on one warm runner, with a shell run and a bracket STL export between them, byte-identical once the time stamp is blanked, and equal to a fresh kernel's file; it failed at export 2 before the change, and still failed with renumbering alone, on a `STYLED_ITEM` line), and the usage-id test in packages/assembly/src/export/export.test.ts (failed with ids '1', '2', '4', '3', ... on the first export, so the writer's own order is not file order).

Cost, median of 10 (scratch script, same machine): `kernel.fresh()` plus `dispose()` on a warm thread 25.5 ms (a new instance read and compiled the binary in about 80 to 110 ms before). A STEP export job on a warm runner: bracket 150.5 ms on the warm kernel and 172.8 ms on a fresh one (+22.3 ms), enclosure 1051.4 ms and 1133.1 ms (+81.6 ms). The first STEP export job in a fresh process: bracket 695.0 ms and 691.5 ms (no difference within noise), enclosure 1920.0 ms and 2061.2 ms (+141.2 ms). Disposed instances are collected: 599 of 600 instances made and disposed in a loop were finalised, the JS heap stayed at 10 to 14 MB, and the process RSS rose from 164 MB to a plateau near 380 MB after about 400 instances.

**Correction (verification, 2026-10-28): fresh kernels leaked when a script drew a 2D sketch.** The loop above made bare instances and never touched brepjs. The independent verifier ran 200 enclosure STEP exports on one pool worker: RSS grew from 477 MB to 2010 MB (about 7.7 MB per job) and the worker's JS heap from 169 MB to 701 MB, against a flat 476 to 459 MB at HEAD. Five whys:

1. Why did memory grow? No fresh kernel used by bracket or enclosure was ever finalised, so each kept its Emscripten module and WebAssembly memory.
2. Why were they kept? brepjs held them: every brepjs shape handle keeps the adapter registered when it was made, and the adapter keeps the `OcctKernel`.
3. Why were the handles kept? brepjs 20.11.1 registers each handle in a module-level `FinalizationRegistry` with a held value that closes over the handle (`createHandle`), so no handle is ever collected. Only scripts that reach brepjs (`polygon`, `path` and the `lib` helpers that draw profiles) create them.
4. Why did the tests miss it? The determinism tests compared bytes only, and the collection check used bare instances. The pool's recycle check reads the JS heap, which does not include WebAssembly memory.
5. Why could a dead kernel stay reachable at all? The DSL registered the adapter itself with brepjs, with no way to take it back.

Fix: the DSL registers a revocable proxy of the adapter with brepjs, and `Dsl.dispose()` revokes it (packages/dsl/src/dsl.ts). The job runner disposes the fresh kernel's DSL before the kernel. Leaked brepjs handles now hold a revoked proxy, not the kernel. Regression test, seen failing first (4 of 4 fresh kernels reachable after GC): "fresh kernels are freed after STEP exports that draw 2D sketches" in packages/compute/src/step-determinism.test.ts. After the fix, the same soak (200 enclosure STEP exports on one pool worker, `maxJobsPerWorker` raised, scratch script): 0 failed, 1 distinct STEP sha256, liveShapes 0, file descriptors flat at 26, RSS 492 MB after job 1, then 392 to 432 MB from job 20 to job 200; worker JS heap 284 to 287 MB from job 60 to job 200. The brepjs handle objects themselves still leak (small, also at HEAD); reporting that upstream is for the maintainers.

H-det rerun: `node scripts/hdet.ts --cases enclosure,shell,offset` (20 fresh processes and 20 warm reuses per case; fresh series 127.7 s, warm series 51.2 s, one warm worker throughout):

| Case | Volume and area bits | Bounding boxes | Face and edge counts | STEP without timestamp and usage ids | STEP without timestamp |
|---|---|---|---|---|---|
| enclosure | identical | identical | identical | identical | identical |
| shell | identical | identical | identical | identical | identical |
| offset | identical | identical | identical | identical | identical |

H-det now holds for STEP bytes on this machine, in fresh processes and on a warm worker. bracket and tapered-cup were not rerun in this entry. The other tier-1 OSes still need the same run in CI.

## 2026-10-28: Step 0 tooling

Built by neuraldeep.net design agents. Founder hours: to be filled in at the Friday review.

All measurements below: a shared Linux container, Linux 6.18 x64, Intel Xeon at 2.80 GHz with 4 logical cores, 16 GB, Node 24.22.1, occt-wasm 5.8.1, brepjs 20.11.1, working tree of branch `ccr-1e979422-dguyci` on 2026-10-28 (uncommitted Step 0 tooling on top of the first vertical slice). The container is shared, so timings are indicative.

### H-det: determinism of kernel results

Command: `node scripts/hdet.ts` (20 fresh processes and 20 warm reuses per case; 240.6 s in all, 193.5 s of it the fresh series). Corpus: examples bracket, tapered-cup and enclosure, plus `corpora/hdet/shell.o3j.js` and `corpora/hdet/offset.o3j.js`. Each fresh run is a new Node process with a new pool worker and kernel. The warm series runs every case round-robin, 20 times, on one worker that was never recycled. Each run exports STEP and logs the IEEE 754 bits of every part's volume and area from the kernel.

| Case | Volume and area bits | Bounding boxes | Face and edge counts | STEP without timestamp and usage ids | STEP without timestamp |
|---|---|---|---|---|---|
| bracket | identical | identical | identical | identical | fresh 1, warm 20 distinct |
| tapered-cup | identical | identical | identical | identical | fresh 1, warm 20 distinct |
| enclosure | identical | identical | identical | fresh 1, warm 6 distinct | fresh 1, warm 20 distinct |
| shell | identical | identical | identical | fresh 1, warm 2 distinct | fresh 1, warm 20 distinct |
| offset | identical | identical | identical | fresh 1, warm 2 distinct (line wraps only; identical after the fix below) | fresh 1, warm 20 distinct |

"identical" means all 40 runs agree. "fresh 1, warm 20 distinct" means the 20 fresh processes agree with each other, and the 20 warm runs give 20 different values.

Result:

- **Measures are bit-identical everywhere.** Volume and area bits, boxes and counts agree across all 40 runs of every case, shell and offset included. The earlier spike's warm-reuse drift on shell and offset ([docs/research/spikes/endurance.md](../docs/research/spikes/endurance.md)) did not appear here. That spike drove raw occt-wasm; this run goes through the DSL facade, whose job runner releases every shape after each job.
- **STEP is byte-identical across fresh processes** once the FILE_NAME timestamp is stripped, for every case.
- **STEP differs on a warm worker, for two reasons.** First, every `NEXT_ASSEMBLY_USAGE_OCCURRENCE` gets its id from a counter that lives as long as the kernel instance, so a warm worker writes '1', then '2', and so on. Second, in multi-colour assemblies run interleaved with other jobs (enclosure and shell), the colour `STYLED_ITEM` and `COLOUR_RGB` entities come out in a different order. That is consistent with a map keyed by heap addresses, the same class of problem as the pointer-keyed maps in ARCHITECTURE.md section 8. The geometry entities are the same.
- **Correction (review round 2, 2026-10-28).** The offset row's warm variants were not the colour order. Blanking a usage id that grows from '9' to '10' moves the column where the OCCT writer wraps that `NEXT_ASSEMBLY_USAGE_OCCURRENCE` line, so the two warm files differed only in line breaks (3 lines, no `STYLED_ITEM` line among them). `normaliseStepIds` now removes whitespace outside strings as well (scripts/hdet-lib.ts, with a test in scripts/hdet.test.ts). Rerun of `node scripts/hdet.ts` (all five cases, 20 fresh and 20 warm, 355 s on the same container): measures, boxes and counts identical everywhere as before; STEP without timestamp and usage ids now identical for bracket, tapered-cup and offset, and still 1 fresh / 6 warm for enclosure and 1 fresh / 2 warm for shell. Cause per case: offset was the line wrap only; enclosure and shell are the real `STYLED_ITEM` and `COLOUR_RGB` order. The verdict below is unchanged.
- **Verdict:** H-det holds for measures in both modes and for STEP in fresh processes, and fails for STEP bytes on a warm worker. Proposed fallback, for the founder to confirm: the first fallback of ARCHITECTURE.md section 8, run record requests (goldens, evidence hashes, replay) on a fresh kernel instance; and renumber the usage ids in the exporter so plain exports are stable too. (Confirmed by the founder on 2026-10-28 and built; see the STEP determinism fallback entry above.) This is one machine; the other tier-1 OSes still need the same run in CI.

### o3dj-bench v0

- The C7 schema `packages/schemas/json/bench-task.schema.json`, 22 tasks in `bench/tasks` (12 regression, 10 capability), task-lint, the regression runner and the grader ([bench/README.md](../bench/README.md)).
- `node bench/lint.ts`: 22 of 22 tasks clean in 9.5 s. Every reference passes; every seeded mutant is caught, by a clash, a missing part, a size limit, a too-tight clearance or a changed measure.
- `node bench/run-regression.ts --repeat 3`: 12 of 12 (100%), 3 identical replays, 12.7 s.
- Found while writing tasks: three caps built separately but with identical geometry still become one definition, so `same_definition` cannot tell clones from identical copies. Not a defect; the button-panel mutant uses a different defect.
- Capability split: not run with an agent yet. The procedure is [bench/run-capability.md](../bench/run-capability.md).

### Reference assemblies

`node scripts/reference-assemblies.ts`; the full table is in [corpora/reference-assemblies/README.md](../corpora/reference-assemblies/README.md). The 145-occurrence plate (2 seeded clashes, 142 contacts) runs in 17.7 s on a fresh worker, 187 MB, detailed report 13.4 kB; that is 60% of the pool's 30 s job limit, worth watching on slower runners. The 1,025-occurrence grid runs in 2.6 s (5 definitions, no fits), 3.0 s with 51 definitions and 7.2 s with 1,024 contacts, all under 200 MB.

### Found: an offset ellipse does not survive STEP

`return ellipse(18, 10).offset(3).extrude(10);` runs and reports a valid solid of 8630.68 mm3, but `open3dj export --format step` fails with STEP_ROUNDTRIP_FAILED: the file re-imports as 0 solids. The export guard did its job, so nothing broken reached a user, and STL, glTF and 3MF are fine. Two follow-ups for a failure report: a regression test with this script, and a better hint, because the current one blames a revolved profile. The H-det offset case uses an octagon instead until this is fixed.

Fixed in the S1 polish increment (2026-10-28). Five whys: the file re-imported as 0 solids because its curves were `NUL REF`; they were null because the STEP writer has no entity for OCCT's offset curve; the offset curve was there because `offset()` of an ellipse returns one; nothing caught it earlier because the DSL checked validity and measures, not exportability, of a sketch op. Countermeasure: `offset()` now rebuilds offset-curve edges as B-splines interpolated through 128 points of the curve and refuses the result if the area moves by more than 1e-6 relative (packages/dsl/src/sketch.ts), with a regression test that exports and re-imports this exact script (packages/dsl/src/sketch-boolean.test.ts). The STEP_ROUNDTRIP_FAILED hint now names both known causes. The H-det offset case can go back to the ellipse.

Integration check (2026-10-28): the H-det offset case now has an ellipse ring (`ellipse(18, 10).offset(3)` minus `ellipse(18, 10).offset(-2)`) next to the octagon. It runs valid (4645.54 mm3) and its STEP export round-trips. `node scripts/hdet.ts --cases offset` (20 fresh and 20 warm runs, 68.9 s): volume and area bits, boxes and counts identical in all 40 runs; STEP as before, 1 variant across fresh processes and 2 on the warm worker with timestamp and usage ids stripped. (Corrected in review round 2: those 2 offset variants differed only in where a line wraps, not in the colour `STYLED_ITEM` order; see the correction above. With the wrap normalised, offset has 1 variant.)

### doctor --bench: what Step 0 still needs

`open3dj doctor --bench` today measures kernel load, one bench part (first and warm), peak worker memory and pool scaling over 1 to N workers (packages/compute/src/doctor.ts). PLAN.md S0 also asks for kernel micro-benchmarks per operation (boolean, fillet, shell, tessellation, STEP write, HLR render), a viewer frame-time probe and an optional WebGPU probe; those are not built yet.
