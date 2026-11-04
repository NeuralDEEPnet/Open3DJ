# Lean starting stack for a one-person-plus-agents Open3DJ

Checked 28 Oct 2026. Versions come from the npm, PyPI and crates.io registries, and from the source trees of the packages involved. Measurements were taken in this sandbox (4 vCPU Intel Xeon at 2.1 GHz, 15 GB RAM, Linux x64, Node 22.22.0). The native baseline is the gap-8 run on the same machine class. Scripts and raw output are in [spike/lean/](spike/lean/) and [bench/](bench/). Where this note conflicts with PLAN.md or ARCHITECTURE.md, this note is newer and was written under the founder's new constraints: no paid engineers, small releases, Kaizen.

## Bottom line

1. **Start TypeScript-first (option A).** Ship one npm package, `npx -y open3dj mcp`. It contains:
   - the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0)
   - brepjs 20.11.x over occt-wasm 5.8.x (OCCT 8.0.1 compiled to WebAssembly)
   - Open3DJ's own DSL v1 facade, matching the 3dj dslReference
   - agent scripts run in QuickJS-WASM (quickjs-emscripten 0.32.0, quickjs-ng variant), inside a short-lived Node worker started with `--permission`
   - a local three.js viewer, served later from the same process

   The whole package is JavaScript plus WASM, so there are **zero per-platform native builds**, and it already runs on all six targets that Node publishes.
2. **Protocol support no longer separates the options.** The TypeScript SDK v2, the Python SDK 2.3.0 and rmcp 3.8.0 all serve the 2026-07-28 era and `initialize`-era clients from one server. The decision rests on speed, sandboxing and reach.
3. **WASM costs about 1.2x to 2.1x, measured on matched workloads.** In exchange it gives the containment an agent tool needs: a failed fillet comes back as a structured error that names the faulty edges, and the process stays alive.
4. **Rust (B) is a later host, not a starting point.** occt-wasm now ships a Rust crate that runs the *same* WASM kernel under wasmtime. A future Rust daemon could therefore reuse the kernel, the DSL and the handle model without rewriting them. Starting in Rust today would mean rebuilding brepjs's high-level layer and still writing the viewer in TypeScript.
5. **Python (C) is the fastest demo, but a weak base.** It is roughly what build123d-mcp already is (validated CADGenBench 0.830). It needs OS-level sandboxing on every OS from day one, has no Windows ARM64 OCP wheel, and cannot run the 3dj JavaScript DSL. Keep build123d as an optional `uvx` worker tier added later, because LLM-CAD research favours Python scripts.
6. **Cash cost of option A is $0 until a signed desktop binary ships.** npm, PyPI and GitHub Actions for public repos (including `windows-11-arm` and macOS runners) are free. Apple's $99/year and Azure Artifact Signing at about $9.99/month only arise when shipping a desktop binary. SignPath Foundation is a free alternative after the first release (gap-9).

## Comparison

| Criterion | A: TypeScript + WASM | B: Rust lean | C: Python |
|---|---|---|---|
| Time to first useful release (planning estimate, founder plus agents) | **About 2 to 4 weeks.** The SDK, kernel, high-level CAD API, HLR renderer and exporters already exist; new code is the DSL facade, tools and reports | About 6 to 10 weeks: MCP in Rust, a JS engine for the DSL, a rebuilt brepjs-style layer, and a TypeScript viewer anyway | **About 1 to 2 weeks** to a demo; the build123d API is mature |
| Agents writing and maintaining the core | Strong. One language end to end; tsc and vitest give fast feedback | Good code, slow loop (compile times, borrow checker); two languages (Rust plus TypeScript UI) | Strong for the core; dynamic typing gives weaker refactor safety |
| Agents writing *models* | JS DSL (3dj-compatible); less pretraining data than CadQuery/build123d | Same as A | **Best evidence** (most LLM-CAD papers use CadQuery/build123d) |
| Windows x64/ARM64, macOS, Linux with no native builds | **Yes.** Node runs on all six targets (win-arm64 is Tier 2) and the kernel is WASM | Rust binary cross-built per target. With the occt-wasm crate there is no OCCT build, but wasmtime on Windows ARM64 is Tier 3 | **No Windows ARM64.** OCP 8.0.1.1.0 ships five platform wheels and no win_arm64 |
| Install friction | `npx -y open3dj mcp`. Node is near-universal among agent users. Package is about 25 MB | Single binary via the npm optional-dependency pattern (best UX, most release work) | `uvx open3dj` needs uv; first run pulls Python plus a 68 MB OCP wheel |
| Sandboxing agent scripts | **Good on day one**: QuickJS-WASM limits, kernel in WASM linear memory, worker under the Node permission model, kill timer. OS sandbox added later | **Best** (wasmtime fuel/epoch plus ResourceLimiter), but more to build | **Weakest.** CPython with OCP has no in-language sandbox; it needs bubblewrap, Seatbelt and AppContainer per OS from the start |
| Geometry robustness | OCCT 8.0.1; structured errors; no segfaults; 4 GiB wasm32 cap | Same kernel, if built on occt-wasm; a native shim adds per-OS builds | Native OCCT 8.0.1: fastest, no memory cap, but a careless call segfaults the process (gap-8) |
| Path to long-term architecture | Contracts first; kernel, host, shell and sandbox swap behind them | Is the long-term host in the old plan | Python stays a tier, not the core |

