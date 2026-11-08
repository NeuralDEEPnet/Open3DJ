# Project ideas

Five scoped projects for a student or a new contributor, in the format mentoring programs such as Google Summer of Code use. Each one is tied to a step of the [roadmap](../ROADMAP.md), has a size in hours, and ends in something that can be measured.

Open3DJ cannot take part in Google Summer of Code as its own organization before 2029, and no program runs these ideas today ([ops/programs.md](../ops/programs.md)). The list is here now for three reasons: it is what an umbrella organization or a university asks for first, it shows what a mentored project here looks like, and anyone can pick up an idea outside a program.

**Sizes** follow Google Summer of Code: "~90 hours (Small), ~175 hours (Medium), or ~350 hours (Large)" ([GSoC FAQ](https://developers.google.com/open-source/gsoc/faq), checked 2026-11-08).

**AI use.** Open3DJ is agent-first, and contributors may work with AI agents under [AI_POLICY.md](../AI_POLICY.md): disclose the help in every commit, a person signs off every commit, and a person presses every button on GitHub. A program or university that sets stricter rules for its own students wins for those students.

**The usual rules apply** ([AGENTS.md](../AGENTS.md)): tests with every change, no new language, framework or runtime dependency without an accepted issue or RFC, exact pinned versions that pass the license gate, and the clean-room rule for core code.

**To start on an idea,** open an [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) issue that names it, and say how you would split it into pull requests of about 400 changed lines.

## 1. The MCP client compatibility matrix

- **Size:** 175 hours. **Difficulty:** medium.
- **Roadmap:** [S1 Agent Preview](../ROADMAP.md#s1-agent-preview), "recorded handshakes from real clients (Codex, Gemini CLI, Cursor, VS Code) in the client matrix"; [ARCHITECTURE.md](ARCHITECTURE.md) section 9; goal G7 in [PLAN.md](PLAN.md) section 2.
- **Skills:** TypeScript on Node 24, the MCP protocol, GitHub Actions, test fixtures.
- **The problem:** the server speaks three MCP protocol versions (2025-06-18, 2025-11-25 and 2026-07-28), and each agent client negotiates its own. A client update can break the handshake without anyone noticing until a user reports it.
- **Expected results:**
  - Scripted clients built on the official MCP SDKs open a session at each protocol version and run `tools/list` and one `tools/call` per tool on a fixture project, on all five CI runners, with no secrets, so forks run it too.
  - The opening handshake of each named client, recorded once on a real machine and scrubbed of local paths, replays against the server in CI.
  - A table in [GETTING-STARTED.md](GETTING-STARTED.md) of which client was checked at which version, and the steps to re-record a fixture.
- **Mentor:** the founder (a second mentor wanted).

## 2. The viewer's WebGPU path and the frame-time gate

- **Size:** 350 hours. **Difficulty:** hard.
- **Roadmap:** [S2 See it](../ROADMAP.md#s2-see-it), "the frame-time gate on the 145-occurrence assembly (p95 under 33 ms with WebGPU); a check of the WebGPU path on real GPUs; clash and reference overlays from the report"; [PLAN.md](PLAN.md) section 6, S2 exit.
- **Skills:** WebGPU and WGSL, WebGL2, three.js, browser performance profiling, and access to at least one real GPU.
- **The problem:** the WebGPU path is written but has not been seen rendering on any real GPU. CI machines have no GPU, so only people with hardware can close this ([docs/TESTING.md](TESTING.md#platform-status)).
- **Expected results:**
  - The WebGPU path verified, or fixed, on GPUs from at least three vendors, each with a hardware report.
  - `npm run viewer:bench` results for the 145-occurrence plate on those machines, and the changes that bring p95 frame time under 33 ms with WebGPU (under 50 ms with WebGL2, the proposed target).
  - Clash and reference overlays drawn from the GeometryReport, with tests.
- **Mentor:** the founder (a second mentor wanted).

## 3. A Harbor adapter for the capability split

- **Size:** 175 hours. **Difficulty:** medium.
- **Roadmap:** [S1 Agent Preview](../ROADMAP.md#s1-agent-preview), whose metric is pass^3 on the capability split; [bench/run-capability.md](../bench/run-capability.md).
- **Skills:** containers, agent harnesses, TypeScript, careful benchmark hygiene.
- **The problem:** today an operator runs the 10 capability briefs by hand, 3 times each. [Harbor](https://github.com/harbor-framework/harbor) is an Apache-2.0 framework that runs agents on tasks in sandboxes, and other CAD benchmarks (Parametric CAD Bench, CAD-bench) and Terminal-Bench run on it (checked 2026-11-05). Harbor's task format was not checked (unverified).
- **Expected results:**
  - An RFC first: an adapter adds Docker and a dependency, which needs an accepted RFC under [AGENTS.md](../AGENTS.md).
  - An adapter that gives the agent only the brief and an empty project folder, with no access to the task's reference or mutant scripts, runs it 3 times, and grades each run with `node bench/grade.ts --runs`.
  - The pass^3 table from one complete run with one agent, and a page on how others repeat it.
- **Mentor:** the founder (a second mentor wanted).

## 4. Standard parts under the Library Convention (C6)

- **Size:** 350 hours. **Difficulty:** medium.
- **Roadmap:** [S4 Mates, BOM and library](../ROADMAP.md#s4-mates-bom-and-library), "an ISO fastener and heat-set insert library under a checker"; contract C6 in [ARCHITECTURE.md](ARCHITECTURE.md) section 2; [ASSEMBLIES.md](ASSEMBLIES.md).
- **Skills:** reading public dimension tables and datasheets, TypeScript, JSON Schema, mechanical design.
- **The problem:** agents assemble products from screws, nuts, washers and heat-set inserts, and each needs exact sizes, connectors and bill-of-materials fields from a cited source.
- **Expected results:**
  - The C6 manifest schema and its checker: cited standard or datasheet, units, tolerances, license, connectors anchored to named references, BOM fields.
  - A first set of parts (for example metric socket head screws, hex nuts, washers and heat-set inserts from a vendor datasheet), each with its source and the date it was checked.
  - Tests that build every size and check its measures against the cited numbers.
  - No text or drawings pasted from paid standards ([AGENTS.md](../AGENTS.md#license-hygiene)).
- **Mentor:** the founder (a second mentor wanted).

## 5. An OrcaSlicer quote provider

- **Size:** 175 hours. **Difficulty:** medium.
- **Roadmap:** [S5 Approve and print](../ROADMAP.md#s5-approve-and-print-id-0), "a slicer estimate as a separate process"; the quote provider row in [ARCHITECTURE.md](ARCHITECTURE.md) section 15; the slicer estimate row in [COMPUTE.md](COMPUTE.md) section 2.
- **Skills:** Node child processes, 3MF, cross-platform paths on Windows, macOS and Linux, test doubles.
- **The problem:** before a part is printed or quoted, people want print time and filament use. OrcaSlicer is AGPL, so it may only run as a separate process that the user installs, never linked into Open3DJ ([ARCHITECTURE.md](ARCHITECTURE.md) principle 6).
- **Expected results:**
  - A provider that finds a user-installed OrcaSlicer, slices a part's 3MF with a stated printer profile, and returns print time and filament use labeled as an estimate.
  - A structured error that names the missing tool when OrcaSlicer is not installed, never a download or a build.
  - Tests against a fake slicer binary, so CI needs no OrcaSlicer, and one recorded run against the real one.
- **Mentor:** the founder (a second mentor wanted).
