# Repository settings for the founder

Some of the most visible parts of a GitHub project are settings, not files: the About box, topics, labels, Discussions, security reporting, branch rules and the settings behind automatic merging. The session that wrote these community files could not change repository settings, so this page collects everything in paste-ready form.

**For automatic evaluation and merging to work**, the settings in sections 2 (auto-merge), 6 (sign-off), 7 (the ruleset for `main`) and 8 (Actions, code owners and the AI review secret) must all be in place, in the order given in [First-time setup order](#first-time-setup-order). Until they are, pull requests are still checked, but a maintainer merges them by hand. The policy itself is described in [CONTRIBUTING.md](../CONTRIBUTING.md#how-your-pull-request-is-evaluated-and-merged), [AI_POLICY.md](../AI_POLICY.md) and [GOVERNANCE.md](../GOVERNANCE.md#automatic-evaluation-and-merging).

Each section gives the web steps and, where possible, an equivalent [GitHub CLI](https://cli.github.com/) command. Run the commands as a repository admin. Work through the [checklist](#checklist) at the end, then delete this file or keep it as a record.

## 1. About box

Open the repository page and click the gear icon next to **About**.

**Description** (335 of 350 characters):

```text
Open-source, agent-first CAD by Neural Deep Network LTD. Precise parametric modeling that AI agents drive over MCP and CLI, a professional desktop UI, local-first on Windows, macOS and Linux, pluggable cloud GPUs, and an industrial design pipeline from concept to manufacture. People, AI agents and organizations welcome to contribute.
```

This uses American spelling to match the other GitHub-facing files. If you prefer your original British wording, use "modelling" and "organisations" instead (336 characters).

**Website:** `https://www.neuraldeep.net` for now. Switch it to the documentation site when one exists.

**Topics** (20, GitHub's maximum):

```text
cad agentic-ai ai-agents mcp model-context-protocol parametric-cad brep opencascade 3d-modeling industrial-design product-design design-for-manufacturing 3d-printing text-to-cad generative-design local-first open-source step claude-code kaizen
```

**Include in the home page:** tick **Releases**. Leave **Packages** and **Deployments** unticked until they are used.

```sh
gh repo edit NeuralDEEPnet/Open3DJ \
  --description "Open-source, agent-first CAD by Neural Deep Network LTD. Precise parametric modeling that AI agents drive over MCP and CLI, a professional desktop UI, local-first on Windows, macOS and Linux, pluggable cloud GPUs, and an industrial design pipeline from concept to manufacture. People, AI agents and organizations welcome to contribute." \
  --homepage "https://www.neuraldeep.net" \
  --add-topic cad,agentic-ai,ai-agents,mcp,model-context-protocol,parametric-cad,brep,opencascade,3d-modeling,industrial-design \
  --add-topic product-design,design-for-manufacturing,3d-printing,text-to-cad,generative-design,local-first,open-source,step,claude-code,kaizen
```

## 2. Features

In **Settings > General > Features**:

- **Issues:** on. The issue forms in `.github/ISSUE_TEMPLATE/` turn blank issues off and point questions to Discussions.
- **Discussions:** on (see [section 3](#3-discussions)).
- **Wiki:** off. Documentation lives in the repository, where it is reviewed like code.
- **Projects:** optional. Useful later for the weekly plan-do-check-act board.
- **Sponsorships:** optional, once a GitHub Sponsors or Open Collective account exists.

In **Settings > General > Commits**:

- **Require contributors to sign off on web-based commits:** on. The browser editor then adds the Signed-off-by line for contributors who never touch git, so their pull requests pass the required DCO check ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository)). [CONTRIBUTING.md](../CONTRIBUTING.md#editing-in-the-browser) tells newcomers to rely on this. This setting was still off on 2026-10-29 (`web_commit_signoff_required: false`), so turn it on before you invite contributors, then remove the note about it in CONTRIBUTING.md.

In **Settings > General > Pull Requests**:

- **Allow squash merging** with the default message **Pull request title and commit details**. This keeps every `Signed-off-by` line in the squashed commit, which the Developer Certificate of Origin needs.
- **Allow rebase merging:** on. It keeps the original signed-off commits.
- **Allow merge commits:** off, for a linear history.
- **Allow auto-merge:** on. The merge workflow turns on auto-merge for a pull request when the rules allow, and GitHub merges it once every requirement of the ruleset in [section 7](#7-branch-rules-for-main) is met. Without this setting nothing merges automatically.
- **Always suggest updating pull request branches:** on.
- **Automatically delete head branches:** on.
- **Limit open pull requests for users without write access:** set the limit to 2, which matches the rule in [CONTRIBUTING.md](../CONTRIBUTING.md#for-ai-agents-and-their-operators), and add regular contributors to the bypass list. GitHub added this setting in June 2026 ([changelog](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/)); look for it in the pull request section of the repository settings.

```sh
gh repo edit NeuralDEEPnet/Open3DJ \
  --enable-issues --enable-discussions --enable-wiki=false \
  --enable-squash-merge --squash-merge-commit-message pr-title-commits \
  --enable-rebase-merge --enable-merge-commit=false \
  --enable-auto-merge \
  --allow-update-branch --delete-branch-on-merge
# Sign-off for commits made in the browser
gh api -X PATCH repos/NeuralDEEPnet/Open3DJ -F web_commit_signoff_required=true
```

## 3. Discussions

Discussions give questions and ideas a durable, searchable home. Categories can only be edited in the web interface: open the **Discussions** tab, then the pencil icon next to **Categories**.

| Category | Format | Description to paste |
|---|---|---|
| Announcements | Announcement (only maintainers can post) | Releases, weekly plan-do-check-act notes and project news. |
| Ideas | Open-ended discussion | Ideas for Open3DJ, big or small. Promising ideas become issues or RFCs. |
| Q&A | Question and answer | Ask anything about using or contributing to Open3DJ. Mark the answer that helped. |
| Show and tell | Open-ended discussion | Show what you designed, built, printed or automated with Open3DJ. |
| Industrial design | Open-ended discussion | Product design from brief and concept to design for manufacture and supplier handoff. |
| Agents and MCP | Question and answer | Driving Open3DJ from Claude Code, Codex, Cursor and custom MCP agents. Share configs, prompts and results. |

GitHub creates some default categories (General, Ideas, Polls, Q&A, Show and tell, Announcements). Keep the ones in the table, add the last two, and delete or keep **General** and **Polls** as you prefer.

**Suggested first post** (title "Welcome to Open3DJ: bring your agent, or bring yourself"; post it in Announcements and pin it):

```markdown
Welcome to Open3DJ, open-source and agent-first CAD created by Neural Deep Network LTD.

**Where we are.** The first vertical slice works: a script goes in, and a checked assembly, a report, a four-view drawing and STEP, STL, GLB and 3MF files come out, through the `open3dj` CLI and an MCP server with five tools. `open3dj view` shows the result in 3D in your browser. There is no desktop app yet, and nothing is on npm yet. Try it in a few minutes with [docs/GETTING-STARTED.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/GETTING-STARTED.md).

**Where we're going.** [ROADMAP.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/ROADMAP.md) has the steps, from trust checks and a parts library to printed prototypes, mechanisms and a supplier-ready handoff, and how you can help with each one.

**We have no outside contributors yet. You can be the first.** There are two ways in:

- **Bring your agent.** Load the Claude Code plugin from [skills/](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/skills/README.md), or connect Codex, Cursor, Gemini CLI or your own MCP agent. The most wanted task: run the [capability benchmark](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/bench/run-capability.md) and post the first pass^3 score in Agents and MCP. Then pick an `agent-ready` issue. The rules are short: [AI_POLICY.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/AI_POLICY.md).
- **Contribute as a person.** Pick a `good first issue`, propose a standard part, add an example or test geometry, install Open3DJ on your own machine with [docs/TESTING.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/docs/TESTING.md) and paste `open3dj doctor --report` into a hardware report, check a research claim, or write a design brief in Industrial design.

**How your pull request is handled.** Every pull request is checked automatically on five platforms, with a DCO sign-off check and an advisory AI review. Documentation, examples, new bench tasks and similar data merge on their own when everything passes. Code merges after one maintainer approves. [CONTRIBUTING.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/CONTRIBUTING.md) has the details.

Questions of any size are welcome in Q&A. Read [GOVERNANCE.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/GOVERNANCE.md) to see how decisions are made, and [CODE_OF_CONDUCT.md](https://github.com/NeuralDEEPnet/Open3DJ/blob/main/CODE_OF_CONDUCT.md) for how we treat each other. Thank you for being here.
```

## 4. Security

**Private vulnerability reporting** is required by [SECURITY.md](../SECURITY.md). Until it is on, reporters cannot use the **Report a vulnerability** button.

1. Go to **Settings**.
2. In the sidebar, open the **Security and quality** section (older interfaces call it **Code security** or **Code security and analysis**) and click **Advanced Security**.
3. Next to **Private vulnerability reporting**, click **Enable**.

While you are there, turn on these features, which are free for public repositories:

- **Dependabot alerts** and **Dependabot security updates**
- **Secret scanning** and **Push protection**

```sh
# Private vulnerability reporting
gh api -X PUT repos/NeuralDEEPnet/Open3DJ/private-vulnerability-reporting
# Dependabot alerts and security updates
gh api -X PUT repos/NeuralDEEPnet/Open3DJ/vulnerability-alerts
gh api -X PUT repos/NeuralDEEPnet/Open3DJ/automated-security-fixes
# Secret scanning and push protection
gh repo edit NeuralDEEPnet/Open3DJ --enable-secret-scanning --enable-secret-scanning-push-protection
```

After enabling private reporting:

- Remove the `TODO(founder)` comment about private reporting from `SECURITY.md`.
- In `.github/ISSUE_TEMPLATE/config.yml`, point the security contact link straight at the private form, as its `TODO(founder)` comment describes: set `url` to `https://github.com/NeuralDEEPnet/Open3DJ/security/advisories/new` and `about` to "Report privately through GitHub. See SECURITY.md for what to include." Until reporting is on, that page does not work for reporters, so the link points to `SECURITY.md`, which has a fallback.

**Two-factor authentication:** enable it on every account with write access to the repository.

## 5. Labels

The issue forms apply some of these labels automatically. A label must exist before a form can apply it, so create them first. The forms also use GitHub's default `bug` and `enhancement` labels, so keep those.

| Label | Color | Description |
|---|---|---|
| `good first issue` | `#7057ff` | Small, well-described task that makes a good first contribution |
| `help wanted` | `#008672` | Maintainers would welcome help with this |
| `agent-ready` | `#1d76db` | Executable acceptance check and files in scope; an agent with a human operator can take it |
| `needs-human` | `#f9d0c4` | Needs a person's judgment, hands or eyes, not an agent |
| `experiment` | `#bfd4f2` | Exploration or spike; may never merge; write-up in rfcs/experiments |
| `andon` | `#d93f0b` | Stop the line: main is broken or a check gave a false pass. Fix before any other merge |
| `parts-library` | `#0e8a16` | Standard parts for the parts library (screws, bearings, profiles and more) |
| `industrial-design` | `#d876e3` | Industrial design pipeline, from brief and concept to supplier handoff |
| `rfc` | `#fbca04` | Request for comments: a significant change under discussion (see rfcs/) |
| `research` | `#c5def5` | Research notes in docs/research: checks, corrections and new findings |
| `documentation` | `#0075ca` | Improvements or additions to documentation |
| `security` | `#b60205` | Security hardening. Report vulnerabilities privately (see SECURITY.md) |
| `organization` | `#5319e7` | An offer from a company, university, lab, makerspace, print service or other project |
| `feedback` | `#c2e0c6` | Ideas, UX feedback, translation offers and Kaizen suggestions |
| `needs-triage` | `#ededed` | New issue waiting for a maintainer to review and label |
| `bench` | `#006b75` | o3dj-bench tasks: new briefs, fixes and capability results |
| `failure-report` | `#e99695` | Something an agent or a person could not get right; becomes a test or a bench task |
| `hardware-report` | `#bfdadc` | doctor --bench results from a real machine |
| `lane: auto` | `#c2e0c6` | Merge lane: only auto-lane paths; merges when every check and the AI review pass |
| `lane: maintainer` | `#fef2c0` | Merge lane: touches code, configuration or governance; merges after a maintainer approves |
| `needs-maintainer` | `#fbca04` | Waiting for a maintainer to review or approve |
| `ai-review: pass` | `#0e8a16` | The advisory AI review found no problems |
| `ai-review: changes-suggested` | `#d93f0b` | The advisory AI review suggested changes |
| `hold` | `#b60205` | Do not merge automatically until a maintainer removes this label |

```sh
R=NeuralDEEPnet/Open3DJ
gh label create "good first issue" -R $R --force --color 7057ff --description "Small, well-described task that makes a good first contribution"
gh label create "help wanted"      -R $R --force --color 008672 --description "Maintainers would welcome help with this"
gh label create agent-ready        -R $R --force --color 1d76db --description "Executable acceptance check and files in scope; an agent with a human operator can take it"
gh label create needs-human        -R $R --force --color f9d0c4 --description "Needs a person's judgment, hands or eyes, not an agent"
gh label create experiment         -R $R --force --color bfd4f2 --description "Exploration or spike; may never merge; write-up in rfcs/experiments"
gh label create andon              -R $R --force --color d93f0b --description "Stop the line: main is broken or a check gave a false pass. Fix before any other merge"
gh label create parts-library      -R $R --force --color 0e8a16 --description "Standard parts for the parts library (screws, bearings, profiles and more)"
gh label create industrial-design  -R $R --force --color d876e3 --description "Industrial design pipeline, from brief and concept to supplier handoff"
gh label create rfc                -R $R --force --color fbca04 --description "Request for comments: a significant change under discussion (see rfcs/)"
gh label create research           -R $R --force --color c5def5 --description "Research notes in docs/research: checks, corrections and new findings"
gh label create documentation      -R $R --force --color 0075ca --description "Improvements or additions to documentation"
gh label create security           -R $R --force --color b60205 --description "Security hardening. Report vulnerabilities privately (see SECURITY.md)"
gh label create organization       -R $R --force --color 5319e7 --description "An offer from a company, university, lab, makerspace, print service or other project"
gh label create feedback           -R $R --force --color c2e0c6 --description "Ideas, UX feedback, translation offers and Kaizen suggestions"
gh label create needs-triage       -R $R --force --color ededed --description "New issue waiting for a maintainer to review and label"
gh label create bench              -R $R --force --color 006b75 --description "o3dj-bench tasks: new briefs, fixes and capability results"
gh label create failure-report     -R $R --force --color e99695 --description "Something an agent or a person could not get right; becomes a test or a bench task"
gh label create hardware-report    -R $R --force --color bfdadc --description "doctor --bench results from a real machine"
gh label create "lane: auto"       -R $R --force --color c2e0c6 --description "Merge lane: only auto-lane paths; merges when every check and the AI review pass"
gh label create "lane: maintainer" -R $R --force --color fef2c0 --description "Merge lane: touches code, configuration or governance; merges after a maintainer approves"
gh label create needs-maintainer   -R $R --force --color fbca04 --description "Waiting for a maintainer to review or approve"
gh label create "ai-review: pass"  -R $R --force --color 0e8a16 --description "The advisory AI review found no problems"
gh label create "ai-review: changes-suggested" -R $R --force --color d93f0b --description "The advisory AI review suggested changes"
gh label create hold               -R $R --force --color b60205 --description "Do not merge automatically until a maintainer removes this label"
```

**Why `good first issue` and `help wanted` keep their spaces.** They are GitHub's default labels, and [GitHub's documentation](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/encouraging-helpful-contributions-to-your-project-with-labels) says that applying the exact `good first issue` label makes it more likely that GitHub surfaces the issue to new contributors. The workflow labels support the Kaizen practices in [CONTRIBUTING.md](../CONTRIBUTING.md#the-kaizen-rhythm): `agent-ready` is the definition of ready for agent work, `needs-human` keeps a lane for people, `experiment` is the exploration lane, and `andon` stops the line.

The `bench`, `failure-report` and `hardware-report` labels are applied by the Bench task proposal, Failure report and Hardware report forms, so create them too. The last six labels are the ones the merge automation reads and writes; their names are set in `.github/merge-policy.json` (under `labels`), so if you rename one there, rename it here too. A `hold` or `andon` label on a pull request stops it from merging automatically.

**What makes an issue `agent-ready`:** a clear goal, links to the relevant files, under about one day of agent work, and acceptance criteria that a test can check (for example "the M4 x 12 screw has a bounding box of 7.0 x 7.0 x 16.0 mm within 0.05 mm"). Agents and their operators can then pick it up, and reviewers can verify the result quickly.

## 6. Developer Certificate of Origin (DCO) check

Every commit in a pull request must carry a `Signed-off-by` line from a person. The project's workflow reports this as a check named **`dco`**, and that is the name the ruleset in [section 7](#7-branch-rules-for-main) requires. Nothing needs installing for it.

If you prefer the DCO app instead (published by `dcoapp`, built on Probot), install it from https://github.com/apps/dco for this repository only. It adds a check named **DCO**, with capital letters. Require one of the two checks, not both, and make sure the required name matches exactly; a required check that never reports blocks every merge.

Your own commits need the sign-off too. Contributors who forget can fix it with `git commit --amend -s --no-edit` for the last commit, or `git rebase --signoff main` for several, then `git push --force-with-lease` (see [CONTRIBUTING.md](../CONTRIBUTING.md#sign-your-work-the-developer-certificate-of-origin)). Contributors who edit in the browser are covered by the web sign-off setting in [section 2](#2-features). [docs/LICENSING.md](LICENSING.md) explains the DCO in plain language, including how to sign off with GitHub's private `noreply` email address.

## 7. Branch rules for `main`

Use a ruleset: **Settings > Rules > Rulesets > New ruleset > New branch ruleset**. These rules make the two merge lanes work: every pull request needs the required checks, and only pull requests that touch a path with a code owner need an approval.

- **Name:** `main protection`. **Enforcement status:** Active.
- **Target branches:** include the default branch.
- **Restrict deletions:** on.
- **Block force pushes:** on.
- **Require a pull request before merging:** on.
  - **Required approvals: 0.** The approval requirement comes from code owners instead (next line). A number above 0 would make every pull request wait for a person, including documentation fixes.
  - **Require review from Code Owners:** on. With the `CODEOWNERS` file of [section 8](#8-automatic-evaluation-and-merging), every path except the auto-lane paths has an owner, so a pull request that touches code, workflows, hooks, dependencies, licenses or governance needs one approving review from a maintainer. A pull request that touches only auto-lane paths has no code owner to ask, so GitHub asks for no approval. The required `merge-policy` status (next item) is the main gate: it applies the exact lane rules, so it also waits for an approval in the cases `CODEOWNERS` cannot express, such as a changed golden, a changed bench `task.json`, a replaced image or an oversized pull request. The `evaluate` check only reports the lane for people; it always succeeds.
  - **Dismiss stale pull request approvals when new commits are pushed:** on, so a change pushed after a maintainer approved needs a new approval. Leave **Require approval of the most recent reviewable push** off: it can ask for an approval on every pull request, which would stop the auto lane.
  - **Require conversation resolution before merging:** on. An unresolved review thread then holds back an automatic merge until someone resolves it. If the AI reviewer posts inline review threads rather than a single comment, auto-lane pull requests wait for those threads too; that is the safe direction.
- **Require status checks to pass:** on. Add these checks by their exact names. A check appears in the search box only after it has run once in the last week, so open a test pull request first.
  - `check (ubuntu-latest)`
  - `check (ubuntu-24.04-arm)`
  - `check (macos-latest)`
  - `check (windows-latest)`
  - `check (windows-11-arm)`
  - `dco` (or `DCO` if you use the app instead, [section 6](#6-developer-certificate-of-origin-dco-check))
  - `evaluate`
  - `merge-policy`

  `merge-policy` is a commit status, not a check run: the merge workflow (`.github/workflows/automerge.yml`) sets it on the head commit of every pull request, and it is the gate that makes the two lanes work. It turns success only when every other required check is green and, in the auto lane, the AI review passed on that exact commit, or, in either lane, a maintainer approved that exact commit. It stays pending while a `hold` or `andon` label is set or a maintainer has requested changes. The merge workflow turns on auto-merge for every ready pull request, so **without `merge-policy` in this list, an auto-lane pull request would merge with no AI review and a changed golden would merge with no person**. When you add it, pick **GitHub Actions** as its source if the box offers a choice, so that only the workflow can satisfy it.

  Leave **Require branches to be up to date before merging** off for now. With it on, every merge makes the other open pull requests out of date, and auto-merge waits until someone updates them. Turn it on, or use a merge queue, if two pull requests that passed alone ever break `main` together.
- **Require linear history:** on, matching the merge settings in [section 2](#2-features).
- **Merge queue:** off. The CI, `evaluate` and `dco` workflows listen to `merge_group`, but the merge workflow sets `merge-policy` on pull request commits, not on merge-group commits, so a queue would wait for that status forever.

**Bypass list.** While you are the only maintainer, nobody else can approve your own maintainer-lane pull requests (GitHub does not let an author approve their own pull request). Add yourself (the Repository admin role) to the bypass list, set to "For pull requests only", so you can still merge your own reviewed work through a pull request. Remove the bypass as soon as a second maintainer joins. Do not add any app, bot or workflow to the bypass list.

```sh
# After saving the ruleset in the web interface, check it:
gh api repos/NeuralDEEPnet/Open3DJ/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/NeuralDEEPnet/Open3DJ/rules/branches/main
```

## 8. Automatic evaluation and merging

Sections 2, 6 and 7 cover auto-merge, the sign-off check and the ruleset. These settings complete the picture.

### Code owners: a safety net for the maintainer lane

The lanes are decided by `.github/merge-policy.json`, and the required `merge-policy` status from the merge workflow waits for a maintainer approval in the maintainer lane. The `evaluate` check only reports the lane. A `CODEOWNERS` file makes GitHub enforce the same idea on its own, so that even a broken workflow cannot merge code without a person.

[`.github/CODEOWNERS`](../.github/CODEOWNERS) is already in the repository. It gives every path an owner except the auto-lane paths. In a `CODEOWNERS` file the last matching line wins, and a line with a pattern but no owner means "no owner" ([GitHub docs: about code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)). It is built in five steps:

1. `*` owns everything.
2. The auto-lane folders and `*.md` lose their owner: `/docs/`, `/examples/`, `/bench/tasks/`, `/corpora/`, `/lib/`.
3. Code, scripts, binaries and build files get an owner again in every folder: `*.ts`, `*.js`, `*.sh`, `*.py`, `*.wasm`, `package.json`, `Dockerfile` and the other names in the policy's `code` rule.
4. The DSL scripts of examples and bench tasks (`*.o3j.js`) lose it again, because they run only inside the sandbox.
5. Code folders, `.github/`, `.claude/`, dotfiles, agent instruction files, the front page and plan, and governance files get an owner last, so nothing above can un-own them.

`scripts/automerge/workflows.test.ts` checks on every `npm run check` that every maintainer-lane path of the policy has an owner here and that the auto-lane paths have none.


`CODEOWNERS` cannot tell a new file from a changed one, so it leaves existing goldens (`examples/*/expected.json`), bench tasks, corpus files and images unowned; the `merge-policy` status still sends changes to those to the maintainer lane. When you widen the auto lane in `.github/merge-policy.json`, remove the matching owner lines here in the same pull request. If the two files differ, the stricter one wins: a path with an owner always needs an approval, and a path the policy file sends to the maintainer lane always waits for one. Both files live in `.github/`, so changing either one is itself a maintainer-lane change. Once the repository moves to an organization ([section 10](#10-account-and-organization)), replace `@NeuralDEEPnet` with a maintainers team.

### Actions settings

In **Settings > Actions > General**:

- **Actions permissions:** allow actions created by GitHub and the specific actions the workflows use (today only `anthropics/claude-code-action`, for the AI review), rather than all actions. The workflows that hold write tokens or the AI secret (`ai-review.yml` and `automerge.yml`) pin every action to a full commit id, with the version in a comment, and `workflows.test.ts` fails if a third-party action is not pinned. To update a pin, look up the release's commit on the action's release page on the day you change it.
- **Approval for running fork pull request workflows from contributors:** choose **Require approval for first-time contributors**. This is the "human click" of [AI_POLICY.md](../AI_POLICY.md): a first-time contributor's workflows, the checks and the AI review included, run only after a maintainer clicks **Approve and run**. Know its limit: GitHub stops asking once a contributor has had a commit merged, and an auto-lane pull request can merge without a person. From then on, every push from that contributor starts CI and an AI review without a click. The AI review has a daily budget in `.github/merge-policy.json` (`aiReview`: at most 6 reviews per pull request and reviews for at most 5 new pull requests per author in 24 hours), and the open pull request limit of 2 ([section 2](#2-features)) caps it further. If the AI bill or the CI minutes ever grow too fast, choose **Require approval for all external contributors** instead; every outside contributor's runs then wait for your click.
- **Workflow permissions:** **Read repository contents and packages permissions**. Each workflow job asks for the extra permissions it needs (for example `pull-requests: write` to turn on auto-merge) in its own file.
- **Allow GitHub Actions to create and approve pull requests:** **off**. This setting is what keeps any workflow, and any AI model running in one, from approving a pull request.

### The AI review secret

The AI review needs one secret. Add it in **Settings > Secrets and variables > Actions > New repository secret**:

- `ANTHROPIC_API_KEY`: an API key from the Anthropic Console, billed per use; or
- `CLAUDE_CODE_OAUTH_TOKEN`: a token from `claude setup-token`, which uses your Claude subscription ([PLAN.md](PLAN.md) section 4.8 plans the review on the founder's subscription).

```sh
# Prompts for the value, so it never lands in your shell history or a file
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R NeuralDEEPnet/Open3DJ
```

Never paste the value into an issue, a file or a commit. Without the secret there is no AI review. Auto-merge still works, but every pull request, in both lanes, then waits for a maintainer approval, and GitHub merges it after you approve. Before you add the secret, read the review workflow once and check three things: the job that holds the secret never checks out or runs the pull request's code; the reviewer gets its input inline and has no tools that read files, run commands or reach the web; and its job token can only read contents. `workflows.test.ts` checks the same on every `npm run check`.

### First-time setup order

The `evaluate`, `dco`, AI review and merge workflows always run the scripts and the policy from the default branch, never from a pull request. Until they are on `main`, they cannot run, so the pull request that adds them cannot pass its own `evaluate` and `dco` checks. Set things up in this order:

1. **Merge the pull request that adds the automation** (the workflows, `scripts/automerge/`, `.github/merge-policy.json` and `.github/CODEOWNERS`) yourself, through the admin bypass, after `npm run check` passes. Make sure the two example goldens are regenerated first, or every `check (...)` job fails.
2. **Turn on the settings** of sections 2 and 8: auto-merge, web sign-off, the Actions settings and, if you want the AI review, the secret.
3. **Open a test pull request** that changes one file in `docs/`, so that every check name runs once: the five `check (...)` jobs, `dco`, `evaluate` and the `merge-policy` status.
4. **Create the ruleset** of [section 7](#7-branch-rules-for-main) with the eight required checks and code owner review. Add the required checks only after step 3: a name appears in the search box only after it has reported once.
5. **Check the first automatic merges** as described below.

### Things to check on the first automatic merge

- **CI on `main`.** A merge that auto-merge makes for the workflow's own `GITHUB_TOKEN` does not start push workflows, so CI may not run on the merged commit by itself. The `main-ci` job in `automerge.yml` covers this: after a merge it sees, and every 30 minutes, it starts `ci.yml` on the default branch when the head of `main` has no CI run. On the first automatic merge, open **Actions > CI** and check that a run for the merged commit appears within about 30 minutes.
- **The two lanes.** Open two test pull requests: one that changes only a file in `docs/`, and one that changes a file in `packages/`. The first should show no review requirement and merge by itself once the checks and the AI review pass. The second should ask for your review as code owner. If the docs-only one asks for a review, check the required approvals (0) and the `CODEOWNERS` file.
- **A required check that never reports.** If a required check name in the ruleset does not match the job name exactly, every pull request waits forever. Compare the names in [section 7](#7-branch-rules-for-main) with the checks on the test pull request.
- **Pausing.** To hold one pull request, add the `hold` label (an `andon` label on the pull request does the same). To stop automatic merging everywhere for a while, for example while `main` is broken, disable the merge workflow in **Actions**, or set required approvals in the ruleset to 1 for that time.

## 9. Social preview image

Upload it in **Settings > General > Social preview > Edit > Upload an image**. GitHub asks for a PNG, JPG or GIF under 1 MB, at least 640 x 320 pixels, and recommends 1280 x 640 pixels.

**Idea:** a 1280 x 640 dark technical canvas split in two.

- **Left:** a clean B-rep mechanical part, such as a bracket with a fillet and two holes, drawn as crisp edges with two or three dimension callouts in millimeters. It signals precise CAD, not a mesh toy.
- **Right:** a short, real-looking agent exchange in a monospace font, for example an MCP tool call that adds a fillet and returns a GeometryReport line with the volume and "watertight: yes".
- **Bottom band:** "Open3DJ: open-source, agent-first CAD" and, smaller, "by Neural Deep Network LTD".

Keep the important content away from the edges, because some sites crop the image. Because the project name may change after trademark clearance, keep the name small enough to swap easily.

## 10. Account and organization

The repository currently lives under the `NeuralDEEPnet` account, which the research found is a user account rather than an organization ([research/gap-5.md](research/gap-5.md)). An organization makes teams, `CODEOWNERS` with teams, and a two-factor requirement for all members possible. Create the organization and transfer the repository once the project name is settled. GitHub redirects the old URLs after a transfer.

## 11. After these settings

Open **Insights > Community standards**. Once these settings, the README and a CONTRIBUTING.md are in place, it should show README, Code of conduct, Contributing, License, Security policy, Issue templates and Pull request template as complete.

Then, to welcome the first contributors, and before you announce the project anywhere (the README, CONTRIBUTING.md and the welcome post link to these labels, and on 2026-10-29 the repository had none of the project labels and no open issues):

- Open five to ten small issues labeled `good first issue` (for people) or `agent-ready` (for an operator and their agent), each with a checkable acceptance criterion. For example:
  - `Part: ISO 4762 M3-M6 socket head cap screw` (`parts-library`, `agent-ready`)
  - `Part: ISO 4032 M3-M6 hex nut` (`parts-library`, `good first issue`)
  - `Part: 608 ball bearing envelope` (`parts-library`, `good first issue`)
  - `Research check: OCCT 8.0.1 license file and LGPL exception text` (`research`, `good first issue`)
  - `Research check: TRELLIS (v1) geometry-path dependency licenses in gap-4.md` (`research`, `agent-ready`)
  - `Glossary: B-rep, STEP, MCP` (`documentation`, `good first issue`)
  - `Glossary: draft angle, wall thickness, undercut` (`documentation`, `needs-human`)
  - `Design brief: wall bracket for a 20 x 20 mm extrusion` (`industrial-design`, `good first issue`)
  - `Test geometry: a STEP file with fillets on fillets` (`help wanted`)
  - `Docs: check every link in CONTRIBUTING.md and AGENTS.md` (`documentation`, `agent-ready`)
  - `Bench: first capability run with Claude Code, Codex or Gemini CLI` (`bench`, `help wanted`)
  - `Hardware: install with docs/TESTING.md and file open3dj doctor --report on Windows, macOS or ARM64` (`hardware-report`, `needs-human`)
- Pin the welcome discussion and the best starter issues.
- To ask people to test on their machines, use the ready-to-post texts and the posting checklist in [ops/outreach/](../ops/outreach/README.md).

## Checklist

- [ ] About: description, website and 20 topics
- [ ] Features: Issues and Discussions on, Wiki off, merge settings
- [ ] Sign-off required on web-based commits
- [ ] Open pull request limit of 2 for users without write access, with a bypass list
- [ ] Discussions categories and a pinned welcome post
- [ ] Private vulnerability reporting enabled, the TODO comment in `SECURITY.md` removed, and the security link in `config.yml` pointed at the private form
- [ ] Dependabot alerts and security updates, secret scanning and push protection
- [ ] Two-factor authentication for everyone with write access
- [ ] Labels created
- [ ] Allow auto-merge on
- [ ] `dco` check required (or the DCO app installed and its `DCO` check required)
- [ ] Ruleset for `main`: 0 required approvals, code owner review, the eight required checks (including `merge-policy`), linear history
- [ ] `.github/CODEOWNERS` in place (it is in the repository), and the automation merged to `main` first ([setup order](#first-time-setup-order))
- [ ] Merge labels created: `lane: auto`, `lane: maintainer`, `needs-maintainer`, `ai-review: pass`, `ai-review: changes-suggested`, `hold`
- [ ] Actions: first-time contributor approval (or approval for all outside contributors), read-only default token, Actions may not approve pull requests
- [ ] `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secret added for the AI review
- [ ] Two example goldens regenerated, so that `npm run check` is green
- [ ] First automatic merge checked (CI on `main`, required check names)
- [ ] Social preview image uploaded
- [ ] Organization created after the naming decision
- [ ] Community standards page shows all items complete
