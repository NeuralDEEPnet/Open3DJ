# Open3DJ

**Open-source, agent-first CAD: AI agents and people design precise, checked parts and assemblies together, on your own computer.**

![The Open3DJ viewer showing the enclosure example: the assembly tree on the left, the lid and base in 3D with fit markers at the four screws, and the selected screw's measures and the fit list on the right.](docs/images/viewer-enclosure.png)

Open3DJ does precise parametric B-rep modeling, the exact solid geometry that engineering and manufacturing depend on. AI agents drive it over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP) and a command-line interface, and every change returns evidence (validity, volume, bounding box, fits, drawings) that a person or an agent can check. It runs locally on Windows, macOS and Linux, and your designs belong to you.

Open3DJ is created by **Neural Deep Network LTD** ([neuraldeep.net](https://www.neuraldeep.net)), based in Dublin and Malta, EU, and built in the open with volunteers, AI agents and the organizations that join us. **The project has no outside contributors yet. You could be the first.**

## What works today

The first vertical slice runs end to end, from a clone:

- **CLI and MCP server.** The `open3dj` command line and a dual-era MCP server (protocol versions 2025-06-18 to 2026-07-28) with five tools: `run`, `inspect`, `render`, `export` and `docs`.
- **A sandboxed DSL.** Scripts in a 3dj-compatible DSL run in a QuickJS sandbox, with the geometry kernel (OCCT as WebAssembly) in a CPU worker pool.
- **Assemblies first.** Shared definitions, occurrences, connectors and `matchTo`, with exact clash, contact and clearance checks that list each gap of a pair.
- **Stable names.** Fingerprint references report each named face or edge as exact, ambiguous or broken.
- **Drawings and exports.** Four-view hidden-line drawings (PNG and SVG), and STEP, STL, GLB and 3MF files with an evidence file of hashes and measures.
- **A local 3D viewer.** `open3dj view` shows the assembly tree, picking, fit markers and live reload on every save. WebGL2 is verified; the WebGPU path is not yet verified on real GPU hardware.
- **Examples and a benchmark.** [10 examples](examples/README.md) with a gallery, [o3dj-bench v0](bench/README.md) with 12 regression and 10 capability tasks, and reference assemblies of 145 and 1,025 occurrences.
- **One command to check it all.** `npm run check` runs the typecheck, every test (about 690), the bench regression split, and the stdout-leak and license gates.

Not yet: there is no desktop app. Nothing is published to npm (the name is pending trademark clearance). CI runs the full check on Linux, macOS and Windows on x64 and ARM, and passes there except for the two goldens below (the browser viewer test is skipped on CI). Nobody outside the project has tested Open3DJ on their own machine yet: see [Help test Open3DJ on your machine](#help-test-open3dj-on-your-machine). No agent has run the capability benchmark yet. **`npm run check` is red on two tests today**: two example goldens (`box-with-lid` and `enclosure`) are waiting for the founder to regenerate them, and until then every CI run fails, so no pull request can merge in either lane. Contributions are welcome now and will merge once that is fixed. See [ROADMAP.md](ROADMAP.md) for the full picture.

### Try it

You need [Node.js 24](https://nodejs.org) and git.

```sh
git clone https://github.com/NeuralDEEPnet/Open3DJ.git
cd Open3DJ
npm ci
npx open3dj run examples/bracket/bracket.o3j.js                     # the GeometryReport
npx open3dj render examples/bracket/bracket.o3j --out bracket.png   # a four-view drawing
npx open3dj export examples/bracket/bracket.o3j --format step       # STEP plus an evidence file
npx open3dj view examples/enclosure/enclosure.o3j.js                # the 3D viewer in your browser
```

Start your own design with `npx open3dj new mypart` (or `--template assembly`).

**Connect an AI agent.** For Claude Code, load the server and the agent skill together with the plugin in this checkout:

```sh
claude --plugin-dir /path/to/Open3DJ/skills/claude-code-plugin
```

Then ask, for example, "make a 60 mm wall bracket with two M4 holes, check it and export STEP". Codex, Gemini CLI, Cursor, VS Code and Claude Desktop use the same server command, `node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp`, plus [skills/open3dj/SKILL.md](skills/open3dj/SKILL.md) as instructions. [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) shows each one.

## Where we're going

Open3DJ aims to be the best agentic CAD software you can get. Agents fail at CAD because they cannot see what their code did, cannot point at geometry reliably, cannot recover from kernel errors and cannot prove the result is right. Open3DJ fixes those four things first, then carries a physical product from a brief and a concept through form, engineering and design for manufacture to a pack a supplier can quote. Agents do most of the work; people approve taste, money and anything that leaves the machine.

| Step | What it delivers | Status |
|---|---|---|
| S0 Line and gauge | Checks, hooks, bench and measurements on real machines | In progress |
| S1 Agent Preview | Write, run, see and export over MCP; every design is an assembly | In progress |
| S2 See it | The local 3D viewer, with GPU and CPU paths | In progress |
| S3 Trust | Print checks, full reference states, error recovery, replay | Next |
| S4 Mates, BOM and library | Fastened mates, bill of materials, standard parts | Later |
| S5 Approve and print | From a brief to a measured printed prototype, with human approvals | Later |
| S6 Mechanisms | Hinges, slides and lids with real degrees of freedom | Later |
| S7a, S7b GPU analysis and providers | GPU speed behind CPU twins; cloud providers with approvals | Later |
| S8a, S8b Concept and massing | Concept boards and editable massing, on GPU or CPU | Later |
| S9 Form and CMF | Surface quality, color, material and finish | Later |
| S10 Molding DFM | Injection-molding rule checks | Later |
| S11 Engineering and validation | Mate solver, tolerance stacks, simulation | Later |
| S12 Handoff and RFQ | Drawings, AP242 and a pack suppliers can quote from | Later |

[ROADMAP.md](ROADMAP.md) gives each step's goal, what ships and how you can help. [docs/PLAN.md](docs/PLAN.md) has the full plan.

## Help test Open3DJ on your machine

Open3DJ runs on your own computer, so we need people with real machines to tell us whether it works on theirs: other operating systems, ARM boards, antivirus scanners and real GPUs that our cloud checks cannot cover. **Platform status:** CI runs the full check on Windows x64 and ARM64, macOS on Apple Silicon, and Linux x64 and ARM64, but nobody outside the project has tested Open3DJ on a real machine yet.

Install with one command, then follow the 15-minute checklist in [docs/TESTING.md](docs/TESTING.md):

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 | iex
```

```sh
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.sh | sh
```

<!-- REMOVE AFTER PULL REQUEST #3 MERGES -->
Until pull request #3 merges, the installers are only on its branch: use the commands in [Before pull request #3 merges](docs/TESTING.md#before-pull-request-3-merges).

Then file a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml) with the output of `open3dj doctor --report`. A report that says "everything worked" helps too, and every tester is credited.

## Join us

The repository is new and the contributor list is empty. Whatever you bring, your work will be visible and credited. There are two ways in, and you can use both.

<table>
<tr>
<td width="50%" valign="top">

### Bring your agent

For people who work with AI agents: Claude Code, Codex, Cursor, Gemini CLI or your own MCP agent.

- **Install the plugin.** `claude --plugin-dir skills/claude-code-plugin` gives your agent the five tools and the skill ([skills/README.md](skills/README.md)).
- **Set the first benchmark score.** Run the [capability split](bench/run-capability.md) (10 briefs, 3 runs each) and share the grader's pass^3 table. No agent has done it yet.
- **Turn failures into tests.** File a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml) or a [bench task](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=bench_task.yml) for what your agent got wrong.
- **Pick a task.** Start with a [starter task](CONTRIBUTING.md#your-agents-first-task) that needs no issue. Issues labeled `agent-ready` are being filed and will show up [here](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3Aagent-ready).
- **Know the rules.** [AI_POLICY.md](AI_POLICY.md): disclose AI help, a person signs off every commit, and your agent never posts on GitHub by itself: you read its draft and press the button. Point your agent at [AGENTS.md](AGENTS.md).

</td>
<td width="50%" valign="top">

### Contribute as a person

For designers, engineers, makers, developers, writers, researchers and students. Many tasks need no code.

- **Start small.** Pick one of the [concrete first tasks](CONTRIBUTING.md#for-people), which need no issue. Issues labeled `good first issue` are being filed and will show up [here](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- **Grow the parts library.** Propose a [standard part](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=part_library.yml) with dimensions and sources.
- **Add an example or test geometry.** A real part you need, or a file that breaks other CAD tools.
- **Test on your machine.** Follow the 15-minute checklist in [docs/TESTING.md](docs/TESTING.md) on Windows, macOS, Linux or ARM and file a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml).
- **Check the research** with a [research check](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=research_check.yml), or **write a design brief** with the [industrial design form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=industrial_design.yml).

</td>
</tr>
</table>

New to GitHub? [Create a free account](https://github.com/signup), then [pick a form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new/choose). Questions are welcome in [GitHub Discussions](https://github.com/NeuralDEEPnet/Open3DJ/discussions). Every contributor is credited in [CONTRIBUTORS.md](CONTRIBUTORS.md) and in the release notes; agents are credited through their operators.

## How contributions are evaluated and merged

Every pull request is checked automatically, so you get an answer quickly and maintainers spend their time where it matters.

- **Automatic checks:** `npm run check` on five platforms (Linux x64 and ARM64, macOS, Windows x64 and ARM64), which includes the bench regression split and the license gate; a DCO sign-off check; and an evaluation that sorts the pull request into a lane by the files it changes.
- **An AI review:** an advisory comment and a label. It never approves and never merges.
- **Auto lane, merged automatically:** pull requests that only touch documentation, examples, new bench tasks, standard parts and similar data that runs only inside the sandbox merge on their own once every check and the AI review pass.
- **Maintainer lane, one approval:** pull requests that touch code, workflows, hooks, dependencies, licenses, governance, agent instructions, this front page and the plan, or existing goldens and images are evaluated the same way, then merge automatically after one maintainer approves.
- **First-time contributors:** a maintainer clicks once to let the checks run on your first pull request. That is GitHub's protection for new contributors.

The lanes are defined in one file, [.github/merge-policy.json](.github/merge-policy.json). The details, including how to see why a pull request is not merging yet, are in [CONTRIBUTING.md](CONTRIBUTING.md#how-your-pull-request-is-evaluated-and-merged).

## Organizations

Companies, universities, labs, makerspaces, print services and other projects can contribute engineering time, parts catalogs, benchmark data, compute or integrations. See [For organizations](CONTRIBUTING.md#for-organizations) or fill in the [Organization offer](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=organization.yml) form.

## How we work

We work in a lean, Kaizen style: small usable releases, a weekly plan-do-check-act review, stop the line on regressions, and every failure root-caused into a regression test. We are blameless and curious: a well-documented experiment that did not work is still a contribution.

## License

[MIT](LICENSE), "Copyright (c) 2026 Neural Deep Network LTD and the Open3DJ contributors". A dual license, MIT OR Apache-2.0, is proposed but not decided. Contributions are signed off under the [Developer Certificate of Origin](CONTRIBUTING.md#sign-your-work-the-developer-certificate-of-origin); there is no CLA, and you keep your copyright. No GPL or AGPL code goes into the core, and Open CASCADE (LGPL-2.1 with an exception) runs as a separate WebAssembly file. Your designs belong to you. [docs/LICENSING.md](docs/LICENSING.md) explains it all in plain language.

## About the name

"Open3DJ" is a working name, pending trademark clearance. If it changes, we will rename the repository (GitHub redirects old links), and your work and your credit carry over unchanged.

## Project documents

| File | What it covers |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Where the project is going, step by step, and how to help |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute, and how pull requests are evaluated and merged |
| [AGENTS.md](AGENTS.md) | Rules and standard work for AI coding agents |
| [AI_POLICY.md](AI_POLICY.md) | Disclosure, human-only sign-off, and what bots may and may not do |
| [GOVERNANCE.md](GOVERNANCE.md) | How decisions are made, the open-core charter and the path to a neutral foundation |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, with a section on AI agents |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |
| [CONTRIBUTORS.md](CONTRIBUTORS.md) | Everyone who has helped |
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | Your first part, for people and for agents |
| [docs/TESTING.md](docs/TESTING.md) | Install with one command and test Open3DJ on your machine in 15 minutes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The technical architecture, contracts and agent tools |
| [docs/research/README.md](docs/research/README.md) | Research on AI CAD, kernels, agent protocols, security and licensing |
| [CITATION.cff](CITATION.cff) | How to cite Open3DJ |

---

Open3DJ is created by [Neural Deep Network LTD](https://www.neuraldeep.net) and the Open3DJ contributors.
