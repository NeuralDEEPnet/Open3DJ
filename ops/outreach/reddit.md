# Reddit

Notes and a starting text for each subreddit. The founder posts by hand, from a personal account with real participation in that subreddit, one subreddit at a time.

**The rules could not be read.** On 2026-11-05, reddit.com, old.reddit.com, redditinc.com and Reddit's help site all refused our fetches (HTTP 403 or blocked), for every subreddit below. Everything this page says about a subreddit's rules comes from third-party pages and is **unverified**. **Read each subreddit's rules, sidebar and wiki in a browser on the day you post.** If a rule says no self-promotion, or keeps a weekly or megathread for projects, follow it. If a rule forbids AI-written posts, write your own text from the facts in [show-hn.md](show-hn.md). If you are unsure, send the moderators a message first, and skip the subreddit when a post would not fit.

## For every subreddit

- **Say who you are in the first line:** the founder of Neural Deep Network LTD, which makes Open3DJ.
- **One subreddit per day at most,** each with its own text. Never cross-post one text everywhere.
- **Lead with something people can do or see** (a printed part, a STEP file, a 15-minute test), not a launch announcement.
- **Stay to answer comments,** honestly about what does not work yet.
- **Never ask for upvotes,** and never ask others to comment for you.
- **Post only after CI is green** on `main` and the checklist in [README.md](README.md) is done.

## Order

| Order | Subreddit | Condition |
|---|---|---|
| 1 | r/3Dprinting | A test print of the bracket, measured, in your own hands |
| 2 | r/cad | After asking the moderators whether a tester call is welcome |
| 3 | r/ClaudeAI | The showcase megathread, unless your account qualifies for a post |
| 4 | r/mcp | After reading the rules for a showcase flair or thread |
| 5 | r/LocalLLaMA | **Only** with a demo driven by a locally run model |
| Ask first | r/FreeCAD, r/openscad | Only for interoperability, only after the moderators say yes |

## r/3Dprinting

**Rules (unverified):** only secondhand reports of a 10% self-promotion rule, from an old comment in a different subreddit. Treat self-promotion as limited.

