# Open3DJ: Licensing, Governance, Community and Sustainable Business Model

Research date: 2026-10-27. Research dimension: licensing, governance, community, business model. Method: direct fetches of primary sources (license files, project READMEs, pricing pages, foundation pages, GitHub search). The shared web-search budget was exhausted before this sweep started, so everything below comes from fetched primary pages or is explicitly flagged as unverified.

## Executive summary

Open3DJ today is one commit: an MIT `LICENSE` (copyright "Neural deep network LTD", 2026) and a one-line README. MIT is a fine starting point, but Apache-2.0 is the better long-term choice for an agent-first platform (express patent grant, explicit trademark carve-out, same permissiveness), and relicensing costs nothing while there is a single copyright holder. The real licensing work is not the outbound license but the dependency map: OCCT is LGPL-2.1 with a header-file exception (fine for a permissive core if linked as a replaceable library and credited), while CGAL's useful packages, SolveSpace's solver and OpenSCAD are GPL and must stay out of process (subprocess or separate plugin), and Tencent's Hunyuan3D weights are unlicensed in the EU, UK and South Korea, so they cannot be the default local generative backend for a company quoting prints in EUR. On governance, start company-led with a Rust-style public RFC process, DCO instead of a CLA, and `CODEOWNERS`-based module ownership (Blender's model), and pre-commit to a neutral home for the trademark (Commonhaus-style or an FPA-style association) at a stated milestone. On money: donations fund maintenance, not CAD kernels (FreeCAD's Open Collective budget is about $14k/yr versus Blender's Dev Fund at about $326k/month), and the VC-funded FreeCAD company Ondsel, the Rust kernel Fornjot and the browser CAD CADmium all shut down between 2025 and 2025-09. The models that work are "open client + metered hosted services" (Zoo, Ollama, Supabase, Hugging Face): keep everything in the `open3dj` repo Apache-2.0 with no `/ee` folder, and sell GPU credits, hosted MCP, print quotes, enterprise/on-prem and support from 3dj.app. Finally: the naming is risky. Intel ISL's Open3D (14.1k stars, MIT) is a well-known 3D library, "3DJ" already names several GitHub orgs and projects, a three-week-old Rust competitor (SolidCraft, 11k stars, MIT OR Apache-2.0, MCP built in) has just claimed the "open-source agentic CAD" slot, and I could not reach a trademark database. Register the mark and launch with a crisp differentiation story before the window closes.

## 1. What the repo's current MIT license allows (and does not)

- `LICENSE` is the standard MIT text, copyright "Neural deep network LTD", year 2026. MIT permits anyone, including competitors and 3dj.app itself, to use, modify, sublicense and sell the code with only attribution. It has no patent grant and no trademark clause, which matters once there is a brand worth protecting (see choosealicense.com Apache-2.0 page for the contrast).
- Because only one entity has contributed, relicensing to Apache-2.0 (or Apache-2.0 OR MIT) is a one-commit change today; after external contributions without a CLA/DCO it becomes a consent exercise.
- Nothing in MIT constrains what the hosted 3dj.app does; the constraint runs the other way: whatever Open3DJ ships must be compatible with the licenses of the kernels and models it bundles.

## 2. Dependency license map and the implications

