# Open3DJ research: safely executing agent-generated CAD code and securing the agent surface

Research date: 2026-10-27. Scope: sandboxing of LLM-generated JS/Python/OpenSCAD, untrusted CAD file ingestion, MCP-specific attacks and spec requirements, desktop secret storage, plugin supply chain, cloud-GPU privacy, and a recommended threat model and architecture for Open3DJ. Note on method: the shared web-search budget for this run was exhausted before the first query, so every claim below was verified by fetching primary sources directly (spec pages, vendor advisories, project READMEs and docs). Claims that could not be verified are marked as such.

## Executive summary

An agent-first CAD tool is, from a security standpoint, a remote-code-execution service with a friendly UI: it runs code the user did not write (LLM output), opens files the user did not author (STEP/3MF/STL/SCAD from the internet), and exposes a local network surface (MCP over HTTP) that browsers and other processes can reach. In 2025-2026 every one of those surfaces has produced real incidents: MCP Inspector RCE via DNS rebinding/CSRF (CVE-2025-49596, CVSS 9.4), mcp-remote command injection from a malicious OAuth endpoint (CVE-2025-6514, CVSS 9.6), filesystem-MCP sandbox escapes (CVE-2025-53109/53110), Cursor's MCP config "rug pull" (CVE-2025-54136), the GitHub-MCP and Supabase-MCP prompt-injection data leaks, and a steady stream of 3D-file-parser RCEs (OpenSCAD STL stack overflow CVE-2020-28599; in 2026 alone ZDI published RCEs in Pixar OpenUSD crate parsing, Luxion KeyShot and macOS USD parsing). The research also shows that static "prohibited API" checks are not a boundary: 3dj.app's own public `cad_validate_script` accepted a script containing `fetch`, `eval`, `new Function`, dynamic `import()`, a prototype-chain escape, `while(true)` and a 1e9-element allocation as `valid: true`. The recommendation is a layered design: a small deterministic geometry API exposed through a membrane (the Figma/Onshape pattern), scripts executed by an interpreter (QuickJS) compiled to WebAssembly and run under wasmtime with fuel/epoch and memory limiters, that whole worker launched inside an OS sandbox (bubblewrap/Landlock+seccomp, Seatbelt, AppContainer+Job Objects) with no network, an MCP server that is stdio-first and localhost-bound with Origin/Host validation and per-install bearer tokens, pinned tool descriptions, untrusted-data labelling of everything that comes out of a file, Sigstore-signed WASM plugins, OS-keychain secret storage, and an explicit per-job consent and metadata-stripping step before any geometry leaves the machine for a cloud GPU.

## 1. Sandboxing agent-generated JavaScript

**Why not just V8 (Node `vm`, isolated-vm, Deno)?** V8 is the largest attack surface on the list. Google's own V8 sandbox write-up states that 60% of in-the-wild Chrome exploits from 2021-2023 were V8 memory-corruption bugs, and that the in-process V8 sandbox "is not yet a strong security boundary" (April 2024). `isolated-vm` (ISC licence) is honest about its limits: its `memoryLimit` is "more of a guideline", a determined attacker "could use 2-3 times the limit before termination", snapshots/cachedData from users are unsafe, it recommends running in a separate process, it needs `--no-node-snapshot` on Node 20+, and the project is in maintenance mode. Deno's permission model is good for *semi-trusted* code (per-path `--allow-read`, per-host `--allow-net`, `--deny-*`, a permission-broker process), but Deno's docs say `--allow-run` and `--allow-ffi` are equivalent to `--allow-all`, there are no per-module privileges, and for untrusted code they recommend adding OS sandboxing (chroot/cgroups/seccomp) and VMs/microVMs on top.

