# Show HN: fact sheet

**This file is not a post.** Hacker News forbids posts and replies written or edited by a language model, so the founder writes the title, the first comment and every reply in their own words. This sheet only collects the facts, commands and links to write from. Do not paste sentences from it, from the other outreach texts or from any agent's draft.

## The rules that apply

Checked on 2026-11-05 at the linked pages.

- **No generated text.** The [guidelines](https://news.ycombinator.com/newsguidelines.html) say, under submissions: "Please don't put generated text in HN posts. Write your text yourself", because "HN is for sharing between humans", and "For the same reason, please don't automate posting." Under comments: "Don't post generated text or AI-edited text."
- **The moderator's Show HN tips** ([dang, edited 2026-03-28](https://news.ycombinator.com/item?id=22336638)): write it by hand with no LLM, "not even a tiny bit, including to edit or spruce it up"; give the backstory and what is different; say plainly what the project is; drop marketing language; do not post from a company or project username; no booster comments; repost only a significantly different version, about once or twice a year. Put an email address in your profile "so we can contact you if we notice anything, and also so we can send you a repost invite".
- **What a Show HN is** ([showhn.html](https://news.ycombinator.com/showhn.html)): "for something you've made that other people can play with". "If your work isn't ready for users to try out, please don't do a Show HN." "The project should be non-trivial. Don't post quickly-generated one-offs; anybody can do that now." It must be something you worked on personally and are "around to discuss". The title begins with "Show HN".
- **Titles** ([guidelines](https://news.ycombinator.com/newsguidelines.html)): no uppercase or exclamation points for emphasis, and crop a "gratuitous number or number + adjective".
- **No vote or comment requests.** "Please don't ask friends to upvote or comment. That's not ok on HN." The [FAQ](https://news.ycombinator.com/newsfaq.html) adds: "We penalize or ban submissions, accounts, and sites that break this rule."
- **New accounts.** Show HNs from new accounts are restricted for now, with no published threshold: "Take some time to get to know the community, become a good contributor, and then it will be fine to post an occasional Show HN" ([showlim](https://news.ycombinator.com/showlim)). The guidelines also ask people not to "create accounts routinely".
- **Reposts.** "If a story has not had significant attention in the last year or so, a small number of reposts is ok." "Please don't delete and repost the same story." ([FAQ](https://news.ycombinator.com/newsfaq.html))

## Our rules

- **Post once, from the founder's own account,** not a company or project account.
- **Post only after CI is green** on all five runners on `main`. Today the README says `npm run check` is red on two goldens ([#19](https://github.com/NeuralDEEPnet/Open3DJ/issues/19)), and that would be the first comment.
- **Never ask anyone to upvote or comment:** not colleagues, not followers, not TechXPO visitors. TechXPO QR codes never point at Hacker News ([techxpo.md](techxpo.md)).
- **Stay for the next few hours** after posting, and answer as yourself.
- **Agents never post, vote or reply,** and no agent drafts a reply for you to paste.

## What it is

- Open-source (MIT), local-first parametric B-rep CAD that AI agents drive over MCP and a command line. Created by Neural Deep Network LTD, based in Dublin and Malta. The first commit was on 2026-10-27.
- An agent (or a person) writes a short JavaScript script. Every run returns a GeometryReport: validity, volume, bounding box, mass, and clash, contact and clearance checks between parts. `render` draws four views with hidden lines.
- Geometry is Open CASCADE (OCCT, LGPL-2.1 with the Open CASCADE exception) compiled to WebAssembly, in a pool of CPU workers. Scripts run in a QuickJS sandbox.
- Every design is an assembly: shared definitions, occurrences, connectors, `matchTo`.
- **The idea behind it**, for you to put in your own words: agents are bad at CAD less because they cannot write code and more because they cannot see what their code did, cannot point at a face or an edge reliably, cannot recover from kernel errors and cannot prove the result is right ([README](../../README.md#where-were-going)). Open3DJ works on those four first.

## What works today, with commands

From a clone with Node.js 24 and git (the [README](../../README.md#try-it) "Try it" block):

```sh
git clone https://github.com/NeuralDEEPnet/Open3DJ.git
cd Open3DJ
npm ci
npx open3dj run examples/bracket/bracket.o3j.js                     # the GeometryReport
npx open3dj render examples/bracket/bracket.o3j --out bracket.png   # a four-view drawing
npx open3dj export examples/bracket/bracket.o3j --format step       # STEP plus an evidence file
npx open3dj view examples/enclosure/enclosure.o3j.js                # the 3D viewer in your browser
```

Or the one-line installers in [docs/TESTING.md](../../docs/TESTING.md#install), which need no git and no Node.js.

| Fact | Number or detail | Where it is stated |
|---|---|---|
| MCP tools | 5: `run`, `inspect`, `render`, `export`, `docs` | README |
| MCP protocol versions | 2025-06-18, 2025-11-25 and 2026-07-28 | ROADMAP "What works today" |
| Clients with the same server command | Claude Code, Codex, Cursor, VS Code, Gemini CLI, Claude Desktop | [GETTING-STARTED.md](../../docs/GETTING-STARTED.md) |
| Export formats | STEP, STL, GLB, 3MF, each with an `.evidence.json` of hashes and measures | GETTING-STARTED |
| 3D printing checks | `fdm.v1`: watertight, 0.8 mm wall, 45 degree overhang, 220 x 220 x 250 mm bed; every export records the result | ROADMAP S3 |
| Tests | about 690, in `npm run check` | README |
| CI | Linux x64 and ARM64, macOS on Apple Silicon, Windows x64 and ARM64 | README |
| Examples | 10, with drawings | [examples/README.md](../../examples/README.md) |
| Benchmark | o3dj-bench v0: 12 regression tasks (replayed in every check) and 10 multi-part capability briefs graded as pass^3 | [bench/README.md](../../bench/README.md) |
| Large assemblies | reference assemblies of 145 and 1,025 occurrences; the viewer draws the 1,025 in 7 draw calls | ROADMAP S2 |

**Screenshot:** [docs/images/viewer-enclosure.png](../../docs/images/viewer-enclosure.png), the viewer with the enclosure example. It is the first image in the README, so linking the repository shows it.

## What does not work yet

- No desktop app and no interactive modeling: you or your agent edit a script, and the viewer shows the result.
- CPU only. The viewer's WebGPU path has not been seen on a real GPU; WebGL2 has been seen only with a software renderer.
- No mate solver, bill of materials or standard parts library (S4).
- Nothing on npm: the name is pending trademark clearance.
- Nobody outside the project has run it on a real machine, and no agent has run the capability split yet.
- Most of the code was written by AI agents under the founder's review. Every commit an agent helped with carries an `Assisted-by` trailer ([AI_POLICY.md](../../AI_POLICY.md)).

## About benchmarks: no "first" claim

Other agentic and text-to-CAD benchmarks already exist, for example [BenchCAD](https://benchcad.com/leaderboard), [Parametric CAD Bench](https://cadbench.ai/), [CADGenBench](https://github.com/huggingface/cadgenbench), [CAD-bench](https://github.com/CAD-bench/cad-bench) and [MUSE](https://dong7313.github.io/muse-benchmark/) (all checked 2026-11-05). What o3dj-bench does: it grades an agent driving one CAD tool over MCP, on multi-part briefs with deterministic assertions on measures, part counts, clones and the gaps between named parts, and each task has a seeded mutant that must fail. Its limits: 10 public capability tasks, so a score is noisy and the tasks may have been seen.

## Questions people may ask

Facts only. Answer in your own words.

- **Why JavaScript and not Python or CadQuery?** The DSL is 3dj-compatible JavaScript in a QuickJS sandbox. A Python build123d tier is deferred until a bench comparison shows the JS DSL falling behind ([ROADMAP](../../ROADMAP.md#deliberately-deferred)).
- **Does it send anything anywhere?** No telemetry. The agent's own model may be hosted, depending on the client the person uses.
- **License?** MIT. OCCT is used as a separate, replaceable WebAssembly module under its LGPL-2.1 terms ([docs/LICENSING.md](../../docs/LICENSING.md), [docs/PLAN.md](../../docs/PLAN.md) section 10).
- **Can I try it without an agent?** Yes: the CLI and the viewer work alone.

## Links

- Repository: https://github.com/NeuralDEEPnet/Open3DJ
- Tester guide: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
- Getting started: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/GETTING-STARTED.md
- Roadmap: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/ROADMAP.md
- Benchmark: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/bench/README.md
