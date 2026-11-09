# o3dj-bench leaderboard

This page lists results of the o3dj-bench capability split: an AI agent gets a client's brief, builds a multi-part design with Open3DJ over MCP, and a deterministic grader checks what it leaves behind. Anyone can submit a result. Your agent does the runs; you check the files and open the pull request.

There are no results yet. The first submission sets the baseline.

## What it measures

- **An agent and Open3DJ together.** The agent is a client (such as Claude Code, Codex or Cursor), a model and their settings. It works only through Open3DJ's five MCP tools (`docs`, `run`, `inspect`, `render` and `export`), from the brief alone.
- **The capability tasks** in [bench/tasks/](bench/tasks/) (`cap-*`), 10 today. Each one is a multi-part assembly brief, such as a Raspberry Pi 5 case with standoffs or a remote control shell with a battery door. Its assertions check the report status, valid solids, measures, part and occurrence counts, clones, and fits and clearances between named parts. Each task has a reference solution that passes and a seeded mutant that must fail, and task-lint checks both on every pull request ([bench/README.md](bench/README.md)).
- **pass^3:** the share of tasks that pass in all 3 fresh runs. **pass@1:** the passing runs out of 3 per task (30 with 10 tasks). A user who asks three times should get a good design three times, so pass^3 is the headline number.
- **A deterministic grade.** `node bench/grade.ts --runs <dir>` runs each agent's final project script through Open3DJ's compute pool and evaluates the task's assertions. It uses no model and no judgment: re-grading the same folder at the same commit should give the same pass or fail for every run, and a difference is treated as a bug.

## What it does not measure

- General CAD skill, or skill with other CAD tools and languages (CadQuery, build123d, FreeCAD, OpenSCAD).
- Drawing-to-CAD, reverse engineering, sketching or surfacing.
- Printability. The 3D printing gates are not in the task assertions yet, so a brief cannot require a printable part.
- A ranking of models. The same model in another client, or with other settings, can score differently.
- Speed and cost. Minutes, tool calls, tokens and cost are recorded when known, but they do not rank anything.

## Limits: read these next to every score

1. **10 public tasks today.** One task is 10 points of pass^3. With n=10, a 95% interval is wide: 5 of 10 is 24% to 76%. Our own calculation with the Wilson score interval, for k tasks passed of 10:

   | Passed | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | 95% interval (%) | 0-28 | 2-40 | 6-51 | 11-60 | 17-69 | 24-76 | 31-83 | 40-89 | 49-94 | 60-98 | 72-100 |

   Two rows whose intervals overlap may not differ at all. At n=10, the intervals of two rows stop overlapping only when the rows are 6 or 7 tasks apart. The project's weekly runs of one agent use a smaller step: a drop of 2 or more tasks is a yellow andon, a signal to look for a regression ([docs/PLAN.md](docs/PLAN.md) section 4.4). It does not show that two rows differ.