**QuickJS as the interpreter.** Bellard's QuickJS is MIT, ~367 KiB for a hello-world binary, latest release 2026-06-04 with "almost complete ES2025" support. quickjs-ng is the MIT community fork. `quickjs-emscripten` compiles either to WASM and exposes exactly the knobs a CAD sandbox needs: `runtime.setMemoryLimit()`, `runtime.setMaxStackSize()`, `runtime.setInterruptHandler()` / `shouldInterruptAfterDeadline()`, works in browsers, Node, Deno, Bun and Workers, and ships an Asyncify variant (~2x size) for sync-over-async; its README says it "has not been audited". Figma's plugin system is the canonical precedent: after a vulnerability in the Realms shim they moved to "a JavaScript VM written in C" compiled to WebAssembly, with a whitelist-only API, a membrane so no host object ever leaks into the sandbox, and a swappable engine behind a handle-based interface. Figma also accepted that a plugin can freeze the tool but not corrupt the document.

**wasmtime as the second wall.** wasmtime 50.0.0 (docs dated 2026-10-20) provides `consume_fuel` (deterministic halt), `epoch_interruption` (documented as "safe to use for limiting untrusted guests", typically 2-3x faster than fuel, but bulk-memory ops check the epoch once so heap must also be bounded), `max_wasm_stack` (default 512 KiB), and the `ResourceLimiter` trait (`memory_growing`/`table_growing`, plus `instances`/`tables`/`memories` caps defaulting to 10,000). Its security page documents 2 GB guard regions, guard pages on stacks, zeroing of instance memory, Spectre mitigations on `br_table`/`call_indirect`, and WASI's capability-based filesystem model. Running QuickJS-in-WASM under wasmtime means a JS engine bug yields at most a corrupted WASM linear memory, not host code execution.

**Replicad / OpenCascade.js.** Replicad is MIT and is "an abstraction over opencascade"; opencascade.js is LGPL-2.1 (the README badge says OCCT 7.6.2, while 3dj advertises 7.7.2, so the build used matters) and OCCT itself is LGPL-2.1 with the OCCT exception. OCCT is a multi-million-line C++ kernel; compiled to WASM it inherits WASM's memory isolation, which is exactly why the browser-based Replicad/3dj model is reasonably safe in a tab: the kernel cannot escape linear memory. The same artefact can run server-side under wasmtime with limits.

**microVMs.** Where hardware virtualisation is available, Hyperlight (Apache-2.0, CNCF sandbox, pre-1.0) runs no-OS guests in microVMs that "spin up in milliseconds" on KVM/MSHV (Linux), WHP (Windows) and HVF (macOS arm64); `hyperlight-wasm` is a separate project. Firecracker (Apache-2.0, KVM only, used by Lambda/Fargate) is the cloud-side equivalent. These are the right tool for a multi-tenant cloud worker, not for a desktop default.

## 2. Sandboxing Python

