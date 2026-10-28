# Lean and Kaizen operating model for Open3DJ (founder, volunteers, AI agents)

Research date: 28 Oct 2026. Method: primary sources (GitHub changelog and docs, Claude Code docs, Toyota and Lean Enterprise Institute pages, project policy files, vendor pricing pages, arXiv). This note builds on gap-1, gap-7, gap-9 and industrial-design.md and does not repeat them. It assumes no paid engineers and no funding plan.

## Bottom line

- **The bottleneck is human review, not code.** Every practice below protects review attention: small batches, a work-in-progress (WIP) cap set by daily review capacity, and deterministic checks before a human looks. DORA 2025 calls AI "an amplifier" and names "working in small batches" among seven capabilities that amplify its benefit [1][2].
- **Put zero-exception rules in hooks and CI, not prose.** Claude Code's guidance: CLAUDE.md is "for guidelines"; "if something has to happen every time, make it a hook, a deny rule, or a managed setting" [3]. That is poka-yoke.
- **Jidoka means a red main branch stops new merges**, and a false "pass" on any gate stops the line until a regression test exists.
- **Open source has been flooded by low-quality AI PRs in 2026.** tldraw auto-closes external PRs [4], Godot bans autonomous agents [5], curl ended its bug bounty [6], and GitHub shipped PR caps and collaborator-only PRs [7][8]. Open3DJ is agent-first, so it must welcome agents while making the contributor, never the maintainer, pay the cost of validation.
- **Volunteers need executable on-ramps, not labels.** Good-first-issue labels are in decline and newcomer merge rates on them fell from 61.9% to 42.2% [9]. Library-style contributions with an automated checker (the KiCad and BOSL2 pattern) scale better.
- **The toolchain can be almost free.** Standard GitHub runners on all three OSes are free and unlimited for public repos [10]. Microsoft Store MSIX signing is free [11]. The unavoidable cash costs are Apple's $99 a year (only when a macOS GUI ships), filament or prints for the industrial design (ID) pipeline, and the founder's existing LLM subscription.

## 1. Toyota Production System practices mapped to agent-built software

Toyota defines jidoka as "automation with a human touch", where the operator "can stop the line by pulling the stop cord", and just-in-time as "making only what is needed, when it is needed, and in the amount needed" [12]. The Toyota Way rests on two pillars, continuous improvement and respect for people [13].

| Practice | Meaning for Open3DJ | Concrete mechanism |
|---|---|---|
| PDCA [14] | Every release is one experiment | Each step states a hypothesis, one exit metric and a definition of done; Friday review decides "standardise" or "roll back" |
| Small batches, one-piece flow | One issue, one PR, one concern | Agent PRs under about 400 changed lines excluding fixtures; one `lib` part per PR; weekly release train |
| Pull, kanban, WIP limits | Agents start work only when review capacity exists | Board columns Ready / Doing / Review / Done; Review column capped (start at 3 agent PRs); GitHub per-user open-PR cap for outside contributors [8] |
| Muda (waste) [15] | Seven software wastes: partly done work, extra features, relearning, handoffs, task switching, delays, defects; plus token waste | Close stale agent branches weekly; skills and AGENTS.md stop relearning; review in two fixed windows a day; fast CI |
| Muri (overburden) | Founder review load, volunteer burnout, agent context overload | Review WIP cap; CLAUDE.md under 200 lines [16]; no on-call for volunteers |
| Mura (unevenness) | Bursts of agent PRs after planning, then droughts | Heijunka: a fixed daily agent dispatch quota; weekly releases instead of release spikes |
| Jidoka and andon | The line stops itself on abnormality | Required checks on `main`; merge queue frozen when red; `andon` label anyone may apply; agent Stop hooks that refuse to finish until checks pass [3] |
| Poka-yoke [17] | Make the wrong action impossible | PreToolUse hooks block agent edits to golden files, tolerance tables and the licence allowlist; licence gate in CI; schema codegen for MCP/CLI parity; DCO check; daemon-owned approvals in the product |
| 5 whys [18] | Root-cause every escaped defect | Every `andon` issue closes with a 5-whys note and a named countermeasure |
| Standard work | The current best way, written down, as the baseline for kaizen | AGENTS.md, issue forms, skills (`new-lib-part`, `fix-bench-failure`, `release`, `triage`); "Claude makes the same mistake a second time" triggers an update [16] |
| Gemba | Go and see real use | Read agent transcripts weekly; watch a volunteer install on a Windows laptop; print and handle every ID-0 part |
| Visual management | The state of the line is visible to all | Public project board; a GitHub Pages status page with main status, bench trend, open andons, review-queue age |
| A3 [19] | One page per problem or step | `docs/a3/NNN.md`: background, current condition, target, root cause, countermeasures, follow-up |
| Kaizen event | Short focused blitz on one metric | Monthly one-to-two-day event with volunteers, for example "Windows install under 3 minutes" |