| Component | License (verified) | Consequence for a permissive Open3DJ core |
|---|---|---|
| OCCT (V8_0_1, 2026-07-30) | LGPL-2.1 + `OCCT_LGPL_EXCEPTION.txt`; commercial license also offered | The exception lets object code that incorporates OCCT header material be distributed "under terms of your choice" provided you give "prominent notice in supporting documentation". Plain LGPL still requires that users can relink/replace the library (dynamic linking or shipping object files). WASM builds that statically link OCCT (opencascade.js, replicad) need the exception plus a relinkable artifact or source offer for the OCCT part. |
| opencascade.js | LGPL-2.1 (README badge shows OCCT 7.6.2) | Same as OCCT; 3dj.app uses 7.7.2 per the brief, newer than upstream's README badge. |
| replicad | MIT | Safe. |
| OCP / build123d / CadQuery | Apache-2.0 (OCP, build123d verified; CadQuery not fetched) | Safe; Python route to OCCT without GPL. |
| Manifold | Apache-2.0; used by OpenSCAD, Blender, Godot, trimesh, BRL-CAD | Safe; the right mesh-boolean library for an in-process mesh path. |
| OpenSCAD | GPL-2 (COPYING) with a special CGAL linking exception; latest stable still 2021.01 (2021-01-31); Manifold backend selectable via `--backend=manifold` | Keep as an isolated subprocess/sandbox exactly as 3dj.app already does. Linking it in-process would make the combined work GPL. |
| CGAL (5.x) | Kernel LGPL-3+; Nef Boolean ops, Polygon Mesh Processing, Mesh Generation, Surface Mesh, Triangulations, Alpha Wrapping, Convex Hull 3 are GPL; commercial licenses from GeometryFactory | Only the LGPL kernel is usable in a permissive core. Every useful algorithm package is GPL. Prefer Manifold (Apache) for booleans, and treat any CGAL-based feature as an optional GPL plugin process. |
| SolveSpace / libslvs; python-solvespace 3.0.8 (2022-11-11) | GPL-3.0-or-later | Cannot be linked into a permissive core. Options: PlaneGCS, a clean-room solver (SolidCraft wrote its own), or run SolveSpace as a separate GPL process. |
| PlaneGCS (FreeCAD Sketcher) | LGPL-2.1-or-later (header: Konstantinos Poulios, 2011) | Usable as a dynamically linked/WASM-relinkable library with notice; modifications to PlaneGCS files must be published. |
| truck (Rust B-rep, RICOS) | Apache-2.0 | Safe, but no fillet/chamfer claimed; CADmium used it and HN commenters flagged fillets as the hard part. |
| Hunyuan3D 2.0 (2025-01-21) and 2.1 | "Tencent Hunyuan 3D Community License": territory excludes EU, UK and South Korea; >1M MAU requires a separate license; outputs may not train other models; Hong Kong law | Not shippable as a default to European users. Keep behind a provider abstraction, user-installed, with a geo/consent gate. |
| TRELLIS (Microsoft) | MIT for models and most code; `diffoctreerast` and modified FlexiCubes carry their own licenses | Better default for a local generative backend; audit the two sub-components. |

Key rules, condensed:

1. Permissive core + LGPL kernel is the FreeCAD/CadQuery/replicad pattern and is fine, provided OCCT remains a replaceable library and the docs carry the OCCT notice. The MPL-2.0 FAQ (Q11/Q14) is the clearest statement of why file-level copyleft (MPL) and library copyleft (LGPL) can coexist with proprietary or permissive code, while GPL cannot.
2. GPL components only ever run as separate programs with a documented, arms-length interface (CLI/IPC/files). This is exactly how 3dj.app already isolates OpenSCAD; keep it that way in Open3DJ and document it.
3. Weights are licensed separately from code. Make "provider" a first-class plugin concept so licensing is per-provider, and ship a license-aware manifest (`license`, `territory`, `commercial`, `mau_cap`) that the UI and the MCP server can surface to the agent.
4. Attempted to fetch the GNU GPL FAQ for the canonical static/dynamic LGPL wording; gnu.org returned 429/503. The summary above relies on the OCCT exception text itself plus the MPL FAQ.

## 3. Which outbound license: MIT vs Apache-2.0 vs MPL-2.0 vs AGPL-3.0 vs dual

