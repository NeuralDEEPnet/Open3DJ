# Running the capability split

The capability split measures what an agent achieves with Open3DJ over MCP: it gets only a client's brief, and the grader checks the design it leaves behind. This page is the procedure for a weekly run with Claude Code. It needs no secrets in the repository and no automation: an operator runs it by hand on their own machine and subscription, and copies the result into the Friday scorecard ([ops/scorecard/TEMPLATE.md](../ops/scorecard/TEMPLATE.md)).

## What you need

- A checkout of this repository at the commit you want to measure, with `npm ci` done and `npm run check` green.
- Claude Code, signed in with your own account. Other MCP clients (Codex, Gemini CLI) can run the same procedure when their quotas allow; record which client you used.
- About 2 to 4 hours for all 10 tasks x 3 runs. You can spread the runs over the week.

## Procedure

1. **Make a run folder outside the repository**, so nothing from the runs lands in git:

   ```sh
   RUNS=~/o3dj-bench-runs/2026-10-30-claude-code
   for t in $(ls bench/tasks | grep '^cap-'); do for k in 1 2 3; do mkdir -p "$RUNS/$t/run-$k"; done; done
   ```

2. **For each task and each run k (1, 2, 3), start a fresh session** in `$RUNS/<task>/run-k`, with the Open3DJ MCP server rooted there. From that folder:

   ```sh
   claude mcp add open3dj -- node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp --root .
   claude
   ```

   Every run is a new session with no memory of earlier runs. Do not reuse a session across tasks or runs.

3. **Paste the prompt below**, with the task's `brief` from `bench/tasks/<task>/task.json` in place of `<brief>`. Paste nothing else: no hints, no reference solution, no follow-up help. If the agent asks a question, answer "Use your judgement and state your assumptions." and nothing more.

   ```text
   You are designing a part for a client with the Open3DJ MCP tools (run, inspect, render, export, docs).
   Work in the project solution.o3j in this folder. Use docs to look up the DSL. Check your design with
   run and inspect (fits and measures) and look at it with render before you finish. When you are done,
   the project's current script is your answer. Units are mm and Z is up.

   The client's brief:
   <brief>
   ```

4. **Let the agent finish.** A run ends when the agent says it is done, or after 60 minutes, or after 100 tool calls, whichever comes first. A run that hits a limit is graded as it stands.

5. **Record for each run**, in a scratch note: the client and its version, the run time in minutes, the number of tool calls, and the tokens if your client shows them. Do not record anything from the brief or the transcript that you would not publish.

6. **Grade the whole folder** from the repository root:

   ```sh
   node bench/grade.ts --runs "$RUNS"
   ```

   The grader runs each `run-k/solution.o3j/main.o3j.js` with the values saved in that project's `params.o3j.json` (by `run` params or `set_param`) over the task's params, which is what the project's next run would build, through the real compute pool (add `--cli` to use fresh CLI processes), prints every failed assertion, a table of runs passed per task, and the pass^3 total, and writes `$RUNS/grades.json`. A run with no `solution.o3j` fails.

## Reporting

Copy into the week's scorecard, under Product:

| Field | Value |
|---|---|
| Commit | the hash you measured |
| Client | for example Claude Code, with its version |
| pass^3 | from the grader, for example 6 of 10 tasks (60%) |
| pass@1 | passing runs out of 30 |
| Median minutes and tool calls per run | from your notes |
| Tasks that changed since last week | each task that went from pass to fail or back, with one line on why |

A drop of 2 or more tasks across 3 runs is a yellow andon for the Friday A3 ([PLAN.md](../docs/PLAN.md) section 4.4). Every failed run that shows a product problem (a confusing error, a missing DSL entry, a misleading report) becomes a failure report ([.github/ISSUE_TEMPLATE/failure_report.yml](../.github/ISSUE_TEMPLATE/failure_report.yml)) and, where a brief can reproduce it, a new bench task.

## Rules that keep the numbers honest

- The same prompt, the same limits and no help, every run.
- Never edit a task's brief or assertions to make a run pass. Changing a task bumps its `version` and is a separate pull request with a reason.
- Tasks are public, so agents may have seen them. A held-out split that runs only in maintainer CI is planned ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 16).
- Keep the run folders until the scorecard is committed, in case a grade is questioned. They contain your agent's work, not secrets; still, do not publish transcripts without reading them first.