**Approach:** a print you made, with numbers. The bracket example is 40 x 35 x 35 mm with 4 mm flanges and four 4.5 mm holes that an M4 screw should pass through ([docs/TESTING.md](../../docs/TESTING.md#5-optional-print-the-bracket-and-measure-it)).

**Expect one failed print check.** Exporting the bracket prints `gates fdm.v1: fail, 1 open, 0 waived`, and `open3dj inspect examples/bracket/bracket.o3j --fields gates` shows `FAIL overhang 90 against 45 at face:3`, with the advice "Support it, bridge it if the span is short, or turn the part" (checked 2026-11-08). The text below says so up front, so readers do not take it for a broken file. [techxpo.md](techxpo.md) shows the same failure on purpose.

**Title:** `Free, open-source CAD that's checked before you print: looking for people to print one test bracket and measure it`

```text
I'm the founder of Neural Deep Network LTD. Our open-source CAD project, Open3DJ, makes parts from short scripts (written by you or an AI agent) and checks them before export: valid solid, volume, size, clearances between parts, and 3D printing checks for wall thickness, overhangs and bed size. It exports 3MF and STL and runs on your own computer.

It's early, and we want to know how its parts come out on real printers. The ask: install it with one command, export the bracket example as 3MF, print it in whatever you have loaded, and measure it with calipers. It should be 40 x 35 x 35 mm with 4 mm flanges and 4.5 mm holes that an M4 screw passes through. Tell us the printer, slicer, material and your numbers.

One thing you will see: the export reports one failed check on the bracket, an overhang, with faces that lean up to 90 degrees against a 45 degree limit. That is the check doing its job, not a broken file. Print it the way you would print any bracket (supports, bridging or another orientation) and tell us what you chose.

Tester guide (about 15 minutes plus the print): https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Everyone who reports is credited in the repository, if they want to be.
```

## r/cad

**Rules (unverified):** a search summary says r/cad bans spam, including self-promotion. **Message the moderators first** and post only if they say a tester call is welcome.

**Approach:** the STEP round trip into the CAD tool people already use.

**Title:** `Looking for testers: open-source B-rep CAD that runs locally and exports STEP (early, made for AI agents)`

```text
I'm the founder of Neural Deep Network LTD, and we're building Open3DJ, an open-source (MIT) parametric CAD tool. It uses Open CASCADE (as WebAssembly) for exact B-rep geometry, runs on your own machine, and exports STEP, STL, GLB and 3MF.

It's early and unusual: there is no desktop app or interactive modeling yet. Parts are short JavaScript scripts, written by you or by an AI agent over MCP, and every run reports validity, volume, bounding box and clash or clearance checks between parts.

What I'd value from this sub: install it with one command, export the enclosure example to STEP and open it in the CAD tool you use every day (SolidWorks, Fusion, Onshape, FreeCAD, anything). Tell us whether the solids, sizes and faces come through cleanly. The whole checklist takes about 15 minutes.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers who want it are credited in the repository. Criticism of the approach is welcome too.
```

## r/ClaudeAI

**Rules (unverified):** a third-party mirror of an April 15, 2026 moderator post says a showcase post on the main feed needs at least 50 total karma; below that, use the "Built with Claude" project showcase megathread, under the subreddit's rule 7. **Use the megathread** unless your account clearly qualifies and rule 7 allows a post.

**Approach:** the plugin and the evidence loop, plus an honest list of what is untested.

**Title (if a post is allowed):** `An open-source CAD MCP server and Claude Code plugin: looking for people to test it on their machines`

```text
I'm the founder of Neural Deep Network LTD. Open3DJ is our open-source (MIT) CAD project built for agents: an MCP server with five tools (run, inspect, render, export, docs) and a Claude Code plugin that adds a skill with the scripting language and the error-fix loop. Claude writes a short script, and every run returns evidence it can check: validity, volume, bounding box, clash and clearance checks, 3D printing checks, and a four-view drawing it can look at. It exports STEP, STL, GLB and 3MF and runs on your own computer.

It's early: no desktop app, CPU only, and most of the client setups follow each client's documentation and have not all been tried by hand yet.

The ask: install it with one command, run the 15-minute checklist, then connect Claude Desktop or Claude Code and ask for a small part (for example, a 60 mm wall bracket with two M4 holes). Tell us whether it connected, and whether the part was right.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository. Transcripts of where Claude went wrong are especially useful: we turn them into regression tests.
```

## r/mcp

**Rules (unverified):** no rule text was found anywhere. Look for a showcase flair, a weekly thread or a self-promotion rule on the day.

**Approach:** what the server does for an agent that other CAD servers leave out: checks it can read back, and a benchmark with seeded mutants. Do not claim to be the first CAD server or the first CAD benchmark; there are many of both ([directories.md](directories.md#1-glama), [show-hn.md](show-hn.md#about-benchmarks-no-first-claim)).

**Title:** `Open3DJ: a local CAD MCP server where every tool call returns checks the agent can verify (looking for testers)`

```text
I'm the founder of Neural Deep Network LTD. Open3DJ is our open-source (MIT) CAD MCP server. It runs locally over stdio, with five tools: run, inspect, render, export and docs. The agent writes a short JavaScript script; run returns a compact report (validity, volume, size, clashes and clearances between named parts), render returns a four-view drawing the agent can look at, and inspect gives 3D printing checks and element addresses. The server speaks MCP protocol versions 2025-06-18, 2025-11-25 and 2026-07-28.

There is also a small benchmark, o3dj-bench: multi-part briefs graded by deterministic assertions, each with a seeded mutant that must fail. No agent has run its capability split yet; the first result sets the baseline: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/LEADERBOARD.md

The ask: connect your client (Claude Code, Codex, Cursor, VS Code, Gemini CLI and Claude Desktop use the same server command), ask for a small part, and tell us whether the handshake and the tools worked.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Client setup: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/GETTING-STARTED.md#connect-a-client
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository, if they want to be.
```

## r/LocalLLaMA (only with a local-model demo)

**Rules (unverified):** a third-party summary (data as of Oct 4, 2026; rules archived in January 2025) lists "Limit Self-Promotion" (no more than 10% of your content), at least 5 karma earned in the subreddit, and a "Resources" or "I Built A Thing" flair for your own project.

**Post here only after someone has driven Open3DJ with a locally run model** through an MCP client, and say which model and client. Open3DJ runs no language model itself and has not been tested with local models. A post that leads with a hosted agent is off topic there.

**Title:** `Local-first CAD over MCP: has anyone driven it with a local model? Looking for testers`

```text
I'm the founder of Neural Deep Network LTD. Open3DJ is our open-source (MIT) CAD project: an MCP server that runs entirely on your machine, with exact B-rep geometry (Open CASCADE as WebAssembly), checks on every run, and STEP, STL, GLB and 3MF export. No cloud account, no telemetry.

So far it has been driven by hosted models. [Replace this sentence with what was tried locally: the model, the MCP client and how it went.] We'd like to know how local models do with it: whether they can follow the tool loop, read the error messages and fix their scripts.

The ask: install it with one command, run the 15-minute checklist, then point your MCP client at it and ask for a small part. Tell us the model, the client and what happened.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository, if they want to be.
```

## r/FreeCAD and r/openscad (ask the moderators first)

**Rules (unverified):** none found. openscad.org lists the OpenSCAD subreddit under "Other" ([community page](https://openscad.org/community.html), checked 2026-11-05), and FreeCAD's site menu links Reddit. Both subreddits are about one tool, so a post about Open3DJ itself is likely off topic.

**Post only an interoperability question, and only after the moderators say yes.** For FreeCAD: do Open3DJ's STEP files open cleanly in FreeCAD? For OpenSCAD: only if its users have a concrete need Open3DJ answers; otherwise skip it. Mind the [clean-room rule](communities.md#the-clean-room-rule-for-code-contributors) when inviting code contributors from either community.

**Message to the moderators** (adapt it):

```text
Hi, I'm the founder of Neural Deep Network LTD. We make Open3DJ, an open-source (MIT) CAD tool that uses Open CASCADE, like FreeCAD. We'd like to ask FreeCAD users one question: whether our exported STEP files (an enclosure with a base, a lid and four screws) open cleanly in FreeCAD. Would a short post asking that be welcome here? If not, no problem, and thank you.
```

**r/FreeCAD title, if allowed:** `Testing STEP export from a new open-source CAD project: does it open cleanly in FreeCAD?`

```text
I'm the founder of Neural Deep Network LTD. We're building Open3DJ, an open-source (MIT) CAD project aimed at AI agents: parts are scripts, and every run returns checks such as validity, volume and clearances. Like FreeCAD, it uses Open CASCADE for the geometry (as WebAssembly in our case). It is not a FreeCAD replacement, and it has no desktop app yet. The moderators kindly said this question is welcome here.

We'd value FreeCAD users' eyes on one thing: our STEP files. Install Open3DJ with one command, export the enclosure example (a base, a lid and four screws) and open it in FreeCAD. Do you get 6 solids in a 100 x 70 x 36 mm box? Do the faces and the assembly structure come through? Any warnings in the report view?

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository, if they want to be.
```

## Sources for the unverified notes

All read on 2026-11-05 and none of them is Reddit itself: r/LocalLLaMA, [spacestationlabs.ai](https://spacestationlabs.ai/subreddits/localllama); r/ClaudeAI, a [redlib mirror](https://redlib.groet-infra.nl/r/ClaudeAI/comments/1sly3jm/built_with_claude_project_showcase_megathread/); r/cad, a search summary of [r-weld.vercel.app](https://r-weld.vercel.app/r/cad), which returned 404 when fetched; r/3Dprinting, an old comment on a [redlib mirror](https://axebps-redlib.hf.space/r/3Dprintedtabletop/comments/f8pf7h/the_future_of_r3dprintedtabletop/fip4api/?context=3) in r/3Dprintedtabletop; r/mcp, nothing found.