- Apache-2.0: permissive, adds an express patent grant with retaliation clause and excludes trademark use. Adopted by Supabase (114.1k stars), Manifold, truck, OCP, build123d, Cycles. Recommended for Open3DJ core, SDKs and the MCP server.
- MIT: Ollama (185k stars), Zoo Design Studio, Open3D, PostHog core, replicad, TRELLIS. Equivalent in practice minus patents/trademark; keep "Apache-2.0 OR MIT" if you expect Rust crates (SolidCraft uses exactly that).
- MPL-2.0: Penpot (61.7k stars). File-level copyleft; good fit if you want modifications to your kernel wrappers published but allow proprietary plugins. Reasonable second choice for a `kernel/` subtree; adds friction for WASM bundling.
- AGPL-3.0: Plane (61.5k stars). Protects against hosted clones, but it is the wrong signal for a project whose whole point is to be embedded in other people's agents and MCP clients; it also complicates the many Apache/MIT CAD MCP servers you want to absorb.
- Source-available / fair-code: n8n's Sustainable Use License (internal business use only; redistribution must be free and non-commercial; `.ee` files under a separate Enterprise License) and CADmium's Elastic License 2.0. Both work commercially (n8n: 208.8k stars) but n8n needed a CLA ("sadly necessary") and CADmium's HN thread (669 points, 241 comments, 2024-05-21) shows the community immediately audits the license and punishes an "open source" claim that is not OSI. Do not do this for a project whose README says "open source".
- Dual licensing (GPL + commercial) requires copyright aggregation (CLA) and would exclude the Apache/MIT agent ecosystem. Not recommended.
- Open core with an `/ee` folder: PostHog (MIT + `ee/LICENSE`, with a separate `posthog-foss` purge repo) and Cal.com. As of 2026-10-27 the `calcom/cal.com` repository is displayed as "cal.diy", described as "a fork of Cal.com with all enterprise/commercial code removed", 100% MIT, and its README says community contributions "do not flow to Cal.com's production platform". That is the end state of in-repo open core under contributor pressure. Prefer the cleaner "open client + closed hosted services in a different repo" line (Zoo, Ollama, Supabase).

