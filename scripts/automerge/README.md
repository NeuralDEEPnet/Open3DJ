# Automatic evaluation and gated auto-merge

Every pull request is evaluated automatically. Low-risk pull requests merge by themselves, and everything else merges by itself after one maintainer approval. The rules live in one file, [`.github/merge-policy.json`](../../.github/merge-policy.json). This folder holds the code that applies them. It has no dependencies.

## Lanes

| Lane | What is in it | When it merges |
|---|---|---|
| auto | Only docs and other Markdown, example scripts, new example drawings, new bench tasks, new corpus files, standard parts (`lib/`) and new doc images, within the size caps | When every required check passes and the AI review passes on the head commit |
| maintainer | Everything else: code, workflows, hooks, agent instructions (including `GEMINI.md`, `CONVENTIONS.md` and similar files of other agent tools), dependencies, license and governance files, the front page and plan (`README.md`, `ROADMAP.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/GETTING-STARTED.md`, `docs/BLENDER.md`, `docs/REPO-SETTINGS.md`, `docs/research/README.md`, `bench/README.md`, `LEADERBOARD.md`), changed goldens (`examples/*/expected.json`), changed bench `task.json` files, replaced images, unusual paths, symlinks, executables, and pull requests over the size caps | When every required check passes and a maintainer approves the head commit (for a maintainer's own pull request from this repository, their `ship-it` label on the head commit counts as that approval; see [below](#ship-it-a-maintainers-one-tap-for-their-own-pull-request)) |

A pull request's lane is the strictest lane of any file it changes. A rename counts at both ends. To widen the auto lane later, edit the policy file in a pull request of its own. Because that file is under `.github/`, the pull request is itself in the maintainer lane.

## Checks, statuses and labels

| Name | Kind | Set by | Meaning |
|---|---|---|---|
| `check (ubuntu-latest)`, `check (ubuntu-24.04-arm)`, `check (macos-latest)`, `check (windows-latest)`, `check (windows-11-arm)` | check | `ci.yml` | `npm run check` on each runner |
| `dco` | check | `dco.yml` | Every commit has a matching `Signed-off-by` line, or the head commit carries the author's `ship-it` certification |
| `ship-it` | commit status | `dco.yml` | The author's `ship-it` tap on that exact commit: success, "DCO and approval by @login at <time> for #<number>", or failure, "withdrawn by @login at <time> for #<number>" or "superseded by a push at <time> for #<number>". Only a status written by `github-actions[bot]` for this pull request counts. Not a required check |
| `evaluate` | check | `evaluate.yml` | Reports the lane in the job summary |
| `ai-review` | commit status | `ai-review.yml` | The advisory AI review of that exact commit and file list: success (pass), failure (changes suggested) or error. Its description ends with `files <fingerprint>` |
| `merge-policy` | commit status | `automerge.yml` | The gate. Success only when the policy is met for that exact commit |
| `lane: auto`, `lane: maintainer` | label | `automerge.yml` | The lane |
| `needs-maintainer` | label | `automerge.yml` | A person must act: approve, or look at the AI review's suggestions |
| `ai-review: pass`, `ai-review: changes-suggested` | label | `ai-review.yml` | The AI verdict. Remove `ai-review: pass` to stop an auto-lane merge |
| `hold`, `andon` | label | maintainers | Keeps `merge-policy` pending and auto-merge off |
| `ship-it` | label | the pull request's author, a maintainer, by hand | Their DCO certification and approval of their own pull request from this repository. `dco.yml` removes it after a push. The bot never adds it |

A maintainer approval always satisfies the policy, so an auto-lane pull request also merges when the AI review is missing or suggests changes and a maintainer approves. Any maintainer's request for changes blocks the merge until that maintainer approves.

## `ship-it`: a maintainer's one tap for their own pull request

GitHub does not let an author approve their own pull request, and agents never sign off ([AI_POLICY.md](../../AI_POLICY.md) rule 3). So when a maintainer's agent opens a pull request under the maintainer's account, nobody can approve it while the maintainer is the only one, and its `dco` check fails. The `ship-it` label settles both with one tap.

**When it counts.** All of these must hold:

- The pull request comes from a branch of this repository, not from a fork.
- Its author is a maintainer by the policy's rule (`approvals.permissions`: admin, maintain or write), the same rule that decides whose review counts.
- The author added the label themself: the event's sender is the author, and a user account, not a bot.
- The label is still on, and the author's own tap put it there: the newest `ship-it` event in the pull request's issue events (`issues/<number>/events`) is a `labeled` event by the author, a user account.
- The head commit carries a `ship-it` commit status that `github-actions[bot]` wrote for that tap: it names the author and this pull request, and it is not older than the author's newest tap.

**What happens.**

1. **The tap.** Adding the label starts `dco.yml` (`labeled`). In one step, before it checks the commits, it writes a `ship-it` status on the head commit that GitHub named in the labeled event: success, "DCO and approval by @login at <time> for #<number>". Then it checks the commits. Commits without a sign-off pass, and the job summary says "DCO certified by @login with the ship-it label at <time> for <sha>". No bot writes a `Signed-off-by` line anywhere: the status is the record.
2. **The merge.** The merge bot reads the head commit's statuses with their creators (`commits/<sha>/statuses`) and the pull request's label events, and counts a valid ship-it as the maintainer approval, in either lane. `hold` and `andon` still block, a maintainer's request for changes still blocks, and CI, `dco` and `evaluate` must still pass. In the auto lane it stands in for the AI review, like any maintainer approval. The `DCO` run's completion starts `automerge.yml`, so the merge bot sees the status as soon as it exists.
3. **A push.** A new head commit has no ship-it status, so the tap no longer counts. On that `synchronize` event, `dco.yml` removes the label, silently (no comment), so the author sees that the new commit needs a new tap. It also marks the tap on the commit before the push as superseded (failure, "superseded by a push at <time> for #<number>"), so a force-push back to that commit does not bring the old tap back.
4. **Taking it back.** When anyone removes the label, `dco.yml` writes a withdrawal (failure) on that commit if it holds a certification, and dco fails again for unsigned commits. Putting the label back counts only after a new tap by the author, recorded after it: the bot and dco check who added the label that is on now, so an older certification never comes back, even when the withdrawal itself was never recorded.
5. **Anyone else.** A label added by another person, even another maintainer, or by a bot, is ignored: no status and no comment. While it is the newest `ship-it` label event, no ship-it counts on the pull request.

**What does not change.** Pull requests from forks, outside contributors, non-maintainers and bots get exactly the same `dco` verdict, summary and `merge-policy` as before, and the bot makes no extra API call for them (`cli.test.ts` checks this). Label changes now start `dco` again, with the same verdict.

**What is still a person's job.** The ruleset needs no new rule or required check for `ship-it`: the required `dco` and `merge-policy` read it. But **Require review from Code Owners** ([docs/REPO-SETTINGS.md](../../docs/REPO-SETTINGS.md#7-branch-rules-for-main) section 7) still asks for a code owner's review on a maintainer-lane pull request, and GitHub does not let the author give it ([GitHub docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews), checked 2026-11-08: "Pull request authors cannot approve their own pull requests"). So while the author is the only code owner, an auto-lane pull request merges by itself after the tap, and a maintainer-lane one has every check green but still needs the author's bypass merge, or that ruleset option turned off. The choice is the founder's.

**Residual risk.** GitHub cannot tell the maintainer's own tap from an agent or a script that uses the maintainer's token. So agents never add `ship-it`, even when asked ([AI_POLICY.md](../../AI_POLICY.md) rule 3).

A second risk comes with write access. Anyone with write access is a maintainer by the policy's rule, and a workflow they push to a branch of this repository writes commit statuses under the same `github-actions[bot]` name as `dco.yml`, because a status carries no proof of which workflow wrote it. Such a person could write a `ship-it` status in the author's name. The checks above narrow this: the status counts only while the author's own tap is the newest `ship-it` label event, on a head commit whose status was written after that tap, so a label they add themself never counts. What is left is a short window after the author's tap: if they push to the author's branch and the label stays on (for example while the label removal after that push is still queued), a status they forge on their commit could count. That would not only approve the pull request. It would record a DCO certification in the author's name for commits the author never saw. So give write access only to people you would trust with that, and read the `dco` summary of your own pull requests: it names the commit that was certified.

## How it stays safe with fork pull requests

- **No pull request code runs in a privileged workflow.** The `evaluate`, `dco`, AI review and automerge jobs check out the default branch, sparse, with only this folder and the policy file. They read the pull request through the GitHub API. Only `ci.yml` runs the pull request's code, under `pull_request`, with a read-only token and no secrets.
- **A pull request cannot change its own policy.** The evaluator, the policy and the automerge workflow always come from the default branch. A pull request that edits `evaluate.yml` can change what its own `evaluate` check says. It cannot change `merge-policy`, which `automerge.yml` computes on its own. Such a pull request touches `.github/`, so it is in the maintainer lane anyway.
- **Verdicts are bound to commits.** The evaluator reads the changed files of one exact commit through the compare API (`compare/<base>...<sha>`), never the pull request's moving file list, and it re-reads the pull request before it writes, giving up if the head moved. `ai-review`, `merge-policy`, `ship-it` and approvals count only for the head commit they were given for, and an `ai-review` verdict counts only when its file fingerprint matches the files the merge bot sees. Auto-merge is pinned to the evaluated commit (`expectedHeadOid`), and GitHub turns auto-merge off when someone without write access pushes again.
- **Untrusted text stays data.** Workflows never put pull request text into a shell script. The scripts stop workflow commands while they print anything from a pull request. Summaries and the AI comment escape HTML, links, images and @mentions. `workflows.test.ts` checks these rules on every `npm run check`.
- **The AI reviewer has no tools.** It runs after `evaluate` succeeds, so a first-time contributor's pull request is reviewed only after a maintainer approves its workflow runs. A job without the AI secret prepares the diff and metadata as text, and the reviewer gets that text inline in its prompt. File, shell, web and GitHub tools are all denied, so it cannot read the secret from the runner. Its job token can only read contents. It has a turn limit and a time limit, and it returns JSON that a separate job validates before posting; output that looks like a credential is never posted. A daily budget (`aiReview` in the policy) limits how many reviews the secret pays for. It skips with a notice when no AI secret is configured. The action is pinned to a full commit id.
- **Merge commits need a sign-off unless they add nothing.** The `dco` check accepts a merge commit without its own sign-off only when every file it changes from its first parent is identical in another parent, which a clean **Update branch** merge is. A merge commit that carries changes of its own needs a sign-off like any other commit.

## Settings the repository needs

These are repository settings, not files. A repository admin changes them once.

1. **Settings > General > Pull Requests:** turn on **Allow auto-merge**. Keep squash merging on.
2. **Settings > Actions > General > Workflow permissions:** choose **Read repository contents and packages permissions**. Each workflow asks for the few permissions it needs.
3. **Settings > Actions > General > Approval for running fork pull request workflows from contributors:** keep **Require approval for first-time contributors** (the default), or choose **Require approval for all external contributors**. The first only covers a contributor's runs until their first merged commit; after that, their pushes start CI and the AI review without a click, within the AI budget.
4. **Ruleset for the default branch** (Settings > Rules > Rulesets):
   - Require a pull request before merging, with **0 required approvals** (the `merge-policy` status enforces the approval for the maintainer lane), **Dismiss stale approvals** on, and **Require review from Code Owners** on. [`.github/CODEOWNERS`](../../.github/CODEOWNERS) owns every path except the auto-lane paths.
   - Require status checks: `check (ubuntu-latest)`, `check (ubuntu-24.04-arm)`, `check (macos-latest)`, `check (windows-latest)`, `check (windows-11-arm)`, `dco`, `evaluate` and `merge-policy`. If you can, pick GitHub Actions as the source of each. `merge-policy` is the gate: without it, auto-merge would merge as soon as the other checks pass.
   - Do not turn on the merge queue yet: `merge-policy` is set on pull request commits, not on merge-group commits.
   - Block force pushes and deletions. Keep yourself on the bypass list while you are the only maintainer, because nobody can approve their own pull request. `ship-it` needs no new rule or check, but code owner review still applies to it ([above](#ship-it-a-maintainers-one-tap-for-their-own-pull-request)).
5. **Secrets** (Settings > Secrets and variables > Actions): add `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to turn on the AI review. Without one, auto-lane pull requests wait for a maintainer approval.
6. **Order:** these workflows run the default branch's scripts, so merge the pull request that adds them first (admin bypass), then open a test pull request so the check names exist, then add the required checks. See [docs/REPO-SETTINGS.md](../../docs/REPO-SETTINGS.md#first-time-setup-order).
7. **DCO:** the `dco` workflow replaces the DCO app. If you use the app instead, put its check name (`DCO`) in `requiredChecks` in the policy and in the ruleset.

## Files

| File | What it does |
|---|---|
| `policy.ts` | Pure evaluator: lanes, path checks, reviews, the merge decision and the summary |
| `dco.ts` | Pure DCO check, and the outcome when `ship-it` certifies every commit |
| `shipit.ts` | Pure `ship-it` rules: what a label event does, and whether a head commit carries a valid certification |
| `review.ts` | Pure AI review helpers: input preparation, output validation, the escaped comment |
| `github.ts` | Small REST and GraphQL client on top of `fetch` |
| `cli.ts` | The commands the workflows run: `evaluate`, `dco`, `ai-prepare`, `ai-publish`, `automerge`, `main-ci` |
| `*.test.ts` | Unit tests, end-to-end tests against a fake GitHub API on 127.0.0.1, and the static workflow checks |

## Known limits

- A merge made by auto-merge does not start push workflows, so `automerge.yml` starts CI on the default branch when its head has no run. It checks every 30 minutes and after a merge it sees.
- The `GITHUB_TOKEN` allows 1,000 API requests per hour per repository. One evaluation uses about 10 to 15 requests. Merge bot runs never overlap (a concurrency group), and GitHub drops older waiting runs, so the half-hourly sweep is the safety net: it evaluates at most 20 pull requests updated in the last 24 hours, and every run stops early when fewer than 150 requests are left.
- The compare API lists at most 300 files. A pull request with that many is in the maintainer lane anyway (the cap is 50 files).
- An AI verdict whose file fingerprint no longer matches (for example after the base branch moved under a rename) does not count. A maintainer approval, or the next push, settles it.
- The evaluator reads file modes and sizes from the head commit's tree. On a truncated tree it falls back to one call per file, and files of unknown mode go to the maintainer lane.
- dco and the merge bot read at most 1,000 issue events of a pull request to find who added the label. A pull request with more events cannot use `ship-it`; the `dco` summary says so.
- A `dco` run for a label change never cancels another run; it waits. GitHub keeps only one waiting run per group, so if two more label changes arrive while a run is in progress, a waiting `ship-it` run can be dropped. The label then shows, but nothing certifies the commit, and the `dco` summary says so. Taking the label off and adding it again records it.
