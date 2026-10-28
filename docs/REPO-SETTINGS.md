# Repository settings for the founder

Some of the most visible parts of a GitHub project are settings, not files: the About box, topics, labels, Discussions, security reporting and branch rules. The session that wrote these community files could not change repository settings, so this page collects everything in paste-ready form.

Each section gives the web steps and, where possible, an equivalent [GitHub CLI](https://cli.github.com/) command. Run the commands as a repository admin. Work through the [checklist](#checklist) at the end, then delete this file or keep it as a record.

## 1. About box

Open the repository page and click the gear icon next to **About**.

**Description** (336 of 350 characters):

```text
Open-source, agent-first CAD by Neural Deep Network LTD. Precise parametric modelling that AI agents drive over MCP and CLI, a professional desktop UI, local-first on Windows, macOS and Linux, pluggable cloud GPUs, and an industrial design pipeline from concept to manufacture. People, AI agents and organisations welcome to contribute.
```

This is the text exactly as specified. It uses British spelling ("modelling", "organisations"). The rest of the GitHub-facing files use American spelling. If you prefer them to match, change those two words to "modeling" and "organizations". The text then has 335 characters, still under the limit.

**Website:** `https://www.neuraldeep.net` for now. Switch it to the documentation site when one exists.

**Topics** (20, GitHub's maximum):

```text
cad agentic-ai ai-agents mcp model-context-protocol parametric-cad brep opencascade 3d-modeling industrial-design product-design design-for-manufacturing 3d-printing text-to-cad generative-design local-first open-source step claude-code kaizen
```

**Include in the home page:** tick **Releases**. Leave **Packages** and **Deployments** unticked until they are used.

```sh
gh repo edit NeuralDEEPnet/Open3DJ \
  --description "Open-source, agent-first CAD by Neural Deep Network LTD. Precise parametric modelling that AI agents drive over MCP and CLI, a professional desktop UI, local-first on Windows, macOS and Linux, pluggable cloud GPUs, and an industrial design pipeline from concept to manufacture. People, AI agents and organisations welcome to contribute." \
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

In **Settings > General > Pull Requests**:

- **Allow squash merging** with the default message **Pull request title and commit details**. This keeps every `Signed-off-by` line in the squashed commit, which the Developer Certificate of Origin needs.
- **Allow rebase merging:** on. It keeps the original signed-off commits.
- **Allow merge commits:** off, for a linear history.
- **Always suggest updating pull request branches:** on.
- **Automatically delete head branches:** on.

```sh
gh repo edit NeuralDEEPnet/Open3DJ \
  --enable-issues --enable-discussions --enable-wiki=false \
  --enable-squash-merge --squash-merge-commit-message pr-title-commits \
  --enable-rebase-merge --enable-merge-commit=false \
  --allow-update-branch --delete-branch-on-merge
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

**Suggested first post** (pin it in Announcements):

> **Welcome to Open3DJ.** Open3DJ is open-source, agent-first CAD created by Neural Deep Network LTD. We are in the planning stage, which is the best time to shape a project. People, AI agents operated by people, and organizations are all welcome. Good places to start: check a claim in our research with the Research check form, propose a standard part, or tell us what you need in Industrial design. Read GOVERNANCE.md to see how decisions are made, and CODE_OF_CONDUCT.md for how we treat each other.

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

After enabling private reporting, remove the "Note for the founder" block from `SECURITY.md`.

**Two-factor authentication:** enable it on every account with write access to the repository.

## 5. Labels

The issue forms apply some of these labels automatically. A label must exist before a form can apply it, so create them first. The forms also use GitHub's default `bug` and `enhancement` labels, so keep those.

| Label | Color | Description |
|---|---|---|
| `good-first-issue` | `#7057ff` | Small, well-described task that makes a good first contribution |
| `help-wanted` | `#008672` | Maintainers would welcome help with this |
| `agent-friendly` | `#1d76db` | Clear spec and checkable acceptance criteria; an agent with a human operator can take it |
| `parts-library` | `#0e8a16` | Standard parts for the parts library (screws, bearings, profiles and more) |
| `industrial-design` | `#d876e3` | Industrial design pipeline, from brief and concept to supplier handoff |
| `rfc` | `#fbca04` | Request for comments: a significant change under discussion (see docs/rfcs) |
| `research` | `#c5def5` | Research notes in docs/research: checks, corrections and new findings |
| `documentation` | `#0075ca` | Improvements or additions to documentation |
| `security` | `#b60205` | Security hardening. Report vulnerabilities privately (see SECURITY.md) |
| `needs-triage` | `#ededed` | New issue waiting for a maintainer to review and label |

```sh
R=NeuralDEEPnet/Open3DJ
gh label create good-first-issue  -R $R --force --color 7057ff --description "Small, well-described task that makes a good first contribution"
gh label create help-wanted       -R $R --force --color 008672 --description "Maintainers would welcome help with this"
gh label create agent-friendly    -R $R --force --color 1d76db --description "Clear spec and checkable acceptance criteria; an agent with a human operator can take it"
gh label create parts-library     -R $R --force --color 0e8a16 --description "Standard parts for the parts library (screws, bearings, profiles and more)"
gh label create industrial-design -R $R --force --color d876e3 --description "Industrial design pipeline, from brief and concept to supplier handoff"
gh label create rfc               -R $R --force --color fbca04 --description "Request for comments: a significant change under discussion (see docs/rfcs)"
gh label create research          -R $R --force --color c5def5 --description "Research notes in docs/research: checks, corrections and new findings"
gh label create documentation     -R $R --force --color 0075ca --description "Improvements or additions to documentation"
gh label create security          -R $R --force --color b60205 --description "Security hardening. Report vulnerabilities privately (see SECURITY.md)"
gh label create needs-triage      -R $R --force --color ededed --description "New issue waiting for a maintainer to review and label"
```

**A note on `good-first-issue`.** GitHub's own default label is spelled `good first issue`, with spaces. GitHub's documentation says that applying that exact label makes it more likely that GitHub surfaces the issue to new contributors. Two simple options:

- keep GitHub's default `good first issue` and `help wanted` labels as well, and apply both spellings to starter issues, or
- use only GitHub's default spellings and skip the hyphenated ones.

Either works. The first keeps the label set consistent, and the second keeps it shorter.

**What makes an issue `agent-friendly`:** a clear goal, links to the relevant files, and acceptance criteria that a test can check (for example "the M4 x 12 screw has a bounding box of 7.0 x 7.0 x 16.0 mm within 0.05 mm"). Agents and their operators can then pick it up, and reviewers can verify the result quickly.

## 6. Developer Certificate of Origin (DCO) app

The DCO app checks that every commit in a pull request carries a `Signed-off-by` line whose email matches the commit author. It is published by `dcoapp` and built on Probot.

1. Open https://github.com/apps/dco and click **Install**.
2. Choose **Only select repositories**, pick **Open3DJ**, and confirm.
3. Open a test pull request with a signed-off commit (`git commit -s`). The app adds a check named **DCO**.
4. Make that check required (see [section 7](#7-branch-rules-for-main)).

Your own commits need the sign-off too. Contributors who forget can fix it with `git commit --amend -s` or `git rebase --signoff main`, then force-push their branch. [docs/LICENSING.md](LICENSING.md) explains the DCO in plain language, including how to sign off with GitHub's private `noreply` email address.

## 7. Branch rules for `main`

Use a ruleset: **Settings > Rules > Rulesets > New ruleset > New branch ruleset**.

- **Name:** `main protection`. **Enforcement status:** Active.
- **Target branches:** include the default branch.
- **Restrict deletions:** on.
- **Block force pushes:** on.
- **Require a pull request before merging:** on.
  - Required approvals: 1.
  - Dismiss stale pull request approvals when new commits are pushed: on.
  - Require review from Code Owners: turn this on once a `CODEOWNERS` file exists.
  - Require conversation resolution before merging: on.
- **Require status checks to pass:** on. Add **DCO** now. Add the CI checks when the first code lands in Step 1 of [docs/PLAN.md](PLAN.md).
- **Require linear history:** on, matching the merge settings in [section 2](#2-features).

**Bypass list.** While you are the only maintainer, nobody else can approve your pull requests. Add yourself (the Repository admin role) to the bypass list, set to "For pull requests only", so you can still merge your own reviewed work through a pull request. Remove the bypass as soon as a second maintainer joins.

## 8. Social preview image

Upload it in **Settings > General > Social preview > Edit > Upload an image**. GitHub asks for a PNG, JPG or GIF under 1 MB, at least 640 x 320 pixels, and recommends 1280 x 640 pixels.

**Idea:** a 1280 x 640 dark technical canvas split in two.

- **Left:** a clean B-rep mechanical part, such as a bracket with a fillet and two holes, drawn as crisp edges with two or three dimension callouts in millimeters. It signals precise CAD, not a mesh toy.
- **Right:** a short, real-looking agent exchange in a monospace font, for example an MCP tool call that adds a fillet and returns a GeometryReport line with the volume and "watertight: yes".
- **Bottom band:** "Open3DJ: open-source, agent-first CAD" and, smaller, "by Neural Deep Network LTD".

Keep the important content away from the edges, because some sites crop the image. Because the project name may change after trademark clearance, keep the name small enough to swap easily.

## 9. Account and organization

The repository currently lives under the `NeuralDEEPnet` account, which the research found is a user account rather than an organization ([research/gap-5.md](research/gap-5.md)). An organization makes teams, `CODEOWNERS` with teams, and a two-factor requirement for all members possible. Create the organization and transfer the repository once the project name is settled. GitHub redirects the old URLs after a transfer.

## 10. After these settings

Open **Insights > Community standards**. Once these settings, the README and a CONTRIBUTING.md are in place, it should show README, Code of conduct, Contributing, License, Security policy, Issue templates and Pull request template as complete.

Then, to welcome the first contributors:

- Open five to ten small issues labeled `good-first-issue` and `agent-friendly`, for example research checks and the first standard parts.
- Pin the welcome discussion and the best starter issues.

## Checklist

- [ ] About: description, website and 20 topics
- [ ] Features: Issues and Discussions on, Wiki off, merge settings
- [ ] Discussions categories and a pinned welcome post
- [ ] Private vulnerability reporting enabled, and the note in `SECURITY.md` removed
- [ ] Dependabot alerts and security updates, secret scanning and push protection
- [ ] Two-factor authentication for everyone with write access
- [ ] Labels created
- [ ] DCO app installed and its check required
- [ ] Ruleset for `main`
- [ ] Social preview image uploaded
- [ ] Organization created after the naming decision
- [ ] Community standards page shows all items complete
