# Reddit

**Before each post:** read the subreddit's rules and sidebar on the day you post. Many subreddits limit self-promotion, require a flair, ask that you take part in the community beyond your own project, or keep a weekly thread for projects and tools. These drafts were not checked against each subreddit's current rules. If a subreddit has a project thread, post there instead of a new post. If a post would not fit, skip that subreddit.

Post one subreddit per day at most, as yourself, and say you are the founder. Stay to answer comments. Each subreddit gets its own text below; do not cross-post one text everywhere.

## r/cad

**Title:** `Looking for testers: open-source B-rep CAD that runs locally and exports STEP (early, made for AI agents)`

```text
I'm the founder of Neural Deep Network LTD, and we're building Open3DJ, an open-source (MIT) parametric CAD tool. It uses Open CASCADE (as WebAssembly) for exact B-rep geometry, runs on your own machine, and exports STEP, STL, GLB and 3MF.

It's early and unusual: there is no desktop app or interactive modeling yet. Parts are short JavaScript scripts, written by you or by an AI agent over MCP, and every run reports validity, volume, bounding box and clash or clearance checks between parts.

What I'd value from this sub: install it with one command, export the enclosure example to STEP and open it in the CAD tool you use every day (SolidWorks, Fusion, Onshape, FreeCAD, anything). Tell us whether the solids, sizes and faces come through cleanly. The whole checklist takes about 15 minutes.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers who want it are credited in the repository. Criticism of the approach is welcome too.
```

## r/3Dprinting

**Title:** `Free, open-source CAD that's checked before you print: looking for people to print one test bracket and measure it`

```text
I'm the founder of Neural Deep Network LTD. Our open-source CAD project, Open3DJ, makes parts from short scripts (written by you or an AI agent) and checks them before export: valid solid, volume, size, and clearances between parts. It exports 3MF and STL and runs on your own computer.

It's early, and we want to know how its parts come out on real printers. The ask: install it with one command, export the bracket example as 3MF, print it in whatever you have loaded, and measure it with calipers. It should be 40 x 35 x 35 mm with 4 mm flanges and 4.5 mm holes that an M4 screw passes through. Tell us the printer, slicer, material and your numbers.

Tester guide (about 15 minutes plus the print): https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Everyone who reports is credited in the repository, if they want to be.
```

## r/FreeCAD

**Title:** `Testing STEP export from a new open-source CAD project: does it open cleanly in FreeCAD?`

```text
I'm the founder of Neural Deep Network LTD. We're building Open3DJ, an open-source (MIT) CAD project aimed at AI agents: parts are scripts, and every run returns checks such as validity, volume and clearances. Like FreeCAD, it uses Open CASCADE for the geometry (as WebAssembly in our case). It is not a FreeCAD replacement, and it has no desktop app yet.

We'd value FreeCAD users' eyes on one thing: our STEP files. Install Open3DJ with one command, export the enclosure example (a base, a lid and four screws) and open it in FreeCAD. Do you get 6 solids in a 100 x 70 x 36 mm box? Do the faces and the assembly structure come through? Any warnings in the report view?

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository if they want to be.
```

## r/ClaudeAI

**Title:** `An open-source CAD MCP server and Claude Code plugin: looking for people to test it on their machines`

```text
I'm the founder of Neural Deep Network LTD. Open3DJ is our open-source (MIT) CAD project built for agents: an MCP server with five tools (run, inspect, render, export, docs) and a Claude Code plugin that adds a skill with the scripting language and the error-fix loop. Claude writes a short script, and every run returns evidence it can check: validity, volume, bounding box, clash and clearance checks, and a four-view drawing it can look at. It exports STEP, STL, GLB and 3MF and runs on your own computer.

It's early: no desktop app, CPU only, and most of the client setups follow each client's documentation and have not all been tried by hand yet.

The ask: install it with one command, run the 15-minute checklist, then connect Claude Desktop or Claude Code and ask for a small part (for example, a 60 mm wall bracket with two M4 holes). Tell us whether it connected, and whether the part was right.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository. Transcripts of where Claude went wrong are especially useful: we turn them into regression tests.
```

## r/LocalLLaMA (only if it applies)

**Post here only after someone has run Open3DJ with a local model** (for example through an MCP client that drives a local model), and say which model and client. Open3DJ itself runs no language model, and it has not been tested with local models. If nobody has tried it yet, skip this subreddit or ask a question instead of announcing.

**Title:** `Local-first CAD over MCP: has anyone driven it with a local model? Looking for testers`

```text
I'm the founder of Neural Deep Network LTD. Open3DJ is our open-source (MIT) CAD project: an MCP server that runs entirely on your machine, with exact B-rep geometry (Open CASCADE as WebAssembly), checks on every run, and STEP, STL, GLB and 3MF export. No cloud account, no telemetry.

So far it has been driven by hosted models. [Replace this sentence with what was tried locally: the model, the MCP client and how it went.] We'd like to know how local models do with it: whether they can follow the tool loop, read the error messages and fix their scripts.

The ask: install it with one command, run the 15-minute checklist, then point your MCP client at it and ask for a small part. Tell us the model, the client and what happened.

Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
Repository: https://github.com/NeuralDEEPnet/Open3DJ

Testers are credited in the repository.
```
