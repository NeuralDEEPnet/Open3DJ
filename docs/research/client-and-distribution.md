# Open3DJ research: cross-platform desktop client stack, rendering and distribution

Research date: 2026-10-27. Facts below were verified against primary sources (release pages, official docs, package manifests) where possible; items that rest on blogs or single reports are flagged as such. Web search budget ran out before every secondary question could be checked; the "Open questions" list at the end records what was not verified.

## Executive summary

For an agent-first, local-first CAD client that must share code with a web client and a headless core, the best 2026 stack is a **Rust "core daemon" that owns the kernel, the MCP/HTTP API and headless export, wrapped by a Tauri 2.12 desktop shell that renders with three.js (WebGPURenderer with automatic WebGL2 fallback)**. Tauri gives 3 to 10 MB shells, native menus, file associations, multi-window and a capability-based security model, but it inherits the platform webview: WebGPU is available in WebView2 (Chromium 113+) and in WKWebView on macOS 26+, but **not in WebKitGTK on Linux**, where even WebGL2 can silently fall back to software rasterization. Tauri 3 (alpha.5, 14 Oct 2026) adds an optional bundled-Chromium (CEF) runtime that removes that Linux gap at the cost of hundreds of MB, so the plan should be "Tauri 2 now, CEF runtime or Electron fallback for Linux if WebGL2 proves inadequate". The kernel should run **natively in the daemon** (OCCT WASM is 1.1x to 3x slower than native and WebKit-based webviews are still capped at 4 GB of wasm32 memory), with the taucad `libcascade` OCCT 8.0.1 WASM build reserved for the zero-install browser mode. Distribution must budget for Apple's USD 99/yr program and mandatory notarization (Homebrew stopped bypassing Gatekeeper for casks and ended support for casks that fail Gatekeeper on 1 Sep 2026), and for Windows signing via SignPath Foundation (free for OSS) or Azure Artifact Signing (USD 9.99/mo). A realistic installer budget is 60 to 120 MB, versus 211 to 341 MB for Zoo Design Studio (Electron) and 399 to 783 MB for FreeCAD. "Runs on any PC" should mean 64-bit x86_64 or arm64, 8 GB RAM, and any GPU that offers WebGL2/Vulkan 1.1/Metal, including Intel integrated graphics.

## 1. Desktop shell comparison