## Evidence by criterion

### Protocol: all three SDKs are dual-era now

- **TypeScript SDK v2.**
  - `@modelcontextprotocol/server` 2.0.0 was published on 27 Jul 2026; 2.4.0 on 23 Oct 2026, under Apache-2.0. Its README calls v2 "the stable release line, implementing the 2026-07-28 MCP spec".
  - On stdio, `serveStdio(factory)` "also serves 2025 unless `legacy: 'reject'`". A 2025-era opening "pins the connection to a legacy instance … exactly as a hand-wired stdio server would".
  - Over HTTP, `createMcpHandler` defaults to `legacy: 'stateless'`.
  - A default-on legacy shim converts the modern `input_required` result into elicitation for legacy clients.
  - The v1 package `@modelcontextprotocol/sdk` 1.32.2 still tops out at 2025-11-25. **Use v2.**
- **Python SDK.** `mcp` 2.3.0 (2 Oct 2026) contains `serve_dual_era_loop`. FastMCP 4.1.4 requires `mcp>=2.3.0`.
- **Rust.** rmcp 3.8.0 (26 Oct 2026) is dual-era (gap-6).

Gap-6 still applies to all three. Human approvals stay daemon-owned. The agent surface must work over plain `tools/list` and `tools/call` at 2025-06-18.

### Kernel speed and failure behaviour (measured)

Each figure is the median of 7 runs after 2 warm-ups. Both runtimes produced identical volumes.

| Workload | Native OCP 8.0.1.1.0 (CPython 3.13) | occt-wasm 5.8.1 (Node 22.22) | WASM/native |
|---|---|---|---|
| Box + cylinder fuse | 3.04 ms | 6.45 ms | 2.12x |
| 200 mm plate minus 100 holes (cutAll) | 145.1 ms | 182.0 ms | 1.25x |
| Fillet 12 box edges | 6.87 ms | 12.38 ms | 1.80x |
| Fuse 40 boxes | 109.7 ms | 154.0 ms | 1.40x |
| Plate + mesh + STEP write | 310.7 ms | 383.3 ms | 1.23x |
| 1,000 small fuses | 2.74 s | 3.81 s | 1.39x |
| Startup | 0.83 s import, 286 MB RSS | 16 ms import + 105 ms init, 103 MB RSS | WASM faster |
| Suite peak RSS | 333 MB | 317 MB | about equal |

Taucad's self-reported study (Apple M2 Pro, Node 24) gives a similar picture: 1.10x to 1.77x on real work, 3.16x on a small fuse and 0.99x on a 40-box multi-tool fuse.

Failure behaviour differs more than speed:

- **Native.** A failed all-edge fillet on a holed bracket segfaulted the native process whenever `Shape()` was called without checking `IsDone()` (gap-8).
- **WASM.** The same bracket in occt-wasm returned `CONSTRUCTION_FAILED: fillet: operation failed [faulty edges: 15,23]`, and the kernel kept working afterwards. That is the per-edge feedback the old plan wanted to build by bisection.
- **One gotcha.** `cutAll` returns a compound, and `fillet` needs a solid. Extract the solid first; the DSL facade should do this automatically.

Limits to plan around:

