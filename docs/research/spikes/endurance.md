# Spike: Endurance, memory and determinism (2026-10-28)

One agent ran this spike, and a second, independent agent then reran and challenged it. Both sections are below. The machine was a shared 4-vCPU Linux x64 container with other agents running, so treat timings as noisy medians. The agents were not allowed to write report files, so this report was assembled from their structured results. Source code is in [endurance/src/](endurance/src/). Paths starting with `spikes/` or `scratchpad/` refer to the working folders where the spikes ran; outputs and installed packages are not in the repository.

**Question:** Can one occt-wasm 5.8.1 kernel instance (OCCT 8.0.1, Node v22.22.0) do thousands of parametric rebuilds with bounded memory? Which release strategy should Open3DJ use, what is the WASM heap ceiling and how does the kernel fail there, when should a worker be recycled, what are cold and warm start costs, how much memory does a 200-part fuseAll peak at, and what determinism promise can Open3DJ make?

## Original run

**Verdict:** works-with-caveats

### Results

- Setup: 4 vCPU Xeon at 2.1 GHz shared with other agents (load 2-8), so all timings are medians. The test part is a parametric enclosure, rebuilt with a new width each time: fillet the vertical and bottom edges at 3 mm, shell 2 mm with the top face removed, cut 4 holes with one cutAll, fuse a boss, fillet the boss top edge, then compute volume and tessellate. It has 42 faces and each rebuild creates 143 handles.
- 5,000 rebuilds in one kernel instance, by memory strategy. No release: median 65.5 ms, p95 125 ms; WASM heap grew 128 to 1,416 MiB and RSS to 1,552 MiB, with 715,000 live handles. This is linear growth of about 0.26 MiB per rebuild (0.125 MiB without tessellation). release() of every handle: median 64.9 ms, heap flat at 128 MiB, RSS 240 MiB. checkpoint()/releaseSince(): median 64.3 ms, heap flat at 128 MiB, RSS 247 MiB. Releasing costs no measurable time.
- No leak over 20,000 rebuilds with checkpoint/releaseSince. The heap stayed at 128 MiB, and the allocator high-water mark (highest non-zero word in linear memory) stayed at exactly 18.92 MiB from rebuild 1,000 to 20,000. RSS moved from 242.9 to 243.7 MiB, and the median rebuild was 64.9 ms. The replicad #282-style leak does not appear when handles are freed.
- The heap ceiling is getHeapMax() = 4,294,901,760 B (4,095.9 MiB); the heap starts at 128 MiB and grows in steps of about 96 MiB. The heap never shrinks: releaseAll() leaves it at its high-water size. Only dropping the instance gives memory back: worker.terminate() took 49 ms and brought RSS from 423 to 213 MiB.
- Two failure modes at the ceiling. (a) A clean OcctError 'cutAll: unreachable' (a wasm trap); afterwards the instance still made a box, but its C++ state should be treated as unsafe. (b) A silent livelock at 100% CPU: the no-release endurance run hung at rebuild about 15,000 for 18+ minutes, and a probe that tessellated each rebuild hung the same way. A 60 s watchdog's worker.terminate() killed the stuck wasm in 188 ms.
- Fresh processes are deterministic. Across 5 processes the whole corpus was bit-identical: volume and area bits, bounding box, face and edge counts, subShapeHashes, mesh positions, normals and indices, STL bytes, and normalised STEP. WebAssembly has no address-space randomisation, so this is expected.
- A fresh instance in the same process replays exactly. Three instances made from one compiled Module each built the offset part 3 times, and build n was bit-identical across all instances. Output depends only on the calls made since the instance was created.
- Reusing a warm instance gives identical results for booleans and fillets (the part, sequential fuse, fuseAll, reverse and shuffled orders): bits, mesh and STL matched over 20 repeats each in three heap-perturbation modes. subShapeHashes, however, differed on all 20 repeats, because they are pointer hashes.
- Reusing a warm instance breaks bit-identity for offset and shell (BRepOffset, the OCCT PR #1600 bug class). Volume bits had 7-17 distinct values, with relative spread up to 3.5e-15, and mesh, STL and STEP differed on every repeat. A canonical fingerprint made of sorted per-face area and centroid, rounded to 1e-6, was identical across all 70 builds for every case.
- Fuse order is a deterministic per-order effect. Fusing in reverse order gave 438 edges instead of 439, with relative volume difference 1.5e-7. fuseAll and sequential fusing in the same order differ by 2.4e-12. Every order reproduced exactly on every run.
- STEP bytes need three normalisations: the FILE_NAME timestamp, the PRODUCT('Open CASCADE STEP translator 8.0 N') counter and the NEXT_ASSEMBLY_USAGE_OCCURRENCE('N') id. Both counters are process-global. With them stripped, STEP was identical whenever the geometry was.
- Start-up costs (median of 7 fresh processes, load about 2). Cold: import 11 ms + init 100 ms, first rebuild 202 ms, 5th rebuild 68 ms. Compiling the module first: compile 47 ms + instantiate 7 ms (init 25 ms). Workers sharing one compiled Module: spawn to ready 79-83 ms, first rebuild 61-68 ms after the first worker. Workers compiling their own module: 140-156 ms and about 200 ms. A fresh instance per run with a shared Module: 29-34 ms, RSS stable over 40 instances.
- Warm-up and V8 flags. Rebuilds reach the steady state of about 45-48 ms after about 20 rebuilds, and the first 10 take about 1.0-1.2 s in total. --no-liftoff makes the first rebuild 3.9 s. --no-wasm-lazy-compilation makes init 441 ms. Liftoff-only has the same steady state, so default flags are best. Node 22 cannot cache compiled wasm on disk: v8.serialize(WebAssembly.Module) gave 2 bytes and deserialize failed with 'Unable to deserialize cloned data.'
- 200-part fuseAll, each case in its own process (VmHWM is peak RSS). 200 unit boxes: 1.45 s, heap 128 MiB (184 after tessellation), VmHWM 321 MiB. Plate plus 199 cylinders: 4.2 s, VmHWM 317 MiB. 200 overlapping enclosures: 201 s (under load), heap 2,963 MiB, VmHWM 4,182 MiB, valid with 17,198 faces. Tessellating that result took 11 s and pushed the heap to 4,093 MiB, 2.6 MiB below the 4 GiB ceiling.
- The kernel's print and printErr can be captured through an init({createModule}) wrapper. The 9 lines of STEP-writer statistics went to the captured buffer, and process.stdout received 0 bytes.
- Recommendations: wrap each run in checkpoint/releaseSince. Recycle the worker at a 1.5 GiB WASM heap (soft limit), abort at 3 GiB (hard limit), and recycle on any watchdog timeout or 'unreachable' error. Promise bit-identical results only on a fresh kernel instance, which costs about 30 ms.

### Failures and caveats

- REPORT.md was not written. The harness refused the write ('Subagents should return findings as text, not write report files'), so the report content is in this structured output, and report_path names the intended location, which does not exist.
- Shelling a box with all 12 edges filleted (top face removed) returned an INVALID solid with no error: 52 faces, 2 shells, isValid false, volume 23181.1 instead of an open box. Open3DJ must run isValid after shell and offset. The test part keeps its top rim sharp to avoid this.
- fuse() returns a compound, and fillet() on that compound throws 'OcctError: fillet: TopoDS::Solid'. The DSL must unwrap single-solid compounds.
- An all-edge 1 mm fillet of the holed bracket fails with 'fillet: operation failed [faulty edges: 1228,1236]'. It fails the same way in every process and every repeat.
- At the 4 GiB ceiling the kernel either throws 'cutAll: unreachable' or livelocks with no error. The no-release endurance run hung at rebuild about 15,000 for 18+ minutes and was killed. The probe that tessellated each rebuild hung until the 60 s watchdog fired.
- v8.serialize(WebAssembly.Module) produced 2 bytes and v8.deserialize threw 'Unable to deserialize cloned data.' Node 22 has no on-disk cache for compiled wasm.
- The first determinism pass normalised STEP only by stripping timestamps and showed false STEP differences. They came from two process-global counters (PRODUCT translator N and NAUO id). The pass was rerun with a fixed normaliser; the old results are kept in out/det-v1-oldnorm.
- Timings are noisy (load 2-8 from other agents). The 3 endurance strategies ran at the same time, and the 200-enclosure fuseAll (201 s) overlapped them, so its time is inflated but its memory figures are not. The first init benchmark at load about 6 (initbench-loaded.json) gave figures 1.5-2x higher than the quieter rerun (initbench.json).

### Recommendations for Step 1

- Put checkpoint()/releaseSince() around every DSL run in the runtime, so scripts never call release. Anything kept between runs (the current model, caches) is created before the mark. It costs the same as release(), and the heap stayed flat over 20k rebuilds.
- Run the kernel only in worker_threads, with print and printErr captured through init({createModule}), so no kernel output can reach the MCP stdio stream.
- Compile occt-wasm.wasm once in the daemon with WebAssembly.compile and post the Module to each worker. A worker is then ready in about 80 ms, and after the first worker the first rebuild is warm at about 65 ms. Prime each new worker with one canned build to absorb about 1 s of warm-up.
- Recycle a worker when its WASM heap (HEAP32.buffer.byteLength) reaches 1.5 GiB, after the current job finishes. Abort the job and report 'model too large' at 3 GiB. Recycle on any 'unreachable' OcctError. Keep a 10k-run safety cap; it costs nothing.
- Give every job a wall-clock watchdog (for example 60 s by default, set per tool) that calls worker.terminate(). At the 4 GiB ceiling OCCT can livelock without throwing, and terminate kills the stuck wasm in about 190 ms.
- Determinism promise: the same script, inputs and kernel version on a FRESH kernel instance give bit-identical geometry, mesh, STL and normalised STEP. This held across 5 processes and 3 instances. Warm-instance reuse guarantees only geometric equality within about 1e-14 relative; offset and shell can change topology bits and meshes. Use a fresh instance (about 30 ms with a shared Module) for golden tests, caches and evidence hashes.
- Do not use subShapeHashes as persistent face IDs; they are pointer hashes and change on every warm rebuild. Use a canonical geometric fingerprint (sorted per-face area and centroid, rounded) for identity and for diff summaries.
- Normalise STEP before hashing or diffing: strip the FILE_NAME timestamp, the PRODUCT('Open CASCADE STEP translator 8.0 N') counter and the NEXT_ASSEMBLY_USAGE_OCCURRENCE('N') ids.
- Run isValid after shell and offset, and unwrap single-solid compounds returned by fuse before calling fillet or chamfer.
- Canonicalise boolean order in the DSL (for example batch the operands into fuseAll or cutAll in source order). Different orders give slightly different topology, although each order is reproducible.
- Tell agents that large booleans across many copies of a detailed part (for example 200 copies of a 42-face part) can approach the 4 GiB ceiling and take minutes. Pre-flight check face count times part count, and prefer patterns, instances or compounds over fusing everything.
- Next steps to schedule: repeat the determinism suite on macOS arm64 and Windows x64 in CI to check bit-identity across machines, which this spike did not test, and consider memory64 when the toolchain and browsers support it.

### Commands used

```
S=spikes/endurance
mkdir -p $S/deps && cd $S/deps && echo '{"name":"endurance-deps","private":true}' > package.json && timeout 300 npm install --ignore-scripts --no-audit --no-fund occt-wasm@5.8.1
cd $S/src && ./run_all.sh $S   # full suite, about 1.5 h
cd $S/src && for st in none release checkpoint; do timeout 3000 node endurance.mjs $S/deps $st 5000 $S/out/endurance-$st.json 250 2> $S/out/endurance-$st.log & done; wait
cd $S/src && timeout 5400 node endurance.mjs $S/deps checkpoint 20000 $S/out/long-checkpoint.json 1000 2> $S/out/long-checkpoint.log
cd $S/src && timeout 1500 node ceiling_probe.mjs $S/deps 3900 60000 noeval > $S/out/ceiling_probe.json 2> $S/out/ceiling_probe.log
cd $S/src && timeout 1500 node ceiling_probe.mjs $S/deps 3950 60000 eval > $S/out/ceiling_probe_eval.json 2> $S/out/ceiling_probe_eval.log
cd $S/src && timeout 900 node --expose-gc recycle.mjs $S/deps 1500 > $S/out/recycle.json 2> $S/out/recycle.log
cd $S/src && ./run_det.sh $S && python3 -I compare_det.py $S/out/det
cd $S/src && timeout 600 node fresh_instance.mjs $S/deps
cd $S/src && timeout 300 node stepdiff.mjs $S/deps $S/out && timeout 300 node stepdiff2.mjs $S/deps
cd $S/src && timeout 1200 node initbench.mjs $S/deps $S/out/initbench.json 7
cd $S/src && for fl in '' --no-wasm-tier-up --no-liftoff --no-wasm-lazy-compilation; do for r in 1 2 3; do timeout 300 node $fl warmup_curve.mjs $S/deps; done; done
cd $S/src && timeout 600 node --expose-gc instance_churn.mjs $S/deps 40
cd $S/src && for c in boxes cyls parts; do timeout 900 node fuseall_peak.mjs $S/deps $c 200; done
```

## Independent reproduction

Not completed. The reproduction agent stopped when the session hit a usage limit. Treat these results as unconfirmed until rerun.