| Framework | Latest verified | License | Shell size (hello world) | GPU/WebGPU path | Native menus / file assoc. / multi-window | Verdict for Open3DJ |
|---|---|---|---|---|---|---|
| **Tauri 2.x** | 2.12 (26 Sep 2026); patch 2.12.5 (21 Oct 2026); MSRV 1.90; Windows 7 dropped | MIT/Apache-2.0 | 3 to 9 MB (blog measurements: 3.2 MB and 8.6 MB .app) | Uses OS webview: WebView2 (Win), WKWebView (macOS 10.15+), WebKitGTK 4.1 (Linux). WebGPU on Win and macOS 26+, none on Linux | Yes: menu API, `bundle.fileAssociations` (ext, mimeType, macOS role, Windows description), multi-window; bundles deb/rpm/appimage/msi/nsis/app/dmg | **Primary choice** |
| **Tauri 3 alpha + CEF runtime** | 3.0.0-alpha.5 (14 Oct 2026); `tauri-runtime-cef` crates since 13 Sep 2026 | MIT/Apache-2.0 | "hundreds of megabytes larger"; ~1 GB CEF download per platform at first build | Bundled Chromium (consistent WebGPU on Win/macOS). Linux: forces X11 (XWayland) and currently only exposes SwiftShader for WebGPU (issue #16203, open) | Same Tauri APIs; Windows sandbox currently unavailable; only en-US locale pack | Watch; Linux escape hatch once stable |
| **Electron** | 45.0.0 (21 Oct 2026): Chromium 156, Node 24.22, V8 15.6; Win 10+, macOS Ventura+, x64/arm64 on all three | MIT | 85 to 244 MB (blog measurements); Zoo Design Studio ships 211 to 341 MB installers | Bundled Chromium: WebGPU identical on all three OSes (Linux still gated by Chromium's GPU allowlist/flags) | Full; electron-builder/forge; electron-updater with blockmap differential updates | Fallback if Linux WebKitGTK is unacceptable |
| **Qt 6** | 6.11.3; 6.10 support ended 7 Oct 2026; LTS every 4th minor, 5-year LTS patches commercial-only | LGPL-3.0/GPL or commercial; Small Business EUR 546/yr (revenue <= EUR 1M) | 30 to 60 MB typical (not measured here) | Native RHI (Vulkan/Metal/D3D12); OCCT has a Qt viewer | Excellent native integration; no web-client code sharing | Only if abandoning web sharing (FreeCAD path) |
| **Slint** | 1.18.1 | GPL-3.0 OR Royalty-free (attribution, no embedded) OR commercial | Small (Rust) | Own renderer (Skia/FemtoVG), can host wgpu | Native-ish; smaller ecosystem | No web sharing of UI code; skip |
| **Flutter** | 3.47 (Impeller default on desktop per blogs); Canonical now lead maintainer of desktop at Google I/O 2026 | BSD-3 | 20 to 40 MB | Impeller (Metal/Vulkan); no WebGPU exposure for custom 3D | Multi-window still experimental | Skip for CAD |
| **egui / iced / Dioxus** | egui 0.37.0 (15 Oct 2026); iced 0.14.0; Dioxus 0.7.10 stable, 0.8.0-alpha.3 (16 Oct 2026) with experimental Blitz/WGPU native renderer | MIT/Apache-2.0 | Small | wgpu-native (egui-wgpu, iced wgpu); Dioxus Native is "experimental" | Immature desktop integration (menus, file associations vary) | Good for internal tools; not for the main UI |

Why Tauri over Electron: identical frontend code runs in the browser client, the shell adds single-digit MB, updates ship only your code (the webview is OS-provided), and the IPC is gated by declarative capabilities, permissions and scopes with CSP and an isolation pattern. The cost is three webviews with three feature sets; the biggest practical consequences are documented below (Linux GPU).

Maintenance burden: Tauri raises MSRV to "stable minus three"; wgpu breaks every ~3 months; three.js ships roughly quarterly with breaking changes (r184 16 Apr, r185 1 Jul, r186 24 Sep 2026); Electron ships a major every 8 weeks and supports 3 branches. An agent-first project benefits from Tauri's slower cadence plus a pinned three.js.

## 2. Rendering

### 2.1 WebGPU availability by webview (the decisive matrix)

- **Chromium / WebView2 (Windows)**: WebGPU shipped in Chrome 113 for Windows x86/x64, macOS and ChromeOS. Windows ARM64 is still behind `enable-unsafe-webgpu`. WebView2 "generally supports what the Microsoft Edge Chromium platform supports" (Microsoft, WebView2Feedback #1285); Tauri exposes `additionalBrowserArgs` (Windows only) if a flag is needed. Verify on the installed Evergreen runtime; no official "WebGPU on by default in WebView2" statement was found.
- **WKWebView (macOS)**: Safari 26.0 ships WebGPU by default on macOS Tahoe 26, iOS 26, iPadOS 26 and visionOS 26. Tauri maintainers confirmed (24 Nov 2025) it "should work out of the box" in WKWebView on macOS/iOS 26+; one user reported it working in production builds but not dev builds. macOS 13 to 15 users get WebGL2 only.
- **WebKitGTK (Linux)**: no WebGPU. WebKitGTK 2.54.0 (16 Sep 2026) switched the compositor to Skia and removed cairo but does not mention WebGPU; a 2023 WebKitGTK mailing list said nobody was working on it; Tauri maintainers (Jan 2025) said Tauri will not support it directly. Chrome on Linux only enables WebGPU for Intel Gen12+ (Chrome 144) and NVIDIA on Wayland with driver 535.183.01+ (Chrome 147); Firefox Linux is Nightly-only with shipping "expected in 2026".
- **Tauri's own Linux warning**: WebGL2 context creation can succeed on a software rasterizer with no error, WebKitGTK masks the renderer string as "Apple GPU", and the docs recommend "a non-WebGL fallback on Linux and a user-facing setting to switch renderers".

Conclusion: design the viewer for WebGL2 as the floor and WebGPU as an upgrade; never require WebGPU.

### 2.2 Renderer libraries

- **three.js r186 (MIT)**: `WebGPURenderer` is documented as "the new alternative of WebGLRenderer" that "falls back to a WebGL 2 backend" when WebGPU is unavailable, with a `forceWebGL` option. Third-party migration guides note that `ShaderMaterial`/`onBeforeCompile` are not supported under the node-based renderer and that r185 changed premultiplied alpha; React Three Fiber support was incomplete in early 2026. For a CAD viewer with custom edge/face shaders this means writing materials in TSL from day one.
- **Babylon.js 9.x (Apache-2.0)**: WebGPU since 5.0 (May 2022); 8.0 (Mar 2025) rewrote all shaders in WGSL; 9.0 (Mar 2026) added clustered and compute-based volumetric lighting; 9.27.1 on 18 Sep 2026. No automatic fallback: the app chooses the engine at async init. Strong alternative, heavier API surface.
- **wgpu 30.0.1 (22 Aug 2026, MIT/Apache-2.0)**: native Vulkan/Metal/D3D12/OpenGL plus WebGL2/WebGPU on wasm. Ideal for **headless rendering inside the Rust core** (thumbnails, agent previews, section images) without a browser.
- **Filament v1.79.0 (26 Oct 2026, Apache-2.0)**: PBR engine with Vulkan/Metal/WebGPU backends and a 1.87 MB web package; mature but C++-centric and not CAD-oriented.
- **xeokit (AGPL-3.0 or commercial via Creoox)**: double-precision renderer tuned for "hundreds of thousands of objects per frame", XKT format (49 MB IFC to 1.5 MB), multi-file manifests. AGPL is incompatible with an MIT client that must embed in proprietary agent hosts; use as a benchmark, not a dependency.
- **three-cad-viewer 3.5.1 (MIT)**: the CadQuery/build123d viewer; proves three.js is adequate for B-rep face/edge display, clipping and measurement, but it is a notebook widget rather than a production shell.
- **occt-import-js 0.0.23 (LGPL-2.1)**: STEP/BREP to mesh in WASM; fine as an importer in the browser mode.
- **OCCT in WASM**: the original `opencascade.js` 1.1.1 is six years old (OCCT 7.4). The maintained fork is taucad `libcascade` v3.0.3 (12 Oct 2026) on **OCCT 8.0.1**, LGPL-2.1 with the OCCT exception, single- and multi-threaded (pthread, needs COOP/COEP) builds, ~38 MB uncompressed wasm, 488 ms (ST) / 676 ms (MT) init on an M2 Pro. Note that 3dj.app runs OCCT 7.7.2 via opencascade.js/Replicad; Open3DJ can leapfrog to 8.0.1.

### 2.3 Performance ceilings for large assemblies

- taucad benchmarks (M2 Pro, pinned 2026-05-21): WASM vs native OCCT is 0.99x to 1.98x on fuse/fillet/loft/sweep, 3.16x on boolean fuse; multi-threading gives 1.24x overall (up to 3.46x on loft). Kernel-heavy work belongs in native code.
- wasm32 memory64: Chrome 133 and Firefox 134 ship memory64; Safari only in Technology Preview behind a flag. A WebKit-hosted WASM kernel is therefore limited to 4 GB, which is the practical ceiling for assemblies of a few thousand parts in-process.
- three.js draw-call strategy: `InstancedMesh` for repeated geometry (fasteners, lib.* parts), `BatchedMesh` for many distinct geometries sharing a material. Forum reports include a 12 M-triangle Revit model dropping to 10 FPS with BatchedMesh versus merged meshes, and BatchedMesh being slower on WebGPU than WebGL on some devices; pre-allocate buffer sizes rather than resizing. Treat these as anecdotes: the real ceiling must be measured on the target matrix (Iris Xe on WebGL2 in WebKitGTK is the worst case).
- xeokit's "hundreds of thousands of objects" figure is the right order of magnitude for a well-engineered WebGL2 CAD viewer; three.js can reach it with batching, ID-buffer picking and frustum/occlusion culling, but not with one `Mesh` per face.

### 2.4 Selection, measurement, section views

- **Picking**: use GPU ID-buffer picking (three.js `webgl_interactive_cubes_gpu` pattern): encode a face ID or edge ID per primitive in a picking render target, read one pixel on hover/click; cost is independent of scene size. Pair with a BVH raycast (three-mesh-bvh) for exact hit points, normals and snapping. B-rep face and edge IDs must be stable kernel-side (the same persistent-reference problem 3dj.app solves with `withReferences`), so the daemon should emit tessellation with per-face and per-edge index ranges plus stable IDs.
- **Measurement**: compute in the kernel (OCCT `BRepExtrema`, `GProp`), not from meshes, and return the same JSON to UI and agents. The UI only draws the overlay.
- **Section views**: three.js clipping planes (per-material `clippingPlanes`, stencil capping for solid cuts) for interactive viewing; true section geometry (`BRepAlgoAPI_Section`) from the kernel when agents need measurable sections.

## 3. Architecture patterns

1. **Single-process WASM kernel in the webview** (CADmium, Replicad/3dj.app browser workbench): zero install, works in the plain web client, but 1.1x to 3x slower, capped at 4 GB in WebKit, blocked by threads needing COOP/COEP, and invisible to CLI/agents unless duplicated. CADmium (truck kernel, SvelteKit, Tauri, Elastic License 2.0) was archived on 5 Sep 2025.
2. **Rust core + sidecar (Python/OCCT)**: the Plasticity pattern (Electron + native `c3d.node` addon around Parasolid) and the FreeCAD pattern (Qt + Python + OCCT). Fast and native, but a sidecar inside the GUI process is still only reachable by the GUI.
3. **Daemon with local HTTP/MCP server that UI, CLI and agents all talk to**: Zoo Design Studio is this pattern hosted remotely ("the 3D view is just a video stream from our hosted geometry engine", commands over WebSockets, engine "built for GPUs, primarily via Vulkan"); Blender MCP and FreeCAD MCP bolt it on as add-ons that open localhost sockets (9876, 9875) bridged by a stdio MCP process. The MCP spec (2025-06-18 and 2025-11-25) requires Origin validation (403 on invalid Origin), recommends binding to 127.0.0.1 and authentication for local Streamable HTTP servers because of DNS rebinding; rmcp (Rust SDK) had exactly that bug fixed in v1.4.0.

Pattern 3 is the one that makes Open3DJ "better for agents than anything that exists": a single `open3dj` binary that is simultaneously the CLI, the MCP server (stdio and Streamable HTTP on loopback with a per-install token), the REST/WebSocket API for the Tauri and web UIs, the headless exporter (STEP/STL/3MF/glTF) and the headless renderer (wgpu). The desktop app spawns it as a Tauri sidecar; the web client can either talk to a local daemon, to a hosted daemon (3dj.app as a provider), or fall back to the `libcascade` WASM build for zero-install use. Cloud GPUs (generative mesh, heavy booleans) are just another provider behind the same API.

## 4. Distribution

### 4.1 Signing and notarization

- **macOS**: Apple Developer Program USD 99/yr includes Developer ID and notarization. Homebrew removed `--no-quarantine` (issue #20755, closed 5 Nov 2025 via PR #20973) and planned to end support for casks that fail Gatekeeper on 1 Sep 2026; Acceptable Casks requires apps to pass Homebrew's Gatekeeper checks. Unnotarized macOS builds are effectively undistributable. macOS Tahoe 26 is the last release for Intel Macs; Blender 5.x already requires Apple Silicon. Ship a universal binary now, plan to drop x86_64 macOS by 2028.
- **Windows**: Microsoft's guidance (updated 29 Aug 2026): Azure Artifact Signing (formerly Trusted Signing) ~USD 9.99/month (Basic, 5,000 signatures/month), organizations in USA/Canada/EU/UK, individuals USA/Canada only; OV certificates USD 150 to 300/yr with mandatory HSM/token since June 2023; EV USD 400+ "no longer recommended" because the SmartScreen instant-reputation bypass was removed in 2024; Microsoft Store MSIX is re-signed by Microsoft for free with no SmartScreen prompts; **SignPath Foundation offers free OV-level signing for open-source projects**. Expect SmartScreen warnings for the first releases regardless; a 2026 Microsoft Q&A thread reports Artifact Signing intermediate-CA rotation causing repeated warnings since March 2026.
- **Linux**: no signing gate, but Tauri's updater signatures (minisign-style keys, "cannot be disabled") and GPG-signed deb/rpm repos are expected by distros.

### 4.2 Channels

- **Direct (GitHub Releases)**: Tauri emits NSIS `.exe`, `.msi`, `.app`/`.dmg`, AppImage, `.deb`, `.rpm`. Updater artifacts: NSIS/MSI `.sig`, `.app.tar.gz` `.sig`, AppImage `.sig`; deb/rpm/Flatpak/Snap are not auto-updated by the plugin (rely on the package manager). Updater manifests can be static JSON on GitHub Releases or a dynamic endpoint (`{{target}}`, `{{arch}}`, `{{current_version}}`); Windows installs passively by default.
- **winget**: PR to `microsoft/winget-pkgs`, automated validation plus moderator review; installer must be silent-capable, hash-pinned, served from the publisher's own domain over HTTPS, and pass multi-AV scans.
- **Microsoft Store**: Tauri can only submit EXE/MSI (no MSIX); must embed the WebView2 offline installer, must install silently, must be signed, and must still use the Tauri updater.
- **Homebrew cask**: requires notarization (above) plus notability; a third-party submission bar is lower than self-submission (community reports: 75 stars vs 225 stars/90 forks; not official text).
- **Flathub**: reverse-DNS ID (`io.github.neuraldeepnet.Open3DJ` is verifiable without a domain), minimal static permissions, portals mandatory when they exist, offline from-source builds (generate `cargo-sources.json`/`node-sources.json`), no prebuilt binaries, and "simple web wrapper" apps are rejected (a CAD app is not one, but the reviewer will ask). Tauri's guide uses `org.gnome.Platform` 47 with `--socket=wayland --socket=fallback-x11 --device=dri --share=ipc`. OrcaSlicer recommends Flathub as its Linux channel; Bambu Studio's Flatpak is community-maintained.
- **Snap**: Tauri guide uses `core22`, strict confinement, the `gnome` extension (desktop/opengl/wayland/x11) and binds `webkit2gtk-4.1`. Blender is on the Snap Store; most CAD projects prioritize Flathub.
- **AppImage**: Ubuntu 22.10+ lacks `libfuse2`; on 24.04 the package is `libfuse2t64`, and 24.04's AppArmor user-namespace restriction breaks Electron/CEF sandboxes inside AppImages (Tauri's CEF docs say AppImages "can lose the sandbox" on Ubuntu 23.10+). Use a static type-2 runtime that bundles FUSE, and still ship deb/rpm/Flatpak.
- **Flatpak + NVIDIA**: the `org.freedesktop.Platform.GL.nvidia-<version>` extension must match the host driver; users report "OpenGL error after every driver update" and apps that fail to launch on legacy 390.x drivers. Detect and explain this in-app.

### 4.3 Linux GPU driver pitfalls (WebKitGTK)

Tauri's Linux graphics page lists, in order: `nvidia_drm.modeset=1` (drivers < 545), `__NV_DISABLE_EXPLICIT_SYNC=1` (fixes Wayland "Error 71" with no perf cost), `WEBKIT_DISABLE_DMABUF_RENDERER=1` (fixes blank/white windows, loses the fast path), `WEBKIT_DISABLE_COMPOSITING_MODE=1` (last resort). Shipping an unconditional override "disables the faster path for all users"; projects such as Cline gate it on the NVIDIA kernel module being loaded and honor an explicit user `=0`. One Mesa/AMD/Wayland project found the DMA-BUF flag breaks canvas rasterization. This is the single strongest argument for the CEF/Electron escape hatch on Linux.

### 4.4 Installer size budgets (verified release assets)

| App (stack) | Windows | macOS | Linux |
|---|---|---|---|
| Dune3D 1.4.0 (C++/GTK4/OCCT) | 40.4 MB MSI | none | Flathub |
| OrcaSlicer 2.4.2 (wxWidgets/OpenGL/ImGui) | 131 MB x64, 119 MB arm64 | 235 MB universal | 131 MB AppImage, 125 MB Flatpak, aarch64 builds |
| Zoo Design Studio 1.5.2 (Electron 40, three 0.184) | 341 MB | 296 MB universal dmg | 211 MB AppImage (x86_64 and arm64) |
| Bambu Studio 2.8.2 | 409 MB exe | 275 MB | 219 MB AppImage |
| Blender 5.2.3 LTS | 349 MB x64, 227 MB ARM | 330 MB (Apple Silicon only) | 367 MB tar.xz |
| FreeCAD 1.1.4 (Qt/Python/OCCT) | 495 MB installer | 620 MB arm64, 687 MB x86_64 | 783 MB x86_64, 721 MB aarch64 AppImage |

Budget for Open3DJ: shell 5 to 10 MB, core daemon with native OCCT 40 to 60 MB, optional WASM kernel ~38 MB uncompressed (download on demand), so **60 to 120 MB per platform**, roughly Dune3D-to-OrcaSlicer class and one third of Zoo. Memory: blog measurements put a six-window Tauri app at ~172 MB versus ~409 MB for Electron.

## 5. How peers ship

- **Zoo Design Studio** (MIT, KittyCAD/modeling-app): Electron `^40.8.5`, electron-builder `^26.11.1`, Electron Forge 7.11, electron-updater `^6.8.9` with blockmaps, React 19.2, Vite 7, three `^0.184`, Rust KCL compiled to WASM, Windows codesign and notarize scripts in CI. Geometry and rendering happen on Zoo's Vulkan engine and arrive as video; there is no local engine, so it is offline-incapable by design. Open3DJ's local-first daemon is the direct counter-position.
- **Plasticity 2026.2** (proprietary, Parasolid + HOOPS Exchange): Electron with a native Node addon (`c3d.node` via node-gyp in the public scaffold; AUR packagers report bundled Electron 26); ships Windows 10+ MSI, macOS 12+ zips for Intel and Apple Silicon, Ubuntu 22.04+ `.deb`. Proof that an Electron shell plus a native kernel addon can be a professional CAD product.
- **Dune3D 1.4.0** (28 Jan 2026): C++, GTK4, OCCT, SolveSpace solver; Windows MSI 40 MB, Flathub, AUR; no macOS. Smallest footprint in the set.
- **CADmium**: Rust truck kernel to WASM, SvelteKit, three.js/Threlte, Tauri; Elastic License 2.0; archived 5 Sep 2025. Cautionary tale for building a new B-rep kernel.
- **MatterCAD** (MatterHackers): free proprietary modeling app for Windows and macOS (C#/.NET lineage), Pro tier with cloud sync; not a stack reference.
- **FreeCAD 1.1** (24 Mar 2026; 1.1.4 current): Qt/PySide, Python 3.11, OCCT; Windows installer and portable, separate Intel and Apple Silicon dmgs, x86_64 and aarch64 AppImages, Flathub; the heaviest downloads in the comparison.
- **Blender 5.2.3 LTS** (22 Oct 2026): direct download, Steam, Microsoft Store, Snap; Windows ARM native build; minimum 8 GB RAM, 2 GB VRAM, OpenGL 4.3 and Vulkan 1.3, GeForce 900+/GCN 4+/Kaby Lake+. Blender 5.0 kept OpenGL as default because "OpenGL drivers are able to offload GPU memory to CPU RAM, while Vulkan doesn't"; 5.3 beta makes Vulkan default on Windows (not ARM) and Linux with the minimum lowered to Vulkan 1.1. The lesson for a wgpu-based headless renderer: keep a GL/software fallback for low-VRAM machines.
- **Bambu Studio 2.8.2 / OrcaSlicer 2.4.2**: PrusaSlicer lineage (wxWidgets, OpenGL, Dear ImGui, Boost, CGAL); Orca ships native Windows ARM64, universal macOS, Ubuntu 24.04 AppImages for x86_64 and aarch64, Flatpak, and a Microsoft Store (MSIX) listing. Orca is the best model for a complete channel matrix.

## 6. Hardware baseline

Steam Hardware Survey, September 2026: Windows 95.03% (Win11 71.34%, Win10 23.61%), macOS 1.92%, Linux 3.05%; RAM 32 GB 42.22%, 16 GB 37.82%, 8 GB 6.47%; VRAM 16 GB 27.21%, 8 GB 26.71%, 4 GB 5.13%; integrated GPUs appear at Intel Iris Xe 1.50%, AMD Radeon Graphics 1.43%, Intel UHD 1.01%; 8-core CPUs 30.06%, 6-core 27.23%, 4-core 10.79%. Steam over-represents gaming hardware; engineering laptops skew toward Iris Xe/UHD and 16 GB. Windows on Arm is about 3.2% of laptops in 2026 (TrendForce estimate), Chrome's WebGPU is still flag-gated on Windows ARM64, and Blender 5.3 keeps OpenGL on Windows ARM. Apple: macOS 26 is the last Intel release.

Recommended definition of "runs on any PC":

- Minimum: 64-bit x86_64 or arm64 CPU with 4 cores; 8 GB RAM; any GPU with WebGL2 and Vulkan 1.1 (Windows/Linux) or Metal (macOS 13+), including Intel UHD 620 and newer; Windows 10 1803+, macOS 13+, glibc 2.28+ Linux with WebKitGTK 4.1.
- Recommended: 16 GB RAM, 4 GB VRAM, WebGPU-capable browser or webview (WebView2, macOS 26) for the WebGPU path.
- Cloud: generative mesh, large booleans and batch exports offload to configured providers (3dj.app, self-hosted daemon on a GPU box) through the same API; no feature should be cloud-only except GPU-native generation.
- Ship native builds for Windows x64 and ARM64, macOS universal, Linux x86_64 and aarch64 (Tauri supports aarch64-pc-windows-msvc; Electron ships arm64 on all three).

## 7. Recommendations for Open3DJ

1. **Shell**: Tauri 2.12 with a React or Svelte UI shared verbatim with the web client; keep the renderer and UI free of Tauri-specific APIs behind a thin "host" interface so the same bundle runs in a browser against a remote daemon. Track Tauri 3's CEF runtime for Linux; if Linux WebGL2-in-WebKitGTK fails the performance bar, ship a CEF or Electron build for Linux only.
2. **Renderer**: three.js r186 `WebGPURenderer` with TSL materials, `forceWebGL` on Linux WebKitGTK and a user-visible renderer switch; `InstancedMesh`/`BatchedMesh` batching; GPU ID-buffer picking with stable face/edge IDs from the kernel; BVH raycasts for snapping and measurement; clipping-plane sections in the viewer and kernel sections for agents. Add a wgpu headless renderer in the core for PNG previews that agents can request without a GUI.
3. **Core**: one Rust daemon (`open3dj`) hosting native OCCT 8.x (via a sidecar or FFI), exposing MCP (stdio and Streamable HTTP on 127.0.0.1 with Origin/Host validation and a per-install bearer token), a REST/WebSocket API and headless export. Reuse the taucad `libcascade` WASM build only for the zero-install browser mode and keep the two kernels API-identical. Avoid a new B-rep kernel.
4. **Security**: Tauri capabilities per window, strict CSP, isolation pattern; the daemon never binds 0.0.0.0 by default; agent scripts run in the daemon's sandbox (isolated engine, as 3dj.app does for OpenSCAD), not in the webview.
5. **Distribution**: GitHub Releases as the source of truth with Tauri updater signatures; winget, Homebrew cask (after notarization), Flathub (`io.github.neuraldeepnet.Open3DJ`), AUR, deb/rpm repo, Microsoft Store EXE with offline WebView2; Snap later. Apply to SignPath Foundation for Windows signing and budget USD 99/yr for Apple; expect SmartScreen warnings for the first months and document them.
6. **Linux hardening**: detect NVIDIA and apply `__NV_DISABLE_EXPLICIT_SYNC=1` then `WEBKIT_DISABLE_DMABUF_RENDERER=1` only when the module is present and the user has not overridden; probe WebGL2 for software rendering (frame-time test, not the masked renderer string) and offer the fallback; document Flatpak NVIDIA extension matching and `libfuse2t64`.
7. **Size and hardware targets**: 60 to 120 MB installers, 8 GB RAM minimum, no WebGPU requirement, native arm64 builds everywhere.

## Open questions (not verified in this pass)

- Whether current WebView2 Evergreen runtimes expose `navigator.gpu` without `--enable-unsafe-webgpu` (Microsoft states WebView2 follows Edge; no explicit statement found).
- Velopack as an updater alternative (no sources retrieved).
- Dune3D's license (believed GPL-3.0; not checked).
- Plasticity's current bundled Electron version (AUR comment says 26; the public scaffold still lists `^17`).
- Snap-specific GPU confinement issues for CAD apps (no sources retrieved).

## Sources

- Tauri 2.12 announcement: https://v2.tauri.app/blog/tauri-2.12/
- Tauri releases (2.12.5, 3.0.0-alpha.5): https://github.com/tauri-apps/tauri/releases
- Tauri 3 CEF runtime docs: https://v3.tauri.app/develop/cef/
- tauri-runtime-cef crate: https://crates.io/crates/tauri-runtime-cef/versions
- Tauri CEF Linux WebGPU/SwiftShader issue #16203: https://github.com/tauri-apps/tauri/issues/16203
- Tauri WebGPU issue #6381: https://github.com/tauri-apps/tauri/issues/6381
- Tauri Linux graphics issues: https://v2.tauri.app/develop/debug/linux-graphics/
- Tauri prerequisites (webviews, OS, arch): https://v2.tauri.app/start/prerequisites/
- Tauri config reference (fileAssociations, targets): https://v2.tauri.app/reference/config/
- Tauri security model: https://v2.tauri.app/security/
- Tauri updater plugin: https://v2.tauri.app/plugin/updater/
- Tauri distribution overview: https://v2.tauri.app/distribute/
- Tauri Flatpak guide: https://v2.tauri.app/distribute/flatpak/
- Tauri Snapcraft guide: https://v2.tauri.app/distribute/snapcraft/
- Tauri Microsoft Store guide: https://v2.tauri.app/distribute/microsoft-store/
- Electron 45 release blog: https://www.electronjs.org/blog/electron-45-0
- Electron platform support (v45 README): https://raw.githubusercontent.com/electron/electron/v45.0.0/README.md
- Electron releases: https://releases.electronjs.org/
- Tauri vs Electron measurements (Hopp): https://www.gethopp.app/blog/tauri-vs-electron
- Tauri vs Electron 2026 (blog, hello-world sizes): https://tech-insider.org/tauri-vs-electron-desktop-app-framework-2026/
- Qt releases and support: https://doc.qt.io/qt-6/qt-releases.html
- Qt for Small Business pricing: https://www.qt.io/qt-for-small-business
- Slint licensing: https://slint.dev/pricing and https://crates.io/crates/slint
- Flutter 3.47 / Impeller desktop (secondary): https://alternativeto.net/news/2026/8/flutter-3-47-introduces-standalone-ui-packages-and-impeller-for-desktop/
- Flutter desktop stewardship by Canonical (secondary): https://www.monterail.com/blog/flutter-development-trends
- egui 0.37.0: https://docs.rs/crate/egui/latest
- iced 0.14.0: https://github.com/iced-rs/iced/releases
- Dioxus 0.7 / Blitz: https://dioxuslabs.com/blog/release-070/ and https://lib.rs/crates/dioxus-native
- WebGPU implementation status (gpuweb wiki): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- WebKit features in Safari 26.0 (WebGPU): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKitGTK 2.54.0 release notes: https://webkitgtk.org/2026/09/16/webkitgtk2.54.0-released.html
- WebKitGTK release list: https://webkitgtk.org/news.html
- WebKitGTK WebGPU status note (xjmusic issue, cites 2023 webkit-gtk list): https://github.com/xjmusic/xjmusic/issues/576
- WebView2 WebGPU feedback issue: https://github.com/MicrosoftEdge/WebView2Feedback/issues/1285
- three.js releases (r186): https://github.com/mrdoob/three.js/releases
- three.js WebGPURenderer source/JSDoc: https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgpu/WebGPURenderer.js
- three.js WebGPU migration notes (secondary): https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- three.js GPU picking example: https://threejs.org/examples/webgl_interactive_cubes_gpu.html
- BatchedMesh performance reports: https://discourse.threejs.org/t/significant-performance-drop-and-high-cpu-usage-with-batchedmesh/67324 and https://github.com/mrdoob/three.js/issues/29580
- Babylon.js WebGPU support: https://doc.babylonjs.com/setup/support/webGPU
- Babylon.js 8.0 announcement: https://blogs.windows.com/windowsdeveloper/2025/03/27/announcing-babylon-js-8-0/
- wgpu 30.0.1: https://docs.rs/crate/wgpu/latest
- Filament releases: https://github.com/google/filament/releases and license https://raw.githubusercontent.com/google/filament/main/LICENSE
- xeokit SDK (AGPL-3.0): https://github.com/xeokit/xeokit-sdk and https://xeokit.io/
- three-cad-viewer: https://www.npmjs.com/package/three-cad-viewer
- occt-import-js: https://www.npmjs.com/package/occt-import-js
- opencascade.js original (1.1.1, OCCT 7.4): https://www.npmjs.com/package/opencascade.js
- taucad libcascade (OCCT 8.0.1): https://github.com/taucad/opencascade.js and release https://github.com/taucad/opencascade.js/releases/tag/v3.0.3
- taucad benchmarks (WASM vs native, sizes): https://github.com/taucad/opencascade.js/blob/main/BENCHMARKS.md
- WebAssembly feature support (memory64 etc.): https://raw.githubusercontent.com/WebAssembly/website/main/features.json
- MCP transports and localhost security: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports.md and https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- rmcp DNS-rebinding advisory: https://osv.dev/vulnerability/GHSA-89vp-x53w-74fx
- Blender MCP: https://mcp.so/servers/blender-mcp ; FreeCAD MCP: https://mcp.so/servers/freecad_mcp
- Zoo Design Studio package.json: https://raw.githubusercontent.com/KittyCAD/modeling-app/main/package.json
- Zoo Design Studio README and releases: https://github.com/KittyCAD/modeling-app and https://github.com/KittyCAD/modeling-app/releases/expanded_assets/v1.5.2
- Zoo Design Studio v1 architecture blog: https://zoo.dev/blog/zoo-design-studio-v1
- Plasticity 2026.2 coverage: https://www.cgchannel.com/2026/10/plasticity-2026-2-is-out/
- Plasticity download page: https://www.plasticity.xyz/download
- Plasticity public scaffold package.json: https://raw.githubusercontent.com/nkallen/plasticity/master/package.json
- Plasticity AUR (Electron 26 comment): https://aur.archlinux.org/packages/plasticity-bin
- Dune3D 1.4.0 release and install docs: https://github.com/dune3d/dune3d/releases/tag/v1.4.0 and https://docs.dune3d.org/en/latest/installation.html
- Dune3D FOSDEM 2026 talk: https://fosdem.org/2026/schedule/event/UUVWPM-dune_3d_-_2_12_years_in_the_3rd_dimension/
- CADmium repository (archived, Elastic License 2.0): https://github.com/CADmium-Co/CADmium
- MatterCAD: https://www.matterhackers.com/store/l/mattercad-3d-design-software/sk/MQ9XJDK9
- FreeCAD 1.1 release page: https://freecad.github.io/Website/download/releases/1-1/
- FreeCAD 1.1.4 assets: https://github.com/FreeCAD/FreeCAD/releases/expanded_assets/1.1.4
- FreeCAD on Flathub: https://flathub.org/en/apps/org.freecad.FreeCAD
- Blender download page (channels, sizes): https://www.blender.org/download/
- Blender requirements: https://www.blender.org/download/requirements/
- Blender 5.3 Vulkan default notes: https://developer.blender.org/docs/release_notes/5.3/eevee/
- Blender 5.0 OpenGL default rationale (Phoronix): https://www.phoronix.com/news/Blender-5.0-Vulkan-OpenGL-RAM
- Bambu Studio releases: https://github.com/bambulab/BambuStudio/releases/expanded_assets/v02.08.02.61
- OrcaSlicer releases and site: https://github.com/OrcaSlicer/OrcaSlicer/releases/expanded_assets/v2.4.2 and https://www.orcaslicer.com/download/
- OrcaSlicer stack (DeepWiki, secondary): https://deepwiki.com/SoftFever/OrcaSlicer
- Apple Developer Program (USD 99/yr, Developer ID, notarization): https://developer.apple.com/programs/
- macOS Tahoe last Intel release: https://en.wikipedia.org/wiki/MacOS_Tahoe
- Homebrew --no-quarantine removal and Gatekeeper deadline: https://github.com/Homebrew/brew/issues/20755
- Homebrew Acceptable Casks: https://docs.brew.sh/Acceptable-Casks
- Microsoft code signing options (Artifact Signing pricing, EV change, SignPath): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Artifact Signing SmartScreen warnings 2026 (Q&A): https://learn.microsoft.com/en-sg/answers/questions/5929307/artifact-signing-account-is-giving-smartscreen-at
- SignPath Foundation: https://signpath.org/
- winget submission process: https://learn.microsoft.com/en-us/windows/package-manager/package/repository
- Flathub requirements: https://docs.flathub.org/docs/for-app-authors/requirements
- AppImage FUSE on Ubuntu 24.04: https://docs.appimage.org/user-guide/troubleshooting/fuse.html and https://itsfoss.com/cant-run-appimage-ubuntu/
- Flatpak NVIDIA extension issues: https://github.com/flathub/org.freedesktop.Platform.GL.nvidia/issues/211 and https://discussion.fedoraproject.org/t/nvidia-flatpak-opengl-error-after-every-driver-update/182197
- NVIDIA DMA-BUF workaround in shipped apps: https://github.com/cline/cline/pull/14687 and https://github.com/phsb5321/Tauri-PDF-Reader/pull/238
- Steam Hardware Survey (September 2026): https://store.steampowered.com/hwsurvey
- Windows on Arm share (TrendForce via ITdaily): https://itdaily.com/blogs/workplace/qualcomm-snapdragon-x-pc-windows-on-arm/
- Chrome WebGPU on Linux (secondary): https://app.cinevva.com/guides/webgl-webgpu-not-supported-fix
