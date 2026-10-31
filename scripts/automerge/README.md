# Automatic evaluation and gated auto-merge

Every pull request is evaluated automatically. Low-risk pull requests merge by themselves, and everything else merges by itself after one maintainer approval. The rules live in one file, [`.github/merge-policy.json`](../../.github/merge-policy.json). This folder holds the code that applies them. It has no dependencies.

## Lanes

| Lane | What is in it | When it merges |
|---|---|---|
| auto | Only docs and other Markdown, example scripts, new example drawings, new bench tasks, new corpus files, standard parts (`lib/`) and new doc images, within the size caps | When every required check passes and the AI review passes on the head commit |
| maintainer | Everything else: code, workflows, hooks, agent instructions (including `GEMINI.md`, `CONVENTIONS.md` and similar files of other agent tools), dependencies, license and governance files, the front page and plan (`README.md`, `ROADMAP.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/GETTING-STARTED.md`, `docs/REPO-SETTINGS.md`, `docs/research/README.md`, `bench/README.md`), changed goldens (`examples/*/expected.json`), changed bench `task.json` files, replaced images, unusual paths, symlinks, executables, and pull requests over the size caps | When every required check passes and a maintainer approves the head commit |

A pull request's lane is the strictest lane of any file it changes. A rename counts at both ends. To widen the auto lane later, edit the policy file in a pull request of its own. Because that file is under `.github/`, the pull request is itself in the maintainer lane.

## Checks, statuses and labels

| Name | Kind | Set by | Meaning |
|---|---|---|---|
| `check (ubuntu-latest)`, `check (ubuntu-24.04-arm)`, `check (macos-latest)`, `check (windows-latest)`, `check (windows-11-arm)` | check | `ci.yml` | `npm run check` on each runner |
| `dco` | check | `dco.yml` | Every commit has a matching `Signed-off-by` line |
| `evaluate` | check | `evaluate.yml` | Reports the lane in the job summary |
| `ai-review` | commit status | `ai-review.yml` | The advisory AI review of that exact commit and file list: success (pass), failure (changes suggested) or error. Its description ends with `files <fingerprint>` |
| `merge-policy` | commit status | `automerge.yml` | The gate. Success only when the policy is met for that exact commit |
| `lane: auto`, `lane: maintainer` | label | `automerge.yml` | The lane |
| `needs-maintainer` | label | `automerge.yml` | A person must act: approve, or look at the AI review's suggestions |
| `ai-review: pass`, `ai-review: changes-suggested` | label | `ai-review.yml` | The AI verdict. Remove `ai-review: pass` to stop an auto-lane merge |
| `hold`, `andon` | label | maintainers | Keeps `merge-policy` pending and auto-merge off |

A maintainer approval always satisfies the policy, so an auto-lane pull request also merges when the AI review is missing or suggests changes and a maintainer approves. Any maintainer's request for changes blocks the merge until that maintainer approves.

## How it stays safe with fork pull requests

- **No pull request code runs in a privileged workflow.** The `evaluate`, `dco`, AI review and automerge jobs check out the default branch, sparse, with only this folder and the policy file. They read the pull request through the GitHub API. Only `ci.yml` runs the pull request's code, under `pull_request`, with a read-only token and no secrets.
- **A pull request cannot change its own policy.** The evaluator, the policy and the automerge workflow always come from the default branch. A pull request that edits `evaluate.yml` can change what its own `evaluate` check says. It cannot change `merge-policy`, which `automerge.yml` computes on its own. Such a pull request touches `.github/`, so it is in the maintainer lane anyway.
- **Verdicts are bound to commits.** The evaluator reads the changed files of one exact commit through the compare API (`compare/<base>...<sha>`), never the pull request's moving file list, and it re-reads the pull request before it writes, giving up if the head moved. `ai-review`, `merge-policy` and approvals count only for the head commit they were given for, and an `ai-review` verdict counts only when its file fingerprint matches the files the merge bot sees. Auto-merge is pinned to the evaluated commit (`expectedHeadOid`), and GitHub turns auto-merge off when someone without write access pushes again.
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
   - Block force pushes and deletions. Keep yourself on the bypass list while you are the only maintainer, because nobody can approve their own pull request.
5. **Secrets** (Settings > Secrets and variables > Actions): add `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to turn on the AI review. Without one, auto-lane pull requests wait for a maintainer approval.
6. **Order:** these workflows run the default branch's scripts, so merge the pull request that adds them first (admin bypass), then open a test pull request so the check names exist, then add the required checks. See [docs/REPO-SETTINGS.md](../../docs/REPO-SETTINGS.md#first-time-setup-order).
7. **DCO:** the `dco` workflow replaces the DCO app. If you use the app instead, put its check name (`DCO`) in `requiredChecks` in the policy and in the ruleset.

## Files

| File | What it does |
|---|---|
| `policy.ts` | Pure evaluator: lanes, path checks, reviews, the merge decision and the summary |
| `dco.ts` | Pure DCO check |
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
