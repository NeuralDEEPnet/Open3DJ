# Open3DJ Governance

This document explains who runs Open3DJ, how decisions are made, how you can gain a bigger role, and what the project promises to keep free and open.

## Summary

- **Creator and current lead:** Open3DJ was created by **Neural Deep Network LTD** (GitHub: [NeuralDEEPnet](https://github.com/NeuralDEEPnet), website: https://www.neuraldeep.net), based in Dublin and Malta in the EU. The company currently leads the project and appoints the lead maintainer.
- **Open to everyone:** people, AI agents operated by people, and organizations can all contribute, and contributors can become maintainers.
- **Decisions in the open:** lazy consensus for everyday work, written RFCs for big changes, and the lead maintainer as tie-breaker.
- **An open-core charter:** a written list of what will always stay free and open (see [below](#open-core-charter)).
- **A path to neutrality:** as the community grows, the project intends to move its trademark and any shared funds to a neutral foundation.

## Who works on Open3DJ today

Open3DJ is honest about its size. Today the team is the founder of Neural Deep Network LTD, unpaid volunteers, Claude, and the founder's other AI agents. **There are no paid engineers.** Agents do a lot of the work, and people review and merge it.

That is why contributions of every kind matter so much here, and why we work to make your first contribution easy and your work visible.

## How we work

We work in a lean, Kaizen style. In practice that means:

- **Small, usable releases.** We ship small working steps rather than big drops. The roadmap is in [docs/PLAN.md](docs/PLAN.md).
- **A weekly plan-do-check-act review.** Once a week, maintainers review what shipped, what broke and what we learned, then adjust the plan. Notes are posted publicly in GitHub Discussions.
- **Stop the line on regressions.** Any maintainer can pause merges when the main branch regresses. Fixing the regression comes before new work.
- **Every failure becomes a test.** We find the root cause of each bug and add a regression test so it cannot return quietly.
- **Standard work.** [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), the issue forms and the pull request template describe the standard way to work. When we find a better way, we update the standard.
- **Blameless culture.** We look at systems, not at people. Failed experiments are documented, not punished, and a "what we tried" record is part of the docs. Off-path, ambitious ideas are welcome as experiments or RFCs.
- **A sustainable pace.** Volunteers give their own time. Nobody is expected to work unpaid overtime, answer at weekends or stay forever. You can step back at any time, and we will thank you for what you gave.

## Roles

### Users

Anyone who uses Open3DJ: designers, engineers, makers, developers, students and businesses. Users shape the project through issues, discussions, bug reports and feedback. You do not need permission to take part.

### Contributors

Anyone who contributes anything: code, documentation, parts for the standard library, research checks, benchmarks, test data, renders, translations, design reviews, triage, or answers in Discussions. Contributors follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and sign off their commits under the Developer Certificate of Origin (see [docs/LICENSING.md](docs/LICENSING.md)).

**Organizations** contribute too: companies, universities, labs, makerspaces, print services and other open-source projects. An organization can contribute code, standard parts, benchmarks, compute, integrations or test data. Its people take part as individual contributors, and they can become maintainers like anyone else.

### AI agent operators

A person or organization who runs an AI agent (such as Claude Code, Codex, Cursor or a custom MCP agent) that contributes to Open3DJ.

- The operator is responsible for everything the agent submits, as if they had written it themselves.
- The operator reviews the agent's work before it is submitted, discloses that an agent helped, and adds the human Developer Certificate of Origin sign-off. Agents must never sign off on their own behalf.
- AI agents are tools, not members. An agent cannot hold a role, approve a pull request, vote, or count towards consensus. Maintainers may run project bots with narrowly scoped permissions, and those bots are the responsibility of the maintainer who runs them.

### Maintainers

Contributors with merge rights. Maintainers review and merge pull requests, triage issues, label good first issues, run the weekly review, enforce the Code of Conduct, and mentor new contributors. Maintainers must enable two-factor authentication on GitHub.

### Module owners

Maintainers who hold final review responsibility for an area of the project. Ownership is recorded in a `CODEOWNERS` file so that reviews are routed automatically. Areas are expected to include:

- geometry kernel integration
- the agent contract (MCP server, CLI and SDKs)
- the desktop app and user interface
- compute and providers (local and cloud)
- the standard parts library
- the industrial design pipeline (see [docs/INDUSTRIAL-DESIGN.md](docs/INDUSTRIAL-DESIGN.md))
- benchmarks and quality
- documentation and research
- security

Until there are enough maintainers, the lead maintainer owns every area. Ownership moves to contributors as they earn it.

### Lead maintainer

The lead maintainer is appointed by Neural Deep Network LTD. Today that is the company's founder. The lead maintainer:

- sets the overall direction with input from the community,
- breaks ties when consensus fails,
- approves new maintainers and module owners, and
- is the final escalation point for Code of Conduct matters.

## How decisions are made

### Everyday changes: lazy consensus

Most work proceeds by lazy consensus. Someone proposes a change in an issue or pull request. If nobody raises a reasoned objection, the change goes ahead.

- A pull request needs approval from one maintainer, or from the module owner for the area it touches, and all required checks must pass.
- Allow at least two working days for comments on anything that changes behavior, so that people in other time zones can respond. Typo fixes and other trivial changes can merge sooner.
- An objection should explain the problem and, where possible, suggest an alternative. "I'd prefer not" is not a blocking objection.

### Big changes: RFCs

Changes that are large, hard to reverse, or that affect many people go through a written RFC (request for comments), kept in `docs/rfcs/` once the first RFC lands. An RFC is needed for:

- the public agent contract (MCP tools, CLI commands, SDK APIs) and file formats,
- the script language and reference semantics,
- new runtime dependencies that bring license obligations, and changes to the license policy,
- the security model,
- the open-core charter and this governance document.

The process, adapted from the Rust project's RFC process ([docs/research/community-licensing-business.md](docs/research/community-licensing-business.md), section 4), and summarized for contributors in [CONTRIBUTING.md](CONTRIBUTING.md#rfcs-for-big-changes):

1. Open an issue labeled `rfc` that describes the problem, the proposal, the alternatives you considered, the risks, and how we will know it worked.
2. Everyone discusses it in the open, including organizations and agent operators. The relevant module owners guide the discussion.
3. When the proposal needs a full write-up, open a pull request that adds it as a Markdown file in `docs/rfcs/`, starting from the template (`docs/rfcs/0000-template.md`, to be added).
4. When discussion settles, a module owner proposes a decision (accept, reject or postpone) and starts a **final comment period of 10 calendar days, including at least 5 business days**.
5. If no new concerns come up, the decision stands. It is recorded with its reasons in the issue, accepted RFCs are merged into `docs/rfcs/`, and each accepted RFC gets a tracking issue.

Experiments do not need an RFC. Spikes and prototypes are welcome in `docs/rfcs/experiments/`, and their results, including failures, are written up so that everyone learns from them.

### When consensus fails

If maintainers cannot reach consensus, the module owner decides for their area. If the question crosses areas or remains disputed, the lead maintainer decides and writes down the reasons. While the project is company-led, Neural Deep Network LTD keeps final responsibility for legal matters such as licensing and the trademark.

## Becoming a maintainer

Maintainers are chosen for sustained, high-quality contributions and good judgment, not for volume. There is no fixed formula. Typical signs are:

- several months of regular contributions that were merged or helped others,
- helpful, kind and accurate reviews of other people's work,
- good judgment about when to say no, and when to ask for an RFC,
- following the Code of Conduct and our agent rules.

Code is not the only path. Sustained work on parts, documentation, research checks, benchmarks, triage or community support counts too.

**How it happens:**

1. An existing maintainer nominates the contributor in a private maintainer discussion. Self-nominations are welcome: ask any maintainer.
2. Maintainers have one week to raise concerns. The decision is by lazy consensus.
3. The lead maintainer approves the nomination or explains why not.
4. The new maintainer enables two-factor authentication, gets merge rights, and is added to the maintainers table in [CONTRIBUTORS.md](CONTRIBUTORS.md).

**Stepping back:** maintainers can step back at any time and become emeritus maintainers, with our thanks. A maintainer who has been inactive for six months is moved to emeritus after a friendly check-in. Emeritus maintainers can return by asking.

**Removal:** a maintainer can be removed for a serious or repeated breach of the Code of Conduct, or for abuse of their access, by decision of the lead maintainer after hearing from the other maintainers.

## Recognition

We want every contribution to be seen. The details are in [CONTRIBUTING.md](CONTRIBUTING.md#recognition). In short:

- Every contributor is added to [CONTRIBUTORS.md](CONTRIBUTORS.md) with their first merged contribution, code or not.
- Release notes credit every contributor to that release, including contributors of parts, research checks, benchmarks, compute and test data, and each release note includes a contributor spotlight.
- Agent-assisted work credits the human operator and names the agent, for example "Ada Lovelace (with Claude Code)".
- Organizations that contribute are credited by name in [CONTRIBUTORS.md](CONTRIBUTORS.md) and in the release notes.

## Open-core charter

Neural Deep Network LTD makes these commitments for Open3DJ:

1. **Always free and open.** The following stay in this repository under an OSI-approved open-source license, free to use, with no account required:
   - the geometry kernel integration,
   - the project file formats and their specifications,
   - every import and export format (such as STEP, STL and 3MF),
   - the local MCP server,
   - the CLI,
   - the desktop app,
   - the use of local compute, including your own GPU,
   - the provider interface that lets anyone plug in a cloud or local compute service.
2. **Fully useful on its own.** Open3DJ is built to work completely offline and locally, without any 3dj.app account or any other paid service.
3. **No hidden closed parts.** This repository contains no closed-source code and no "enterprise edition" folder. Features are not moved out of the open project in order to sell them.
4. **Your work is yours.** The designs you create and the files you export belong to you (see [docs/LICENSING.md](docs/LICENSING.md)).
5. **Private by default.** Telemetry, if it is ever added, is off by default and opt-in.

Changing this charter requires an RFC. A change can never take back rights already granted under the open-source license to code already released.

<!-- TODO(founder): confirm the charter. Items 1 (first six bullets) follow the brief; the local-compute and provider-interface bullets and items 2, 3 and 5 come from the research recommendations and the earlier draft plan (docs/research/community-licensing-business.md, docs/research/archive/full-scale-plan.md section 10). -->

## Relationship with 3dj.app

[3dj.app](https://www.3dj.app) is a separate, closed, hosted product made by the same company, Neural Deep Network LTD. It offers hosted services such as cloud GPU generation, a hosted MCP endpoint and print quotes.

- **One provider among others.** In Open3DJ, 3dj.app is an optional provider. It plugs in through the same public provider interface as any other local or third-party service, and it passes the same conformance tests.
- **Never required.** No Open3DJ feature requires a 3dj.app account. There are no 3dj.app-only APIs in Open3DJ.
- **Your consent first.** Nothing leaves your machine for 3dj.app, or for any other cloud provider, without your explicit consent for that job.
- **Openly declared.** Hosted providers, 3dj.app included, should declare which generative models they run and under which licenses.

Neural Deep Network LTD may earn money from hosted services such as 3dj.app. That business model never requires removing anything from Open3DJ, and contributions to Open3DJ stay under Open3DJ's open-source license.

## Trademark

The name "Open3DJ" and the Open3DJ logo belong to Neural Deep Network LTD. The open-source license covers the code, not the name or logo.

- You may use the name to refer to the project truthfully, for example "works with Open3DJ" or "a fork of Open3DJ".
- Please do not use the name or logo in a way that suggests that a fork, product or service is the official project or is endorsed by it. A short trademark policy will follow once the name is settled.

**The name may change before the first public release.** Trademark clearance for "Open3DJ" is still in progress, because a similar mark, OPEN3D, is a live US registration (Reg. 6468139) ([docs/research/gap-5.md](docs/research/gap-5.md)). Open3DJ is not affiliated with the Open3D library. If the name changes, we will announce it in Discussions and keep redirects in place.

## Path to a neutral foundation

Company leadership is the right fit while the project is small. It gives the project clear decisions and an accountable owner. As the community grows, Open3DJ should not depend on any single company.

Neural Deep Network LTD intends to move the trademark and any shared project funds to a neutral host when either of these happens, whichever comes first:

- three or more organizations each employ a maintainer with merge rights, or
- Open3DJ reaches version 1.0.

Candidate hosts include the Commonhaus Foundation and an independent association like the FreeCAD Project Association ([docs/research/community-licensing-business.md](docs/research/community-licensing-business.md), section 4). The move itself will go through an RFC so that contributors have a say.

<!-- TODO(founder): confirm the two neutral-host triggers above. They come from the research recommendation and are written here as the company's intention. -->

## Changing this document

Changes to this governance document go through an RFC. While the project is company-led, they also need the approval of the lead maintainer.