- **Memory cap.** occt-wasm is built wasm32 with `MAXIMUM_MEMORY=4294967296` (4 GiB). Node has supported memory64 since 24.0 and wasmtime since 30, while Safari still has it behind a flag. occt-wasm is not built for memory64.
- **Leaks.** The OCCT 8.0.1 guided-sweep regression (build123d #1474) is in OCCT itself, so it affects every option. Field reports of WASM heap leaks (replicad #282) and Tau's heap recycling at 1.5 GiB argue for short-lived workers that are recycled at a threshold.

### Sandboxing (measured spike)

An agent script ran in QuickJS-WASM. The only way out was a handful of host functions that pass u32 kernel handles.

- **No host access.** `process`, `require`, `fetch` and the `constructor.constructor` escape all evaluated to `undefined`.
- **Endless loop.** `while(true){}` was interrupted at the 500 ms deadline.
- **Allocation bomb.** It was stopped by a 32 MiB limit with "out of memory", but only after 12 s. The deadline is not checked inside a native `Array.fill`. **Mistake-proofing rule:** the parent must also enforce a wall-clock kill on the worker process.
- **Membrane overhead is negligible.** 100 sequential cuts took 1,858 ms through QuickJS and 1,837 ms directly, about 1%.
- **Permission model works with the kernel.** Under `node --permission` with read-only grants, occt-wasm loaded and computed, while file writes and `child_process` returned `ERR_ACCESS_DENIED`.

The Node docs are explicit that the permission model "does not protect against malicious code". That is acceptable here, because agent code never runs in Node; it runs only in QuickJS. The permission model is a second fence, and an OS sandbox (Anthropic sandbox-runtime style) is the third, added in a later release.

isolated-vm (7.0.1) and SES (2.3.0) put agent code inside V8 and should stay out. QuickJS is the only option that keeps the agent's JavaScript engine itself inside a WASM boundary.

### Agents writing and maintaining the code

- **GitHub language data.** On GitHub, TypeScript overtook Python and JavaScript in August 2025 by contributor count. GitHub ties the shift to typed languages "that make agent-assisted coding more reliable". It cites a 2025 study finding that 94% of LLM-generated compilation errors were type-check failures, which tsc catches before runtime.
- **brepjs as an existence proof.** It is a one-maintainer, explicitly AI-assisted TypeScript CAD library (AI-DISCLOSURE.md):
  - 516 npm versions since 2 Feb 2026
  - 514 test files with roughly 5,800 test cases (grep count)
  - four kernel adapters behind a synchronous `KernelAdapter`

  The same evidence is a churn warning: 12 major versions in 2026.
- **The language agents write models in is a separate question.** LLM-CAD research overwhelmingly uses CadQuery and build123d. Option A keeps that door open with an optional Python worker, and an o3dj-bench ablation then decides which language SKILL.md recommends.

### Reach and install

- **Node.** Node 26.12.1 and 24.22.1 (LTS) publish builds for linux-arm64 (Tier 1), osx-arm64 (Tier 1), win-arm64 (Tier 2) and the x64 targets. GitHub offers free `windows-11-arm` runners to all public repos, so one pure-JS CI matrix covers every target at no cost.
- **Single binary.** A single binary is an option, not a prerequisite:
  - Node SEA has `--build-sea` since 25.5 and is at stability 1.1.
  - `bun build --compile` has supported `bun-windows-arm64` since 1.3.10, but brepjs lists Bun as untested.
- **LGPL wasm in a bundle.** Whichever route is used, keep `occt-wasm.wasm` as a separate, replaceable file. Its compiled output is LGPL-2.1-only. Note that npm's licence field says "MIT OR Apache-2.0", which covers only the tooling.

### How production apps run OCCT in WASM

- **3dj.app.** Its public `cad_get_evidence_schema` states "OpenCascade.js 7.7.2 WebAssembly solid kernel". CAD runs in the browser workbench, and `cad_validate_script` is static only (gap-2, security report).
- **Replicad.** Since v1.0 it runs on OCCT 8.0.1 through taucad's opencascade.js builds.
- **CascadeStudio** (MIT). It runs opencascade.js (OCCT 8.0 RC4) in a Web Worker and is fully static or PWA, with no server.
- **Tau.** It runs per-kernel WASM heaps and recycles them at 1.5 GiB on desktop (gap-8).

All four confirm the pattern: OCCT-WASM runs in a worker, and the worker is recycled.

## Component check

| Component | Version (date) | Licence | Maintainers / cadence | Risk and countermeasure |
|---|---|---|---|---|
| `@modelcontextprotocol/server` | 2.4.0 (23 Oct 2026) | Apache-2.0 | Official SDK; 2.x minor every 1 to 3 weeks | Pin exactly; run the client conformance matrix before each bump |
| occt-wasm (npm) | 5.8.1 (25 Oct 2026); 65 versions since 27 Mar 2026 | Tooling MIT OR Apache-2.0; `.wasm` LGPL-2.1-only | One maintainer (andymai), CI, about 530 tests, release-please | Bus factor 1: pin, mirror the repo, keep the build reproducible (`cargo xtask build` or Docker) |
| occt-wasm (crate) | 5.1.0 (25 Oct 2026), wasmtime 48 | Same | Same | The future Rust-host route; 629 downloads so far |
| brepjs | 20.11.1 (27 Oct 2026); 516 versions | Apache-2.0 (needs NOTICE) | One maintainer, AI-assisted, 12 majors in 2026 | Pin exactly; vendor the `KernelAdapter` interface; keep Open3DJ's DSL facade the only public API |
| quickjs-emscripten | 0.32.0 (16 Feb 2026); previous release Sep 2024 | MIT | Slow cadence; "has not been audited" | QuickJS is small and stable; keep the outer kill timer and the OS sandbox |
| manifold-3d | 3.5.4 (25 Sep 2026) | Apache-2.0 | Active | Mesh booleans and repair |
| three.js | r186 (0.186.1) | MIT | Quarterly breaking releases | Pin |
| build123d (optional tier) | 0.13.0 on cadquery-ocp-novtk 8.0.1.1.0 | Apache-2.0 | Active | No win_arm64; one OCCT per runtime (gap-3) |
| Avoid | brepkit-wasm | AGPL-3.0-only | n/a | Never bundle (gap-2) |

## Recommended stack and how it grows without rewrites

**Four contracts are written once and kept** (standard work for every release):

1. MCP tool schemas as JSON Schema: GeometryReport, the five-state reference report, Evidence Pack with waivers, jobs, approvals, provenance.
2. DSL v1 surface plus a tolerance-based conformance suite on the 18 public 3dj starters.
3. The brepjs `KernelAdapter` (synchronous, opaque handles).
4. The `.o3j` project and replay format.

Everything else sits behind them and can be swapped.

**Kaizen release ladder for the stack.** Each step is a usable release, and each is chosen by measurement.

| Release | Stack added | Exit check (go and see) |
|---|---|---|
| R0, `npx open3dj mcp` | TS SDK v2 `serveStdio`; brepjs + occt-wasm; four tools (`run`, `inspect`, `render`, `export`); GeometryReport; occt-wasm HLR multiview PNG/SVG snapshots (measured: 135 ms, byte-identical across two processes); STEP/STL | Works from Claude Code, Codex (2025-06-18) and Gemini CLI; CI green on ubuntu, macOS, Windows x64 and `windows-11-arm` |
| R1, safe scripts | QuickJS worker plus permission flags plus kill timer; DSL v1 subset driven by the starters; conformance suite; Evidence gates (watertight, 0.8 mm wall, 45 degree overhang, bed) | Sandbox attack tests in CI (the four above); conformance tolerances met |
| R2, human loop | Local viewer (three.js) and nonce-protected approval page from the same process; job model; replay | A real user approves an export; replay hashes match |
| R3, providers and tiers | Licence-aware provider router (3dj.app via MCP; TRELLIS v1 clean runner); optional `uvx` build123d worker | A licence manifest is shown before any download |
| R4, design pipeline | XCAF assemblies with names and colours (CMF), AP242 STEP, 3MF, HLR drawings for manufacturing handoff | One product taken from brief to quote |
| R5, desktop (pull, not push) | Same web UI in Electron 45 (bundles Node 24.22, x64/arm64 on all three OSes) or Tauri 2.12 with a Node SEA sidecar; signing costs start here | Users ask for it; installer-size and frame-time data decide the shell |

**Swap points, each opened only by a measured trigger:**

- **Kernel memory or speed.** Trigger: a real part exceeds the 4 GiB cap, or p95 `run` time exceeds 2 s. Order of response:
  1. contribute a memory64 build of occt-wasm (Node 24 and wasmtime support it);
  2. then compile the same ~230-function occt-wasm C++ facade natively as an N-API addon behind the same `KernelAdapter`, with prebuilt binaries for the hot platforms only;
  3. heavy STEP import can also go to the optional native Python worker.
- **Host language.** If a Rust daemon is wanted later (single binary, wasmtime fuel limits), the occt-wasm crate runs the same kernel. QuickJS can run under wasmtime, so the DSL JavaScript and the tool schemas carry over. Whether brepjs's TypeScript layer performs acceptably inside QuickJS is untested and would be a spike, not an assumption.
- **Sandbox.** Wrap the worker in bubblewrap, Seatbelt or AppContainer plus a Job Object, following the sandbox-runtime and Codex patterns, without changing the worker protocol.

## Stop-the-line triggers for this stack

- A red DSL conformance result or a red sandbox attack test blocks release. Root-cause it and add a regression test.
- Kernel dependency bumps (brepjs, occt-wasm, MCP SDK) go in one weekly batch PR. Each batch must pass conformance, the bench (no more than 10% regression) and a 10,000-op memory soak.
- Any new native dependency needs a written reason. Zero native builds is a standing rule until a trigger above fires.

## Sources

- MCP TypeScript SDK v2:
  - https://www.npmjs.com/package/@modelcontextprotocol/server
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
  - https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md
  - https://ts.sdk.modelcontextprotocol.io/v2/serving/http
  - https://www.npmjs.com/package/@modelcontextprotocol/sdk
- Python SDK and FastMCP: https://pypi.org/project/mcp/2.3.0/ ; https://pypi.org/project/fastmcp/4.1.4/ ; https://pypi.org/project/fastmcp-slim/4.1.4/
- rmcp: https://crates.io/crates/rmcp
- occt-wasm:
  - https://github.com/andymai/occt-wasm (README, LICENSE, `xtask/src/build.rs`, `crate/README.md`, `benchmarks/baseline.json`)
  - https://www.npmjs.com/package/occt-wasm
  - https://crates.io/crates/occt-wasm
- brepjs:
  - https://github.com/andymai/brepjs (README, AI-DISCLOSURE.md, docs/compatibility.md, docs/kernel-swap.md)
  - https://www.npmjs.com/package/brepjs
- quickjs-emscripten: https://github.com/justjake/quickjs-emscripten ; https://www.npmjs.com/package/quickjs-emscripten
- isolated-vm: https://www.npmjs.com/package/isolated-vm
- SES: https://www.npmjs.com/package/ses
- Node.js:
  - permission model: https://nodejs.org/api/permissions.html
  - SEA: https://nodejs.org/api/single-executable-applications.html
  - releases: https://nodejs.org/dist/index.json
  - platform tiers: https://github.com/nodejs/node/blob/v26.x/BUILDING.md
- WebAssembly feature support: https://raw.githubusercontent.com/WebAssembly/website/main/features.json
- wasmtime tiers: https://docs.wasmtime.dev/stability-tiers.html
- Bun Windows ARM64: https://bun.com/blog/bun-v1.3.10 ; https://bun.com/docs/bundler/executables
- GitHub Windows Arm runners: https://blogs.windows.com/windowsdeveloper/2025/04/14/github-actions-now-supports-windows-on-arm-runners-for-all-public-repos/
- Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ ; https://arxiv.org/pdf/2504.09246
- WASM vs native benchmark (taucad): https://github.com/taucad/opencascade.js/blob/main/BENCHMARKS.md
- CascadeStudio: https://github.com/zalo/CascadeStudio
- Python CAD packages: https://pypi.org/project/build123d/ ; https://pypi.org/project/cadquery-ocp-novtk/8.0.1.1.0/ ; https://pypi.org/project/build123d-mcp/
- 3dj Evidence schema: public `cad_get_evidence_schema` tool on the 3dj MCP server, called 28 Oct 2026
- Earlier notes in this folder: gap-2, gap-3, gap-6, gap-8, gap-9, security-sandboxing.md, client-and-distribution.md, research-llm-cad.md
- Local measurements:
  - [spike/lean/wasm.json](spike/lean/wasm.json) (raw output: the kernel's STEP banner precedes the JSON), [bench/native.json](bench/native.json)
  - scripts: [spike/lean/](spike/lean/) `membrane.mjs`, `overhead.mjs`, `png.mjs`, `bracket.mjs`, `perm.mjs`; each takes the path of a folder with the npm dependencies installed as its first argument
