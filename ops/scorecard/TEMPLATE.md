# Scorecard YYYY-WW

<!-- Copy to ops/scorecard/YYYY-WW.md (ISO week) in the Friday review. A nightly CI job that
drafts the Flow, Quality and People numbers is planned (docs/PLAN.md section 4.3) but not built
yet: .github/workflows has only ci.yml, with no schedule. Until it exists, collect these numbers
by hand (gh pr list, gh run list, the CI page) or write "n/a (no nightly job yet)". The founder
fills the rest, then commits.
Metrics and owners: docs/PLAN.md section 4.3. Andon thresholds: docs/PLAN.md section 4.4.
Write "n/a" for a metric that does not apply yet, with the step that brings it. -->

- **Week:** YYYY-WW (Monday YYYY-MM-DD to Friday YYYY-MM-DD)
- **Commit:** `<hash>` on `main`
- **Current step:** S? and its Kaizen metric (docs/PLAN.md section 6)
- **Release this week:** version or "none"

## Flow

| Metric | This week | Last week | Target or trigger | Source |
|---|---|---|---|---|
| PR lead time (median, opened to merged) | | | falling | GitHub API (by hand with `gh` until the nightly job exists) |
| Review queue age (oldest open PR in Review) | | | over 5 days is yellow | GitHub API (by hand with `gh` until the nightly job exists) |
| Agent PRs in Review (WIP) | | | at most 3 | GitHub API (by hand with `gh` until the nightly job exists) |
| Reverts | | | 0 | GitHub API (by hand with `gh` until the nightly job exists) |
| Founder minutes per merged PR | | | falling | `/time` comments and the PR template field, summed nightly |

## Quality

| Metric | This week | Last week | Target or trigger | Source |
|---|---|---|---|---|
| Regression suite (`npm test`, `node bench/run-regression.ts`) | | | 100%, below is red | CI and nightly |
| First-pass CI rate (PRs green on their first run) | | | rising | CI |
| False passes on seeded corpora (gates, clashes, references, library checker, bench mutants) | | | 0, any is red (G3) | CI and nightly |
| Silent reference mis-resolutions (1,000-edit sweep, from S3) | | | 0, any is red (G4) | nightly |
| CPU and GPU verdict differences (from S7a) | | | 0, any is red (G8) | nightly |
| Fresh clone to green `check` (S0 Kaizen metric) | | | 10 minutes or less on Linux, macOS, Windows | CI timings |

## Product

| Goal | Measure | This week | Last week | Target |
|---|---|---|---|---|
| G1 Agents finish real designs | pass^3 on the capability split (bench/run-capability.md); also pass@1 | | | 70% at S1 |
| G2 Agents recover from failures | failures fixed within 2 further calls | | | 80% at S3 |
| G3 Reports never lie | false passes on seeded corpora | | | 0 |
| G4 References stay stable | silent mis-resolutions in the sweep | | | 0 |
| G5 Fast first result | `npx` (packed tarball) to first multi-part STEP | | | 5 minutes or less |
| G6 Parts fit when printed | first-print fit rate (from S5) | | | 80% over 10 prints |
| G7 Every client works | CI client matrix and manual checklist | | | 100% of tools |
| G8 CPU and GPU agree | verdict differences (from S7a) | | | 0 |
| G9 Handoff is clear | supplier questions per RFQ (from S12) | | | falling |
| Current step's Kaizen metric | | | | |

Capability run details (client and version, tasks that changed since last week and why):

-

## Value stream (from S5; the S0 baseline is in ops/value-stream.md)

| Project | Stage with the longest lead time | Total lead time | Rework loops | Escapes |
|---|---|---|---|---|
| | | | | |

## People

| Metric | This week | Last week | Target or trigger | Source |
|---|---|---|---|---|
| Newcomer first response time (median) | | | a newcomer waiting over 48 hours is yellow | GitHub API (by hand with `gh` until the nightly job exists) |
| Returning contributors | | | rising | GitHub API (by hand with `gh` until the nightly job exists) |
| Founder hours (loop plus step work) | | | within the weekly cap (decision 5) | the founder, in the build log |

## Andons this week

| Level | Trigger | Issue | Status |
|---|---|---|---|
| | | | |

## Act

- **Worst problem this week:** one line, with the metric that shows it.
- **A3:** [ops/a3/NNN-title.md](../a3/) or "none this week".
- **Standard-work update:** the AGENTS.md line, hook, gate, skill or template that changed, with its PR.
- **Next week's top observed failure (Monday plan):**
