# Licensing in plain language

This guide explains, in everyday words, what you can do with Open3DJ, how contributions are licensed, which third-party components the project can use and how, and who owns what you make. It is not legal advice. Where this guide and the [LICENSE](../LICENSE) file differ, the LICENSE file wins.

Every factual claim below points to the research note it comes from, in [docs/research/](research/). Anything we have not been able to check is marked **to verify**.

## At a glance

| Question | Short answer | Status |
|---|---|---|
| What license is Open3DJ under? | MIT. Copyright (c) 2026 Neural Deep Network LTD and the Open3DJ contributors. | In force today |
| Will that change? | A switch to dual "MIT OR Apache-2.0" is proposed, for Apache-2.0's patent grant. | **Pending founder decision** |
| How do I license my contribution? | Sign off your commits under the Developer Certificate of Origin (DCO). There is no CLA. | Asked for in the pull request template now; enforced once the DCO app is installed ([REPO-SETTINGS.md](REPO-SETTINGS.md)) |
| Can Open3DJ use GPL or AGPL code? | Not in the core. Such code may only run as a separate, optional program, or not at all. | Project policy |
| What about generative 3D models? | Every model pack comes with a license manifest. Restricted models are opt-in packs only. | Project policy |
| Who owns what I design? | You do. Designs you create and files you export belong to you. | Project policy |
| Is the name "Open3DJ" settled? | Not yet. Trademark clearance is in progress, so the name may change before the first public release. | **Pending** |

## 1. What the MIT license lets you do today

Open3DJ is licensed under the [MIT License](../LICENSE). In plain terms ([research/community-licensing-business.md](research/community-licensing-business.md), section 1):

