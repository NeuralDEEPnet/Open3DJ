# Spike: MCP server with the kernel in a worker (2026-10-28)

One agent ran this spike, and a second, independent agent then reran and challenged it. Both sections are below. The machine was a shared 4-vCPU Linux x64 container with other agents running, so treat timings as noisy medians. The agents were not allowed to write report files, so this report was assembled from their structured results. Source code is in [mcp-worker/src/](mcp-worker/src/). Paths starting with `spikes/` or `scratchpad/` refer to the working folders where the spikes ran; outputs and installed packages are not in the repository.

**Question:** Can Open3DJ serve run/render/export over stdio MCP with @modelcontextprotocol/sdk 1.32.2 while the OCCT kernel (occt-wasm 5.8.1) runs off the main thread? Does OCCT's stdout printing leak into the MCP stream under worker_threads or a child process, and what is the cleanest fix? What are the latency and startup costs? Which protocol versions does SDK 1.32.2 negotiate?

## Original run

**Verdict:** works

### Results

- Leak proof (raw stdout capture, 12 configurations): only exportStep prints, 9 lines (342 B) per call, through Emscripten out()=console.log. Leaks 18 foreign lines / 684 B per test (2 exports) in: in-process with no fix, worker_threads with default settings (worker stdout is forwarded to the parent's process.stdout), worker_threads with only a main-thread console guard, and a child process with stdio:inherit. Zero foreign bytes with: the print hook, Worker({stdout:true,stderr:true}) drained to stderr, a child with stdio:pipe and IPC, or all three combined.
- Cleanest fix: occt-wasm InitOptions has no print option, but createModule lets you wrap the shipped factory: OcctKernel.init({createModule:o=>factory({...o, print:sink, printErr:sink})}). The glue honours Module.print/printErr for fd 1 and fd 2. It captured 100% of the output, in every backend.
- Stress test: 41 pipelined requests with a paused reader, 15 runs. No message was corrupted mid-line; leaked text always landed between messages. In the worker case it arrives asynchronously, sometimes after the response it belongs to.
- SDK v1 client under a leak: 108 transport onerror events in a naive run ('Unexpected token '*', "**********"... is not valid JSON', 'Unexpected end of JSON input'), yet 100/100 calls succeeded because StdioClientTransport skips bad lines.
- SDK Client over StdioClientTransport, medians over 7/7/5 server starts, 100 calls each. Thread: connect 195 ms, first run 667 ms, run p50/p95 78.9/111.6 ms, mixed 66.7/147.3 ms, render 119/200 ms, export 11.8/75 ms. Child: connect 190 ms, first run 577 ms, run 78.0/97.8 ms, mixed 61.4/125.0 ms. In-process: connect 234 ms, run 78.2/102.1 ms. 1,900/1,900 responses valid (CallToolResultSchema plus client-side outputSchema validation), 0 transport errors.
- Boundary overhead (150 warm runs per backend): worker IPC p50 0.38 ms (thread) and 0.48 ms (child); MCP stdio plus SDK about 0.9 ms p50; a render with its base64 PNG about 2 ms.
- Startup: SDK import 126-136 ms; OcctKernel.init 117-136 ms; kernel ready 160 ms (child) / 193 ms (thread) after server start, overlapped with the MCP handshake. In-process kernel boot delays the initialize reply by about 40 ms. The first run costs about 0.6 s from cold code paths.
- Memory: thread backend 325 MB RSS in one process; child 82 MB main plus about 299 MB kernel; liveShapes stayed at exactly 16 (the LRU size) on all 19 starts, so intermediate handles do not leak.
- Timeouts at 2 s: worker.terminate() and SIGKILL stopped both while(true){} and 400 sequential booleans inside wasm at about 2.0 s, and the next call succeeded after 189-202 ms (respawn plus init). In-process, the server stayed wedged: -32001 Request timed out, and the next call failed too.
- SDK 1.32.2 protocol: LATEST_PROTOCOL_VERSION='2025-11-25'; SUPPORTED=[2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]; DEFAULT_NEGOTIATED='2025-03-26'. The client always sends LATEST (no option). The server echoes any supported version: a 2025-06-18 request gets 2025-06-18 and a 2025-11-25 request gets 2025-11-25; 2026-07-28 and unknown versions get 2025-11-25. All were accepted and tools worked.
- SDK 1.32.2 has no 2026-07-28 support: server/discover returns -32601 Method not found; the only 'discover' code is OAuth; input_required exists only as the 2025-11-25 experimental task status. The server is lenient: tools/list and tools/call work without initialize, and a second initialize renegotiates.
- structuredContent/outputSchema are fully supported in 1.32.2: McpServer.validateToolOutput throws InvalidParams on missing or mismatched structuredContent, and Client.callTool validates with cached AJV validators, but only after listTools().
- The v2 SDK line (@modelcontextprotocol/server and @modelcontextprotocol/client 2.4.0, 2026-10-23) is dual-era. The same kernel worker behind serveStdio(factory,{legacy:'serve'}) answered the v1 client and the v2 legacy client with 2025-11-25, and the v2 'auto' and 'pin 2026-07-28' clients with 2026-07-28; 20/20 runs and a render image on every successful connection. A v2 'auto' client falls back to initialize against the v1 server (+97 ms connect); pin mode fails there. v2 is 14 packages vs 97 for v1.
- render returns MCP image content (PNG, about 22 KB for the bracket) plus an embedded resource (image/svg+xml, open3dj://models/<id>/multiview.svg); the rendered 4-view drawing was visually checked and is correct.
- The export path policy blocked ../, absolute paths, non-.step extensions, symlinked-directory escapes, and symlinked-file writes (O_NOFOLLOW gives ELOOP); nothing was written outside the export dir.

### Failures and caveats

- False-negative first leak run: every export failed with 'ERROR: fillet: TopoDS::Solid' because cutAll returns a compound and BRepFilletAPI needs a solid, so nothing was printed. Fixed with asSolid() (unwraps a single solid); the harness now asserts runOk and exportOk.
- A main-thread console guard does NOT stop leaks from worker_threads: worker stdout is forwarded straight to the parent's process.stdout (18 lines / 684 B leaked with guard only).
- In-process kernel cannot be pre-empted: a runaway script or a long wasm op wedges the whole MCP server (-32001 Request timed out on that call and the next).
- occt-wasm's own OcctWorker.spawn() uses the browser global `new Worker(url,{type:'module'})` plus Comlink, so it is not usable in Node 22 as shipped. Found by reading the code, not executed.
- The print hook depends on Emscripten internals (Module.print through createModule), which occt-wasm does not document as an option; an upstream glue change could break it silently.
- Error text leaks absolute server paths, e.g. "ERROR: ELOOP: too many symbolic links encountered, open '/tmp/.../exports/file-link.step'"; a dangling symlink without overwrite gives a misleading 'file exists'.
- SDK 1.32.2 cannot serve 2026-07-28 (no server/discover, no MRTR); a v2 client pinned to 2026-07-28 fails against it: 'SdkError: Version negotiation failed: the server did not offer pinned protocol version 2026-07-28 via server/discover (no fallback in pin mode)'.
- v2 server with legacy:'reject' refuses v1 clients: 'MCP error -32022: Unsupported protocol version: 2025-11-25'.
- Splicing of leaked text into the middle of a JSON-RPC message was not observed (0/15 stress runs) but is not ruled out for child stdio:inherit, since messages exceed PIPE_BUF (4 KB) and two processes write to one pipe.
- node:vm was used for the JS facade and is not a security boundary; real sandboxing was out of scope.
- REPORT.md could not be written: the harness blocks subagents from writing report files, so the full report is in the final message text instead.

### Recommendations for Step 1

- Put the kernel behind a KernelHost interface and run it off the main thread; default to child_process (IPC channel, stdio piped) for the agent-facing MCP server: same latency as threads (<1 ms boundary), separate heap and crash/OOM isolation, SIGKILL always works, 82 MB main process, and it hosts the future OS sandbox. Keep worker_threads for pools and the browser.
- Keep stdout clean in three layers: (1) inject Module.print/printErr via createModule and route the text to logs or kernel_stats; (2) isolate worker stdio (Worker({stdout:true,stderr:true}) or child stdio:'pipe'); (3) redirect console.log/info/debug to stderr in the main process before any import.
- Make leak-test.mjs a CI gate: any non-JSON-RPC byte on MCP stdout fails the build (covers future occt-wasm glue changes).
- Enforce per-call kernel timeouts with kill and respawn (measured: about 2.0 s to stop, 0.19-0.20 s to recover); budget respawn cost into the run SLO.
- Pre-warm each kernel at spawn with one fillet and one boolean to hide the about 0.4 s cold-path penalty on the first agent call (hypothesis, not yet measured).
- Evaluate @modelcontextprotocol/server 2.4.0 with serveStdio(factory,{legacy:'serve'}), pinned to an exact version, as the Step 1 MCP base: SDK 1.32.2 is initialize-only (max 2025-11-25), and gap-6 requires a dual-era server; v2 passed every cell of the era matrix here. The tool API changes to z.object(...) schemas.
- Always return structuredContent plus a JSON text mirror, and declare outputSchema; do not depend on v1's leniency (calls accepted before initialize).
- DSL layer: normalise boolean results (compound with one solid becomes a solid) before fillet and chamfer, and release every intermediate handle per call (this kept liveShapes flat over 1,900 calls).
- Keep file writes in the host process, not the kernel worker: validate relative paths, resolve symlinks against the export root, open with O_NOFOLLOW and O_EXCL, and map OS errors to messages without absolute paths.
- Working budgets on Linux x64 (one machine): warm run of a small part about 80 ms p50 / 100-110 ms p95, render about 115 ms p50, STEP export about 11 ms p50, cold start to first result about 0.6 s. These fit gap-8 H-run/H-sandbox with wide margin; still to be checked on Windows and macOS.

### Commands used

```
S=spikes/mcp-worker
mkdir -p $S/deps $S/deps-v2 $S/out
cd $S/deps && echo '{"private":true}' > package.json && npm install --ignore-scripts --no-audit --no-fund occt-wasm@5.8.1 @modelcontextprotocol/sdk@1.32.2 zod
cd $S/deps-v2 && echo '{"private":true}' > package.json && npm install --ignore-scripts --no-audit --no-fund @modelcontextprotocol/server@2.4.0 @modelcontextprotocol/client@2.4.0
bash $S/src/run-all.sh $S
cd $S/src && timeout 600 node leak-test.mjs $S/deps $S/out
cd $S/src && timeout 500 node bench-client.mjs $S/deps $S/out thread 7 1 1 1
cd $S/src && timeout 500 node bench-client.mjs $S/deps $S/out child 7 1 1 1
cd $S/src && timeout 300 node proto-test.mjs $S/deps $S/out
cd $S/src && timeout 500 node v2-test.mjs $S/deps $S/deps-v2 $S/out
cd $S/src && timeout 400 node kill-test.mjs $S/deps $S/out
node $S/src/server.mjs --deps $S/deps --backend child --export-dir $S/out/exports
```

## Independent reproduction

**Verdict:** works-with-caveats

### Results

- NOTE: The original REPORT.md was never written, so I could not read the author's prose. I inferred the claims from the code and from the author's raw outputs, which I backed up to .../mcp-worker/out-original-author/ before rerunning. The harness also blocks me from writing report files, so the '## Independent reproduction' section is given here in key_results and not appended to a file.
- SETUP: Node v22.22.0, npm 10.9.4, 4 vCPU. Other agents were running at the same time, with load average 4.4 to 9.0. A fresh install into a new directory (repro/deps-fresh) resolved the same versions: occt-wasm 5.8.1, @modelcontextprotocol/sdk 1.32.2, zod 4.6.7, and @modelcontextprotocol/server/client 2.4.0. The occt-wasm.wasm file is byte-identical (sha256 933295205746...). zod is unpinned in the reproduce command; it happened to resolve to the same version.
- REPRODUCED: all reproduce commands ran with exit code 0. run-all.sh took 8m45s, then the standalone commands ran a second time.
- REPRODUCED EXACTLY (stdout leak matrix, 2 passes x 12 configs): the naive inproc, thread and child setups each leak 18 foreign lines (684 bytes) of 'Statistics on Transfer (Write)' into MCP stdout. 'thread guard-only' also leaks 18 lines, because overriding console in the main thread does not cover the worker. print-hook, thread isolate and child pipe each bring the leak to 0. hook+isolate+guard leaks 0 on every backend.
- REPRODUCED (splice test): 15 runs x 41 requests gave 41/41 responses each time. Unprotected configs produced 100 foreign lines but 0 messages corrupted mid-line. My harsher variant (child inherit, 120 requests, reader paused and resumed every 5 ms or 20 ms, responses up to 34 KB) also gave 121/121 responses, 300 foreign lines and 0 corrupted messages. Leaked text lands between messages, not inside them. That is observed, not guaranteed.
- REPRODUCED (SDK client tolerance): thread with h0/i0/g0 completed 100/100 calls but raised 108 transportErrors, the same count the author got.
- REPRODUCED, slower under load. Bench medians over 7 reps (run p50 / run p95 / render p50 / export p50, in ms): thread 110/268/159/16 in pass 1 and 99/203/145/14 in pass 2, against the author's 79/112/119/12. child 116/248/151/14 in pass 1 and 85/140/123/13 in pass 2, against the author's 78/98/112/11. Every rep parsed 700/700 responses with 0 failures. All 84/84 STEP exports were written. Main RSS was about 293 MB for thread and about 70 MB for child (the child kernel itself uses about 276-295 MB).
- BOUNDARY OVERHEAD, checked a different way. I ran the same plate model interleaved A/B: a direct in-process kernel-core call against an MCP callTool, 6 runs x 60 calls. The non-kernel part of each MCP call (worker IPC + stdio + zod) was 2.2-2.8 ms p50 and 4.8-8.2 ms p95 on an 80 ms kernel call. That is under 4% of the call. The author's overhead.mjs gave about 1.3 ms p50 (0.4 IPC + 0.9 stdio), but it used a trivial box; my rerun of overhead.mjs gave ipc 0.27-0.46 and stdio 0.8-1.1 ms. Conclusion: the overhead claim holds, corrected to about 2.5 ms for a realistic call.
- REPRODUCED (kill test): thread and child time out at about 2004-2011 ms and the next call succeeds after 190-340 ms with restarts=1. inproc cannot be stopped: the client times out at 8 s and the following call also times out.
- STRENGTHENED (kill test, single long wasm call): the author's 'wasm_long_op' case is 400 short calls, so JS gets control back between calls. I tested ONE call that stays inside wasm: fuseAll of 50 overlapping spheres, which takes about 18.5 s on its own, and tessellating a torus at deflection 0.001, about 25 s. worker.terminate() exits in 3.6-10 ms and SIGKILL in 7-17 ms. CPU use in the 1 s after exit was 0 ms, so nothing kept running. Through the real server both cases time out at about 2005 ms and the next call succeeds in about 190-230 ms.
- MEMORY ACROSS RESTARTS: over 18 thread-backend restarts, main RSS rose from 160 to 331 MB and then levelled off (a direct terminate loop also levelled off at about 231 MB). Over 18 child-backend restarts, main RSS stayed flat at 67-69 MB.
- REPRODUCED (protocol): SDK 1.32.2 answers 2025-06-18, 2025-11-25, 2025-03-26 and 2024-11-05 as requested. A 2026-07-28 or unknown request gets 2025-11-25 back. server/discover returns -32601. The v1 server accepts tools/list and tools/call WITHOUT initialize, and accepts a second initialize. The v2 era matrix is identical to the author's: the dual-era v2 server serves v1 clients, v2 legacy clients and v2 auto (2026-07-28). legacy:reject refuses 2025-era clients with -32022. A v2 client pinned to 2026-07-28 fails against the v1 server.
- REPRODUCED EXACTLY (export path policy): all 12 cases give the same accept/reject results as the author's. Nothing was written outside the export directory, and the dangling file symlink is refused with ELOOP.
- REPRODUCED: the manual command (server.mjs --backend child) driven with scripted JSON-RPC wrote 5/5 valid JSON-RPC lines and 0 foreign lines, and exported a 29,199-byte STEP AP214 file.
- NEW FINDING, high severity: a model script can escape node:vm in one line. Param.number.constructor('return process')() returns the real process object (pid, getBuiltinModule), even with codeGeneration.strings=false. In the recommended hook+isolate+guard configuration, an escaped fs.writeSync(1, ...) injected a FORGED JSON-RPC response (id 99) into the MCP stdout of inproc and of thread, with 1 foreign line each. Only the child backend kept it off the wire: fd 1 is the pipe, so it went to stderr. So 'thread + isolate' only catches JS-level stdout writes. The child process is the only backend that contains writes at the file-descriptor level.
- NEW FINDING: when the shared kernel is killed on a timeout, every in-flight call is failed with it. A quick call queued 100 ms behind a runaway script waited about 1.9 s and then got 'ERROR: kernel restarted: timeout', on both thread and child. All cached modelIds are lost as well.
- NEW FINDING: the run tool's documented 'deflection' input allows any value above 0 up to 10. deflection 0.001 on torus(20,5) takes about 25 s and returns 221,662 triangles, which a caller can use to tie up the kernel. The kill timer limits the damage, but the input should be clamped relative to the bounding box.
- NEW FINDING (determinism): STEP exports of the same model are byte-identical except for the FILE_NAME timestamp line. The export tool's sha256 field therefore changes on every run and cannot serve as a content or reproducibility hash unless the header is normalised.
- RENDER CHECK: the render-bracket.png 4-view drawing (60x40x40 bracket, 3 holes, filleted top) is correct and readable.

### Failures and caveats

- The original REPORT.md does not exist: the harness blocked the author from writing it. Claims had to be inferred from the code and raw outputs. My own '## Independent reproduction' section also could not be appended, because the subagent rules forbid report files. Its content is in key_results.
- The last reproduce command (node server.mjs --backend child ...) has no timeout and waits on stdin forever. I ran it under 'timeout 30' with scripted JSON-RPC input.
- Timings could not be compared cleanly with the author's: load average was 4.4-9.0 from other agents. My bench p50s were 1.1x-1.4x the author's and p95s up to 2.4x. Relative conclusions (thread is about the same as child, overhead is small) held. Absolute numbers did not reproduce within noise.
- vm escape in the recommended configuration: escape-leak-test.mjs put a forged JSON-RPC message (id 99) on MCP stdout for the inproc and thread backends ('LEAK-B via fs.writeSync(1)'). This contradicts any claim that thread+isolate fully protects the stream.
- Collateral failure: a queued call returned 'ERROR: kernel restarted: timeout' after a different call timed out (thread and child).
- Thread backend main RSS grew from 160 to 331 MB across 18 kill/restart cycles. It levelled off, so it is not an unbounded leak, but the child stayed flat at about 68 MB.
- The splice test is evidence, not proof: 0 corruptions in 15 + 2 runs (857 requests). With stdio inherit, POSIX pipe writes larger than PIPE_BUF are not atomic in principle, so interleaving inside a message cannot be ruled out. Isolation stays mandatory.

### Recommendations for Step 1

- Use the child_process backend (spawn with stdio ['ignore','pipe','pipe','ipc'] and serialization 'advanced') as the only production backend. It was the only one that kept fd-level stdout writes from escaped scripts off the MCP wire. Main RSS stays about 70 MB and flat across restarts, and SIGKILL stops a single long wasm call in under 20 ms. Keep worker_threads only for tests or for the browser.
- Keep all three layers anyway: the Module.print/printErr hook through createModule, piped child stdio drained to stderr, and a main-process console guard. Add a CI test modelled on leak-test plus escape-leak-test that fails on any non-JSON-RPC byte on stdout.
- Treat node:vm as zero isolation: a one-line constructor escape returns the real process object. Ship Step 1 scripts only with a QuickJS/quickjs-ng-in-wasm interpreter behind a membrane, inside the OS-sandboxed child, as security-sandboxing.md recommends. Until then, do not expose the {js} script input to untrusted agents. Escaped code in the child can also call process.send, so the host must validate every IPC reply and treat it as untrusted.
- Do not share one kernel across all calls without a policy. A timeout currently fails every queued call and drops the modelId cache. Options: re-queue innocent in-flight calls on restart, use a small pool or one short-lived kernel per job, and rebuild models from their script hash after a restart.
- Clamp tessellation inputs relative to model size, for example deflection >= bbox diagonal / 2000 and a triangle budget, and enforce per-call timeouts tuned per op class. A legitimate fuseAll of 50 spheres takes about 18 s, so 2 s is too short as a single global value.
- Normalise the STEP FILE_NAME timestamp, or hash with the header removed, before reporting sha256. Otherwise exports cannot be reproducible (gap-8 determinism).
- Protocol: SDK 1.32.2 serves every 2024-11 to 2025-11 client and accepts tools/call without initialize. Use the v2 2.4.0 dual-era serveStdio (legacy: 'serve') to also serve 2026-07-28 clients. Never use legacy:'reject', because most clients still initialize at 2025-06-18 or 2025-11-25. Pin zod to an exact version in package.json.
- Budget the boundary at about 2.5 ms p50 and under 10 ms p95 per call on top of kernel time (measured interleaved A/B). Kernel work, for example about 75-85 ms for a filleted plate, dominates. Optimise the kernel and caching rather than the transport.

### Commands used

```
S=spikes/mcp-worker ; R=$S/repro
mkdir -p $S/deps $S/deps-v2 $S/out ; cd $S/deps && echo '{"private":true}' > package.json && timeout 300 npm install --ignore-scripts --no-audit --no-fund occt-wasm@5.8.1 @modelcontextprotocol/sdk@1.32.2 zod
cd $S/deps-v2 && echo '{"private":true}' > package.json && timeout 300 npm install --ignore-scripts --no-audit --no-fund @modelcontextprotocol/server@2.4.0 @modelcontextprotocol/client@2.4.0
mkdir -p $R/deps-fresh && cd $R/deps-fresh && echo '{"private":true}' > package.json && timeout 300 npm install --ignore-scripts --no-audit --no-fund occt-wasm@5.8.1 @modelcontextprotocol/sdk@1.32.2 zod   # independent version check
cd $S/src && timeout 3000 bash $S/src/run-all.sh $S
cd $S/src && timeout 600 node leak-test.mjs $S/deps $S/out ; timeout 500 node bench-client.mjs $S/deps $S/out thread 7 1 1 1 ; timeout 500 node bench-client.mjs $S/deps $S/out child 7 1 1 1 ; timeout 300 node proto-test.mjs $S/deps $S/out ; timeout 500 node v2-test.mjs $S/deps $S/deps-v2 $S/out ; timeout 400 node kill-test.mjs $S/deps $S/out
( printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 6 ) | timeout 30 node $S/src/server.mjs --deps $S/deps --backend child --export-dir $S/out/exports
cd $R/src && timeout 300 node long-op-probe.mjs $S/deps
cd $R/src && timeout 400 node --expose-gc terminate-test.mjs $S/src $S/deps 8 > $R/out/terminate-results.json
cd $R/src && timeout 200 node escape-leak-test.mjs $S/src/server.mjs $S/deps $R/out > $R/out/escape-results.json
cd $R/src && for tog in 5 20; do timeout 280 node splice-hard.mjs $S/src/server.mjs $S/deps $R/out child 0 0 120 $tog; done
cd $R/src && timeout 500 node direct-bench.mjs $S/src $S/deps 5
cd $R/src && for rep in 1 2 3; do for b in child thread; do timeout 300 node ab-overhead.mjs $S/src $S/deps $b 60; done; done
cd $R/src && for b in thread child; do timeout 400 node kill-hard.mjs $S/src/server.mjs $S/deps $R/out $b 15; done
cd $S/out/bench-exports && diff thread-0/parts/p2.step child-0/parts/p2.step   # only the FILE_NAME timestamp differs
```