2. **Contamination is possible.** Every task, reference and mutant is public on GitHub, so a model may have seen them in training. A held-out split that runs only in maintainer CI is planned, not built ([bench/README.md](bench/README.md#not-yet)).
3. **Runs are done by hand** by each submitter, on their own machine and account.
4. **Scores only measure an agent plus Open3DJ.** They cannot be compared with the scores of other CAD benchmarks, which use other tools, tasks and metrics.

## Results

Rows are sorted by pass^3, then pass@1, then date. Every row states the commit it was measured at, because tasks and Open3DJ change.

| Agent (version) | Organization | Model (provider) | MCP client (version) | Open3DJ commit | pass^3 (95% interval) | pass@1 | Tier | Date | Details |
|---|---|---|---|---|---|---|---|---|---|
| No submissions yet | | | | | | | | | |

## Tiers

- **Self-reported.** The submitter ran the tasks and graded them, and every required file below is linked. A maintainer checks that the fields are complete and the files are there, not that the numbers are right.
- **Verified.** A maintainer re-graded the submitted run folders in their own clone, as below, and got the same pass or fail for every run. The maintainer also read the transcripts and found the prompt and limits unchanged, no task left out and no rule below broken. The re-grade is deterministic and takes minutes.

Submit every result as self-reported. Only a maintainer changes a row to verified, in a pull request of their own. A run that breaks a rule below is marked suspect, and a result with a suspect run is not verified. This page is in the maintainer lane ([CONTRIBUTING.md](CONTRIBUTING.md#two-lanes)), so every change to it, a new row included, merges only after a maintainer approves it.

### How a maintainer re-grades a result

1. **The stated commit must be on `main`.** In your own clone of this repository, run `git fetch origin main` and `git merge-base --is-ancestor <commit> origin/main`. If it exits with anything but 0, reject the submission. Never fetch the commit from a fork or a pull request (such as `refs/pull/<n>/head`): its code is not reviewed, `npm ci` and the grader would run it on your machine, and a changed task or grader can pass anything.
2. **Check out that commit in your clone,** for example in a separate worktree (`git worktree add --detach <path> <commit>`), and run `npm ci --ignore-scripts` there.
3. **Download the archive** into a new, empty folder outside the clone and check its sha256 against the entry. The archive comes from a stranger, so look before you extract: `tar -tvzf <archive>` must list only plain files and folders (every line starts with `-` or `d`), and no name may start with `/` or contain `..`. Reject it otherwise: a symbolic link in it could make the grader read or overwrite a file outside the folder. Then extract it there and check again: `find <dir> ! -type f ! -type d` must print nothing.
4. **Move the submitted `grades.json` aside,** for example `mv <dir>/grades.json <dir>/../submitted-grades.json`. The grader writes its own `grades.json` into the folder it grades, so otherwise you would compare the re-grade with itself.
5. **Grade it** from the root of the checkout: `node bench/grade.ts --runs <dir>`. Compare the pass or fail of every run, and its suspect and unchecked marks, with `submitted-grades.json`. The grader runs the agent's scripts only inside the project sandbox. Its own reads and writes of the folder happen outside it, which is why step 3 checks the archive; graders from this page's commit on also refuse a folder that holds a symbolic link or special file.

## Rules that keep the numbers honest

The full procedure is [bench/run-capability.md](bench/run-capability.md). These rules apply to every submission:

- **The agent sees only the brief,** inside the unmodified prompt from run-capability.md. No hints, no reference solution and no follow-up help. If the agent asks a question, the only answer is the one run-capability.md gives.
- **The agent never reads the tasks.** `bench/tasks/` holds the assertions, the reference solutions and the mutants, so an agent that can read it can copy an answer. Root the MCP server in an empty project folder outside the Open3DJ clone, and give the agent no file or shell access to the clone. A transcript that shows the agent reading `bench/tasks/`, or any other part of the clone, makes that run suspect. The grader marks a run suspect by itself when its transcript mentions `bench/tasks`, a reference or mutant script or [the canary](bench/README.md#the-canary), or when its solution holds the canary.
- **Every run keeps its full transcript.** A run folder without one is unchecked, and the grader never counts it as a pass, even when its design passes.
- **Fresh sessions.** Each of the 3 runs per task is a new session with no memory of other runs or tasks.
- **The same limits for every run:** 60 minutes or 100 tool calls, whichever comes first. A run that hits a limit is graded as it stands.
- **Report every run you made.** Do not run a task more than 3 times and keep the best 3.
- **Every capability task at the stated commit** (10 today). A result with fewer tasks can be submitted. It names the tasks it covers and is listed after the full results.
- **No edits to tasks.** Grade at the commit you ran, with its tasks unchanged.

## How to submit

1. Run every capability task (`bench/tasks/cap-*` at that commit, 10 today) 3 times each, as [bench/run-capability.md](bench/run-capability.md) describes, at one Open3DJ commit on `main`. A result measured at a commit from a fork or an open pull request is not accepted.
2. Grade the folder from the repository root, at that commit: `node bench/grade.ts --runs <dir>`. Keep its console output and the `grades.json` it writes.
3. Put the run folders (`<dir>/<task>/run-1` to `run-3`, each with the agent's `solution.o3j` project and its full transcript, every message and tool call, saved as `transcript.jsonl` or another name that starts with `transcript`) and `grades.json` into one `.tar.gz` archive with plain files and folders only, no symbolic links. Read the transcripts before you publish them. Host the archive where a maintainer can download it, such as a release asset or a dataset in your own account, and note its sha256. Do not commit run folders or transcripts to this repository.
4. Open a pull request that changes only this file: add one row to the results table with the tier "self-reported", and one entry under [Submissions](#submissions) from the template below. As [AI_POLICY.md](AI_POLICY.md) says, your agent may draft it, but you read it and open the pull request yourself.

Type the model id and provider yourself, in the row and in the entry, exactly as your client or API names them. The project does not check or normalize them. If an agent drafts the pull request, it leaves `<model id>` and `<provider>` as placeholders: some agents, the project's own among them, must not write model names into files ([AGENTS.md](AGENTS.md#git-and-pull-requests)). Here the model is what is being measured, so a person types it as result data.

```text
Agent: <agent name> <version>
Agent organization: <who builds the agent>
Model: <model id>, provider <provider>, reasoning or effort setting <setting, or "default">
MCP client: <client name> <version>
Submitter: <your GitHub account>
Open3DJ commit: <full commit hash, on main>
Tasks: cap-<id> v<version>, ... (the version field of each task.json at that commit)
Runs: 3 fresh sessions per task
Prompt and limits: unmodified from bench/run-capability.md (60 minutes, 100 tool calls)
Archive: <URL>, sha256 <hash>
Archive contents: run folders, each with its transcript, and grades.json
Grader output: <the console output of node bench/grade.ts --runs <dir>, pasted below the entry>
pass^3: <k> of <N tasks> (<interval from the table above, for N=10>), pass@1: <n> of <3N>
Suspect runs: <n, with one line each on what its transcript shows>; runs without a transcript: 0
Per run, if known: minutes, tool calls, tokens, cost
Run dates: <first date> to <last date>
Notes: <anything a maintainer should know, such as a task you left out>
```

## Challenges

**First agent to pass `cap-<id>` at pass^3.** For each capability task, the first verified result that passes it in all 3 runs is recorded here with the agent, its operator and the task version. The challenges are about o3dj-bench tasks only. When a task's version changes, its record stays, marked with the old version, and the challenge opens again for the new one.

| Task | Brief | First verified pass^3 |
|---|---|---|
| `cap-button-panel` | Button panel with three caps | Open |
| `cap-cable-organiser` | Desk cable organiser | Open |
| `cap-din-clip-box` | DIN-rail clip enclosure | Open |
| `cap-fan-shroud` | Fan shroud with M3 inserts | Open |
| `cap-junction-box` | Wall-mount junction box with screwed lid | Open |
| `cap-light-pipe-box` | Status box with light pipes | Open |
| `cap-pi5-case` | Raspberry Pi 5 case with standoffs | Open |
| `cap-powerbank-shell` | Small power bank shell | Open |
| `cap-remote-shell` | Remote control shell with battery door | Open |
| `cap-sensor-pod` | Sensor pod with snap lid | Open |

## Submissions

No submissions yet.

## Other CAD benchmarks

Other public benchmarks test AI systems on CAD work, several of them with agents and assemblies. They use other tools, tasks and metrics, so their scores and these cannot be compared. This list is not complete; all pages were checked on 2026-11-05.

- **BenchCAD** ([leaderboard](https://benchcad.com/leaderboard), [BenchCAD 2 post](https://benchcad.com/blog/benchcad-2.html)): parts and assemblies from drawings, and reverse engineering, in a CadQuery sandbox, scored without an LLM judge. It keeps one board for its standard harness and one for customized harnesses, where coding agents such as Claude Code and Codex appear.
- **Parametric CAD Bench** ([cadbench.ai](https://cadbench.ai/), [V3 paper](https://arxiv.org/abs/2611.02659)): 100 FreeCAD tasks (from text, create then edit, and from drawings) with deterministic scoring, ranking model and agent pairs.
- **CADGenBench** ([leaderboard Space](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench), [code](https://github.com/huggingface/cadgenbench)): single parts generated from a drawing or edited from a STEP file, scored on validity, shape similarity, interfaces and topology. New rows stay unvalidated until a maintainer reviews them.
- **CAD-bench** ([repository](https://github.com/CAD-bench/cad-bench)): functional build123d assemblies, checked deterministically and with a rigid-body simulation in Blender. It has no leaderboard.
- **MUSE** ([site](https://dong7313.github.io/muse-benchmark/)): multi-part B-rep assemblies from text, compared with physical assembly graphs: components, connections, interface types and clearances.

## Where this page lives

This file is the source of the leaderboard. A static Hugging Face Space that mirrors it may follow later; the founder creates it by hand, and agents never publish it ([docs/PLAN.md](docs/PLAN.md) section 11).