- **You can** use, copy, modify, merge, publish, distribute, sublicense and sell Open3DJ, for any purpose, including commercial use.
- **You must** keep the copyright notice and the permission notice in all copies or substantial portions of the software.
- **There is no warranty.** The software is provided "as is".
- **MIT has no patent grant and no trademark clause.** It does not give you rights to any patents, and it does not give you rights to the Open3DJ name or logo (see [section 8](#8-trademark)).

The same license applies to everyone, including Neural Deep Network LTD, its hosted sibling 3dj.app, and its competitors.

## 2. Proposed: dual license "MIT OR Apache-2.0"

> **Status: pending founder decision.** Nothing has changed yet. Open3DJ is MIT-licensed today.

The research recommends offering Open3DJ under **MIT OR Apache-2.0**, so each user can pick either license ([research/community-licensing-business.md](research/community-licensing-business.md), sections 3 and 4).

**Why:**

- **Patent grant.** Apache-2.0 includes an express patent license from each contributor, with a retaliation clause: anyone who sues, claiming that the work infringes a patent, loses the patent licenses it gave them. MIT has no such grant. This matters for a CAD project that companies will build on.
- **Trademark clarity.** Apache-2.0 explicitly says it grants no rights to the project's trademarks.
- **Ecosystem norms.** Apache-2.0 is used by the libraries Open3DJ is most likely to build on, including Manifold, OCP and build123d. The dual "MIT OR Apache-2.0" form is common in the Rust ecosystem. SolidCraft, an open-source agentic CAD project, uses it ([research/community-licensing-business.md](research/community-licensing-business.md), sections 3 and 7), and so does the `keyring` crate ([research/security-sandboxing.md](research/security-sandboxing.md), section 7).
- **Nothing is lost.** Anyone who prefers MIT can still choose MIT.

**What would change, if adopted:**

- A `LICENSE-APACHE` file next to `LICENSE-MIT`, SPDX license headers in source files, and a `NOTICE` file that credits third-party components such as OCCT and brepjs.
- A CI check that fails when a GPL, AGPL, Tencent-licensed or non-commercial dependency enters the core (see [section 5](#5-the-gpl-and-agpl-rule-for-the-core)).
- From the switch on, every contribution is licensed inbound = outbound under MIT OR Apache-2.0.

**Timing.** The research notes that relicensing is a one-commit change while Neural Deep Network LTD is the only copyright holder, and becomes a consent exercise once others have contributed ([research/community-licensing-business.md](research/community-licensing-business.md), section 1). To keep the option open, [CONTRIBUTING.md](../CONTRIBUTING.md#licensing-of-contributions) asks contributors to agree that their contributions may also be distributed under Apache-2.0 if the project adopts MIT OR Apache-2.0. That sentence is itself awaiting the founder's confirmation. Anyone who did not agree will be asked again before a switch. How existing MIT contributions carry over is **to verify** with counsel.

**Documentation and schemas.** An earlier draft plan proposed CC-BY-4.0 for documentation and MIT OR Apache-2.0 for data schemas ([research/archive/full-scale-plan.md](research/archive/full-scale-plan.md), section 11). That is also a proposal, not a decision. Until it is decided, everything in this repository is covered by the MIT license.

## 3. Contributing: Developer Certificate of Origin, no CLA

When you contribute to Open3DJ, you certify that you have the right to do so by signing off each commit under the **Developer Certificate of Origin (DCO) 1.1**. There is no Contributor License Agreement (CLA) to sign.

### How to sign off

Add the `-s` flag when you commit:

```
git commit -s -m "Add ISO 4762 socket head cap screw to the parts library"
```

Git adds a line like this to your commit message:

```
Signed-off-by: Your Name <your-email-or-noreply-address>
```

**Privacy tip:** you do not have to publish a personal email address. You can sign off with the private `noreply` address that GitHub gives you (Settings, then Emails). The sign-off must use the same email as the commit author.

Forgot to sign off? Run `git commit --amend -s --no-edit` for the last commit, or `git rebase --signoff main` for several, then update your branch with `git push --force-with-lease`. If you edit files in the browser on GitHub, the sign-off is added for you ([CONTRIBUTING.md](../CONTRIBUTING.md#editing-in-the-browser)).

### Rules for AI agents

- **AI agents must never add a `Signed-off-by` line.** Only a person can certify the DCO. Agents commit without `-s`. The human operator reviews the full diff, then adds their own sign-off (`git commit --amend -s --no-edit` for one commit, `git rebase --signoff <base>` for several) and takes responsibility for the work. This follows the Linux kernel's rule for AI coding assistants ([kernel.org: AI Coding Assistants](https://docs.kernel.org/process/coding-assistants.html)).
- Add a trailer such as `Assisted-by: <agent or tool name>` to each commit an agent helped with (a `Co-Authored-By:` trailer your tool adds also counts), and disclose it in the pull request template. Agents operated by Neural Deep Network LTD use `Assisted-by: neuraldeep.net design agents` (see [CONTRIBUTING.md](../CONTRIBUTING.md#attribution-for-neural-deep-network-agents)).
- Agents must not copy code from incompatible sources (see [section 5](#5-the-gpl-and-agpl-rule-for-the-core)). [AGENTS.md](../AGENTS.md) carries the detailed rules.

### Organizations

If you contribute on behalf of your employer or another organization, make sure you are allowed to. The DCO certifies that you have the right to submit the work. No separate corporate agreement is needed.

### Why a DCO and not a CLA

- **A CLA is mainly needed to relicense or dual-license code commercially.** Open3DJ has no current plan to do that, so a CLA would add friction without a purpose ([research/community-licensing-business.md](research/community-licensing-business.md), section 4). Whether to commit to this permanently is a pending founder decision (see below).
- **The DCO is lighter.** It is one line per commit, with no paperwork and no signup. Penpot uses this model (DCO sign-off, no CLA), while n8n and Blender use CLAs for their different licensing setups (same source).
- **Inbound = outbound.** Your contribution is licensed to everyone under the same open-source license as the rest of the project. Nobody, including Neural Deep Network LTD, receives special rights over your contribution beyond what that license gives everyone.
- **Code signing.** The free SignPath Foundation code-signing program requires an OSI-approved license "without commercial dual-licensing" ([research/gap-9.md](research/gap-9.md), section 1). Whether the company commits to that permanently is a **pending founder decision**.

### The text of the DCO 1.1

From https://developercertificate.org/:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## 4. Third-party components

The starting tech stack is not decided yet. The table lists **candidate** components from the research, their licenses as stated there, and how Open3DJ would use each one if it is chosen. Before any component is added, its license is checked again at the exact version we adopt.

| Component | License (as stated in the research) | How Open3DJ would use it | Source |
|---|---|---|---|
| **Open CASCADE Technology (OCCT)** 8.0.1 | LGPL-2.1 plus the Open CASCADE exception (`OCCT_LGPL_EXCEPTION.txt`). A commercial license is also offered. | Candidate B-rep geometry kernel. Used through its public API as a separate, replaceable library: dynamically linked in native builds, or as a WASM module with a relinkable artifact or source offer, as its terms require. The exception asks for "prominent notice in supporting documentation", so OCCT will be credited in `NOTICE` and in the docs. No OCCT code is copied into permissively licensed files. | [community-licensing-business.md](research/community-licensing-business.md), section 2 |
| **Manifold** | Apache-2.0 | Candidate library for fast mesh booleans and mesh clean-up. | [community-licensing-business.md](research/community-licensing-business.md), section 2; [security-sandboxing.md](research/security-sandboxing.md), section 3 |
| **three.js** (r186) | MIT | Candidate 3D viewer for the desktop and web user interface. | [client-and-distribution.md](research/client-and-distribution.md) |
| **build123d** and **OCP** | Apache-2.0 (both verified). CadQuery is also reported as Apache-2.0 but was not fetched: **to verify**. | Candidate Python modeling route on top of OCCT, without GPL code. | [community-licensing-business.md](research/community-licensing-business.md), section 2; [gap-3.md](research/gap-3.md) |
| **brepjs** | Apache-2.0, which requires a `NOTICE` file and is compatible with MIT | Candidate kernel-adapter interfaces, vendored or mirrored at a pinned version. | [gap-2.md](research/gap-2.md), section 3 |
| **occt-wasm** | Build tooling is MIT OR Apache-2.0 according to its README. Its compiled output is LGPL-2.1, because it builds OCCT from a patched fork. The license of its `facade/` C++ source is not stated: **to verify**. | Candidate OCCT WebAssembly backend. If the facade is LGPL-2.1, it will live in a separately licensed directory or a dynamically linked library with its own LICENSE and NOTICE entry. | [gap-2.md](research/gap-2.md), section 3; [archive/full-scale-plan.md](research/archive/full-scale-plan.md), section 11 |
| **QuickJS** and **quickjs-ng** | MIT (both). The license of the `quickjs-emscripten` wrapper is not stated in the research: **to verify**. | Candidate interpreter for agent-generated scripts, compiled to WebAssembly and run inside the sandbox. | [security-sandboxing.md](research/security-sandboxing.md), section 1 |
| **lib3mf** 2.5.0 | BSD-2-Clause | Candidate 3MF reader and writer. | [formats-interop-manufacturing.md](research/formats-interop-manufacturing.md) |
| **replicad** / **opencascade.js** | MIT / LGPL-2.1 | Reference for API compatibility. opencascade.js would carry the same obligations as OCCT. | [community-licensing-business.md](research/community-licensing-business.md), section 2 |
| **PlaneGCS** (FreeCAD sketcher solver) | LGPL-2.1-or-later | Candidate 2D constraint solver, loaded as a separate, replaceable library with notice. Changes to PlaneGCS files must be published. | [community-licensing-business.md](research/community-licensing-business.md), section 2 |
| **Generative model packs** | Varies per model; see [section 6](#6-generative-model-packs) | Optional providers, each with a license manifest. | [gap-4.md](research/gap-4.md) |

## 5. The GPL and AGPL rule for the core

**No GPL or AGPL code goes into the Open3DJ core.** Linking GPL code into the core would make the combined work GPL, which would conflict with the permissive license that lets people embed Open3DJ in their own agents and products ([research/community-licensing-business.md](research/community-licensing-business.md), sections 2 and 3).

Copyleft programs may only be used as **separate, optional processes** with an arm's-length interface (command line, IPC or files), installed separately and kept in separate repositories or packages, or not at all. This is how 3dj.app already isolates OpenSCAD.

| Component | License (as stated in the research) | Rule | Source |
|---|---|---|---|
| OpenSCAD | GPL-2 with a CGAL linking exception | Separate optional process only | [community-licensing-business.md](research/community-licensing-business.md), section 2 |
| CGAL | Kernel LGPL-3+. The useful algorithm packages (Nef booleans, Polygon Mesh Processing and others) are GPL. | Separate optional process only. Prefer Manifold for booleans. | same |
| SolveSpace / libslvs | GPL-3.0-or-later | Separate optional process only | same |
| pymeshlab | GPL-3.0 | Not in the core | [gap-4.md](research/gap-4.md) |
| pymeshfix | GPL-3.0 (repository) / AGPL-3.0 (PyPI classifier) | Not in the core | same |
| python-igraph | GPL-2.0+ | Not in the core | same |
| brepkit-wasm | AGPL-3.0-only | Do not bundle | [gap-2.md](research/gap-2.md), section 3 |
| OrcaSlicer, Bambu Studio, PrusaSlicer | AGPL-3.0 | Separate process only, driven through their command lines | [formats-interop-manufacturing.md](research/formats-interop-manufacturing.md) |

**Clean-room rule.** Contributors and their agents must not copy code from copyleft projects (GPL, AGPL or LGPL) into Open3DJ's permissively licensed files, and must not paste code of unknown origin. Use libraries through their public APIs instead. [AGENTS.md](../AGENTS.md) carries the detailed rules. License contamination is the main legal risk of agent-written code ([research/community-licensing-business.md](research/community-licensing-business.md), section 4).

**Planned license gate.** The research found that package metadata alone misses some licenses: TripoSG's Tencent terms sit in a subfolder LICENSE file and in a file header. The planned CI gate therefore checks four layers ([research/gap-4.md](research/gap-4.md)):

1. package metadata (npm, PyPI and other registries),
2. LICENSE files of source-installed extensions,
3. the `license` field of every downloaded model card, including nested configurations,
4. license headers inside source files.

## 6. Generative model packs

Model weights are licensed separately from code, and some licenses limit where and how a model can be used. Open3DJ treats each generative model as an optional **model pack**, and every pack ships a **machine-readable license manifest**. The research suggests fields such as `license`, `territory`, `commercial` and `mau_cap` (monthly active user limits). The desktop app will show the manifest to people, and the MCP server will show it to agents, before a pack is used ([research/community-licensing-business.md](research/community-licensing-business.md), section 2).

- **Default packs** use only permissively licensed code, weights and dependencies. Any weak-copyleft exception, such as easydict for TRELLIS (v1) below, is recorded openly in the license gate.
- **Restricted packs** are opt-in only. They are never installed or enabled by default, and their restrictions are shown up front.
- Model weights are accepted only in formats that cannot run code, such as safetensors ([research/security-sandboxing.md](research/security-sandboxing.md), section 8).

| Model | What the research found | How Open3DJ treats it | Source |
|---|---|---|---|
| **TRELLIS (v1)** | Code and weights are MIT. The geometry path has no GPL, AGPL or non-commercial dependencies. Its one weak-copyleft core dependency is easydict (LGPL-3.0), which will either be replaced or recorded as an allowed exception in the [license gate](#5-the-gpl-and-agpl-rule-for-the-core). Its rendering and texture-baking (GLB export) dependencies are not permissive: nvdiffrast (NVIDIA, research or evaluation only), diffoctreerast (research or evaluation only), diff-gaussian-rasterization (non-commercial), pymeshfix (GPL-3.0) and python-igraph (GPL-2.0+). | Candidate default, run geometry-only with permissive substitutes. Texture baking is a separate opt-in pack or a permissive re-implementation. | [gap-4.md](research/gap-4.md) |
| **TripoSG** | Weights are MIT, but the required code is not. The `triposg/` package is under the Tencent Hunyuan FlashVDM Community License, which "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA". The default pipeline also pulls `diso` (CC BY-NC 4.0), RMBG-1.4 (non-commercial) and pymeshlab (GPL-3.0). | Restricted, opt-in pack only | [gap-4.md](research/gap-4.md) |
| **TRELLIS.2** (default pipeline) | Pulls RMBG-2.0 (CC BY-NC 4.0), DINOv3 (custom license with a trade-control clause, gated), and nvdiffrast and nvdiffrec (NVIDIA, non-commercial). | Restricted, opt-in pack only | [gap-4.md](research/gap-4.md) |
| **Hunyuan3D** 2.0 and 2.1 | Tencent Hunyuan 3D Community License. Its territory excludes the EU, the UK and South Korea. Services above 1 million monthly active users need a separate license, and outputs may not be used to train other models. | Restricted, opt-in pack only, with a territory and consent gate | [community-licensing-business.md](research/community-licensing-business.md), section 2 |

**Territory restrictions.** Neural Deep Network LTD is based in the EU, and many of the people we hope will use Open3DJ are in the EU and the UK. Open3DJ will therefore not ship, host or enable Tencent-licensed models by default. Whether the project may offer even an opt-in adapter that users in excluded territories point at weights they obtain themselves is **to verify** with counsel. Hosted providers, 3dj.app included, should declare which models they run and under which licenses.

## 7. Your designs and exported files

**Designs you create with Open3DJ belong to you.** The Open3DJ license covers the software, not what you make with it. Open3DJ claims no rights over your models, scripts, drawings or exported files (STEP, STL, 3MF and others). You can use them, sell them and license them as you choose. Keeping your files open and in your hands is part of the project's [open-core charter](../GOVERNANCE.md#open-core-charter). It also answers a fear the research found among CAD users: losing access to their own files ([research/community-licensing-business.md](research/community-licensing-business.md), section 6).

Some things you bring into a design keep their own terms:

- **Third-party content.** Imported files, templates and standard parts from the library keep their own licenses. Each part in the library states its license and the source of its data.
- **Generative model output.** Some model licenses restrict what you may do with the output. For example, Hunyuan3D outputs may not be used to train other models. The pack's license manifest tells you before you generate.
- **Standards.** Documents such as ISO and DIN standards are copyrighted. Library parts must cite where their dimensions come from and that source's license, and must not reproduce tables from paid standards documents. Whether specific dimensional data may be reused is **to verify** case by case.
- **Cloud providers.** If you choose to send work to a cloud provider, that provider's terms cover what you send. Open3DJ is designed to ask for your consent before anything leaves your machine ([SECURITY.md](../SECURITY.md)).

## 8. Trademark

Neural Deep Network LTD controls the use of the Open3DJ name, and of any future project logo, for this project. The open-source license covers the code, not the name or logo. The MIT license does not grant any trademark rights, and neither would Apache-2.0. You may use the name to refer to the project truthfully. Please do not use it in a way that suggests your fork, product or service is the official project or is endorsed by it. See [GOVERNANCE.md](../GOVERNANCE.md#trademark).

**The name may change before the first public release.** Trademark clearance is in progress. A similar mark, OPEN3D, is a live US registration (Reg. 6468139) for open-source 3D software, so the project is checking the name with counsel before any public listing. "Open3DJ" and "O3DJ" have no US trademark records, and the matching package names and domains were free when checked on 27 October 2026. EU and UK registers could not be checked: **to verify**. Open3DJ is not affiliated with the Open3D library ([research/gap-5.md](research/gap-5.md)).

## 9. Decisions still open

These belong to the founder and Neural Deep Network LTD. This guide will be updated as each one is made.

1. Switch from MIT to MIT OR Apache-2.0 (section 2).
2. A separate license for documentation, such as CC-BY-4.0 (section 2).
3. A permanent commitment never to sell commercial licenses to Open3DJ code, which SignPath signing requires (section 3).
4. The final project name (section 8).

## Questions

Ask in [GitHub Discussions](https://github.com/NeuralDEEPnet/Open3DJ/discussions). If you think something in this guide is wrong, please open a [research check](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=research_check.yml) issue. Corrections are very welcome.