Respect for people is part of the system: blameless reviews (an agent error is a missing check or missing context, not a person's fault), an exploration lane (`experiment` label, spikes that need not merge), and no volunteer deadlines.

## 2. Running the line with AI agents

### 2.1 What went wrong elsewhere

- **tldraw** auto-closes all external PRs since 15 Jan 2026, citing contributions "generated entirely by AI tools" [4]. **curl** ended its bug bounty when confirmed vulnerabilities fell below 5% of reports [6].
- **Ghostty** requires disclosure and that contributors can explain their change without AI, and keeps a public denouncement list [20].
- **Godot** (30 Jun 2026) auto-bans autonomous agents, disallows substantial AI-generated code, and makes contributors with 3 or fewer merged PRs get sign-off before features [5].
- **LLVM** calls unreviewed LLM output an "extractive contribution" and bans agents acting "without human approval", unreviewed automated review comments, and AI on good-first issues [21].
- **Linux kernel:** agents must not add `Signed-off-by`; the human certifies the DCO and adds `Assisted-by:` [22].
- **Most projects permit AI.** Of 281 policies, 83.3% permit it, 67.3% require high human involvement and 48.8% require disclosure [23].
- **GitHub's 2026 controls:** collaborators-only or disabled PRs [7]; a per-user open-PR cap (drafts excluded, bypass list) [8]; collaborators-only issues [24]; workflow trigger allow-lists (preview) [25]; CI on `github-actions[bot]` PRs only after approval [26].
- **Speed and quality evidence is mixed.** METR found experienced OSS developers 19% slower with AI in 2025; a late-2025 follow-up suggests a modest speed-up but is "very weak evidence" [27]. A vendor study of 470 PRs found 1.7x more issues in AI-co-authored PRs [28]. Measure our own flow.

### 2.2 Open3DJ rules

**`AI_POLICY.md`.** AI is welcome in an agent-first project, but the human who opens a PR owns it: they disclose tool and model in an `Assisted-by:` trailer, can explain the change, run the one-command check, and attach evidence (bench diff, GeometryReport, snapshot renders). Only humans sign the DCO. No agent opens issues or PRs or posts reviews without a human pressing the button. Text in human conversations is human-edited. The founder's agents follow the same rules.

**The founder's agent line.**
- **Tools.** Claude Code in parallel worktrees, with `/code-review` in a fresh subagent as the separate reviewer [3]. `claude-code-action@v1` answers `@claude` and runs nightly jobs (bench, licence drift, triage digest) [29].
- **Triggers.** The action runs only for users with write access and rejects bot actors unless allow-listed, so outsiders cannot spend tokens and bots cannot loop [29]. Fork-PR runs get no secrets, so a maintainer triggers review with a comment and gives fork content read and comment tools only.
- **Triage** writes labels and a daily digest for the founder; it does not judge volunteers' PRs in public [21].
- **Merging.** Agents never merge: one human approval plus green checks.
- **Authentication.** `CLAUDE_CODE_OAUTH_TOKEN` from an existing subscription avoids API billing [29]. Cap runs with `--max-turns`, timeouts and concurrency groups.

**Standard work for agents.** One `AGENTS.md` under 200 lines is the source of truth; Claude Code reads it directly when no CLAUDE.md exists (v2.1.277 or later) [16]. Add path-scoped rules for kernel, MCP and library code, and about ten hooks ("if you ever find yourself at forty", most are preferences [3]): a Stop hook runs the fast check; PreToolUse hooks protect fixtures, tolerances, licences and secrets.

### 2.3 Eval-driven development

Following Anthropic's guidance [30]: keep a regression suite at about 100% and a capability suite that starts low as "a hill to climb"; start with "20-50 simple tasks drawn from real failures" (every escaped bug, failed print or confusing transcript becomes a task); report pass^k as well as pass@k; grade outcomes (geometry assertions, Evidence Pack gates), not paths; and read transcripts weekly, the gemba for agents. Infrastructure alone moved Terminal-Bench scores by 6 points, and gaps under 3 points deserve caution [31], so run capability evals at least 3 times and treat a drop as a yellow signal.

## 3. Volunteers: on-ramps and keeping them

**What worked elsewhere:**

- **BOSL2** (BSD-2-Clause, 2,434 stars, 6,070 commits since 2019) keeps docs in code comments whose `Example` blocks OpenSCAD renders into images [32], and `func_coverage.py` lists public functions with no test [33]. Newcomers see exactly what is missing.
- **KiCad libraries** use a written convention (KLC); scripts check every merge request, then a librarian reviews. Librarian capacity is the bottleneck [34].
- **build123d** (Apache-2.0, 3,539 stars) has Discord, Read the Docs and a short CONTRIBUTING file [35]. **cq_warehouse** and **bd_warehouse** (153 and 113 stars) show a one-person part collection does not grow contributors by itself.
- Almost half of good-first issues are not solved by newcomers [36], and their share has declined since January 2024 [9].

**Open3DJ on-ramps, in order of effort:**

1. **Report a real failure** through an issue form (client, model, script, GeometryReport); it becomes an eval task, credited.
2. **Print and measure** ID-0 parts and post photos and calliper readings. Agents cannot do this.
3. **Add a `lib` part** under an Open3DJ Library Convention modelled on the KLC: cited standard (for example ISO 4762), units, tolerances, licence and a manifest. A CI checker runs every gate; a coverage script opens `good-first-part` issues automatically.
4. **Author benchmark tasks** with executable assertions.
5. **Review** DFM rules with citations, CMF and briefs (designers and engineers), or test installs on Windows.
6. **Become a librarian or reviewer** with the triage role and CODEOWNERS for one module.

**Keeping volunteers:**

- First human response within 48 hours (a labelled bot may acknowledge sooner). Close PRs kindly and quickly; cap open PRs at 2 per outside user, with a bypass list for regulars [8]. Agree an issue before any feature, as Godot does [5].
- Recognition: All Contributors credits non-code work [37]; every `lib` part page and bench row names its author; each weekly build log has a spotlight.
- Later: Google Summer of Code via the BRL-CAD umbrella, which listed OpenSCAD and Manifold in 2026 (secondary source) [38]. Claude for Open Source accepts a repo with "20+ unique external contributors" merged in 12 months, and says "apply anyway" to near misses [39].

## 4. Zero-budget toolchain

| Need | Free route | Limits or conditions |
|---|---|---|
| CI | GitHub Actions standard runners: Linux x64 and arm64, Windows x64 and arm64, macOS Intel and arm64 are "free and unlimited on public repositories" [10] | Free plan allows 20 concurrent jobs, 5 of them macOS, and 6 h per job [40]. Larger runners are always charged [41]. Scheduled workflows stop after 60 days of inactivity in public repos [29] |
| Agent in CI | `anthropics/claude-code-action@v1` [29] | Token cost comes from the subscription or API key |
| LLMs | Founder's existing Claude plan. Later: Claude for OSS, 6 months of Max 20x [39]; Codex for OSS, 6 months of ChatGPT Pro plus fund credits of no stated amount [42]; Copilot Pro for "popular" projects [43]. Free Gemini API key: 250 Flash requests a day; the unpaid Gemini CLI tier became Antigravity CLI on 18 Jun 2026 [44] | All discretionary. Plan without them |
| GPU | Hugging Face ZeroGPU: free accounts host 2 Gradio Spaces on half an RTX Pro 6000 (48 GB); visitors get 5 free minutes a day [45]. Modal Starter: $30 a month of credits [46]. Volunteers' own GPUs | A TRELLIS demo and smoke tests, not a fleet |
| Docs | GitHub Pages; Read the Docs Community (free for OSS, ad-supported, PR previews) [47] | None |
| Registries | npm trusted publishing over OIDC, with provenance by default (GA 31 Jul 2025) [48]; PyPI and crates.io trusted publishing; MCP Registry; skills.sh | Use trusted publishing, so there are no long-lived tokens |
| Supply chain | GitHub artifact attestations on the Sigstore public-good instance for public repos [49] | None |
| Windows signing | Microsoft Store MSIX: "code signing is free", the Store re-signs, no SmartScreen warnings [11]; individual registration is free with an ID check, but the waiver is stated only for individuals, not companies [50]; Tauri has no native MSIX output, and Microsoft's winapp CLI guide covers packaging it [51]. Direct downloads: SignPath Foundation (free; publisher shown as "SignPath Foundation"; needs a prior release and reputation; no commercial dual-licensing or proprietary components) [52], or Azure Artifact Signing at about $9.99 a month [11] | The headless Agent Preview ships via npm, PyPI or uvx and needs no Authenticode |
| macOS | Apple Developer Program, $99 a year plus VAT (gap-9). Homebrew casks "must not require ... Gatekeeper to be disabled or bypassed" [53] | Unavoidable only when the desktop app ships |
| Community | GitHub Discussions, Discord, All Contributors bot | None |

**Unavoidable cash:** $0 until the macOS desktop app ships, then $99 a year for Apple. About $120 a year for Azure only if the publisher must read "Neural Deep Network LTD" or SignPath declines. Filament or print orders for ID-0. A domain is optional (github.io or a 3dj.app subdomain).

## 5. The weekly Kaizen loop

The loop takes about 6 to 8 founder hours a week, counting the review windows and the planning and review meetings below.

| When | Activity | Output |
|---|---|---|
| Daily, about 20 min, async | Andon check: is `main` green, are there open `andon` issues? Read the digest | Stop or go |
| Daily, two windows | Pull review: merge or close PRs in the Review column. Then dispatch agents up to the WIP cap from Ready | Flow, not batches |
| Nightly (agents) | Regression and capability evals, licence drift, triage digest | Scorecard data |
| Monday, 30 min | Plan: pick one kaizen theme and refill Ready with spec'd issues (definition of ready below) | Weekly target |
| Wednesday, 45 min | Gemba hour: open office hours, watch one real user or volunteer, read 10 agent transcripts | Problems seen first-hand |
| Friday, 60 min | Check and act: scorecard review; one A3 or 5-whys on the worst problem; update AGENTS.md, hooks or skills; ship the weekly release; post the build log with credits | Standard work updated |
| Monthly | Kaizen event, retrospective, re-base targets (gap-7) | One metric moved |

**Scorecard** (published on the status page):

| Group | Metrics |
|---|---|
| Flow | PR lead time (median); review-queue size and oldest age; agent WIP; releases a week; reverts per merged PR; time to restore `main` |
| Quality | Agent PRs green on first CI run; review rounds per PR; acceptance rate of agent PRs; escaped defects; flaky-test rate |
| Product evals | Regression suite (target 100%); G1 task success; G4 recovery; G5 tokens per report; G6 calls per task; G7 reference stability; G8 invalid-but-labelled-valid (must be 0); ID-0 first-print fit rate |
| Real usage | Downloads (median day x 7); install success; opt-in weekly active installs; first-response time; new contributors with a merged PR; contributors returning within 60 days |
| Cost | LLM tokens or subscription hours per merged PR; CI minutes and macOS queue time |

## 6. Stop-the-line policy

**Red andon.** Any of these stops new merges:

1. A required check is red on `main`.
2. The regression suite is below 100%.
3. A false "pass": an invalid or non-watertight output labelled valid (G8), a false Evidence Pack pass, or a silent reference mis-resolution (G7).
4. A GPL, non-commercial or territory-restricted dependency or weight has entered the core.
5. A security failure: approval bypass, sandbox escape or secret leak.
6. A broken install or data loss on a tier-1 OS in a release.

**Yellow andon** (investigate before the next release): a capability eval drops more than 3 points across 3 runs [31], or the review queue's oldest item is older than 5 days.

**Response.** Anyone, volunteers included, may apply the `andon` label with a reproducer. The founder acknowledges within 24 hours. Contain first: revert, freeze the merge queue, point every agent at the fix. If `main` is not green within 48 hours, revert the cause. Close only with a regression test, a 5-whys note and a standard-work change. Blameless throughout.

## 7. Definitions of ready and done

**Ready (issue):** the problem; an executable acceptance check (test, eval task or gate); files in scope; under one day of agent work; a label (`agent-ready`, `needs-human` or `experiment`).

**Done (PR):** one concern; checks green; a new or updated test or eval; evidence attached; `Assisted-by` trailer and human DCO; docs and changelog line; one human approval; no golden-file edits or new hooks without a stated reason.

**Done (step).** A step is a small usable release, done when:
1. it installs from a registry on its tier-1 platforms;
2. the regression suite is at 100%, and G8 and silent mis-resolutions are at 0;
3. its one exit metric is measured on real use, and met or waived in an A3;
4. the "first part in five minutes" docs, changelog and credited build log are published;
5. no red andon is open;
6. the founder has watched a real user complete the step's main task.

Each step names its hypothesis and exit metric before work starts, for example "install to first agent-built part under 5 minutes on 3 OSes" or, for ID-0, "first-print fit rate at least 80% on 10 volunteer prints".

## 8. First two weeks

1. `AI_POLICY.md`, `AGENTS.md`, `CONTRIBUTING.md` (DCO), issue forms, PR template.
2. Branch protection, merge queue, required checks, per-user PR cap, `andon` label.
3. `claude-code-action@v1`, Stop and protection hooks, a one-command `check` under 10 minutes.
4. 20 regression tasks from the 3dj starters; status page; project board; first Friday review and build log.
5. Apply to Codex for OSS now; to SignPath after the first release; join Apple only before the macOS GUI.

## Sources

1. https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model
2. https://dora.dev/research/2025/dora-report/
3. https://code.claude.com/docs/en/best-practices ; https://code.claude.com/docs/en/hooks
4. https://github.com/tldraw/tldraw/issues/7695
5. https://godotengine.org/article/contribution-policy-2026/
6. https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/ ; https://www.theregister.com/2026/01/21/curl_ends_bug_bounty/
7. https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/
8. https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/ ; https://github.blog/changelog/2026-08-06-set-pull-request-limits-at-the-organization-level/
9. https://arxiv.org/abs/2604.27532
10. https://docs.github.com/en/actions/reference/runners/github-hosted-runners
11. https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
12. https://global.toyota/en/company/vision-and-philosophy/production-system/
13. https://www.toyota-global.com/company/history_of_toyota/75years/data/conditions/philosophy/toyotaway2001.html
14. https://www.lean.org/lexicon-terms/pdca/
15. https://mag.toyota.co.uk/muda-muri-mura-toyota-production-system/ ; Poppendieck, *Implementing Lean Software Development* (2006)
16. https://code.claude.com/docs/en/memory
17. https://www.lean.org/lexicon-terms/poka-yoke/
18. https://www.lean.org/lexicon-terms/5-whys/
19. https://www.lean.org/the-lean-post/articles/understanding-the-many-facets-of-the-a3/
20. https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md
21. https://llvm.org/docs/AIToolPolicy.html
22. https://docs.kernel.org/process/coding-assistants.html
23. https://arxiv.org/abs/2609.07542
24. https://github.blog/changelog/2026-06-29-restrict-issue-creation-to-collaborators-only/
25. https://github.blog/changelog/2026-06-18-control-who-and-what-triggers-github-actions-workflows/
26. https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/
27. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://metr.org/blog/2026-02-24-uplift-update/
28. https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report (vendor study)
29. https://code.claude.com/docs/en/github-actions
30. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
31. https://www.anthropic.com/engineering/infrastructure-noise
32. https://github.com/BelfrySCAD/BOSL2 ; https://raw.githubusercontent.com/BelfrySCAD/BOSL2/master/WRITING_DOCS.md
33. https://raw.githubusercontent.com/BelfrySCAD/BOSL2/master/TESTING.md
34. https://klc.kicad.org/ ; https://forum.kicad.info/t/how-to-help-the-librarians/3746
35. https://github.com/gumyr/build123d ; https://raw.githubusercontent.com/gumyr/build123d/dev/CONTRIBUTING.md ; https://github.com/gumyr/cq_warehouse ; https://github.com/gumyr/bd_warehouse
36. Tan, Zhou, Sun, "A First Look at Good First Issues on GitHub" (ESEC/FSE 2020)
37. https://allcontributors.org/docs/en/emoji-key
38. https://osarch.org/2026/05/03/google-summer-of-code-2026-freecad-brl-cad/ (secondary)
39. https://claude.com/contact-sales/claude-for-oss
40. https://docs.github.com/en/actions/reference/limits
41. https://docs.github.com/en/billing/concepts/product-billing/github-actions
42. https://developers.openai.com/codex/codex-for-oss
43. https://docs.github.com/en/copilot/get-started/plans
44. https://geminicli.com/docs/resources/quota-and-pricing/
45. https://huggingface.co/docs/hub/spaces-zerogpu
46. https://modal.com/pricing
47. https://about.readthedocs.com/pricing/
48. https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
49. https://docs.github.com/en/actions/concepts/security/artifact-attestations
50. https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/
51. https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri
52. https://signpath.org/terms
53. https://docs.brew.sh/Acceptable-Casks