Recommendation: Apache-2.0 for the entire `open3dj` repository, no `/ee` directory, NOTICE file carrying the OCCT and third-party notices, SPDX headers in every file, and a `THIRD-PARTY-LICENSES.txt` generated in CI (SolidCraft's `cargo xtask licences --check` is a good model).

## 4. Governance: company-led vs foundation, CLA vs DCO, maintainers, RFCs

Precedents:

- Blender: Stichting Blender Foundation (Amsterdam, 2002), Blender Institute as the working company; Development Fund is the main income ("$326,145" monthly contribution shown, 7,614 individual and 46 corporate supporters; figure undated on page). Code is GPL-2.0-or-later, binaries GPL-3; Cycles is Apache-2.0. Contributions go to Gitea at projects.blender.org; module owners give final approval; `CODEOWNERS` auto-assigns reviewers; one topic per PR; individual contributors accept a one-time `blender-contributor-agreement` in account settings and companies sign a corporate CLA PDF. Add-ons must be GPL-compatible and may be sold only as a download service.
- FreeCAD: LGPL-2.1, 34.8k stars. FreeCAD Project Association is a Belgian AISBL founded November 2021; it owns the trademark and brand guidelines, runs quarterly grant programs (2026 Q3 funded three projects including TechDraw topological naming), governed by a general assembly of ordinary members voting on the forum. Open Collective shows total raised $28,547, estimated annual budget $14,379, 421 contributors. FreeCAD's blog shows 89 to 123 PRs merged per week in October 2026, FreeCAD 1.1.4 (2026-09-28) and a 26.3 release candidate under a new versioning scheme. Developer handbook recommends `pixi run configure && pixi run build`, pins Windows to Visual Studio Community 2022 for conda-forge compilers, and acknowledges that maintainer capacity is small so reviews can be delayed.
- Ondsel (the venture-backed company that built Ondsel ES on FreeCAD) is shutting down; its FreeCAD fork was archived 2025-03-01 and ondsel.com now redirects to an unrelated site. Its assembly workbench and toponaming work live on in FreeCAD 1.0 (released 19 Nov, release notes cite "topological naming problem mitigation code" and "an integrated assembly workbench").
- Fornjot (Rust CAD kernel, 0BSD): "This project has been shut down. Its goals were never reached." CADmium (ELv2, truck kernel): archived 2025-09-05, 1.6k stars.
- Rust RFC process: PR against an `rfcs` repo from `0000-template.md`, sub-team triage, ten-calendar-day Final Comment Period with at least five business days, sub-team decides, tracking issue in the main repo.
- CLA vs DCO: n8n and Blender use CLAs (needed for n8n's non-OSI license and Blender's corporate contributors); Penpot requires a DCO sign-off (`git commit -s`) and no CLA; SolidCraft uses an inbound=outbound sentence ("By contributing you agree that your contribution is licensed as MIT OR Apache-2.0"); PostHog's CONTRIBUTING.md states neither. DCO 1.1 (Linux Foundation) certifies origin and license right and is enough for a permissive, non-dual-licensed project.
- Neutral homes without building your own foundation: Open Source Collective (501(c)(6) fiscal host used by FreeCAD; bank account, invoices, contracts) and Commonhaus Foundation (community-first governance, fiscal sponsorship via GitHub Sponsors/OpenCollective, trademark policy; hosts Quarkus, Hibernate, Jackson, OkHttp).

Recommendation for Open3DJ:

1. Company-led for the first 18 to 24 months (Neural deep network LTD employs the maintainers, holds the trademark), but publish `GOVERNANCE.md` on day one with: BDFL-for-now, named module owners in `CODEOWNERS`, an RFC repo with the Rust template and a 10-day FCP, and a written trigger ("when three organisations each have a maintainer, or at 1.0") for moving the trademark and donation account to a neutral host (Commonhaus or an FPA-style association). This is the credible middle between n8n/Cal.com (company controls everything) and FPA (foundation without a funded core team).
2. DCO, not CLA. A CLA is only needed if you plan to relicense or dual-license later; announcing that you will not is itself a trust signal for the agent-dev audience.
3. Keep an `AGENTS.md` and clean-room rules like SolidCraft's (no reading of GPL CAD code such as FreeCAD/SolveSpace/QCAD when writing kernel code; automatic license check in CI), because most contributions will be agent-written and license contamination is the main legal risk of agent-first development.

## 5. Open-core and "open client + hosted services": what worked

| Project | License | Stars (2026-10) | Revenue model | Lesson |
|---|---|---|---|---|
| Ollama | MIT | 185k | Local always unlimited; Cloud: pay-as-you-go $0, Pro $20/mo ($60 credits), Max $100/mo ($300 credits), Team $500/mo ($1,000 shared credits), Enterprise custom | Credits-with-included-allowance on top of a free local runtime is the closest analog to "local CPU/GPU by default, cloud GPU pluggable". |
| Zoo (KittyCAD) | MIT app; hosted geometry engine (3D view is "a video stream from our hosted geometry engine") | n/a | Usage-metered; "CAD modeling in Zoo Design Studio remains unlimited"; "Zookeeper reasoning time and billable API usage are metered"; Zoo MCP has no separate fee but hosted operations count as API usage | The open client is a distribution channel for a closed, metered engine. Open3DJ should invert this (open local kernel) and meter only what is genuinely scarce (GPU, print ops). Plan prices did not render (JS); unverified. |
| Supabase | Apache-2.0 | 114.1k | "Supabase is a hosted platform"; self-host allowed | Permissive license did not stop a large hosted business. |
| n8n | Sustainable Use License + Enterprise License | 208.8k | Self-host for internal use; cloud and enterprise features | Works, but required CLA and `.ee` carve-outs and cannot call itself open source. |
| Penpot | MPL-2.0, DCO | 61.7k | Penpot Enterprise (cloud or self-hosted: admin, permissions, SSO) | Enterprise features sold as a separate paid plan, community code under weak copyleft. |
| Plane | AGPL-3.0 | 61.5k | Free (12 seats), Pro $8/user/mo, Business $15/user/mo, Enterprise Grid; feature gates apply to self-hosted too | Feature gating in self-hosted editions is accepted when the base is genuinely usable. |
| PostHog | MIT + `ee/LICENSE` | 40.5k | Cloud with 1M free events/month; self-host "meant for roughly 100k events per month", no support | Honest "self-host is for small scale" positioning avoids resentment. |
| Cal.com | now `cal.diy` MIT (EE removed) | 49.4k | Hosted/enterprise Cal.com | In-repo open core eventually split into a community fork. |
| Hugging Face | Apache-2.0 libraries | n/a | PRO $9/mo ($2 inference credits), Team $20/user, Enterprise $50/user; Spaces GPU A10G $1.00/h, A100 $2.50/h; Inference Endpoints H100 $4.50/h, B200 $9.25/h; storage $12-18/TB/mo | Transparent per-hour GPU pricing is the market reference for "cloud GPU credits". |
| Blender | GPL | n/a | Dev Fund about $326k/month from 7,614 individuals and 46 corporates | Donations can fund a core team only at Blender's scale and age. |
| FreeCAD | LGPL-2.1 | 34.8k | FPA grants; Open Collective about $14k/yr | Donations fund grants, not salaries; the funded company (Ondsel) failed. |
| Plasticity | closed, Parasolid + xNURBS | n/a | Perpetual: Indie $175, Studio $299, 12 months of updates | Pro CAD users will pay one-off for a kernel that fillets reliably; subscription fatigue is real (also the dominant HN sentiment on CADmium). |

## 6. Monetization options for Open3DJ + 3dj.app

Ranked by fit with "local-first, agent-first":

1. Cloud GPU credits for generative 3D and heavy ops (meshing, reverse-engineering fits). Model: Ollama/HF. Local is unlimited; cloud is metered in credits with included monthly allowance; publish per-job prices derived from HF-level hourly rates (A100 $2.50/h, H100 $4.50/h) plus margin. Expose `providers` with live health exactly as 3dj.app's MCP already does and make 3dj.app one provider among local and third-party ones.
2. Hosted MCP (zero-install endpoint with OAuth 2.1 + PKCE, already built). Zoo precedent: no MCP surcharge, hosted operations bill as API usage. Sell reliability, concurrency and history, not access.
3. Print quote marketplace: operator-reviewed EUR quotes already exist; take-rate or subscription for operators. This is the revenue line that no open-source CAD competitor (SolidCraft, FreeCAD) has.
4. Enterprise/on-prem: SSO/SCIM, audit log, air-gapped GPU box, signed binaries, STEP provenance retention. Plane/Penpot/HF all sell exactly these as the enterprise tier; keep them in a separate closed repo, not `/ee`.
5. Support and training for integrators building vertical agents on Open3DJ.
6. Parts/plugin marketplace: the `lib.*` standard-content library and provider plugins. Blender's rule (add-ons must be GPL-compatible; selling is a download service) is the cautionary tale; with Apache-2.0 core you can allow proprietary plugins and take a cut on paid ones.

What not to monetize: the local kernel, the file format, exports (STEP/STL/3MF) or the MCP protocol surface. HN's CADmium thread is explicit that users fear losing access to their files and reject subscription lock-in.

## 7. Community building and launch for an agent-first CAD tool

Distribution channels (all verified live on 2026-10-27):

- Official MCP Registry: preview since 2025-09-08; v0.1 API frozen 2025-10-24 while v1 is shaped for GA; publish with the `mcp-publisher` CLI, namespace `io.github.<user>` via GitHub OAuth/OIDC or a domain namespace (e.g. `app.3dj/...`) via DNS/HTTP challenge. A search for "cad" returns 50 results with six CAD-related servers (kernelCAD 0.17.1, OwlCAD 1.0.1, CheapCADTools 0.25.4, CADProps, 3D CAD Converter, a dental CAD quotes server). No FreeCAD, Blender, OpenSCAD, Onshape or Zoo entry is in that page. The slot is open but filling fast.
- awesome-mcp-servers (96.9k stars): one line per server, alphabetical within category, public repo required, remote-only servers go to awesome-remote-mcp-servers; it already lists blender-mcp, build123d-mcp, jupytercad-mcp, FreeCAD (AnkusDrive), SolidWorks-MCP, Inventor, Revit, Fusion 360 and OctoEverywhere entries under "Art & Culture" (there is no CAD category: propose one in the PR).
- Claude Desktop Extensions (`.mcpb`, originally `.dxt`, published 2025-06-26): one-click install, manifest.json, keychain for secrets, curated directory with Anthropic review. Ship an `.mcpb` with the local server.
- Glama (111,108 servers listed) and Smithery (27,365; its MCP proxy and managed identity shut down 2025-10-31, so do not depend on hosted-proxy registries).
- GitHub: SolidCraft (tangency-labs, created 2026-10-07, about 11k stars, 1.4k forks, 3.1k issues, MIT OR Apache-2.0, pure Rust, own constraint solver, `solidcraft-cli mcp` with headless and bridged modes, path-sandboxed tool access, Discord) is the direct competitor for the "open-source agentic CAD" narrative. Others: agentcad (build123d/CadQuery CLI+MCP, 175 stars), build123d-mcp (132), kjdraw (63, "open-source CAD engine for AI agents"), several FreeCAD MCP bridges (226/102/62), KiCAD-MCP (2,975).

Launch playbook, from the CADmium HN thread (669 points, 241 comments) and the above:

1. Lead with the kernel and the evidence, not the AI. HN wanted stable fillets, reliable references (toponaming), STEP and offline files; the "Design Evidence Pack" (measured/observed/inferred tolerances, manufacturing gates) is a differentiator no competitor lists.
2. State the license and the business model in the first paragraph; link the hosted services as optional providers. CADmium lost trust over ELv2 versus "open source" within hours.
3. Ship installers on day one (SolidCraft ships MSI, universal DMG, AppImage, Snap, Flatpak, web; its README admits binaries are not code-signed). Code-sign yours; it is a visible quality signal.
4. Publish a reproducible benchmark and leaderboard: SolidCraft markets "75 of 76 public reference parts match" via a documented oracle; academic baselines exist (Text2CAD, NeurIPS 2024 spotlight; CAD-Recode on DeepCAD/Fusion360/CC3D). An "agent-CAD bench" (text to STEP with tolerance checks, scored by the evidence pack) run weekly against public MCP servers would be both marketing and a contributor magnet.
5. Discord for synchronous help (SolidCraft, Plasticity, CADmium all use it) plus GitHub Discussions for durable Q&A and RFC threads; FreeCAD's forum and Blender's chat show that the durable archive matters more than the chat app.
6. Docs site with a "first part in five minutes" for agents (copy-pasteable `claude mcp add ...`, Cursor, Codex configs) and for humans; `good-first-issue` labels on small, well-specified geometry test cases; weekly "WIP Wednesday" style changelog posts like FreeCAD's.

## 8. Trademark and naming

- Intel ISL's Open3D ("A Modern Library for 3D Data Processing", MIT, 14.1k stars, v0.20.0 announced 2026-09-24, site contact at osvf.org) is an established 3D brand. "Open3DJ" differs by one letter and will be read as "Open3D + J" or as a typo. Expect SEO collisions and GitHub search noise (Open3D-ML, open3d_slam, Open3DBench and more all exist).
- "3DJ" already names a GitHub organisation (`3DJ`, repos since 2012), a VRChat project (`Happyrobot33/3DJ`, 35 stars) and a SuperCollider spatialisation framework (`andresperezEUT/3Dj`). None is CAD, so coexistence is plausible, but the mark is not distinctive on its own.
- The 3dj.app site rendered only a title ("3DJ: Ideas to Editable CAD, STEP & STL"); the operating entity, terms and any trademark notice could not be read. The repo LICENSE names Neural deep network LTD.
- I could not query TMview (three 503 responses) or USPTO (JS-only search). Trademark status of "3DJ", "Open3DJ" and "Open3D" in classes 9 and 42 is therefore unverified and must be checked by counsel before launch.

Advice: keep "3DJ" as the house brand and register it (EU + UK + US, classes 9/42) now; consider a distinct open-source product name rather than "Open3DJ" (the Apache-2.0 trademark clause and a short `TRADEMARKS.md` then let you control both). If the Open3DJ name stays, add a README line disclaiming any relation to Intel's Open3D and reserve the npm/PyPI/crates names immediately.

## 9. What makes CAD projects hard to contribute to, and how to avoid it

Evidence from FreeCAD's handbook, Blender's handbook and the HN thread: hour-long native builds with pinned toolchains (VS 2022 for conda-forge on Windows), small maintainer capacity and slow reviews, cross-cutting kernel problems (topological naming took FreeCAD until 1.0 to mitigate and is still being funded in TechDraw in 2026 Q3), fillets/chamfers as the recurring stability complaint, and hard-to-write tests for geometry.

Mitigations for Open3DJ:

1. Monorepo with clear layers: `kernel/` (OCCT bindings, WASM and native), `engine/` (script runtime, references, evidence), `mcp/` (server, tool schemas), `apps/desktop`, `apps/web`, `providers/` (local, 3dj.app, third-party GPU), `library/` (lib.* content), `bench/`, `docs/`. Each package builds and tests alone; the WASM kernel means a contributor needs Node, not a C++ toolchain, for most work.
2. CI that runs a geometry golden suite on every PR: volume/area/bounds/euler checks, STEP round-trip, 3MF/STL watertightness, and the evidence-pack gates, with tolerances recorded in the test fixture. Publish the suite as the public benchmark.
3. Fast review SLAs backed by `CODEOWNERS`, labels (`approved-for-ci` like SolidCraft to keep CI cost bounded), one-topic PRs (Blender rule), and an RFC for anything touching the script API or reference semantics.
4. Reproducible dev environment (pixi or devcontainer) and pre-commit formatting, both of which FreeCAD had to retrofit.

## Recommendations for Open3DJ

1. Relicense the repo from MIT to Apache-2.0 now (optionally "Apache-2.0 OR MIT" for Rust crates), add NOTICE with the OCCT credit, SPDX headers, and a CI license check that fails on GPL/AGPL/Tencent-licensed dependencies entering the core.
2. Architect the license boundary: OCCT (LGPL + exception) as a replaceable library; OpenSCAD, CGAL-GPL and SolveSpace only as separate processes/plugins; generative models as providers with a machine-readable license manifest; TRELLIS (MIT) as the default local provider, Hunyuan3D opt-in and geo-gated.
3. Do not create an `/ee` folder. All closed code (billing, print-quote operator tools, fleet scheduling) lives in 3dj.app's private repos and appears to Open3DJ as a provider implementing public plugin interfaces.
4. Governance: `GOVERNANCE.md` + `CODEOWNERS` + `rfcs/` (Rust template, 10-day FCP) + DCO + `AGENTS.md` clean-room rules; pre-announce the neutral-home trigger for the trademark and donation account.
5. Monetize scarcity, not access: GPU credits with a free monthly allowance (Ollama pattern), hosted MCP as the same metered usage (Zoo pattern), print quotes marketplace, enterprise/on-prem tier, support. Publish per-job prices anchored to public GPU rates.
6. Name: clear the trademark with counsel this week; register "3DJ"; decide whether the OSS project should carry a name that does not collide with Intel's Open3D; reserve package names on npm, PyPI, crates.io and the MCP registry namespace.
7. Launch sequence: installers (signed) + `.mcpb` + official MCP registry + awesome-mcp-servers PR (propose a CAD category) + benchmark page, then HN "Show HN" with license and business model in the first paragraph and the evidence pack as the hook; Discord + GitHub Discussions; weekly changelog posts.
8. Treat SolidCraft as the benchmark competitor: match its distribution breadth (desktop/web/CLI/MCP, headless and bridged modes, sandboxed file access) and beat it on B-Rep maturity (OCCT fillets, STEP AP214), evidence/provenance, standard content library and the print/quote loop.

## Sources

- Open3DJ repo: local `LICENSE` and `README.md` (commit 7aba1f6); https://github.com/NeuralDEEPnet/Open3DJ
- OCCT exception: https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/master/OCCT_LGPL_EXCEPTION.txt ; repo/license/commercial note: https://github.com/Open-Cascade-SAS/OCCT ; releases: https://github.com/Open-Cascade-SAS/OCCT/releases
- opencascade.js: https://github.com/donalffons/opencascade.js ; replicad: https://github.com/sgenoud/replicad ; OCP: https://github.com/CadQuery/OCP ; build123d: https://github.com/gumyr/build123d
- CGAL license: https://www.cgal.org/license.html ; package licenses: https://doc.cgal.org/latest/Manual/packages.html
- SolveSpace: https://github.com/solvespace/solvespace ; python-solvespace: https://pypi.org/project/python-solvespace/
- PlaneGCS header: https://raw.githubusercontent.com/FreeCAD/FreeCAD/main/src/Mod/Sketcher/App/planegcs/GCS.h
- Manifold: https://github.com/elalish/manifold ; OpenSCAD: https://github.com/openscad/openscad , https://raw.githubusercontent.com/openscad/openscad/master/COPYING , https://openscad.org/news.html
- truck: https://github.com/ricosjp/truck ; Fornjot: https://github.com/hannobraun/fornjot ; CADmium: https://github.com/CADmium-Co/CADmium , https://raw.githubusercontent.com/CADmium-Co/CADmium/main/README.md , HN thread https://news.ycombinator.com/item?id=40428827
- Hunyuan3D licenses: https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE , https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2/main/LICENSE ; TRELLIS: https://github.com/microsoft/TRELLIS
- Apache-2.0 summary: https://choosealicense.com/licenses/apache-2.0/ ; MPL-2.0 FAQ: https://www.mozilla.org/en-US/MPL/2.0/FAQ/ ; GNU GPL FAQ (fetch failed, 429/503): https://www.gnu.org/licenses/gpl-faq.html
- n8n: https://github.com/n8n-io/n8n , https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md , https://raw.githubusercontent.com/n8n-io/n8n/master/CONTRIBUTING.md , https://faircode.io/
- Zoo: https://github.com/KittyCAD/modeling-app , https://zoo.dev/pricing , https://zoo.dev/api-pricing , https://zoo.dev/zoo-pricing
- Ollama: https://github.com/ollama/ollama , https://ollama.com/cloud ; Supabase: https://github.com/supabase/supabase ; Penpot: https://github.com/penpot/penpot , https://raw.githubusercontent.com/penpot/penpot/develop/CONTRIBUTING.md ; Plane: https://github.com/makeplane/plane , https://plane.so/pricing ; PostHog: https://github.com/PostHog/posthog , https://raw.githubusercontent.com/PostHog/posthog/master/CONTRIBUTING.md ; Cal.com/cal.diy: https://github.com/calcom/cal.com , https://raw.githubusercontent.com/calcom/cal.com/main/README.md , https://raw.githubusercontent.com/calcom/cal.com/main/LICENSE , https://cal.com/blog ; Hugging Face: https://huggingface.co/pricing ; Plasticity: https://www.plasticity.xyz/
- Blender: https://fund.blender.org/ , https://www.blender.org/about/foundation/ , https://www.blender.org/about/license/ , https://developer.blender.org/docs/handbook/contributing/
- FreeCAD: https://github.com/FreeCAD/FreeCAD , https://fpa.freecad.org/ , https://opencollective.com/freecad , https://blog.freecad.org/ , https://freecad.github.io/DevelopersHandbook/ , https://freecad.github.io/DevelopersHandbook/gettingstarted/ , https://github.com/FreeCAD/FreeCAD/releases/tag/1.0.0 ; Ondsel: http://www.ondsel.com/ , https://github.com/Ondsel-Development/FreeCAD
- Governance: https://github.com/rust-lang/rfcs , https://developercertificate.org/ , https://www.commonhaus.org/ , https://opencollective.com/opensource
- MCP distribution: https://github.com/modelcontextprotocol/registry , https://registry.modelcontextprotocol.io/v0/servers?search=cad&limit=50 , https://github.com/punkpeye/awesome-mcp-servers , https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/CONTRIBUTING.md , https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md , https://www.anthropic.com/engineering/desktop-extensions , https://glama.ai/mcp/servers , https://smithery.ai/
- Competitors: https://github.com/tangency-labs/solidcraft , https://raw.githubusercontent.com/tangency-labs/solidcraft/main/AGENTS.md , https://raw.githubusercontent.com/tangency-labs/solidcraft/main/CONTRIBUTING.md , https://raw.githubusercontent.com/tangency-labs/solidcraft/main/docs/mcp.md ; GitHub search results for "mcp cad", "3dj", "open3d", "open3dj" (GitHub API via MCP, 2026-10-27)
- Naming: https://github.com/isl-org/Open3D , https://www.open3d.org/ , https://osvf.org/ , https://www.3dj.app/ (title only) ; TMview API attempts returned HTTP 503: https://www.tmdn.org/tmview/api/search/results?...basicSearch=3DJ
- Benchmarks: https://github.com/filaPro/cad-recode , https://sadilkhan.github.io/text2cad-project/
