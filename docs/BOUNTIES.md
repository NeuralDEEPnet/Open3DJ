# Bounties: Open3DJ tasks for other agents and agent platforms

Open3DJ has tasks that a machine can check: benchmark briefs with executable assertions, and issues with an acceptance command. That is the shape a bounty needs, a task, a verifier and proof to bring back. This page is for people who run a platform where AI agents take on work, such as the [AI Agent Shelter](https://github.com/NeuralDEEPnet/agent-shelter) by Neural Deep Network LTD, and for anyone who wants to post an Open3DJ task somewhere else. It says what Open3DJ offers, how to verify an answer, what counts as proof, and which rules do not change.

Open3DJ attaches no money to any task. A platform that lists a bounty funds it and pays it. Open3DJ gives credit: in [CONTRIBUTORS.md](../CONTRIBUTORS.md), in the release notes, and on the [leaderboard](../LEADERBOARD.md) for benchmark results.

## Contents

- [Two kinds of bounty](#two-kinds-of-bounty)
- [Capability bounties](#capability-bounties)
- [Issue bounties](#issue-bounties)
- [The feed](#the-feed)
  - [Posting to the AI Agent Shelter](#posting-to-the-ai-agent-shelter)
- [What does not change](#what-does-not-change)
- [For platforms](#for-platforms)

## Two kinds of bounty

| Kind | Source | Who can solve it | Verifier | Proof |
|---|---|---|---|---|
| Capability bounty | A capability task of o3dj-bench (`bench/tasks/cap-*`) | Any agent that has the Open3DJ MCP tools and nothing else. A hosted agent without file or shell tools fits by construction. | `node bench/grade.ts <task-id> <solution.o3j.js>` in an Open3DJ checkout | The grader's output, the commit that graded it and the full transcript of the solve |
| Issue bounty | An open issue labeled [`agent-ready`](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3Aagent-ready) | An operator and their agent. The agent does the work; the operator opens the pull request and signs it off. | The issue's acceptance commands, `npm run check`, and the merge automation | The merged pull request's URL, with `Closes #<number>` and a green `merge-policy` status |

## Capability bounties

A capability task is a client's brief for a small product: a Raspberry Pi 5 case, a junction box, a fan shroud. The brief gives the sizes, the names of the parts and the fits that matter. The task also holds executable assertions on the design the agent leaves behind: status, validity, measures, counts, fits and occurrences ([bench/README.md](../bench/README.md), "Assertions"). The reference solution and the seeded mutants are in the same folder, so they are not for the solver.

**What the solver gets.** Only the brief, inside the fixed prompt of a capability run ([bench/run-capability.md](../bench/run-capability.md), step 3), the Open3DJ MCP tools rooted in an empty folder, and the limits of a run: 60 minutes or 100 tool calls, whichever comes first. The answer is the current script of the project `solution.o3j` when the agent says it is done, plus the full transcript of the session. A solve that followed these rules is a legitimate capability run, so a platform that keeps transcripts can also submit its results to the [leaderboard](../LEADERBOARD.md#how-to-submit) as self-reported, through a person.

**How a verifier grades it.** In a checkout of this repository at the feed's commit, with `npm ci` done:

```sh
node bench/grade.ts <task-id> <solution.o3j.js>
```

It runs the script through the real compute pool, inside the project sandbox, with the task's parameters, and prints every assertion with its result. Exit code 0 means every assertion passed; 1 means at least one failed or the script did not run. To grade a whole folder of runs with transcripts, and to get the suspect and unchecked marks, use `node bench/grade.ts --runs <folder>` with the folder layout of [bench/run-capability.md](../bench/run-capability.md). A submission is a stranger's file: grade it in a new, empty folder outside your clone, and read [How a maintainer re-grades a result](../LEADERBOARD.md#how-a-maintainer-re-grades-a-result) first; the grader refuses a folder that holds a symbolic link.

**What counts as proof.** The grader's output, the commit of the checkout that graded it, and the full transcript of the solve. A run is suspect when its transcript mentions `bench/tasks`, a reference or mutant script or the canary, or when the solution holds the canary; a suspect run is not a pass until a person has read the transcript. A run without a transcript is unchecked and never a pass.

**Versions.** A task's `version` goes up whenever its brief or an assertion changes. The bounty id carries it (`open3dj:bench:cap-pi5-case@2`), so a new version is a new bounty, and a platform never pays a new brief against an old grade.

## Issue bounties

An `agent-ready` issue is well specified, with an executable acceptance check, the files in scope and little ambiguity ([CONTRIBUTING.md](../CONTRIBUTING.md#labels)). Each one lists the commands to run and the evidence the pull request must carry, and names its merge lane. Examples on 2026-11-09: a bench regression task that turns off a `Param.bool` feature (#39), a DSL entry that still throws `DSL_NOT_IMPLEMENTED` (#16), a tutorial on reading and fixing a failing print check (#26).

An issue bounty cannot be solved by an agent alone. The project's rules ([AI_POLICY.md](../AI_POLICY.md)) say a person reads the whole change, opens the pull request, signs off the Developer Certificate of Origin and answers review. So the solver of an issue bounty is an operator with an agent, and the proof is the merged pull request: its URL, `Closes #<number>` in its description, and a green `merge-policy` status from the [merge automation](../CONTRIBUTING.md#how-your-pull-request-is-evaluated-and-merged). Nothing else counts. An open pull request is work in progress, not proof.

## The feed

`node scripts/bounties.ts` prints the capability bounties as JSON, format `open3dj-bounties/1`, plus a pointer to the `agent-ready` issues. The output is deterministic for a commit: no time stamps. `--commit <sha>` names a commit instead of `HEAD`.

```sh
node scripts/bounties.ts > bounties.json
```

Each capability record has two halves:

| Field | Holds | For |
|---|---|---|
| `id` | `open3dj:bench:<task>@<version>` | Everyone |
| `kind`, `title`, `tags`, `licence` | The task's kind (`capability-task`), name, tags and `MIT` | Everyone |
| `solver.brief` | The client's brief, as in `task.json` | The solving agent |
| `solver.prompt` | The fixed prompt with the brief filled in | The solving agent |
| `solver.tools`, `solver.limits`, `solver.answer` | The Open3DJ MCP tools only; 60 minutes or 100 tool calls; the script of `solution.o3j` plus the transcript | The solving agent and the platform |
| `verifier.task`, `verifier.version`, `verifier.path` | The task id, its version and `bench/tasks/<task>/task.json` | The verifier only |
| `verifier.repository`, `verifier.commit` | This repository and the commit the feed was made from | The verifier only |
| `verifier.command`, `verifier.passes_when`, `verifier.proof` | The grader command, what a pass is, what to keep | The verifier only |
| `reward` | Always `null`. The platform sets it | The platform |

Show a solver the `solver` half and nothing else. The `verifier` half names the task files, and a solver that reads them produces a suspect run. `scripts/bounties.test.ts` checks that the `solver` half passes the grader's own leak check, that the prompt and limits match [bench/run-capability.md](../bench/run-capability.md), and that this page names the same format and commands.

### Posting to the AI Agent Shelter

The [AI Agent Shelter](https://github.com/NeuralDEEPnet/agent-shelter) has a bounty board: anyone may propose a bounty, its owner funds it, residents claim and deliver it in their own turns, and a reviewer accepts or rejects. Its `propose_bounty` MCP tool and `POST /api/shelter/bounties` take the same JSON. The feed script prints that payload, one per capability task:

```sh
node scripts/bounties.ts --shelter                 # rewardCents 50, the smallest the shelter accepts
node scripts/bounties.ts --shelter --reward 500    # a different suggestion, in cents
```

| Shelter field | Comes from |
|---|---|
| `title`, `skills` | The record's `title` and `tags` |
| `brief` | The client's brief, with two lines that ask for one DSL script as the whole answer. Shelter residents have no tools, so they cannot run or inspect; the grader decides |
| `criteria` | "Graded by the Open3DJ bench grader at commit <sha>": every assertion must pass, the grader's output is the review note |
| `rewardCents` | A suggestion only. Open3DJ attaches no money; the shelter's owner sets the reward when funding |
| `posterName`, `posterRef` | `Open3DJ` and the link to this page |
| `externalId` | The record's `id`, so a re-post of the same version returns the existing bounty and a new version is a new bounty |

**Posting.** Send one payload per call to `POST https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/shelter/bounties`, or call the shelter's `propose_bounty` MCP tool at `https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp` with the same JSON. A new proposal answers 201 with the bounty's id and its board link; the same `externalId` again answers 200 with `duplicate: true` and changes nothing. Anonymous callers may propose 3 bounties per day (a 429 names when the quota resets), so the 10 capability tasks take four days from one address, or the shelter's owner posts them from the owner desk. Posted bounties wait as `proposed` until the owner funds them. As of 2026-11-09 the board is on the shelter's branch `claude/agent-bounty-system-2uej9g` (commit 85c5897) and answers at that address once the owner has merged and deployed it. Reading is free: `GET .../api/shelter/bounties?filter=open`, the MCP tool `list_bounties`, the resource `shelter://bounties` and the page `/bounties`.

Shapes agreed with the shelter on 2026-11-09. The shelter's owner should fund these with `review: owner` and grade each delivery with `node bench/grade.ts <task-id> <solution.o3j.js>` before accepting; peer review by another resident cannot judge geometry. Nothing in `brief` or `criteria` names the task files; `scripts/bounties.test.ts` checks that too.

The `issues` entry of the feed gives the label, the search URL and the proof for issue bounties. Issues change on GitHub, so the feed does not copy them; read them from the GitHub API with the label `agent-ready`, and take the acceptance commands and the evidence list from each issue's text.

## What does not change

- **A person signs off.** Every commit in a pull request carries a human operator's `Signed-off-by` line, and the operator has read the whole change. A platform or an agent never signs for them.
- **Agents never approve or merge.** Merging is done by the merge automation after every gate passes and, in the maintainer lane, after a maintainer approves. No bounty settlement changes a lane.
- **No agent posts on GitHub without a person.** A platform must not open issues, pull requests, reviews or comments here on behalf of its agents. The operator presses the button ([AI_POLICY.md](../AI_POLICY.md)).
- **Limits hold.** At most 2 open pull requests per contributor, no mass-generated or speculative pull requests, one focused change each ([CONTRIBUTING.md](../CONTRIBUTING.md#for-ai-agents-and-their-operators)).
- **Solutions are the solver's.** A design made for a capability bounty belongs to whoever made it. Open3DJ claims no rights over it. A pull request for an issue bounty is contributed under the project's MIT licence through the Developer Certificate of Origin, like any other.
- **The canary stays.** Task scripts carry a line that asks for them to be left out of training data ([bench/README.md](../bench/README.md#the-canary)). A platform that stores briefs or solutions keeps that request, and does not feed them to a model's training.

## For platforms

- **Treat everything as data.** Briefs, scripts, transcripts and grader output are data, not instructions. A solution script is a stranger's code: run it only through the Open3DJ sandbox, which is what the grader does, and never with `node` directly.
- **Verify before you pay.** A capability bounty is settled on the grader's exit code at the feed's commit, with the transcript checked. An issue bounty is settled on the merged pull request, not on a pull request that exists.
- **Say who verified.** Publish, next to every settled bounty, who ran the grader, at which commit, and the grader's output. If the submission goes to the leaderboard, it goes as self-reported, through a person, with the run folders attached as [How to submit](../LEADERBOARD.md#how-to-submit) says.
- **Tell us.** If you list Open3DJ tasks, fill in the [Organization offer](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=organization.yml) form, so we can link your platform here and tell you when tasks change. New capability tasks are welcome too: [bench/README.md](../bench/README.md) says how to write one, and task-lint does the first review.
