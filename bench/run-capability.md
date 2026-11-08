# Running the capability split

The capability split measures what an agent achieves with Open3DJ over MCP: it gets only a client's brief, and the grader checks the design it leaves behind. This page is the procedure for a weekly run with Claude Code. It needs no secrets in the repository and no automation: an operator runs it by hand on their own machine and subscription, and copies the result into the Friday scorecard ([ops/scorecard/TEMPLATE.md](../ops/scorecard/TEMPLATE.md)).

## Why the agent must not see this repository

Every task's reference solution and seeded mutants sit in `bench/tasks/` of this repository. An agent that can read them can copy an answer instead of designing one. This is not hypothetical: a review of agent benchmark submissions found agents that read the test files, read answers from `AGENTS.md` files and copied from `git log` ([DebugML, "cheating agents"](https://debugml.github.io/cheating-agents/), checked 2026-11-05). So every run follows three rules:

1. **The project folder is outside the clone.** The Open3DJ MCP server is rooted in an empty run folder (`mcp --root <empty dir>`). Its tools read and write only projects under that root (`packages/mcp/src/paths.ts`).
2. **The agent has no file or shell tools.** The session offers only the Open3DJ MCP tools. If your client cannot turn off its own file and shell tools, the MCP server runs from a copy of the repository without `bench/tasks` and without its git history ([Other clients](#other-clients)).
3. **The full transcript is kept** next to each run. The grader reads it and reports the run as suspect when it mentions `bench/tasks`, a `reference.o3j.js` or `mutant*.o3j.js` script, or the [canary](README.md#the-canary). A suspect run never counts as a pass until a person has read its transcript.

## What you need

- A checkout of this repository at the commit you want to measure, with `npm ci` done and `npm run check` green. Below, `$O3DJ` is the path to it.
- Claude Code, signed in with your own account. The flags below were checked against `claude --help` of Claude Code 2.1.319, the [CLI reference](https://code.claude.com/docs/en/cli-reference) and the [permissions page](https://code.claude.com/docs/en/permissions) on 2026-11-08. Other MCP clients (Codex, Gemini CLI) can run the same procedure when their quotas allow; record which client you used.
- About 2 to 4 hours for 10 tasks x 3 runs. You can spread the runs over the week.

## Procedure

1. **Make a run folder outside the repository**, so nothing from the runs lands in git, with one empty folder per task and run:

   ```sh
   O3DJ=/path/to/Open3DJ
   RUNS=~/o3dj-bench-runs/2026-10-30-claude-code
   for t in $(ls "$O3DJ/bench/tasks" | grep '^cap-'); do for k in 1 2 3; do mkdir -p "$RUNS/$t/run-$k"; done; done
   ```

2. **For each task and each run k (1, 2, 3), start a fresh session** in its empty folder, with the Open3DJ MCP server rooted there and no built-in tools. For example, for run 1 of `cap-pi5-case`:

   ```sh
   cd "$RUNS/cap-pi5-case/run-1"
   SID=$(node -e "console.log(crypto.randomUUID())")
   claude --session-id "$SID" --tools "" --strict-mcp-config \
     --mcp-config "{\"mcpServers\":{\"open3dj\":{\"command\":\"node\",\"args\":[\"$O3DJ/packages/open3dj/src/cli.ts\",\"mcp\",\"--root\",\"$PWD\"]}}}" \
     --allowedTools "mcp__open3dj__*" --permission-mode dontAsk
   ```

   - `--tools ""` turns off every built-in tool: no file reads, no searches, no shell. It leaves MCP tools alone.
   - `--strict-mcp-config` with `--mcp-config` loads only the Open3DJ server, so no other MCP server you have set up (a file system or GitHub server, for example) can reach the clone.
   - The server is the same as `npx open3dj mcp --root <dir>` started inside the clone. Outside the clone, `npx open3dj` would look for a package on npm, so use the path to `cli.ts`.
   - `--allowedTools "mcp__open3dj__*"` approves the Open3DJ tools, and `--permission-mode dontAsk` denies anything else instead of asking you.
   - `--session-id` names the session, so you can find its transcript in step 5.

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

5. **Save the full transcript next to the run**, after the session ends. Claude Code keeps each session as a JSONL file named after its session id under `~/.claude/projects/` (seen with Claude Code 2.1.319 on 2026-11-08):

   ```sh
   cp ~/.claude/projects/*/"$SID".jsonl "$RUNS/cap-pi5-case/run-1/transcript.jsonl"
   ```

   The grader reads every file in the run folder whose name starts with `transcript`, so another client's export can be saved as `transcript.md` or `transcript.txt`. Save the whole session, every message and tool call, not a summary.

6. **Record for each run**, in a scratch note: the client and its version, the run time in minutes, the number of tool calls, and the tokens if your client shows them. Do not record anything from the brief or the transcript that you would not publish.

7. **Grade the whole folder** from the repository root:

   ```sh
   node bench/grade.ts --runs "$RUNS"
   ```

   The grader runs each `run-k/solution.o3j/main.o3j.js` with the values saved in that project's `params.o3j.json` (by `run` params or `set_param`) over the task's params, which is what the project's next run would build, through the real compute pool (add `--cli` to use fresh CLI processes). A run with no `solution.o3j` fails. Then it checks each run: the run is **suspect** when a transcript mentions `bench/tasks`, a reference or mutant script or the canary, or when the solution script holds the canary. The grader prints every failed assertion and every suspect run with the file and line that made it suspect, a table of runs passed, suspect runs and runs without a transcript per task, and the pass^3 total, and writes `$RUNS/grades.json`. Suspect runs never count as passes, and a task with one is not a pass^3 task.

## Other clients

If your client cannot run without its own file and shell tools, do not start the MCP server from your clone. Start it from a copy that has no `bench/tasks` and no `.git` folder (a clone's git history holds the tasks too), and keep that copy away from the clone:

```sh
mkdir -p ~/o3dj-clean
git -C "$O3DJ" archive --format=tar --prefix=open3dj/ HEAD -- . ':(exclude)bench/tasks' | tar -x -C ~/o3dj-clean
cd ~/o3dj-clean/open3dj && npm ci
```

`git archive` writes the files of the commit without the `.git` folder, and the `:(exclude)` pathspec leaves `bench/tasks` out (checked with git 2.43.0 on 2026-11-08: the archive held no file under `bench/tasks` and no `.git` folder). Point the client's MCP server at `~/o3dj-clean/open3dj/packages/open3dj/src/cli.ts`, start the session in the empty run folder, and still save the full transcript. File tools can still search the whole disk, so the transcript check matters more here, not less. Grade from the original clone, which has the tasks.

## Reporting

Copy into the week's scorecard, under Product:

| Field | Value |
|---|---|
| Commit | the hash you measured |
| Client | for example Claude Code, with its version |
| pass^3 | from the grader, for example 6 of 10 tasks (60%) |
| pass@1 | passing runs out of 30 (suspect runs are not passes) |
| Suspect runs | from the grader, with one line per run on what its transcript shows |
| Median minutes and tool calls per run | from your notes |
| Tasks that changed since last week | each task that went from pass to fail or back, with one line on why |

A drop of 2 or more tasks across 3 runs is a yellow andon for the Friday A3 ([PLAN.md](../docs/PLAN.md) section 4.4). Every failed run that shows a product problem (a confusing error, a missing DSL entry, a misleading report) becomes a failure report ([.github/ISSUE_TEMPLATE/failure_report.yml](../.github/ISSUE_TEMPLATE/failure_report.yml)) and, where a brief can reproduce it, a new bench task.

## Rules that keep the numbers honest

- The same prompt, the same limits and no help, every run.
- The agent never gets file or shell tools on the clone, and every run keeps its full transcript.
- A suspect run is read by a person. If the agent read a task file, the run fails and the report says so. If the mention is harmless (for example the agent named one of its own files `reference.o3j.js`), say so in the report and count the run by hand. Never edit a transcript.
- Never edit a task's brief or assertions to make a run pass. Changing a task bumps its `version` and is a separate pull request with a reason.
- Tasks are public, so agents may have seen them. A held-out split that runs only in maintainer CI is planned ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 16).
- Keep the run folders until the scorecard is committed, in case a grade is questioned. They contain your agent's work and transcripts, not secrets; still, do not publish transcripts without reading them first.
