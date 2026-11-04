# Contributors

**Open3DJ was created by Neural Deep Network LTD** ([neuraldeep.net](https://www.neuraldeep.net)), based in Dublin and Malta, EU.

Open3DJ is built by people, by AI agents working with people, and by organizations. Every kind of contribution counts here: code, design, documentation, research, testing, test data, parts, translation, review, ideas, bug reports, mentoring, compute and funding. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. You are added to this file with your first merged contribution, and you are welcome to add yourself in that pull request. A useful issue counts too: when a maintainer acts on your research check, part proposal, design brief or feedback, we add you here (or you can add yourself in a one-line pull request).

## Be the first

The tables below are almost empty. That is not a sign that nobody is welcome; it is a sign that the project is new. The first slice works today ([what works](ROADMAP.md#what-works-today)), and the first names on this page will be the people who helped shape it. Pick the path that suits you, or both.

**Bring your agent.** If you work with Claude Code, Codex, Cursor, Gemini CLI or your own MCP agent:

- Load the [Claude Code plugin](skills/README.md), or connect your client with [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md#for-agents), and ask your agent to design something real.
- Run the [capability benchmark](bench/run-capability.md) and share the score. Nobody has posted one yet, so yours becomes the baseline.
- Turn what your agent got wrong into a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml) or a [bench task](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=bench_task.yml), or take a [starter task](CONTRIBUTING.md#your-agents-first-task) that needs no issue (issues labeled [`agent-ready`](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3Aagent-ready) are being filed). The rules are in [AI_POLICY.md](AI_POLICY.md).

**Contribute as a person.** If you design, engineer, make, code, write or research:

- Pick a [concrete first task](CONTRIBUTING.md#for-people) that needs no issue (issues labeled [`good first issue`](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3A%22good+first+issue%22) are being filed), or propose a [standard part](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=part_library.yml).
- Install Open3DJ on your own machine with [docs/TESTING.md](docs/TESTING.md) (no person outside the project has tested it yet), run `open3dj doctor --report` and paste its output into a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml).
- Add an example, send test geometry that breaks other tools, check a research claim, or write a design brief.

Documentation, examples, new bench tasks and similar data merge automatically once every check and the AI review pass, so your first contribution can land quickly ([how merging works](CONTRIBUTING.md#how-your-pull-request-is-evaluated-and-merged)). Then add your row below. (One caveat today: `npm run check` is red until two example goldens are regenerated, so nothing merges until then. See the README.)

## Maintainers

| Maintainer | GitHub | Role |
|---|---|---|
| Neural Deep Network LTD | [NeuralDEEPnet](https://github.com/NeuralDEEPnet) | Creator, lead maintainer |

## People

Designers, engineers, makers, developers, writers, researchers and students.

| Name | GitHub | Contributions |
|---|---|---|
| *Your name here* | | *Your first part spec, example, test file, hardware report, doc fix, research check or idea. [Start here.](CONTRIBUTING.md#for-people)* |

## AI agents

AI agents are credited through their human operators, who are accountable for the work.

| Agent | Operator | Contributions |
|---|---|---|
| neuraldeep.net design agents | Neural Deep Network LTD | Research, planning, spikes, the first vertical slice, the viewer, o3dj-bench and documentation |
| *Your agent here* | *You* | *The first capability benchmark score, a failure report, a bench task or an `agent-ready` issue. [Start here.](CONTRIBUTING.md#for-ai-agents-and-their-operators)* |

## Organizations

Companies, universities, labs, makerspaces, print services, manufacturers and other open-source projects.

| Organization | Contributions |
|---|---|
| *Your organization here* | *Engineering time, parts catalogs, benchmark data, compute, integrations. [Start here.](CONTRIBUTING.md#for-organizations)* |

## How to add an entry

Add one row to the right table in your pull request:

```markdown
| Your Name | [your-handle](https://github.com/your-handle) | Parts library (ISO 4032 nut), docs |
```

Please link GitHub profiles as plain links, as above, rather than writing an at-sign mention, so nobody gets pinged by every edit to this file.

## Standing on the shoulders of

The Open3DJ plan builds on the work of these open-source projects and their communities. Thank you. Their licenses and notices will be listed in the repository's notice files as their code comes into use.

| Project | What it gives us |
|---|---|
| [Open CASCADE Technology (OCCT)](https://github.com/Open-Cascade-SAS/OCCT) | The B-rep geometry kernel at the heart of precise CAD |
| [Manifold](https://github.com/elalish/manifold) | Fast, robust mesh booleans |
| [three.js](https://github.com/mrdoob/three.js) | 3D rendering for the user interface |
| [build123d](https://github.com/gumyr/build123d) | Python parametric CAD on OCCT, and a model for agent-friendly CAD code |
| [brepjs](https://github.com/andymai/brepjs) | A pluggable kernel interface for B-rep CAD in JavaScript |
| [occt-wasm](https://github.com/andymai/occt-wasm) | OCCT compiled to WebAssembly behind a handle-based facade |
| [Model Context Protocol](https://modelcontextprotocol.io) | The open protocol that lets AI agents use Open3DJ as a tool |
