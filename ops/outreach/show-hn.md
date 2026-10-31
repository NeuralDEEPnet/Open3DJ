# Show HN

Hacker News asks that a Show HN be something people can try, and that the poster be around to answer. Post the title and URL, then add the first comment right away. Check the [Show HN guidelines](https://news.ycombinator.com/showhn.html) on the day you post.

**Title** (under 80 characters):

```text
Show HN: Open3DJ, open-source CAD that AI agents drive over MCP
```

**URL:**

```text
https://github.com/NeuralDEEPnet/Open3DJ
```

**First comment:**

```text
Hi HN. I run Neural Deep Network LTD, a small company in Dublin and Malta, and Open3DJ is our open-source (MIT) CAD project. It is early, and I am posting mainly to find people who will try it on their own machines.

The idea: AI agents are bad at CAD less because they cannot write code and more because they cannot see what the code did, cannot point at a face or an edge reliably, and cannot prove the result is right. Open3DJ is built around that loop. An agent (or you) writes a short JavaScript script, and every run returns evidence: validity, volume, bounding box, clash and clearance checks between parts, and a four-view drawing.

What works today:
- A command line and an MCP server with five tools (run, inspect, render, export, docs). Claude Code, Codex, Cursor, VS Code, Gemini CLI and Claude Desktop connect with the same server command.
- Exact B-rep geometry: Open CASCADE compiled to WebAssembly, running in a pool of CPU workers, with scripts in a QuickJS sandbox.
- Assemblies first: occurrences, connectors, and fit checks that list each gap.
- Exports to STEP, STL, GLB and 3MF, with an evidence file of hashes and measures. Exporting the same revision twice gives the same STEP bytes.
- A local browser viewer that reloads when you save the script.
- About 690 tests, run in CI on Windows, macOS and Linux, x64 and ARM.

What does not work yet:
- No desktop app and no interactive modeling. You or your agent edit a script; the viewer only shows the result.
- Everything runs on the CPU. GPU work is planned, and the viewer's WebGPU path has not been seen on a real GPU.
- No mate solver, bill of materials or standard parts library yet.
- Nothing on npm (the name is pending trademark clearance). You install with a one-line script from GitHub.
- Nobody outside the project has run it on a real machine. That is why I am here.

Full disclosure: much of the code was written by AI agents working under my review, and every commit an agent helped with carries a disclosure trailer.

If you have 15 minutes, the tester guide installs it with one command and walks through a short checklist: https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md

Reports from Windows, Intel Macs, Linux distributions other than Ubuntu, Raspberry Pis and real GPUs would help most. Every tester who wants it is credited in the repository. Questions and criticism are welcome; I will be here for the next few hours.
```
