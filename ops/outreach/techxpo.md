# TechXPO stand guide

One page for the founder at the stand: a 3-minute live demo, what to say, and where the QR code points. The goal is people who test Open3DJ on their own machine and file a report, not votes, stars or sign-ups.

## Before the day

- **Install from `main`** on the demo laptop with the one-line installer ([docs/TESTING.md](../../docs/TESTING.md#install)), after CI is green. Copy the examples into a demo folder as the tester guide shows, and work from there.
- **Run every command below once** the day before, and again an hour before opening, so the outputs are fresh and nothing downloads on the day. Then try the whole demo with Wi-Fi off: everything should run locally, but check it.
- **Keep the editor open** on `examples/enclosure/enclosure.o3j.js`, line 5 (`Param.number("Width", 100, ...`).
- **Backup:** the screenshot [docs/images/viewer-enclosure.png](../../docs/images/viewer-enclosure.png) and a printed bracket with calipers and an M4 screw, if you have printed one.
- **The QR code** (see below), printed large, with the URL in text underneath.

## The 3-minute demo

Outputs below were recorded from `main` (3c9e8fc) on 2026-11-08; your timings will differ.

**0:00 to 0:40. A part an agent can check.**

```sh
open3dj run examples/enclosure/enclosure.o3j.js
```

Point at the report: `ok`, 6 occurrences of 3 definitions in a 100 x 70 x 36 mm box, every part `valid` with its volume and size, and the fit lines (`contact  lid / screw#1..4  0 mm` and the screw clearances of 0.2 and 0.5 mm). Say: this is what an agent reads after every change, instead of guessing what its code did.

**0:40 to 1:40. See it, change it.**

```sh
open3dj view examples/enclosure/enclosure.o3j.js
```

Orbit with the left mouse button, click a screw (its row and its measures light up), press `F` to fit. In the editor, change the width from `100` to `120` and save: within a few seconds the page shows the wider enclosure and the terminal prints a new revision. Change it back. Press `Ctrl+C` in the terminal when you are done.

**1:40 to 2:30. The print checks catch a problem before the slicer.**

```sh
open3dj export examples/bracket/bracket.o3j.js --format 3mf
open3dj inspect examples/bracket/bracket.o3j --fields gates
```

The export writes the 3MF and an evidence file with hashes, then prints `gates fdm.v1: fail, 1 open, 0 waived`. The inspect shows why: the bracket passes watertight, wall (thinnest 3.998 mm) and bed size, but fails `overhang`, 90 degrees against a 45 degree limit at `face:3`, with the advice "Support it, bridge it if the span is short, or turn the part." Say: an agent gets the same failure, by face, and has to fix it or write down why it accepts it.

**2:30 to 3:00. The ask.** Hand over the QR code. "If you have 15 minutes and a Windows PC, a Mac, a Linux box, a Raspberry Pi or a real GPU, install it at home with one command, run the checklist and file a short report. Every tester is credited. Bring your Claude Code, Codex or Cursor agent. It does the work, you press the button."

## What to say, and what not to say

- **Say what works:** a command line, an MCP server with five tools, the browser viewer, exact B-rep geometry (Open CASCADE as WebAssembly), STEP, STL, GLB and 3MF exports with an evidence file, 3D printing checks, and about 690 tests in CI on Windows, macOS and Linux, on x64 and ARM.
- **Say what does not:** no desktop app and no interactive modeling yet, CPU only, nothing on npm while the name is pending trademark clearance, and nobody outside the project has tested it on a real machine. That last one is why you are at the stand.
- **Say who made it:** Neural Deep Network LTD, open source under MIT, with AI agents doing much of the work under human review.
- **Do not say "first"** about agentic CAD or CAD benchmarks: several exist ([show-hn.md](show-hn.md#about-benchmarks-no-first-claim)).
- **Do not promise dates.**
- **Do not ask anyone to upvote, star, comment or post anywhere.** Ask for a test report only. Hacker News bans vote requests ([FAQ](https://news.ycombinator.com/newsfaq.html), checked 2026-11-05), and GitHub's Acceptable Use Policies ban "rank abuse, such as automated starring or following" ([GitHub](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies), checked 2026-11-05).

## The QR code

**Target:**

```text
https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md
```

- Make the image with any QR code tool you trust; no account or tracking link is needed. Print the URL in text under the code.
- Scan it with two different phones before printing in quantity.
- **Never point a QR code at Hacker News,** at a Show HN thread, or at any page where people vote. Do not post a Show HN from the stand either ([show-hn.md](show-hn.md)).

## After the day

- Note in the [build log](../build-log.md) how many people stopped, how many said they would test, and, over the next two weeks, how many hardware reports came in.
- Answer every report that mentions TechXPO, and credit the testers who ask for it in [CONTRIBUTORS.md](../../CONTRIBUTORS.md).
