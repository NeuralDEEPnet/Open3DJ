# Agent Build Night

Once a month, everyone works on the same design brief. Operators point their own agents (Claude Code, Codex, Cursor, Gemini CLI or any MCP client) at Open3DJ, and the evidence files decide which designs meet the brief. Nobody votes and nobody judges by eye. Each person posts their own results. Each brief can later become a capability task in [o3dj-bench](../../bench/README.md).

Bring your Claude Code, Codex or Cursor agent. It does the work, you press the button.

## The rules

1. **One brief per month,** in this folder, named `YYYY-MM-<short-name>.md`. It is written like a capability brief: a client's words, named parts, numbers, and a list of checks that each map to evidence.
2. **The evidence decides.** A design meets the brief when every check in the brief passes in the evidence files: the run report, the fits, the print checks, the drawing and the export's evidence file. A check that needs a person's eye says so.
3. **Same start for everyone.** A fresh agent session, the prompt below with the brief pasted in, and no help after that. If the agent asks a question, the answer is "Use your judgement and state your assumptions." These are the rules of the capability split ([bench/run-capability.md](../../bench/run-capability.md#rules-that-keep-the-numbers-honest)).
4. **Each person posts their own results,** by hand, in the Build Night's discussion thread. Say which client and model you used; that is your choice and your post.
5. **Agents never post.** No agent opens a thread, replies, votes or sends a message, anywhere ([AI_POLICY.md](../../AI_POLICY.md) rule 4). Hacker News forbids generated text and automated posting ([guidelines](https://news.ycombinator.com/newsguidelines.html), checked 2026-11-05).
6. **One human-written announcement per community,** written for that community, spaced out so the founder can answer each thread. Never the same text everywhere, and never a request for votes or stars ([outreach/README.md](../outreach/README.md#community-norms)).
7. **No "first" claims** about the field. "The first run to pass every check of this brief" is fine, because it is about our brief.

## Before the night

The founder, about one week ahead:

- [ ] The brief is merged on `main`, and CI is green.
- [ ] One person has tried the brief with an agent, or at least checked by hand that every check can be read from the evidence.
- [ ] A discussion thread is open in [Show and tell](https://github.com/NeuralDEEPnet/Open3DJ/discussions), written by the founder: the brief's link, the date and time with a time zone, and the results template below.
- [ ] One announcement per community that wants it, each written by hand ([outreach/communities.md](../outreach/communities.md)).

## On the night: for operators

1. **Install Open3DJ** ([docs/TESTING.md](../../docs/TESTING.md#install)), or use a clone with `npm ci` done.
2. **Make an empty run folder outside any Open3DJ clone,** and root the MCP server there, so the agent sees only its own project:

   ```sh
   mkdir -p ~/build-night/2026-12/run-1 && cd ~/build-night/2026-12/run-1
   claude mcp add open3dj -- open3dj mcp --root .
   claude
   ```

   With a clone instead of the installer, use `node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp --root .`. Other clients: [GETTING-STARTED.md](../../docs/GETTING-STARTED.md#connect-a-client). Do not give the agent file tools on an Open3DJ clone: `bench/tasks` holds reference solutions.
3. **Paste this prompt,** with the brief's text in place of `<brief>`, and nothing else:

   ```text
   You are designing a part for a client with the Open3DJ MCP tools (run, inspect, render, export, docs).
   Work in the project solution.o3j in this folder. Use docs to look up the DSL. Check your design with
   run and inspect (fits and measures) and look at it with render before you finish. When you are done,
   the project's current script is your answer. Units are mm and Z is up.

   The client's brief:
   <brief>
   ```

4. **Let it finish:** when the agent says it is done, after 60 minutes, or after 100 tool calls, whichever comes first.
5. **Collect the evidence** with the commands in the brief, from the run folder.
6. **Post your results** in the thread, by hand, with the template below. Read your transcript before you share any part of it.

## Results template

```text
Client and version:
Model (your choice to share):
Minutes and tool calls:
Checks passed: x of y (list the failed ones)
Print checks: pass / fail, open and waived counts, and each waiver's reason
Drawing: (attach hinge.png or the brief's drawing)
Printed it? (optional) printer, material, and what happened
What the agent got wrong, and what helped it recover:
```

## After the night

- The founder adds one entry to the [build log](../build-log.md): how many runs, how many passed every check, and the most common failure.
- Every failure that shows a product problem (an unclear error, a missing DSL entry, a misleading report) becomes a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml), filed by a person.
- **The brief becomes a capability task** when someone writes a reference solution and a seeded mutant and task-lint passes ([bench/README.md](../../bench/README.md#adding-a-task)). A new task is only new files under `bench/tasks/<id>/`, so it merges in the auto lane and needs no test change: `scripts/bench.test.ts` requires at least 10 capability tasks, not exactly 10.

## In person

A Build Night can also run in a room. MLH Hack Days are "12-hour-or-less, in-person mini hackathons", and MLH reimburses "up to 350 USD for food, snacks, and other event expenses" and pays "7 USD" per checked-in hacker ([mlh.com/hack-days](https://www.mlh.com/hack-days), checked 2026-11-05; who may host is not stated). Hacktoberfest 2026 ran its local events as Hack Days or Meet Ups ([ops/programs.md](../programs.md#hacktoberfest)). Bring a printer if you can: a part that prints and moves is the best evidence of all.

## Briefs

| Month | Brief | Becomes |
|---|---|---|
| December 2026 | [Print-in-place hinge](2026-12-print-in-place-hinge.md) | a capability task, after a reference and a mutant |
