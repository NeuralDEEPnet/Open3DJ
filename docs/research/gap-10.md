# Gap 10: Blender integration (MCP servers, licences, importer behaviour)

Checked 31 Oct 2026 against the Blender Lab MCP source, issues and releases (the projects.blender.org Gitea API), the mcp-for-blender repository and PyPI, NVD and GitHub advisories, Blender's licence page, FAQ, manual and Extensions terms, and Blender's glTF importer source at tag v5.2.3. Nothing was installed or run. Where this note and [landscape-ai-cad.md](landscape-ai-cad.md), [ux-human-agent-collab.md](ux-human-agent-collab.md), [agent-protocols-and-tool-design.md](agent-protocols-and-tool-design.md), [community-licensing-business.md](community-licensing-business.md), [gap-7.md](gap-7.md) or [proposals/proposal-agent-first.md](proposals/proposal-agent-first.md) disagree, this note wins. The plan that uses it is [BLENDER.md](../BLENDER.md).

## Bottom line

| Claim (file, line) | Verdict | Correction |
|---|---|---|
| Plasticity has "No scripting API, AI or MCP" (landscape-ai-cad.md, 47) | **Half right** | No official API, but Plasticity runs a local WebSocket server (default `localhost:8980`) that its MIT Blender add-on 2.2.1 talks to. The handshake carries no token [10] |
| Blender Lab MCP v1.0.3 with 26 tools (landscape-ai-cad.md, 63) | Correct, incomplete | Released 11 Sep 2026. GPL-3.0-or-later. stdio to the client, plus a TCP bridge on localhost:9876 with no authentication that starts on its own when Online Access is on, plus an optional HTTP mode with CORS open to every origin [1] [2] |
| mcp-for-blender "32.5k stars", `generate_3d` (Hyper3D Rodin) (landscape-ai-cad.md, 63) | Outdated | 32,895 stars on 31 Oct 2026. `generate_3d` covers Tripo, Hunyuan3D, Hyper3D Rodin and Meshy [4] |
| "Mesh only, no STEP" (landscape-ai-cad.md, 63) | Needs a qualifier | Blender has no STEP importer, but GPL-3.0-or-later add-ons read STEP: STEP Importer 1.2.1 and STEPper Reborn 2.3.0, both for Blender 5.1+ [9] |
| "FreeCAD/Blender MCPs need the GUI open" (landscape-ai-cad.md, 101) | **Wrong for the Lab server** | It serves from `blender --online-mode file.blend --command blender_mcp`, and six `_for_cli` tools start a background Blender themselves. mcp-for-blender's add-on does refuse `blender -b` [2] [4] [20] |
| "four 2026 CVEs" with no ids (landscape-ai-cad.md, 104) | Correct, no ids | CVE-2026-10661, CVE-2026-10662 and CVE-2026-10688 (no fixed version) and CVE-2026-66004 (fixed in blender-mcp 1.6.5). All four are against the community server; NVD lists none against the Lab server [5] |
| One "Blender MCP" with no guards and an unauthenticated socket, cited to the Lab page (proposals/proposal-agent-first.md, 263) | Citation incomplete | "Without any guards" is the Lab page's own warning [3]. Both servers' bridges on port 9876 do lack authentication, but the Lab page does not say so. The mcp-for-blender README says so [4]; the Lab source has no authentication code (found by grep, not a full read) [2] |
| Blender add-ons "must be GPL-compatible" (community-licensing-business.md, 55 and 95) | **Outdated wording** | Blender now says GPL: "the same license (GPL)" on its licence page, and "made available licensed as GNU GPL as well" in its FAQ since an edit on 16 Aug 2024. extensions.blender.org requires GPL-3.0-or-later [7] |
| `ahujasid/blender-mcp` (ux-human-agent-collab.md, 25; agent-protocols-and-tool-design.md, 202) | Old name | The repository is `ahujasid/mcp-for-blender`; the old URL redirects [4] |
| "renamed from `blender-mcp` on 16 Sep" (gap-7.md, 9) | Imprecise | `mcp-for-blender` first appeared on PyPI as 1.9.0 on 1 Sep 2026. On 16 Sep 2026 the rename was announced (issue #366) and `blender-mcp` 2.0.0 became a wrapper that installs `mcp-for-blender` [4] |
| Keep "Blender add-on code out of the core process" (landscape-ai-cad.md, 134) | Correct, incomplete | Blender asks that published `bpy` code be shared under the GPL, so any `bpy` code Open3DJ writes also needs a licence decision. The founder decided on 31 Oct 2026: a separate repository under GPL-3.0-or-later, never this one. (The VRM add-on shows the other option, an `MIT OR GPL-3.0-or-later` folder.) An add-on that needs Open3DJ installed is unlikely to be listed on extensions.blender.org (terms 5.2) [7] [8] |

## 1. Blender Lab's MCP server

- Releases: v1.0.0 "Initial release" on 27 Apr 2026, v1.0.2 "MCP SDK Fix" on 8 Sep 2026, v1.0.3 "Screenshot Fix" on 11 Sep 2026, with `blender-1.0.3.mcpb` and `mcp-1.0.3.zip` [1]. The `main` branch does not rebuild v1.0.3: its server says 1.0.2 and its add-on 1.0.0, and the 5.2 docs commit sits outside the tag. Pin the tag [1] [2].
- Needs Blender 5.1 or newer (manifest `blender_version_min = "5.1.0"`) [2]. Anthropic's connector tutorial says "Blender 4.2 or later" instead [12]. No test or statement covers Blender 5.3.
- 26 tools: 2 code execution, 10 blend-file summaries, 2 object summaries, 3 screenshots, 4 navigation, 2 renders to a path, 3 doc searches; six have `_for_cli` twins. No tool imports a file: an import goes through `execute_blender_code` [2].
- The bridge can also run without the user interface: `blender --online-mode file.blend --command blender_mcp` serves every call from one background Blender process, on the add-on's default host and port (localhost:9876) unless `--host` and `--port` are given. It rejects deferred responses, and the screenshot tools do not work there. The Blender manual says `--command` implies background mode and takes every argument after it, so `--online-mode` comes first [20].
- The bridge refuses to start unless Blender's Online Access is on, and starts on its own by default. It has no token and no TLS and sets `SO_REUSEADDR`. `--transport http` serves stateless HTTP on 127.0.0.1:8000 with DNS-rebinding protection off and CORS open to every origin [2]. Whether a web page can exploit that mode is inferred from source, not tested.
- The page warns that the server runs LLM code "without any guards"; `weak_sandbox.py` calls itself "more of a slap on the wrist" [2] [3].
- Open user reports, not reproduced: `_for_cli` hangs on Windows (#42, #58, #60), silent failure when Online Access is off (#45), thumbnail settings restored too early (#46, #61), `result` must be a dict (#64), no add-on and server version check (#10), render settings that can leak into a user's file (#12) [11].
- `render_thumbnail_to_path` still tests the EEVEE id `BLENDER_EEVEE_NEXT`, which Blender 5.0 renamed to `BLENDER_EEVEE` [2] [13].
- `pip install blender-mcp` and `uvx blender-mcp` install the community server. Blender Lab said on 11 Sep 2026 that it will not rename its project (issue #34) [4] [11].

## 2. mcp-for-blender (community)

- MIT, 32,895 stars and 2,978 forks on 31 Oct 2026; `mcp-for-blender` 2.2.6 on PyPI (28 Oct 2026); minimum Blender 3.0; "Not affiliated with the official Blender Foundation" [4].
- Nine model-facing tools (among them `execute_blender_code`, `look`, `generate_3d`, `search_assets`, `import_asset`), five app-only viewport tools and `blender://` resources [4].
- Port 9876 with "no authentication or encryption" (README). `BLENDER_MCP_SAFE_MODE=1` guards the MCP path only; its own docstring says the socket still accepts raw code from any local process. Issue #404 (21 Oct 2026, open) reports exactly that [4].
- An anonymous usage record is sent by default; `DISABLE_TELEMETRY=true` turns it off [4].
- The add-on refuses to run under `blender -b` (pull request #272, merged 11 Jun 2026) [4].
- Pull request #237 (merged 4 Jun 2026) removed hidden steering text from two tool descriptions [4].
- CVE-2026-10661 (`input_image_url`), CVE-2026-10662 (SSRF through `zip_file_url`) and CVE-2026-10688 (`execute_blender_code`) were published on 2 Jun 2026, are rated CVSS 3.1 4.3, 6.3 and 5.5, and name no fixed version. Their cited patch commit is in a fork, and the upstream fix (pull request #205) was closed without merging. CVE-2026-66004 (path traversal in the Poly Haven download, CVSS 4.0 6.0) is fixed in `blender-mcp` 1.6.5 [5].
- On Windows, `SO_REUSEADDR` lets a second socket take a port that is already in use, and both add-ons set it on 9876 [2] [4] [6].

## 3. Blender itself

- Blender 5.2.3 LTS was released on 22 Oct 2026; 5.3 is expected on 10 Nov 2026. Official builds: Windows x64 and ARM64, macOS Apple Silicon (macOS 13+), Linux x64 [14].
- NVD lists CVE-2026-119718 to CVE-2026-119722 for "Blender before 4.5.15 and 5.x before 5.2.3": flaws in the point-cache, thumbnail and .blend readers. 119718, 119719 and 119722 are rated CVSS 3.1 7.8. All five were published on 30 Oct 2026 by VulnCheck and await NVD analysis [15].
- The glTF importer (add-on 5.2.41) turns node, mesh and material extras into custom properties; imports nodes that share a mesh as linked duplicates; makes new objects, meshes and materials on every import; clears the scene's variant list when a file has variants; names each `EXT_mesh_gpu_instancing` instance object after its mesh, with no extras; and defaults `merge_vertices` to off and `import_scene_extras` to on [13].
- Blender has no built-in MCP or LLM features. The Lab page says "Blender does not have any built-in functionality for connecting to LLMs" [3]. The Blender Foundation said on 1 May 2026 that "No generative AI functionality is currently available or planned to be integrated in Blender" [16].

## 4. Licences

- Blender's licence page asks that published scripts using the Python API be "shared under a GPL compliant license" and says customers get them "under the same license (GPL)". The FAQ, edited on 16 Aug 2024 to remove "confusing wording about GPL compatibility", says such scripts "have to be made available licensed as GNU GPL as well" [7].
- The same FAQ gives "full freedom to license" to a program that runs outside Blender, uses no Blender source or API calls, produces data for Blender and runs Blender to read it [7].
- extensions.blender.org: add-ons must be GPL-3.0-or-later (terms 1.1), and "should not require any external functional components (other than Blender itself) that need to be downloaded from elsewhere" (terms 5.2). On 31 Aug 2026 a moderator told the Kinema author that depending on third-party software "is not allowed per our terms of service" and that the platform can "only host extensions that are entirely self-contained". Dual listings with MIT are accepted in practice (VRM; rendersynth on 27 Jul 2026; kinema on 8 Oct 2026) [7] [8].
- The FSF's GPL FAQ asks only that a program using a GPL interpreter's bindings be "released in a GPL-compatible way". ARCHITECTURE.md section 11 said "GPL-compatible licence; MIT qualifies", which fits the FSF's reading but not Blender's; it was corrected on 31 Oct 2026, and any `bpy` code now lives in its own GPL-3.0-or-later repository [7] [17].

## 5. Precedents for a CAD-to-Blender link

- Plasticity: an MIT Blender client (2.2.1) of a WebSocket server in Plasticity on `localhost:8980`; each object keeps `plasticity_id`, so materials and modifiers survive a refresh; edit-mode data is overwritten [10].
- The open Fusion to Blender bridge (GPL-3.0-or-later, 1.0.0 on 17 Aug 2026) connects only to 127.0.0.1:9080; Blender materials survive a re-sync, and are lost when a body is recreated with a new id [18].
- IfcOpenShell's IfcMCP (LGPL-3.0-or-later) is an MCP server that works on IFC files directly, with Blender optional [19].

## Sources (all checked 31 Oct 2026)

1. Blender Lab MCP releases: https://projects.blender.org/api/v1/repos/lab/blender_mcp/releases ; repository metadata: https://projects.blender.org/api/v1/repos/lab/blender_mcp
2. Blender Lab MCP source: https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/LICENSE?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/readme_tools.rst?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/mcp/blmcp/__init__.py?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/addon/blender_mcp_addon/__init__.py?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/addon/blender_mcp_addon/mcp_to_blender_server.py?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/addon/blender_mcp_addon/blender_manifest.toml?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/addon/blender_mcp_addon/weak_sandbox.py?ref=main , https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/mcp/blmcp/tools/render_thumbnail_to_path_toolcode.py?ref=main
3. Blender Lab MCP page: https://www.blender.org/lab/mcp-server/
4. mcp-for-blender: https://github.com/ahujasid/mcp-for-blender , https://github.com/ahujasid/mcp-for-blender/blob/main/src/blender_mcp/server.py , https://github.com/ahujasid/mcp-for-blender/blob/main/src/blender_mcp/safe_mode.py , https://raw.githubusercontent.com/ahujasid/mcp-for-blender/main/addon.py , https://github.com/ahujasid/mcp-for-blender/issues/404 , https://github.com/ahujasid/mcp-for-blender/issues/366 , https://github.com/ahujasid/mcp-for-blender/pull/272 , https://github.com/ahujasid/mcp-for-blender/pull/237 , https://github.com/ahujasid/mcp-for-blender/pull/205 ; PyPI: https://pypi.org/pypi/mcp-for-blender/json , https://pypi.org/pypi/blender-mcp/json
5. Community server CVEs: https://nvd.nist.gov/vuln/detail/CVE-2026-10661 , https://nvd.nist.gov/vuln/detail/CVE-2026-10662 , https://nvd.nist.gov/vuln/detail/CVE-2026-10688 , https://nvd.nist.gov/vuln/detail/CVE-2026-66004 , https://github.com/advisories/GHSA-4h8q-hh2j-755w
6. `SO_REUSEADDR` on Windows: https://learn.microsoft.com/en-us/windows/win32/winsock/using-so-reuseaddr-and-so-exclusiveaddruse
7. Blender licence page: https://www.blender.org/about/license/ ; FAQ: https://www.blender.org/support/faq/ ; extension licences: https://docs.blender.org/manual/en/latest/advanced/extensions/licenses.html ; Extensions terms of service: https://extensions.blender.org/terms-of-service/
8. Approval precedents: https://extensions.blender.org/approval-queue/kinema/ , https://extensions.blender.org/approval-queue/rendersynth/ , https://extensions.blender.org/add-ons/vrm/
9. STEP add-ons: https://extensions.blender.org/add-ons/step-importer/ , https://extensions.blender.org/add-ons/stepper-reborn/
10. Plasticity Blender add-on: https://raw.githubusercontent.com/nkallen/plasticity-blender-addon/main/__init__.py , https://raw.githubusercontent.com/nkallen/plasticity-blender-addon/main/client.py , https://raw.githubusercontent.com/nkallen/plasticity-blender-addon/main/handler.py ; FAQ: https://doc.plasticity.xyz/blender/blender-bridge-faq
11. Blender Lab MCP issues: https://projects.blender.org/api/v1/repos/lab/blender_mcp/issues?state=all&type=issues&limit=50 , https://projects.blender.org/api/v1/repos/lab/blender_mcp/issues/34/comments
12. Anthropic's Blender connector tutorial: https://academy.claude.com/tutorials/using-the-blender-connector-in-claude
13. Blender glTF importer at v5.2.3: https://github.com/blender/blender/blob/v5.2.3/scripts/addons_core/io_scene_gltf2/__init__.py , https://github.com/blender/blender/blob/v5.2.3/scripts/addons_core/io_scene_gltf2/blender/imp/blender_gltf.py , https://github.com/blender/blender/blob/v5.2.3/scripts/addons_core/io_scene_gltf2/blender/imp/node.py , https://github.com/blender/blender/blob/v5.2.3/scripts/addons_core/io_scene_gltf2/blender/imp/vnode.py , https://github.com/blender/blender/blob/v5.2.3/scripts/addons_core/io_scene_gltf2/blender/imp/material.py ; Blender 5.0 Python API notes: https://developer.blender.org/docs/release_notes/5.0/python_api/
14. Blender download page: https://www.blender.org/download/
15. Blender core CVEs: https://nvd.nist.gov/vuln/detail/CVE-2026-119718 , https://nvd.nist.gov/vuln/detail/CVE-2026-119719 , https://nvd.nist.gov/vuln/detail/CVE-2026-119720 , https://nvd.nist.gov/vuln/detail/CVE-2026-119721 , https://nvd.nist.gov/vuln/detail/CVE-2026-119722
16. Blender Foundation on AI: https://www.blender.org/news/upcoming-blender-development-fund-and-ai-policies/
17. FSF GPL FAQ: https://www.gnu.org/licenses/gpl-faq.html#IfInterpreterIsGPL
18. Fusion to Blender bridge: https://raw.githubusercontent.com/inspace9018/fusion-to-blender-bridge/main/README.md
19. IfcMCP: https://docs.ifcopenshell.org/ifcmcp.html
20. Blender Lab MCP background bridge: https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/addon/blender_mcp_addon/cli.py?ref=v1.0.3 ; screenshots refused in background mode: https://projects.blender.org/api/v1/repos/lab/blender_mcp/raw/mcp/blmcp/tools/get_screenshot_of_area_as_image_toolcode.py?ref=v1.0.3 ; Blender 5.2 command-line arguments: https://docs.blender.org/manual/en/5.2/advanced/command_line/arguments.html