- **Pyodide** (MPL-2.0; the stable docs are at version 314.0.7, i.e. a CPython 3.14 line) gives WASM memory isolation; threads, multiprocessing, sockets and subprocess do not work, `ssl` is a stub, and all networking goes through the browser. Interruption requires running in a web worker with a `SharedArrayBuffer` interrupt buffer (`setInterruptBuffer`, write 2 for SIGINT). Pyodide publishes no security guarantees and warns that unpickling is `eval`-equivalent. Running Pyodide under wasmtime (not a browser) is possible but heavy, and the browser-oriented networking shims become dead weight.
- **RestrictedPython** 8.5 (2026-08-19, CPython 3.10-3.15) states explicitly it "is not a sandbox system or a secured environment" and offers no resource limits. Use it, if at all, as a linting layer only.
- **OS-level isolation** is the real answer for CPython. On Linux: gVisor (Sentry user-space kernel; `systrap` has been the default platform since mid-2023, ptrace is "no longer supported", KVM is best on bare metal; it explicitly does not protect against resource exhaustion, which cgroups must handle), nsjail (Apache-2.0, Linux-only: namespaces, seccomp-bpf via Kafel, cgroups v1/v2, rlimits), bubblewrap (what Anthropic's sandbox-runtime and OpenAI Codex use), Landlock (unprivileged, stackable LSM since Linux 5.13; TCP port rules at ABI v4, abstract-socket/signal scoping at v6, UDP at v10) and seccomp-bpf (filters syscall numbers and register args only, "may not dereference pointers", needs `no_new_privs`, inherited across fork/exec). firejail (GPL-2.0) is a SUID binary and has had its own privilege-escalation CVEs (the README references CVE-2021-26910), so it is a poor dependency for a desktop app.
- **Cross-platform reference implementations.** Anthropic's `sandbox-runtime` (`srt`, Apache-2.0, beta) uses bubblewrap on Linux (network namespace removed, seccomp to block Unix sockets), Seatbelt profiles via `sandbox-exec` on macOS, and on Windows (alpha) a dedicated `srt-sandbox` local user with a WFP egress fence and a write-restricted token; all egress goes through host proxies that resolve names and block private/loopback/link-local/cloud-metadata addresses. OpenAI Codex documents Seatbelt on macOS, bubblewrap on Linux/WSL2 (with a bundled fallback needing unprivileged user namespaces), and a native Windows sandbox, with `read-only` / `workspace-write` / `danger-full-access` modes. Windows primitives are AppContainer (file, registry, network, device, process and window isolation under a per-app capability token) and Job Objects (CPU-rate control, memory limits, process count, kill-on-close, nested since Windows 8).

Conclusion for Open3DJ: offer Python (CadQuery/build123d-style) as a *trusted-tier* language that only runs inside an OS-sandboxed worker with no network, never inside the renderer, and treat RestrictedPython/Pyodide as UX conveniences rather than boundaries.

## 3. OpenSCAD and the Manifold backend

OpenSCAD has not shipped a stable release since 2021.01: the GitHub releases page still lists 2021.01 as "Latest" and the project news page (latest item 25 September 2026) contains no newer release announcement. The downloads page recommends nightly snapshots and enabling Manifold in Preferences for a "huge performance boost"; Manifold is Apache-2.0 with C++, WASM (`manifold-3d`, serial-only) and Python (`manifold3d`) bindings. `openscad-playground` is a headless WASM build of OpenSCAD that "defaults to the Manifold backend" and runs as a PWA, which proves the WASM route is viable. OpenSCAD's parser is a demonstrated RCE surface: Talos TALOS-2020-1223 / CVE-2020-28599 was a stack-based buffer overflow in `import_stl()` (CVSS 8.8), patched before 2021.01. 3dj's server notes say it compiles OpenSCAD "in an isolated real engine". The safe options are (a) the WASM build under wasmtime with fuel/memory limits, or (b) a nightly native binary launched in the OS sandbox with CPU/memory/output caps and no network; `import()` of user files must be mediated by the host (pre-validated, size-capped copies in the sandbox's read-only mount), and `echo()`/comments must be treated as untrusted text.

## 4. Resource limits and determinism

Combine three layers: interpreter limits (QuickJS memory/stack/interrupt), WASM limits (wasmtime fuel or epoch deadline, `ResourceLimiter` for linear memory, `max_wasm_stack`), and OS limits (cgroups/rlimits on Linux, Job Objects on Windows, Seatbelt plus `ulimit` on macOS). Also cap *outputs*: triangle/vertex counts (3MF itself caps arrays below 2^31 to avoid overflow), STEP file size, number of parts, and tool-result bytes returned to the agent. Onshape's FeatureScript documents the discipline worth copying: "Determinism is a core principle", "models must regenerate the same way every time, everywhere", and "execution cannot be influenced by external input, time, or randomness". A deterministic script API (no clock, no RNG, no network, no filesystem) makes results cacheable by content hash, makes "evidence packs" reproducible, and removes most exfiltration channels in one stroke.

## 5. How Zoo, 3dj, Onshape and Jupyter handle it

- **Zoo Design Studio** (MIT, Electron) isolates by remoteness: "The 3D view in Design Studio is just a video stream from our hosted geometry engine"; KCL is executed by the Rust `kcl-lib` executor and modelling commands go to the engine over WebSockets. No untrusted geometry code runs natively on the user's machine, but it is not local-first.
- **3dj.app** runs Replicad/OCCT WASM in the browser workbench and OpenSCAD in an isolated engine. Its public `cad_validate_script` (which advertises "checks for prohibited/unsafe APIs") returned `valid: true` for a probe script containing `fetch`, `eval`, `new Function`, dynamic `import()`, `globalThis.constructor.constructor("return process")()`, `while(true){}` and `new Array(1e9)`. Static validation there is a syntax/param extractor, not a security control; isolation must happen at runtime.
- **Onshape FeatureScript** runs only inside Part Studio regeneration on Onshape's servers, with the determinism rules quoted above; the standard library source is published in a public document and custom features are shared through Onshape's version/permission system.
- **Jupyter Server** is the best-documented local-HTTP precedent: token auth is on by default because "access to the server means access to running arbitrary code"; "execute" permission is treated as equivalent to all permissions; `allow_remote_access` defaults to False and rejects requests whose `Host` header is not local, explicitly "to protect against DNS rebinding"; notebook outputs are only trusted when signed by the local user's signature database. MCP Inspector's fix for CVE-2025-49596 copied this exact design (default session token plus Origin/Host allow-lists).
- **IDE ecosystems**: VS Code's extension host "has the same permissions as VS Code itself"; the Marketplace compensates with malware scanning in sandboxed VMs, VSIX signing verified at install, verified publishers, a blocklist with automatic uninstall, and Workspace Trust. Anthropic's "code execution with MCP" pattern (tools exposed as a code API, progressive disclosure, a 98.7% token reduction in its example) depends on a sandbox and notes that intermediate data can stay in the sandbox and PII can be tokenised before the model sees it.

## 6. MCP-specific security

**Spec requirements (2025-06-18, still current for 2025-11-25).** Authorization is optional, HTTP transports SHOULD implement it, stdio servers SHOULD NOT (credentials from environment). When implemented: OAuth 2.1 (draft-ietf-oauth-v2-1-13), servers MUST publish RFC 9728 Protected Resource Metadata and MUST validate audience; clients MUST use RFC 8414 metadata, MUST implement PKCE, MUST send the RFC 8707 `resource` parameter in both authorization and token requests; Dynamic Client Registration (RFC 7591) SHOULD be supported; tokens MUST be in the `Authorization` header and MUST NOT be in query strings; redirect URIs MUST be localhost or HTTPS; public clients MUST get rotated refresh tokens; "MCP servers MUST NOT accept or transit any other tokens" (token passthrough is forbidden). Streamable HTTP servers MUST validate `Origin` (2025-11-25 clarifies: respond 403), SHOULD bind to 127.0.0.1, SHOULD authenticate; session IDs MUST be secure and "MUST NOT be used for authentication". The 2025-11-25 revision adds OIDC discovery, incremental scope consent via `WWW-Authenticate` (SEP-835), OAuth Client ID Metadata Documents (SEP-991), URL-mode elicitation, experimental long-running tasks (SEP-1686), and icons for tools. The tools spec says clients "MUST consider tool annotations to be untrusted unless they come from trusted servers", servers MUST sanitise outputs and rate-limit, clients SHOULD keep a human in the loop, validate results, enforce timeouts and log usage; elicitation MUST NOT be used to request sensitive information. The Security Best Practices page adds mitigations for confused-deputy proxies (per-client consent, exact redirect-URI match, single-use state), SSRF during OAuth discovery (block private ranges, pin DNS between check and use), local-server compromise (one-click configs MUST show the exact command; sandbox stdio servers; prefer stdio or Unix sockets), and OAuth URL handling (MUST reject `javascript:`/`data:`/`file:` schemes, MUST NOT open URLs through a shell).

**Incidents, 2025-2026 (all verified from the primary advisory or write-up):**

| Date | Issue | Detail |
|---|---|---|
| 2025-04-01 | Tool poisoning (Invariant Labs) | Hidden instructions in tool descriptions; "rug pull" after approval; cross-server shadowing hijacks a trusted `send_email` tool without ever being called. |
| 2025-04-21 | Line jumping (Trail of Bits) | `tools/list` descriptions enter model context before any call, so invocation-time approval cannot help. |
| 2025-04-29/30 | ANSI codes; plaintext credentials (Trail of Bits) | Escape sequences hide instructions from the user but not the model; `claude_desktop_config.json` was 0644, the Figma connector wrote tokens at 0666. |
| 2025-05-26 | GitHub MCP "toxic flow" | A malicious public issue made the agent copy private-repo data into a public PR; "not a flaw in the GitHub MCP server code itself". |
| 2025-06-13 | CVE-2025-49596 MCP Inspector < 0.14.1, CVSS 9.4 | CSRF/DNS rebinding/0.0.0.0-day against a localhost proxy gave RCE; fix: default session token plus Origin/Host checks. |
| 2025-07-01 | CVE-2025-53110 (7.3) / CVE-2025-53109 (8.4) Filesystem MCP | Prefix-match containment bypass and symlink bypass; fixed in 2025.7.1. |
| 2025-07-08 | Supabase MCP leak | Support-ticket text drove a `service_role` query that exfiltrated `integration_tokens`; mitigations: read-only mode, project scoping, treat results as data. |
| 2025-07-09 | CVE-2025-6514 mcp-remote 0.0.5-0.1.15, CVSS 9.6 | Malicious `authorization_endpoint` passed to `open` executes via PowerShell; fixed 0.1.16; 437k+ downloads affected per THN. |
| 2025-08-05 | CVE-2025-54136 "MCPoison" Cursor | MCP config trusted by name, swapped after approval; fixed in 1.3 (2025-07-29). |

Two further points shape the local-daemon design. Chrome 142 ships a Local Network Access permission prompt for public sites reaching loopback/private addresses (replacing Private Network Access), but WebSockets, WebTransport and WebRTC are "not yet gated", so a browser-side fix cannot be relied upon. And Trail of Bits' `mcp-context-protector` (Apache-2.0) shows what tool pinning should look like: trust-on-first-use of server instructions, tool descriptions *and input schemas*, quarantine of flagged outputs, and ANSI sanitisation.

**Prompt injection via CAD files.** 3MF metadata (`Title`, `Designer`, `Description`, `LicenseTerms`, vendor-prefixed names) is free-form string content inside an OPC/ZIP package; the spec prohibits DTDs because they "enabled denial of service attacks" and requires C14N before XML signatures. STEP Part 21 headers carry free text (`description`, `author`, `organization`, `preprocessor_version`, `originating_system`, `authorization`) and edition 3 (2016) adds anchors, external-file references, ZIP archives and digital signatures. SCAD files carry comments and `echo()` strings. Every one of these is attacker-controlled text that an agent will read, so they must be returned to the model inside explicit "untrusted content" delimiters, with control characters stripped, and never concatenated into tool descriptions or system prompts. Parsers themselves are RCE surfaces: ZDI advisories in 2026 include CVE-2026-92211 (OpenUSD crate-file double free, 2026-10-26), CVE-2026-92202 (KeyShot BIP parsing) and CVE-2026-43733/43729 (macOS USD parsing), all CVSS 7.8 RCE on file open.

## 7. Secrets on the desktop and the client shell

Electron `safeStorage` uses Keychain (macOS), DPAPI (Windows, which does not protect against other apps in the same user session) and kwallet/libsecret/portal on Linux, but falls back to a hard-coded plaintext key (`basic_text`) when no secret store exists; the synchronous API is deprecated and removed in Electron 46, and macOS apps must be consistently code-signed or Keychain re-prompts on every update. The Rust `keyring` crate 4.2.0 (MIT OR Apache-2.0) covers macOS, Windows, Linux Secret Service and keyutils, and Android. Tauri v2 separates a trusted Rust core from an untrusted WebView via capabilities/permissions, scopes, CSP and an isolation pattern; Electron's checklist requires `contextIsolation`, the process sandbox, `nodeIntegration: false` and "under no circumstances" loading remote code with Node integration.

## 8. Plugin supply chain and signing

The npm ecosystem suffered the self-replicating Shai-Hulud worm (GitHub notified 2025-09-14; 500+ packages removed), after which npm is moving to trusted publishing, mandatory FIDO 2FA, deprecated classic tokens and 7-day granular tokens. The MCP registry (preview since 2025-09-08, v0.1 API frozen 2025-10-24) verifies namespaces via GitHub OAuth/OIDC, DNS or HTTP proof, which is a useful identity anchor but not a code review. Sigstore (cosign/Fulcio/Rekor) signs blobs and containers keylessly with OIDC identities and a transparency log; SLSA Build L2 requires signed provenance from a hosted builder and L3 isolates builds from one another (v1.2 is current). For generative-3D model weights, PyTorch pickle files are "unsafe, run arbitrary code"; `safetensors` (Apache-2.0) is a tensor-only format with a 100 MB header cap and no hidden-data regions.

## 9. Privacy when offloading to cloud GPUs

NVIDIA Confidential Computing on Hopper, Blackwell and Rubin places the tenant VM and GPU state in a hardware TEE with attestation, and is offered on Azure and Google Cloud; it is the only mechanism that protects design data from the cloud operator itself, and it is not available on commodity GPU rentals. Anthropic's code-execution pattern shows the complementary software approach: keep intermediate data inside the execution environment and tokenise sensitive fields before anything crosses a trust boundary. Firecracker-style microVMs are the right isolation unit for a multi-tenant Open3DJ cloud worker.

## Recommendations for Open3DJ

**Threat model.** Assets: the user's design IP (files, parameters, evidence), the user's machine and credentials, and the integrity of produced geometry (a silently altered tolerance is a safety issue). Adversaries, in decreasing trust: (1) the user; (2) MCP clients/agents acting for the user but steerable by injection; (3) LLM-generated scripts (assume malicious); (4) files opened from the internet (assume malicious); (5) plugins and MCP servers from third parties (assume rug-pulls); (6) web pages in the user's browser reaching localhost; (7) cloud providers (honest-but-curious by default). Explicit non-goals: hardware side channels, a compromised OS.

**Execution architecture (local daemon `open3dj-daemon`, Rust).**
1. One short-lived *kernel worker* process per job, spawned under the OS sandbox: bubblewrap or Landlock+seccomp on Linux, Seatbelt on macOS, AppContainer plus a Job Object on Windows (adopt `sandbox-runtime` or Codex-style profiles). No network namespace, read-only bind of the project snapshot, write-only job output directory, CPU/memory/pids/output-size caps, hard kill on timeout.
2. Inside the worker, scripts run in wasmtime with `epoch_interruption` (plus `consume_fuel` for the deterministic "reproducible build" mode), a `ResourceLimiter` memory cap, and `max_wasm_stack`. JS runs on QuickJS/quickjs-ng compiled to WASM; Replicad/OCCT and OpenSCAD+Manifold run as WASM modules; CPython is offered only as a trusted-tier language inside the OS sandbox with no network.
3. The script API is a capability membrane (Figma pattern): handles, not host objects; whitelist-only; no `Date.now`, `Math.random`, `fetch`, `import()` or filesystem. Determinism is a documented invariant (Onshape's wording), so results are content-addressed and cached.
4. File ingestion is a separate sandboxed worker with the same limits; 3MF parsing rejects DTDs and enforces size/array caps; all metadata, STEP header fields and SCAD comments are returned to agents as labelled untrusted data with control characters stripped.

**MCP server.** stdio by default. Streamable HTTP binds to 127.0.0.1 only (or a Unix socket/named pipe), validates `Origin` and `Host` (403 otherwise), requires a per-install random bearer token stored in the OS keychain, and uses secure random session IDs that are never an authentication credential. Remote deployments implement OAuth 2.1 + PKCE + RFC 8707 + RFC 9728 and never pass tokens through. Tool descriptions and input schemas are static, versioned and published with hashes so clients can pin them; `list_changed` is only emitted on upgrade. Tool results carry a provenance field (`source: file|script|provider`, `trust: untrusted`) and `outputSchema`; URLs are opened only with scheme allow-lists and never via a shell. Rate limits, timeouts and an audit log are on by default. Default scopes are read-only; write/export/cloud scopes are incremental (SEP-835).

**Plugins.** First-class plugins are WASM Component Model modules with declared capabilities, signed with Sigstore and published with SLSA L2+ provenance; the Open3DJ registry verifies namespaces (as the MCP registry does) and pins by digest. Native plugins exist only in an explicit "trusted" tier with signature verification, a visible permission prompt, and trust-on-first-use re-approval whenever the manifest, description or schema changes (the MCPoison lesson). No install-time scripts.

**Cloud providers (including 3dj.app as one provider).** A provider interface with a declared data-flow contract (what is uploaded, retention, region, whether a TEE is used). Offloading is opt-in per job, shows the user a diff of what will leave the machine, strips metadata by default, encrypts in transit and at rest, and records the provider attestation in the evidence pack. Generative weights are accepted only in safetensors. Multi-tenant Open3DJ cloud workers run in Firecracker/Hyperlight microVMs.

**Desktop client.** Tauri (Rust core, capabilities, CSP, isolation pattern) or Electron with `contextIsolation` and the process sandbox; the renderer never executes user scripts. Secrets go through the `keyring` crate; on Linux the app detects a plaintext fallback and warns. Short-lived tokens with rotated refresh tokens.

**Security program.** SECURITY.md and a CVE process before 1.0; continuous fuzzing of STEP/3MF/STL/SCAD readers; a sandbox-escape bounty; regression tests that replay the 2025 MCP incidents (DNS rebinding, config rug-pull, symlink containment, tool-description change) against the daemon in CI.

## Sources

- MCP Authorization 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP Security Best Practices: https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
- MCP Transports 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP Tools 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP Elicitation 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
- MCP 2025-11-25 changelog: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- Oligo, CVE-2025-49596 MCP Inspector: https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596
- JFrog, CVE-2025-6514 mcp-remote: https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/
- Cymulate, CVE-2025-53109/53110 Filesystem MCP: https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/
- Check Point, CVE-2025-54136 MCPoison: https://research.checkpoint.com/2025/cursor-vulnerability-mcpoison/
- Invariant Labs, tool poisoning: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- Invariant Labs, GitHub MCP: https://invariantlabs.ai/blog/mcp-github-vulnerability
- General Analysis, Supabase MCP: https://www.generalanalysis.com/blog/supabase-mcp-blog
- Trail of Bits, line jumping: https://blog.trailofbits.com/2025/04/21/jumping-the-line-how-mcp-servers-can-attack-you-before-you-ever-use-them/
- Trail of Bits, ANSI codes: https://blog.trailofbits.com/2025/04/29/deceiving-users-with-ansi-terminal-codes-in-mcp/
- Trail of Bits, credential storage: https://blog.trailofbits.com/2025/04/30/insecure-credential-storage-plagues-mcp/
- Trail of Bits, mcp-context-protector: https://github.com/trailofbits/mcp-context-protector
- awesome-mcp-security incident list: https://github.com/Puliczek/awesome-mcp-security
- Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access
- isolated-vm: https://github.com/laverdet/isolated-vm
- V8 sandbox: https://v8.dev/blog/sandbox
- Deno security model: https://docs.deno.com/runtime/fundamentals/security/
- QuickJS: https://bellard.org/quickjs/
- quickjs-ng: https://github.com/quickjs-ng/quickjs
- quickjs-emscripten: https://github.com/justjake/quickjs-emscripten
- Figma plugin system: https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
- wasmtime security: https://docs.wasmtime.dev/security.html
- wasmtime Config (fuel/epoch/stack): https://docs.rs/wasmtime/latest/wasmtime/struct.Config.html
- wasmtime ResourceLimiter: https://docs.rs/wasmtime/latest/wasmtime/trait.ResourceLimiter.html
- Hyperlight: https://github.com/hyperlight-dev/hyperlight
- Firecracker: https://github.com/firecracker-microvm/firecracker
- Pyodide repo (MPL-2.0): https://github.com/pyodide/pyodide
- Pyodide FAQ: https://pyodide.org/en/stable/usage/faq.html
- Pyodide WASM constraints: https://pyodide.org/en/stable/usage/wasm-constraints.html
- Pyodide keyboard interrupts: https://pyodide.org/en/stable/usage/keyboard-interrupts.html
- RestrictedPython: https://restrictedpython.readthedocs.io/en/latest/
- gVisor security: https://gvisor.dev/docs/architecture_guide/security/
- gVisor platforms: https://gvisor.dev/docs/architecture_guide/platforms/
- nsjail: https://github.com/google/nsjail
- firejail: https://github.com/netblue30/firejail
- seccomp-bpf: https://docs.kernel.org/userspace-api/seccomp_filter.html
- Landlock: https://docs.kernel.org/userspace-api/landlock.html
- Anthropic sandbox-runtime: https://github.com/anthropic-experimental/sandbox-runtime
- Codex sandboxing: https://learn.chatgpt.com/docs/sandboxing
- Windows AppContainer: https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation
- Windows Job Objects: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- Apple App Sandbox: https://developer.apple.com/documentation/security/app-sandbox
- OpenSCAD releases: https://github.com/openscad/openscad/releases
- OpenSCAD news: https://openscad.org/news.html
- OpenSCAD downloads: https://openscad.org/downloads.html
- openscad-playground: https://github.com/openscad/openscad-playground
- Manifold: https://github.com/elalish/manifold
- Talos TALOS-2020-1223 / CVE-2020-28599: https://talosintelligence.com/vulnerability_reports/TALOS-2020-1223
- ZDI published advisories (2026 OpenUSD/KeyShot/macOS USD): https://www.zerodayinitiative.com/advisories/published/
- 3MF Core Specification: https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
- ISO 10303-21: https://en.wikipedia.org/wiki/ISO_10303-21
- Zoo modeling-app: https://github.com/KittyCAD/modeling-app
- Zoo kcl-lib: https://github.com/KittyCAD/modeling-app/blob/main/rust/kcl-lib/README.md
- Onshape FeatureScript intro: https://cad.onshape.com/FsDoc/intro.html
- Jupyter Server security: https://jupyter-server.readthedocs.io/en/latest/operators/security.html
- Jupyter Server config (allow_remote_access): https://jupyter-server.readthedocs.io/en/latest/other/full-config.html
- VS Code extension runtime security: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security
- Anthropic, code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- Docker MCP Gateway: https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/
- replicad: https://github.com/sgenoud/replicad
- opencascade.js: https://github.com/donalffons/opencascade.js
- OCCT: https://github.com/Open-Cascade-SAS/OCCT
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Tauri v2 security: https://v2.tauri.app/security/
- keyring crate: https://docs.rs/keyring/latest/keyring/
- GitHub npm supply-chain plan (Shai-Hulud): https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/
- MCP registry: https://github.com/modelcontextprotocol/registry
- Sigstore overview: https://docs.sigstore.dev/about/overview/
- SLSA levels: https://slsa.dev/spec/v1.0/levels
- safetensors: https://github.com/huggingface/safetensors
- NVIDIA Confidential Computing: https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/
- 3dj MCP `cad_validate_script` probe (this session, 2026-10-27): tool returned `valid: true` for a script containing fetch/eval/new Function/dynamic import/prototype escape/while(true)/new Array(1e9).
