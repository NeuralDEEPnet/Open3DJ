# Build log

A credited log of what was built and measured, newest first. The Friday review adds the week's entry with the founder's hours ([PLAN.md](../docs/PLAN.md) section 4.2). Measurements name the date, the machine, the commit or state, and the command, so anyone can repeat them.

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
- **Verdict:** H-det holds for measures in both modes and for STEP in fresh processes, and fails for STEP bytes on a warm worker. Proposed fallback, for the founder to confirm: the first fallback of ARCHITECTURE.md section 8, run record requests (goldens, evidence hashes, replay) on a fresh kernel instance; and renumber the usage ids in the exporter so plain exports are stable too. This is one machine; the other tier-1 OSes still need the same run in CI.

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
