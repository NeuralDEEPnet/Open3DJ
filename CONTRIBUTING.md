# Contributing to Open3DJ

Welcome, and thank you for being here. Open3DJ is at the very start of its life, so the people, AI agents and organizations who join now will shape what it becomes. This guide explains how you can help, what we expect from a contribution, and how we say thank you.

**Start here**

| You are | Your first step |
|---|---|
| **New to GitHub** | [Create a free GitHub account](https://github.com/signup), then [pick a form](https://github.com/NeuralDEEPnet/Open3DJ/issues/new/choose): [Standard part proposal](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=part_library.yml), [Industrial design pipeline](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=industrial_design.yml) or [Research check](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=research_check.yml). No git, no code. |
| **Using an AI agent** | Point it at [AGENTS.md](AGENTS.md) and try one of the [starter tasks for agents](#your-agents-first-task). |
| **Representing an organization** | See [For organizations](#for-organizations). |

Have a question? Ask in [Q&A on GitHub Discussions](https://github.com/NeuralDEEPnet/Open3DJ/discussions/categories/q-a).

**The short version**

1. Pick an issue labeled `good first issue`, `help wanted` or `agent-ready`, or open a new issue that describes what you would like to do.
2. Keep each pull request to one focused change, with tests or evidence.
3. If you send a pull request, sign off each commit (`git commit -s`, or automatic in the browser editor). This is the [Developer Certificate of Origin](#sign-your-work-the-developer-certificate-of-origin).
4. If an AI tool helped, say so in a commit trailer and in the pull request.
5. Be kind. Everyone here follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Why contribute](#why-contribute)
- [Where the project is today](#where-the-project-is-today)
- [Find your path](#find-your-path)
  - [For people](#for-people)
  - [For AI agents and their operators](#for-ai-agents-and-their-operators)
  - [Your agent's first task](#your-agents-first-task)
  - [For organizations](#for-organizations)
- [How work is organized](#how-work-is-organized)
- [Your first pull request, step by step](#your-first-pull-request-step-by-step)
- [Sign your work: the Developer Certificate of Origin](#sign-your-work-the-developer-certificate-of-origin)
- [Disclosing AI assistance](#disclosing-ai-assistance)
- [Quality bar](#quality-bar)
- [Review: what to expect](#review-what-to-expect)
- [Recognition](#recognition)
- [Licensing of contributions](#licensing-of-contributions)
- [Code of conduct](#code-of-conduct)
- [Security issues](#security-issues)
- [Questions](#questions)

## Why contribute

### What Open3DJ is

Open3DJ is open-source, agent-first and local-first CAD. It does precise parametric B-rep modeling, the exact solid geometry that engineering and manufacturing depend on. AI agents drive it through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP) and a command-line interface, and people drive it through a professional desktop app. It will install on Windows, macOS and Linux, run on your own computer, and let you plug in cloud GPUs when you want more power. It also covers the industrial product design pipeline, from a brief and a concept through design for manufacture to a clean handoff to suppliers.

### Why it matters

- **Agents need to see what they built.** AI agents rarely fail at CAD because they cannot write code. They fail because they cannot see what the code did, cannot point at geometry reliably and cannot prove the result is right. Open3DJ is built around that feedback loop: every change produces measurable evidence that a person or an agent can check.
- **Your work stays yours.** Local-first means your files stay on your machine unless you choose to send them somewhere. The designs you create with Open3DJ belong to you.
- **Design should connect to making.** Open3DJ aims to carry a part from idea to a file a printer, a print service or a manufacturer can actually use.
- **Open tools last.** Open source code and open file formats mean nobody can take your tool or your files away from you.

### Who created it

Open3DJ was created by **Neural Deep Network LTD** ([neuraldeep.net](https://www.neuraldeep.net), GitHub `NeuralDEEPnet`), a company based in Dublin and Malta in the EU.

Today the team is the founder, unpaid volunteers, and AI agents, including Claude and the founder's own agents. There are no paid engineers. Every contribution makes a visible difference, and early contributors will always be credited as such.

### What you get

- Credit that lasts, in [CONTRIBUTORS.md](CONTRIBUTORS.md) and in release notes.
- A real voice in the design while it is still on paper.
- Interesting problems: geometry kernels, agent tooling, human and agent collaboration, and manufacturing.
- A friendly place to learn, where trying new things is encouraged.

## Where the project is today

Open3DJ is in the **planning stage**. There is no application code yet. What exists:

- [docs/research/](docs/research/): research reports on the CAD landscape, geometry kernels, agent protocols, security, licensing and more. Start with [docs/research/README.md](docs/research/README.md).
- [docs/PLAN.md](docs/PLAN.md): the lean plan and its steps.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the technical architecture.
- [docs/ASSEMBLIES.md](docs/ASSEMBLIES.md): assemblies, mates, fits and exports.
- [docs/COMPUTE.md](docs/COMPUTE.md): CPU and GPU compute.
- [docs/INDUSTRIAL-DESIGN.md](docs/INDUSTRIAL-DESIGN.md): the industrial design pipeline, from brief to supplier handoff.

The starting tech stack is not decided yet. The first code lands in Step 1 of [docs/PLAN.md](docs/PLAN.md). Until then, the most valuable help is reviewing the plan, checking the research, writing specs for standard parts, collecting test geometry and telling us how you work today.

**About the name.** "Open3DJ" is a working name. It is pending trademark clearance and may change before the first public release. If it does, we will rename the repository (GitHub redirects old links), and your work and your credit carry over unchanged.

## Find your path

There are three ways in: as a person, as a person working with an AI agent, or as an organization. All three are welcome.

### For people

Designers, engineers, makers, developers, writers, researchers and students: you are all welcome. Many tasks need no coding at all.

| You are | Good first steps |
|---|---|
| Industrial or product designer | Read [docs/INDUSTRIAL-DESIGN.md](docs/INDUSTRIAL-DESIGN.md) and tell us where it differs from how you really work. Describe the outputs you hand to a supplier. Until that page lands, open an [Industrial design pipeline](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=industrial_design.yml) issue describing your outputs to suppliers. |
| Mechanical or manufacturing engineer | Write a spec for a standard part. Contribute design-for-manufacture rules for a process you know (draft angles, minimum wall thickness, sheet metal bend radii, tool access for CNC), with sources. |
| Maker or 3D printing enthusiast | Share test geometry that breaks other tools. Describe your print workflow and where it hurts. Later, test builds on your own printer. |
| Developer | Review [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and comment on open issues. Until that page lands, read the three architecture proposals in [docs/research/proposals/](docs/research/proposals/). When Step 1 opens, help with prototypes, CI and tooling. |
| Writer or translator | Make the docs clearer. Write glossary entries that explain CAD terms to developers and AI terms to designers. Offer a language for translation. |
| Researcher or student | Check a claim in [docs/research/](docs/research/) against its primary source. Propose benchmark tasks. Point us to papers we missed. |
| Anyone who uses CAD | Tell us what slows you down in the CAD tools you use today. |

**Concrete first tasks**

1. **Write a standard part spec for the parts library.** Pick a common part, such as an ISO 4762 socket head cap screw, an ISO 4032 hex nut, a 608 ball bearing, a NEMA 17 motor mount or a 20 x 20 mm aluminum extrusion profile. Write down the dimensions and where they come from (the standard's number or a datasheet link), the parameters a user should be able to change, and facts we can check automatically, such as the bounding box or the volume within a tolerance. Record dimensions, not copied pages or drawings from paid standards. Use the [Standard part proposal](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=part_library.yml) form.
2. **Contribute test geometry.** STEP, STL or 3MF files that are known to be hard: fillets on fillets, thin shells, nearly tangent faces, tiny edges. Add a note on what goes wrong in other tools, and share it through the [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) form ("Test geometry"). Only share files you made yourself or that carry a license allowing redistribution (for example CC0 or CC BY 4.0), and say which.
3. **Write an example design brief.** Describe a real object (a phone stand, a wall bracket, an enclosure for a development board) with requirements that an agent's result could be checked against: sizes, loads, fit, material, process. Use the [Industrial design pipeline](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=industrial_design.yml) form.
4. **Check the research.** Every report in [docs/research/](docs/research/) is a snapshot dated 2026-10-27. Pick one claim (a version number, a price, a license, a benchmark score), check the primary source, and report what you found with the link in the [Research check](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=research_check.yml) form.
5. **Improve the docs.** Fix an unclear sentence, add a missing link or add a glossary entry. You can do this in the browser (see [Editing in the browser](#editing-in-the-browser)).
6. **Offer a translation.** Open an [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) issue naming the language you can help with. We will start translations once the core docs settle, so your work does not go stale.
7. **Give UX feedback.** Use the same [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) form to describe a task you do in CAD today, the steps you take and where it hurts. Sketches and screenshots are welcome.

### For AI agents and their operators

AI coding agents are welcome here: Claude Code, Codex, Cursor, Gemini CLI, custom MCP agents and others. Open3DJ is itself built with agents. To keep quality high and review time fair for a small team, agent contributions follow these rules.

1. **A human is accountable.** Every agent contribution has a human operator who has read the whole change, can explain it, and signs off the [DCO](#sign-your-work-the-developer-certificate-of-origin). Only a person can certify the DCO. This is the same principle as the [Linux kernel's policy for coding assistants](https://docs.kernel.org/process/coding-assistants.html).
2. **Read [AGENTS.md](AGENTS.md) first.** Point your agent at it. Codex, Cursor and many other tools read `AGENTS.md` directly, and Claude Code loads it through [CLAUDE.md](CLAUDE.md).
3. **Disclose.** Name the agent in the pull request template, and add a trailer to every commit an agent helped with, for example:

   ```text
   Assisted-by: <agent or tool name>
   Signed-off-by: Ada Lovelace <ada@example.com>
   ```

   A `Co-Authored-By:` trailer that your tool adds automatically is also fine. See [Disclosing AI assistance](#disclosing-ai-assistance).
4. **Link an issue.** Every agent pull request links to an issue that a maintainer has acknowledged or labeled `agent-ready` or `help wanted`.
5. **Keep it small.** One focused change per pull request. The soft limit is about 400 changed lines, not counting generated lockfiles or test fixtures. If you need more, agree on it in the issue first.
6. **Run the checks and paste the results.** Include the commands you ran and their output, or a short summary of it, in the pull request. Geometry changes also need [evidence](#quality-bar).
7. **No volume plays.** No mass-generated or speculative pull requests. No unsolicited drive-by refactors, reformatting or renames. At most 2 open pull requests per contributor at a time. Regular contributors can ask a maintainer to raise this limit for them.
8. **Keep the repository clean.** Never commit secrets (tokens, API keys, credentials), generated binaries or build outputs, or model weights. Restricted-license model weights must never enter the repository in any form.
9. **Answer review as yourself.** Reviewers talk to the operator. You may use your agent to address feedback, but you check the result before you push.
10. **Low-effort pull requests may be closed without a detailed review.** If a pull request looks mass-generated, unreviewed or unrelated to an issue, a maintainer may close it with a short note. This is not a ban. You are welcome to come back with a smaller change linked to an issue.
11. **Agents can help beyond code.** When a maintainer asks, or an issue invites it, agents can help triage issues, write minimal reproductions and check research claims. Post the results under the operator's account with a disclosure, and do not change labels or close issues unless you have triage rights and were asked to.

A friendly tip: prefer issues labeled `agent-ready` ([see the open ones](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3Aagent-ready)), and leave `good first issue` for people taking their first steps in the project. Issues labeled `needs-human` need a person's judgment, hands or eyes, so please do not hand them to an agent.

### Your agent's first task

You do not need to wait for a labeled issue. These starter tasks are allowed without one, because what your agent produces is a draft issue that you check and file yourself. Copy a prompt, run it, and review every line before you submit.

1. **Check a research claim.**

   ```text
   Read docs/research/README.md. Pick one dated claim in docs/research/gap-5.md, verify it against its primary source, and draft a Research check issue (.github/ISSUE_TEMPLATE/research_check.yml) for me to review. Quote the claim exactly, link every source with the date you checked it, and mark anything you could not verify.
   ```

2. **Draft a standard part.**

   ```text
   Draft a Standard part proposal (.github/ISSUE_TEMPLATE/part_library.yml) for an ISO 4032 M5 hex nut. Give the source of every dimension, the parameters a user should be able to set, and checkable acceptance criteria such as the bounding box within a tolerance. Do not copy tables from paid standards. I will check every number.
   ```

3. **Explain a term.**

   ```text
   Read CONTRIBUTING.md and docs/research/README.md. Draft an Idea, feedback or Kaizen suggestion issue (.github/ISSUE_TEMPLATE/feedback.yml) that proposes three glossary entries (B-rep, STEP, MCP), each in two plain sentences for a reader who has never used CAD or AI agents, with one primary source link each. Show me the draft and do not file anything yourself.
   ```

When you file the result, choose the option that starts "Yes, an AI agent drafted or filed it for me" in the form. It confirms that you checked the draft yourself, so make sure its promise (every source, every dimension or the whole draft checked) is true. Once maintainers have labeled issues, the [open `agent-ready` issues](https://github.com/NeuralDEEPnet/Open3DJ/issues?q=is%3Aopen+label%3Aagent-ready) are the next step.

### For organizations

Companies, universities, research labs, makerspaces, print services, manufacturers and other open-source projects can make a big difference to Open3DJ, and we want to hear from you.

**What you can contribute**

- **Engineers' time.** Your people contribute like anyone else, with a DCO sign-off on each commit. Please make sure they have your permission to contribute, because the DCO certifies the right to submit the work. For the full picture, including patents, the DCO for employees and third-party rules, see [docs/LICENSING.md](docs/LICENSING.md).
- **Parts catalogs.** Standard and catalog parts you are allowed to share (fasteners, bearings, extrusions, connectors, motors), in a form we can turn into parametric library parts.
- **Benchmark datasets and test data.** Real CAD tasks, STEP files, and drawings with ground truth, under a license that allows redistribution.
- **Compute or GPU credits.** For CI on Windows, macOS and Linux, nightly benchmark runs, and testing generative model packs.
- **Integrations.** 3D printers, slicers, print services and manufacturers (quotes, design-for-manufacture rules for your processes); CAD and PLM tools (import, export, STEP conformance files); cloud GPU providers through the planned provider interface.
- **Research and teaching.** Student projects, thesis topics, course use and feedback from labs.
- **Hands-on testing.** Makerspaces and training centers can run workshops with new users and tell us what confused them.

**How to get in touch**

- **In public:** fill in the [Organization offer](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=organization.yml) form.
- **In private** (for example commercial terms or data that is not public yet): contact Neural Deep Network LTD through the contact page at [neuraldeep.net](https://www.neuraldeep.net).

Tell us who you are, what you would like to contribute, the license or terms that apply, and who our contact person is.

**How organizations are credited**

- Listed in [CONTRIBUTORS.md](CONTRIBUTORS.md) under Organizations, with what you contributed.
- Thanked by name in the release notes of the release your contribution lands in.
- Datasets, parts catalogs and other material keep your attribution in their files and notices, as their license requires.
- For sustained support, such as engineering time or compute, we will agree on a fitting public acknowledgement together.

**What does not change.** Contributions do not buy control of the roadmap. Decisions are made in public issues and RFCs. Open3DJ is company-led today. [GOVERNANCE.md](GOVERNANCE.md) explains how decisions are made, the open-core charter, and the plan to move the trademark to a neutral foundation (see [Path to a neutral foundation](GOVERNANCE.md#path-to-a-neutral-foundation)).

## How work is organized

### Issues come first

Almost everything starts as an issue. Please search first, then open a new issue with the template that fits best. Issues are where we agree on what to do before anyone spends time on how.

### Labels

| Label | Meaning |
|---|---|
| `good first issue` | Small, clearly described and mentored. Meant for people making their first contribution. |
| `help wanted` | Maintainers would welcome help. May need some experience or context. |
| `agent-ready` | Well specified, with an executable acceptance check, files in scope and little ambiguity. A good fit for an operator and their agent. |
| `needs-human` | Needs a person's judgment, hands or eyes, for example design review, printing and measuring a part, or testing an install. |
| `experiment` | An exploration or spike. It may never merge, and a written-up result, including a failure, counts as success. |
| `andon` | Stop the line: the main branch is broken or a check gave a false pass. Fixing it comes before any other merge. |
| `parts-library` | Standard and catalog parts for the parts library. |
| `industrial-design` | The pipeline from brief and concept to design for manufacture and supplier handoff. |
| `research` | Checks, corrections and new findings for the research in [docs/research/](docs/research/). |
| `documentation` | Improvements or additions to the documentation. |
| `security` | Security hardening. Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). |
| `organization` | An offer from a company, university, lab, makerspace, print service or other project. |
| `feedback` | Ideas, UX feedback, translation offers and Kaizen suggestions. |
| `rfc` | A design proposal under discussion. See [RFCs for big changes](#rfcs-for-big-changes). |
| `needs-triage` | New, and waiting for a maintainer to read and label it. The issue forms add it for you. |

We use GitHub's default spelling for `good first issue` and `help wanted`, because GitHub surfaces issues with those exact labels to new contributors. Only maintainers can apply labels. If you think an issue deserves `andon`, comment with a reproducer and ask for it. More labels will appear as the code arrives.

### Claiming work

Comment on the issue to say you are working on it, and a maintainer will assign it to you. If plans change, just say so on the issue. Nobody minds. If a claimed issue has no update for 14 days, we may free it up for someone else, and you are welcome to pick it up again later.

### Small pull requests

One change per pull request. Small pull requests are reviewed faster, break less and are easier to revert. If a change is getting big, split it, or open an issue to plan it in steps.

### RFCs for big changes

Some changes deserve a written proposal before code: new dependencies with notable license or size impact, changes to the agent tool contract (MCP or CLI), file formats, the geometry kernel, the security model, licensing, and anything else that is hard to reverse.

1. Open an issue labeled `rfc` describing the problem, the proposal, the alternatives you considered, the risks, and how we will know it worked.
2. Discuss it in the open. Anyone can comment, including organizations and agent operators.
3. A final comment period of 10 calendar days, including at least 5 business days, gives everyone a last chance to raise concerns before a decision (see [GOVERNANCE.md](GOVERNANCE.md#big-changes-rfcs)).
4. The decision and the reasons are recorded in the issue. Once the `rfcs/` directory exists, accepted RFCs live there as Markdown files.

Bold ideas are welcome. If you want to explore something off the main path, propose it as an experiment (the `experiment` label). Write-ups of experiments will live in `rfcs/experiments/`. A clearly written-up experiment that did not work is still a useful contribution.

### The Kaizen rhythm

We work in a lean, Kaizen style: small steady improvements, made visible.

- **Small usable releases.** We ship often, in small steps that each do something useful.
- **Weekly plan-do-check-act review.** Each week we plan what to try, do it, check the results against what we expected, and act: keep it, adjust it or drop it. Notes will be posted publicly in GitHub Discussions, so everyone can follow along.
- **Stop the line on regressions.** When the main branch breaks, a maintainer labels the issue `andon`, and fixing it comes before merging anything else.
- **Every failure becomes a regression test.** We find the root cause (we use "5 whys"), write a test that fails, then fix it, so the same problem cannot come back silently.
- **Standard work.** [AGENTS.md](AGENTS.md), this guide and the issue and pull request templates are our standard work. When a problem comes from a gap in the process, we improve the standard.
- **Anyone can suggest an improvement.** Use the [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) form and choose "Kaizen suggestion".

### Blameless, curious and sustainable

- **No blame.** Mistakes show us where the system is weak. We ask what allowed a problem to happen, not who caused it.
- **Curiosity is welcome.** Exploring unusual ideas is how good tools get made. Spikes and experiments are encouraged, and failed experiments are documented, not punished.
- **Long-term over quick.** We prefer solutions that are simple to maintain and easy for the next person to understand.
- **Look after yourself.** Volunteers set their own pace. Nobody is expected to reply in the evening, on weekends or on holidays. It is fine to step away at any time. Just let us know if you are dropping a claimed issue.

## Your first pull request, step by step

1. **Find or open an issue** and comment that you are working on it.
2. **Fork the repository** and create a branch named `<kind>/<issue-number>-<short-description>`, for example `parts/57-iso-4032-nut` or `docs/12-glossary`. Kinds: `feat`, `fix`, `docs`, `parts`, `test`, `research`, `rfc`, `chore`.
3. **Make one focused change.** Add tests or evidence as described in the [quality bar](#quality-bar).
4. **Run the checks** (see below).
5. **Commit with a sign-off:** `git commit -s`. If an AI tool helped, add a disclosure trailer.
6. **Push and open a pull request.** Fill in the template and link the issue, for example `Closes #57`.
7. **Work through the review** with the maintainers. When it is merged, you are credited.

Is this your first pull request ever? Say so in the description. We will walk you through it.

### Editing in the browser

You do not need git for small changes to text. Open any file on GitHub, click the pencil icon and make your edit. Then click the green button to commit or propose your changes, choose to start a pull request, and follow the steps. GitHub makes a copy of the repository (a fork) for you if you need one, and adds your sign-off automatically, so the DCO check passes. This works well for documentation fixes, glossary entries and adding yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md). If a DCO check ever fails on your pull request, do not worry: comment and a maintainer will help you fix it.

<!-- TODO(founder): the automatic sign-off needs "Require contributors to sign off on web-based commits" turned on (docs/REPO-SETTINGS.md, section 2). -->

### Build and test commands

> Commands will be added when the first code lands in Step 1 of [docs/PLAN.md](docs/PLAN.md).

Until then, most changes are documentation. Before you open a pull request, check that your links work, preview the Markdown, and read your text once more for plain, clear sentences.

## Sign your work: the Developer Certificate of Origin

Open3DJ uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) (DCO). We do not use a Contributor License Agreement (CLA). You keep the copyright to your work.

The DCO is a short statement that you have the right to submit your contribution under the project's open-source license. In summary, by signing off you certify that:

- you wrote the contribution, or have the right to submit it under the project's license;
- or it is based on earlier work under a compatible open-source license that lets you submit it;
- or someone who certified one of the above gave it to you and you did not change it;
- and you understand the contribution and your sign-off are public and kept on record.

The full text of the DCO 1.1 is in [docs/LICENSING.md](docs/LICENSING.md#the-text-of-the-dco-11), together with a plain-language guide to licensing.

**How to sign off.** If you edit in the browser, GitHub adds the sign-off for you (see [Editing in the browser](#editing-in-the-browser)). On your own computer, add `-s` when you commit:

```sh
git commit -s -m "Add ISO 4032 hex nut spec"
```

Git adds a line like this to the commit message, using your configured name and email:

```text
Signed-off-by: Ada Lovelace <ada@example.com>
```

**Forgot to sign off?** For the last commit, run `git commit --amend -s --no-edit`. For every commit on your branch, run `git rebase --signoff main` and then push your branch again with `git push --force-with-lease`.

**Name and privacy.** Use your real name or the name you are publicly known by. Anonymous sign-offs cannot be accepted. To keep your personal email private, use your GitHub noreply address (it looks like `ID+username@users.noreply.github.com`), which you can find in your GitHub email settings.

**Agents never sign off.** An agent commits without `-s`. You review the full diff, then add your own sign-off with `git commit --amend -s --no-edit` (one commit) or `git rebase --signoff main` (several). The `Signed-off-by` line always names the accountable human operator.

## Disclosing AI assistance

This applies to everyone, not only agent operators. If an AI tool wrote or substantially shaped a change (code, docs, research or test data), say so:

- Add a trailer to each affected commit, in the form `Assisted-by: <agent or tool name>`. A `Co-Authored-By:` trailer added automatically by your tool is also fine.
- Fill in the AI assistance section of the pull request template: which agent, and what it did.

### Attribution for Neural Deep Network agents

Work posted by AI agents that Neural Deep Network LTD operates, or that act on its behalf, uses one attribution everywhere: **neuraldeep.net design agents**.

| Where | Attribution |
|---|---|
| Commit trailer | `Assisted-by: neuraldeep.net design agents` |
| Pull request description, last line | `Generated by [neuraldeep.net design agents](https://www.neuraldeep.net)` |
| Issue and pull request comments, last line | `Generated by [neuraldeep.net design agents](https://www.neuraldeep.net)` |
| CONTRIBUTORS.md | Listed as neuraldeep.net design agents, operated by Neural Deep Network LTD |

Contributors who use their own agents keep the general rule above and name their own agent or tool.

Spell checkers and simple autocomplete do not need a trailer. Disclosure is not a mark against your work. It helps reviewers know where to look closely, and it helps us learn which ways of working produce the best results.

## Quality bar

Every pull request should meet this bar. Reviewers use it too.

- [ ] **One change, linked to an issue.**
- [ ] **Tests.** New behavior comes with tests. Bug fixes start with a test that fails before the fix and passes after it.
- [ ] **Evidence.** Geometry changes show measured results before and after (for example volume, surface area, bounding box, counts of solids, faces and edges, and the validity check result), plus a render or screenshot. Research changes cite primary sources with links and the date you checked them.
- [ ] **Docs in sync.** If behavior, commands or concepts change, the docs change in the same pull request.
- [ ] **Checks pass**, and the results are pasted into the pull request.
- [ ] **Licenses checked.** Every new dependency, dataset, model or file has a known license that fits our [policy](#licensing-of-contributions).
- [ ] **Nothing that does not belong.** No secrets, no generated binaries, no model weights. The one exception is the example gallery drawings (`examples/*/drawing.png`), which are regenerated by the examples script.
- [ ] **Plain writing.** Short, clear sentences that a newcomer can follow.

## Review: what to expect

We are a small team of volunteers, so here is an honest picture.

- **First response:** we aim to respond to new issues and pull requests within 48 hours. A clearly labeled bot may acknowledge them sooner, and a person always follows up.
- **Review:** small, focused pull requests are usually reviewed within 14 days. Large changes and RFCs can take longer.
- **Silence:** if you have heard nothing after 14 days, a polite ping on the pull request is welcome. It helps us.
- **What reviewers look at:** whether the change solves the linked issue, the quality bar above, license hygiene, and whether the change is small enough to review well.
- **Splitting:** we may ask you to split a large pull request. This is normal and makes merging faster.
- **Closing:** we may close a pull request that is off-issue, much too large, or looks unreviewed, with a short note. You can always reopen with a smaller change.
- **Inactive pull requests:** if we are waiting on the author for 30 days, we may close the pull request. Reopen it any time.
- **Disagreements:** we talk them through on the issue. Maintainers make the final call on small changes, and bigger questions go through an RFC.

These are goals, not promises. As the team grows, we will tighten them.

## Recognition

Every contribution counts, not only code.

- **CONTRIBUTORS.md.** We add you to [CONTRIBUTORS.md](CONTRIBUTORS.md) with your first merged contribution, code or not. You can add yourself in your pull request, or ask us to do it.
- **A useful issue counts too.** When a maintainer acts on your research check, part proposal, design brief or feedback, we add you to [CONTRIBUTORS.md](CONTRIBUTORS.md) (or you can add yourself in a one-line pull request).
- **All kinds of work.** In the spirit of the [all-contributors](https://allcontributors.org/en/reference/emoji-key) specification, we credit design, documentation, research, testing, test data, translation, review, ideas, bug reports, mentoring, event organizing, funding and infrastructure as well as code.
- **Release notes.** Every release names the people and organizations who contributed to it, and includes a contributor spotlight.
- **Agents.** AI agents are credited through their operators, for example "Ada Lovelace (with Claude Code)".

## Licensing of contributions

For the full picture, including patents, the DCO for employees and third-party rules, see [docs/LICENSING.md](docs/LICENSING.md).

**Today.** Open3DJ is licensed under the [MIT License](LICENSE), "Copyright (c) 2026 Neural Deep Network LTD and the Open3DJ contributors".

**Inbound equals outbound.** Your contribution is licensed under the same license as the project. You keep the copyright to your work, and there is no CLA.

**A proposed change.** The research recommends moving to a dual license, **MIT OR Apache-2.0**, as many open-source projects do. Apache-2.0 adds an explicit patent grant, and keeping MIT preserves compatibility. This is a founder decision that has **not been made yet**. Until it is, contributions are accepted under MIT. To keep the option open without asking everyone again later, we ask you to agree that your contribution may also be distributed under Apache-2.0 if the project adopts MIT OR Apache-2.0. If you do not agree, please say so in your pull request before it is merged.

<!-- TODO(founder): confirm the forward-looking Apache-2.0 consent sentence above, or remove it. The same sentence is surfaced as a checkbox in .github/pull_request_template.md ("Before you request review"), so confirm or remove it in both places together. Update this section when the MIT OR Apache-2.0 decision is made. -->

**Third-party code, data and models.** These rules keep Open3DJ safe to use, embed and sell:

- **Open CASCADE Technology (OCCT)** is licensed LGPL-2.1 with the Open CASCADE exception. It must stay dynamically linked, or be used as WebAssembly in line with its terms, so users can replace it.
- **No GPL or AGPL code in the core.** Tools such as OpenSCAD, CGAL, SolveSpace, pymeshlab and pymeshfix may only run as separate, optional processes, or not at all.
- **Generative 3D models come with license manifests.** Models with restrictive terms are opt-in packs only, never defaults. Examples include TripoSG, TRELLIS.2 in its default configuration, and Hunyuan3D, whose Tencent license excludes the EU, the UK and South Korea. Model weights are never committed to this repository.
- **Do not copy code** from projects with incompatible licenses. If you are unsure, ask in the issue before you start.

**Your designs are yours.** The project license covers the Open3DJ software. The models and designs you create with Open3DJ belong to you.

**The name.** "Open3DJ" is pending trademark clearance and may change before the first public release.

## Code of conduct

Everyone who takes part in Open3DJ, in issues, pull requests, discussions or anywhere else, follows our [Code of Conduct](CODE_OF_CONDUCT.md). If something worries you, message a maintainer privately via the contact page at [https://www.neuraldeep.net](https://www.neuraldeep.net). We will treat your report with care and discretion.

<!-- TODO(founder): add a dedicated conduct reporting address here and in CODE_OF_CONDUCT.md. -->

## Security issues

Please do not report security vulnerabilities in public issues or pull requests. Use GitHub private vulnerability reporting instead: open the repository's [Security tab](https://github.com/NeuralDEEPnet/Open3DJ/security) and choose "Report a vulnerability". See [SECURITY.md](SECURITY.md) for details.

## Questions

Not sure where to start, or whether an idea fits? Ask in [Q&A on GitHub Discussions](https://github.com/NeuralDEEPnet/Open3DJ/discussions/categories/q-a). There are no silly questions, and your question probably helps the next newcomer too. Ideas are welcome in the [Ideas category](https://github.com/NeuralDEEPnet/Open3DJ/discussions/categories/ideas), or through the [Idea, feedback or Kaizen suggestion](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=feedback.yml) form.

Thank you for helping build Open3DJ.
