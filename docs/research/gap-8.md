# Gap 8: Platform and performance numbers

Checked 2026-10-27. **[P]** primary, **[S]** self-reported, **[M]** measured here (one machine), **[I]** inference.

## (a) Which OS to prioritise

| Source | Windows | macOS | Linux | Notes |
|---|---|---|---|---|
| Stack Overflow 2025, professional use (n=31,569, multi-select) [P] | 49.5% | 32.9% | Ubuntu 27.7%, other non-WSL 16.7%, Debian 10.4% | WSL 16.8%. Personal use: Windows 56.7%, macOS 32.7% |
| Stack Overflow 2026 (30,903 responses) [P] | — | — | — | **The 2026 survey dropped the OS question.** Coding agents used (n=12,255): Claude Code 65.5%, Copilot 58.7%, Codex 29.5%, Cursor 25.5% |
| JetBrains data playground, 2025 (20.8M pro devs, multi-select) [P] | ≈58% | ≈58% | ≈47% | macOS ties Windows. 2026 report not yet published; its Aug 2026 post gives Claude Code 39% work adoption, no OS split |
| Pragmatic Engineer poll, Sep 2026 (≈10k votes, X / LinkedIn) [S] | 12.8% / 12% | 61.6% / 66% | 24.2% / 20% | Self-selected startup/Big Tech audience |
| StatCounter desktop, Sep 2026 [P] | 76.4% | 16.8% | 4.5% | General population. ChromeOS 2.3% |

**No published survey gives the OS split of CAD users.** The best proxy is platform support. SOLIDWORKS 2026 is Windows-only (macOS gets eDrawings; Parallels "TBA"), as are Creo, NX, Solid Edge and Inventor. Fusion runs on Windows and macOS. Onshape runs in the browser.

**Conclusions [I]:**
- **Agent and CLI users.** Early adopters of AI coding agents are mostly on macOS and Linux, including CI runners, devcontainers and cloud sandboxes. Among all professionals, Windows is still about half. Priority order:
  1. **macOS arm64 and Linux x64 (glibc and containers).**
  2. **Windows x64 native**, which must still ship at MVP.
  3. **Linux arm64, headless CLI only, pulled forward from v0.6 to the Agent Preview.** Docker on Apple Silicon defaults to arm64, and OCP 8.0.1 ships aarch64 wheels (gap-3).
- **Professional CAD UI users.** **Windows x64 first:** recruit most usability testers on Windows laptops and run the Iris Xe frame-time gate there. macOS second; Linux UI best-effort.

## (b) Native versus WASM: what is actually published

**taucad libcascade, OCCT 8 [S].** This is the only native-versus-WASM study. It ran on one Apple M2 Pro with Node 24, taking the median of 7 runs after 2 warm-ups. Native LTO medians and the WASM/native ratio:

| Op | Native | WASM/native |
|---|---|---|
| Small fuse | 3.18 ms | 3.16× |
| Fillet, all edges | 3.27 ms | 1.77× |
| Boolean cut grid | 27.6 ms | 1.30× |
| 40-box multi-tool fuse | 66.6 ms | 0.99× |
| Mesh | 79.6 ms | 1.10× |
| Surface filling | 317 ms | 1.40× |
| Primitives | — | ~9× (call overhead dominates) |

- WASM init is 488 ms (single-threaded) or 676 ms (multi-threaded). **No peak-memory data.** The multi-threaded numbers are a May 2026 snapshot that cannot currently be re-run.
- PLAN's "3.16× slower" quotes the worst real op. The honest summary is **"≈1.1-2× on typical ops, parity on multi-tool fuse, one machine, self-reported"**.

**Other kernels and OCCT itself:**
- **occt-wasm 5.8.1** publishes only its size (~4.5 MB brotli) plus a local harness. **It publishes no timings.**
- **replicad and opencascade.js** publish no benchmarks.
- **OCCT 8.0.0** notes are qualitative only (lock-free allocator, lower `BOPAlgo_PaveFiller` memory). **OCCT 8.0.1** claims "roughly 17-20%" faster Booleans in native and WASM [S, no workload stated].

**Memory: field reports only, no official benchmark.**
- **replicad #282 (open):** about 200 KB of WASM heap leaks per fuse even after `delete()`; 10,000 fuses grow it from 100 MB to 2 GB, then hit the 4 GB wasm32 limit.
- **kernelCAD PR:** no-op embind destructors; a job that aborted at 2.5-3.4 GB finished at 899 MB RSS once fixed.
- **Tau PR #839 (17 Oct 2026):** per-kernel heaps of 716-877 MB after edits, session peaks of 2.0-3.8 GB. It recycles at **512 MiB on phones and 1.5 GiB elsewhere**, matching PLAN's `worker_cap`.
- **Safari memory64 is still behind a flag**, so WebKit stays capped at 4 GB.

**Determinism risk for G13 [P].** OCCT PR #1600 (open, unreviewed) shows `BRepOffset_MakeOffset` iterating maps keyed by the TShape *pointer*, so the order "differs between processes and, as the heap evolves, between two builds in one process". On native OCCT 8.0.1 one input succeeded in only 11 of 20 fresh processes. taucad patched the same bug class in libcascade 3.1.0, where 6 shell runs had given 4 different hashes. Warm-worker reuse and address randomisation can therefore both break bit-identical replay.

