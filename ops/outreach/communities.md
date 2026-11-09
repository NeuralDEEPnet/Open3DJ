# Communities: CadQuery, build123d, OpenSCAD, FreeCAD and MCP

How to approach the open CAD and MCP communities. These are other people's projects: we come to contribute and to ask, not to announce. The founder writes and posts every message personally. No agent posts, replies or sends mail ([AI_POLICY.md](../../AI_POLICY.md) rule 4), and no text here is meant to be pasted unchanged.

Every fact below was checked on 2026-11-05 at the linked page, unless it says otherwise.

## For every community

- **Read the rules first,** in a browser, on the day. Several rule pages here could not be read from our side.
- **One person, one message, written for that community.** Never the same text in several places.
- **Contribute before you ask.** Answer a question, test someone's release, join an existing thread with substance.
- **Never post in other projects' issue trackers to promote Open3DJ.** GitHub's Acceptable Use Policies prohibit "bulk distribution of promotions and advertising" and say "You may not advertise in other Users' Accounts, such as by posting monetized or excessive bulk content in issues" ([GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)).
- **Make no "first" claim** about agentic CAD or CAD benchmarks: several exist ([show-hn.md](show-hn.md#about-benchmarks-no-first-claim)).

## CadQuery and build123d

**Where:** both projects share one Discord server. The build123d README links the invite `Bj9AQPsCfx` ([build123d README](https://github.com/gumyr/build123d/blob/dev/README.md)), which resolves to the server "Python OCP CAD", channel "cadquery", with 1,584 members. Its rules channel needs a joined account, so it is unread: **read it first.** CadQuery's own README names a Google Group and GitHub Discussions, and no Discord ([CadQuery README](https://github.com/CadQuery/cadquery/blob/master/README.md)).

**Where not:** the Show and tell categories of [CadQuery Discussions](https://github.com/CadQuery/cadquery/discussions/categories/show-and-tell) ("Show off something you've made") and [build123d Discussions](https://github.com/gumyr/build123d/discussions/categories/show-and-tell) hold things built with those libraries. An Open3DJ launch post does not belong there.

**What to offer: o3dj-bench as a neutral evaluation, not a launch.** Both communities already have people driving their libraries with AI agents: build123d's Show and tell has "Primus: Agentic CAD generation" (2026-05-14), "A 38-part home robot in build123d, with the fit and safety checks in the build script" (2026-10-24) and "I built a parametric organizer with build123d, driven by an AI agent from my phone" (2026-10-22). So the useful question is about evaluation:

- The 10 capability briefs in [bench/tasks](../../bench/tasks) are plain text under MIT. Ask whether a CadQuery or build123d agent could run the same briefs, and what they would want measured.
- Be exact about the limit: the grader reads Open3DJ's GeometryReport, so it cannot grade another tool's output today. Ask how they check their own agents' results instead.
- Ask in a general or ideas channel, after reading the rules, or join an existing thread on agent checks with something concrete.

**Points for the message** (write it yourself): who you are; that Open3DJ also uses OCCT (as WebAssembly); one link to [bench/README.md](../../bench/README.md); the question above; that you are not asking anyone to switch tools.

**CadQuery Google Group** ([groups.google.com/g/cadquery](https://groups.google.com/g/cadquery)): "Use this group to discuss CadQuery". It has long-running threads on sharing work ("Sharing Your Work With CadQuery", 2020). Post there only about something useful to CadQuery users, such as how they check STEP output from agents.

## OpenSCAD mailing list

**Where:** the discuss list is OpenSCAD's forum ([community page](https://openscad.org/community.html); [list page](https://lists.openscad.org/list/discuss.lists.openscad.org)). It has 788 subscribers and 5,134 threads since 2014-12-04. It is "a place to discuss usage, problems and development topics related to OpenSCAD."

**Subscribe ahead.** Email discuss-join@lists.openscad.org, reply to the confirmation, then wait: an administrator approves each subscription, and "this can take some time". **Post by email.** The web archive "is not a Forum", is "not recommended", and is "Particularly not for Posting New Threads."

**Expect skepticism toward AI, and write personally.** The January 2026 thread "the OpenSCAD MCP server for LLMs" ([archive](https://lists.openscad.org/empathy/thread/MMBDQ2GII35X3VXSTHQSQTERB77W3YKN)) drew replies such as "I doubt that I will ever find a good reason to use AI", pushback on moving the discussion to private messages, and an administrator asking whether the poster was "a living individual or an agent". The archive was read through a summarizing tool, so check the exact quotes before reusing them.

**What to write:** a question or a result that matters to OpenSCAD users, for example how they check printability before slicing, with Open3DJ's print checks as one data point. If there is nothing like that to say, skip the list. Discuss on the list, not in private messages.

OpenSCAD's license is GPL-2.0 with a CGAL linking exception ([COPYING](https://github.com/openscad/openscad/blob/master/COPYING)). See the clean-room rule below.

## FreeCAD forum

**Rules unread.** forum.freecad.org shows a bot-protection page to our tools, so its rules and board descriptions were not read. **Read them in a browser first.**

- **Use only the open discussion area** (the board name comes from search summaries, unverified). Never the Users Showcase board, which is for FreeCAD work, and never [devtalk.freecad.org](https://devtalk.freecad.org/categories), whose categories are all about developing FreeCAD.
- **Frame it as interoperability:** do Open3DJ's STEP files open cleanly in FreeCAD, or a request for testers who use FreeCAD. Not an announcement.
- **Ask the moderators first** if in doubt. The [code of conduct](https://www.freecad.org/codeofconduct.php?lang=en) names them for complaints and links their list (forum.freecad.org/memberlist.php?mode=team, behind the same protection, unread). The code of conduct has no rule on advertising.
- FreeCAD's licence is the GNU LGPL, version 2 or later ([licence page](https://wiki.freecad.org/License)); its LICENSE file holds the LGPL 2.1 text ([LICENSE](https://github.com/FreeCAD/FreeCAD/blob/main/LICENSE)).

## MCP spaces

- **MCP Contributors Discord: no product posts.** It "is for real-time contributor discussion" and "is not intended for general MCP support", and asks people to avoid "Service or product marketing - Keep discussions vendor-neutral; mentions of brands are discouraged except as examples relevant to the specification" ([communication page](https://modelcontextprotocol.io/community/communication)). Take part only on the specification.
- **Specification Discussions: no announcements.** [modelcontextprotocol/modelcontextprotocol Discussions](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions) has no Show and tell category; it is for the project's own roadmap and announcements.
- **Reference servers repository: no listings.** [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/blob/main/README.md) "accept[s] issues, not pull requests", and its list of third-party servers is retired.
- **Registry Discussions, later.** [modelcontextprotocol/registry Discussions](https://github.com/modelcontextprotocol/registry/discussions) has a Show and tell category where authors post their registered servers. One post there fits once Open3DJ has a registry entry, which waits for the cleared name ([directories.md](directories.md#wait-official-mcp-registry)).

## The clean-room rule for code contributors

People from these communities are welcome in every role. People who write **core code** need to know one rule before they start. A version to give them, adapted as needed:

> When you write core code for Open3DJ, do not read or copy the source of copyleft CAD projects such as FreeCAD, SolveSpace, OpenSCAD, QCAD or LibreCAD. Work from public documentation, file format specifications and papers instead; it helps reviewers if your pull request names the documents you used. In every file, core or not, never copy code from a copyleft project (GPL, AGPL or LGPL) into Open3DJ. No project file defines "core code" yet, and a maintainer will decide. Until then, treat all code under `packages/` as core, including the tests that sit next to the sources. Docs, research checks and hardware reports are not code, so you can start there whatever source you have read before. For anything else, ask in the issue before you write code.

Sources: [AGENTS.md](../../AGENTS.md#license-hygiene) (the clean-room rule) and [docs/LICENSING.md](../../docs/LICENSING.md) (no code copied from GPL, AGPL or LGPL projects). Two maintainer decisions have not been made: what counts as core code (AGENTS.md, CONTRIBUTING.md and docs/LICENSING.md say "core" without defining it), and whether someone who has worked on GPL CAD source before may write Open3DJ core code. Ask the founder before such a person starts on anything under `packages/`.