**My measurement [M].** Native OCCT 8.0.1 through OCP 8.0.1.1.0 and CPython 3.13, on a 4-vCPU Xeon at 2.1 GHz with 15 GB RAM, Linux x64. Median of 7 runs after 2 warm-ups:

| Op | Median |
|---|---|
| Box+cylinder fuse | 3.0 ms |
| Fillet, 12 box edges | 6.9 ms |
| Fuse of 40 boxes | 110 ms |
| Plate minus 100 holes | 145 ms |
| Same plate + mesh + STEP AP242 write | 311 ms |

- Cold import took 0.83 s. RSS was **286 MB after import**, peaking at **333 MB**, with no growth over 1,000 fuses. OCP's monolithic bindings inflate this; a Rust shim worker is unmeasured.
- A failed all-edge fillet on a holed bracket **segfaulted the whole process** when `Shape()` was called without `IsDone()`. That supports per-op process isolation.
- The matched occt-wasm run was blocked in this sandbox and belongs in the week-0 spike.

## Recommendation: targets as week-0 hypotheses

Kernel time for starter-scale parts is milliseconds to hundreds of milliseconds, so **G9 (< 1 s) is plausible but untested**. The risks are evidence capture, cold start and Windows process creation. No source publishes AppContainer spawn cost; bwrap starts in 3-9 ms with small mount tables. Restate the goals as hypotheses:
1. **H-run.** Warm `run` p50 < 1 s, p95 < 2 s on the 18 starters, split by stage (script, kernel, tessellation, report, snapshot). Machines: a Windows Iris Xe laptop (16 GB), an M-series Mac, a GitHub Linux x64 runner, and an **8 GB floor box**.
2. **H-sandbox.** Overhead is the sandboxed warm run minus the same run unsandboxed in-process on the same machine. Budget p50 ≤ 50 ms and p95 ≤ 100 ms. Report cold worker spawn separately per OS, with a hypothesis of ≤ 1.5 s (0.83 s measured above; WASM init 488 ms).
3. **H-mem.** Native worker idle RSS ≤ 150 MB, starter p95 peak ≤ 600 MB, recycle at 1 GB, hard cap 1.5 GB. Daemon, UI and 2 workers fit on the 8 GB floor. A 10,000-op soak shows no leak.
4. **H-ratio.** WASM/native ≤ 2× p50 on the starters, measured on the same machine, before the WASM backend is used for share links or reference mode.
5. **H-det.** Hash equality across 20 fresh processes and 20 warm reuses for the starters plus a shell/offset corpus. Run it on each of the three OSes. If it fails, carry the PR #1600 or libcascade patch, or narrow G13.

Publish raw JSON; each number is a go/no-go input, not a promise.

## Sources
- https://survey.stackoverflow.co/2025/technology (Operating system section)
- https://survey.stackoverflow.co/2026.md ; https://survey.stackoverflow.co/2026/technology/data.md ; https://survey.stackoverflow.co/2026/ai/data.md
- https://visualstudiomagazine.com/articles/2026/10/06/stack-overflow-2026-survey-vs-code-leads-visual-studio-takes-third.aspx
- https://www.jetbrains.com/lp/devecosystem-data-playground/ ; https://blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026/ ; https://blog.jetbrains.com/research/2026/05/developer-ecosystem-survey-2026-take-part-in-one-of-the-largest-developer-studies/
- https://newsletter.pragmaticengineer.com/p/windows-and-ai ; https://www.windowslatest.com/2026/09/22/microsoft-keeps-rebuilding-windows-for-developers-but-a-new-poll-puts-windows-at-just-12/ ; https://borncity.com/news/entwickler-umfrage-macos-dominiert-mit-616-unter-tech-profis/
- https://gs.statcounter.com/os-market-share/desktop/worldwide ; https://store.steampowered.com/hwsurvey
- https://www.solidworks.com/support/system-requirements ; https://en.wikipedia.org/wiki/List_of_mechanical_engineering_software ; https://en.wikipedia.org/wiki/Autodesk_Fusion
- https://github.com/taucad/opencascade.js/blob/main/BENCHMARKS.md
- https://github.com/andymai/occt-wasm (README, test/benchmark.ts)
- https://github.com/Open-Cascade-SAS/OCCT/discussions/1275 ; https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8.0.1
- https://github.com/Open-Cascade-SAS/OCCT/pull/1600 ; https://github.com/taucad/opencascade.js/issues/35 ; https://github.com/taucad/opencascade.js/pull/48 ; https://github.com/taucad/tau/issues/243
- https://github.com/sgenoud/replicad/issues/282 ; https://github.com/w1ne/kernelCAD-web/pull/1008 ; https://github.com/taucad/tau/pull/839
- https://raw.githubusercontent.com/WebAssembly/website/main/features.json
- https://github.com/schlessera/brain-kit/issues/2375 ; https://jvns.ca/blog/2022/06/28/some-notes-on-bubblewrap/ ; https://docs.wasmtime.dev/examples-fast-instantiation.html
- Measurement scripts: /tmp/claude-0/-home-user-Open3DJ/45a63da6-7d73-5326-9c09-0591c87c12c4/scratchpad/bench8/scripts/bench_native.py (output native.json)
