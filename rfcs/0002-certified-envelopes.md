# RFC 0002: Certified envelopes, killed by their spike; a corner-first range sweep instead

- **Status:** draft
- **Issue:** #NNN (labeled `rfc`), to be opened by the operator after the experiment issue reports
- **Author:** operator handle; assisted by neuraldeep.net design agents
- **Started:** 2026-11-10
- **Final comment period:** to be set

This RFC began as "Certified Envelopes": a guided counterexample search over each part's declared parameter box, with a replayable certificate. Its spike was killed against the kill criterion fixed before the spike ran. The [experiment report](experiments/2026-11-09-certified-envelopes.md) has every number.

This RFC now records why the headline died. It proposes the part that the evidence supports, as a plain feature: a corner-first sweep of the declared ranges, which is the `sweep` that S4 already plans. It also proposes the fit-report fixes the sweep depends on.

## Problem

A run checks one point of the parameter space. A declared `Param` range is a promise to the person who moves the slider, and nothing checks it today.

Evidence, measured 2026-11-09 and 2026-11-10 on Linux x64 under Node 24.22.1 with the product CLI:

- **flange.** At Diameter 52, inside its range of 50 to 160, the run says `ok` and the part is valid. The bolt holes break through the rim (bounding box 51.92 x 52 mm), and min_wall reads 0.006 mm. At Diameter 56 it reads 0.692 mm.
- **box-with-lid.** At Clearance 0 and at Clearance 0.6 the run gives the same report with no fit line. At 0.25 it lists the 0.25 mm gap.
- **Six of the ten gallery examples** misbehave inside their declared ranges. These are flange, box-with-lid, bracket, knob, tapered-cup and vented-box:
  - the bracket fails to build at its minimum Thickness;
  - vent slots cut the vented-box rim below Height 32.34.

  The experiment report lists ten defects (K1 to K10), each with a reproducer. One of them, the knob's 0.076 mm knife edge, is present at the default values.
- **Parameter ranges are not exposed.** `paramSpecs` is built in `packages/dsl/src/collect.ts` (line 129), but no tool returns it, so an agent cannot see a part's ranges.
- **The fit watch distance is fixed** at 0.5 mm. `packages/compute/src/job.ts` calls `computeFits(kernel, asm)` with no options. A gap wider than 0.5 mm and a zero-gap contact between mated parts both produce no fit line (`packages/assembly/src/fits.ts`, line 49).

Who it affects:

- people who reuse or configure a part;
- agents graded by o3dj-bench;
- anyone who exports a part whose slider can produce broken geometry.

It bears on the PLAN goals G3 ("Reports never lie"), G6 ("Parts fit when printed") and G2 ("Agents recover from failures"). Related issues are andon #19 (the box-with-lid and enclosure goldens) and the Kaizen issue on the mated-pair contact exemption.

## Why not certified envelopes

The spike was pre-registered before any search ran: 15 seeded defects, 10 controls, an analytic failure region per defect, 12 natural briefs, the scoring rule and the seeds. The kill criterion came from the design. Its deciding kills were:

- detection below 80% within 64 evaluations;
- guided search less than 15 points better than uniform random sampling at the same budget;
- any false counterexample.

| Measure | Result |
|---|---|
| Guided detection, budget 64, seed 1 | 15 of 15 (100%) |
| Uniform random, seeds 1 to 10 | 88.0% |
| Guided minus random | **12.0 points, under the 15-point line: kill** |
| False counterexamples | 0 of 356 |
| Replay with the same report hash | 2357 of 2357 points |
| Enclosure, budget 64, 4 workers | 33.9 to 45.4 s |

Two independent audits reproduced every number they re-ran, and both agreed with the kill. They also showed what the kill means:

- **The guided advantage is the corners.** 11 of 15 defects were first found at a corner of the box, 1 at a special value and 3 at Halton points. Compass search never ran on a defect. In simulation, corners then special points then uniform points reach 99.4%, and corners then uniform points reach 98.6%.
- **The rest of the search added no detection** at the registered budget. Shrinking and bisection only located boundaries.
- **The corpus could not clear the line.** Random sampling was expected to find 87.2% from the region shares, so a perfect search could lead by at most 12.8 points. This was recorded before the search.
  - The 10-seed baseline is noisy: 18% of 10-seed blocks would have cleared the line.
  - The 10,000-seed expectation (87.32%) agrees with the kill.
- **The verdict depends on the budget.** These are exploratory results, not pre-registered:
  - At budget 32, guided found 15 of 15, against 76.1% expected for random.
  - On three thin interior bands written by an auditor who knew the search, guided was 4 points worse than random at budget 64, and 26 points better at budget 128.

So the counterexample search, shrinking, the signed certificate and the brief language do not earn their cost on this evidence. Corner-first sampling does. It found d14, a 0.022% sliver at the corner of its box, which random sampling found in 0 of 10 runs and is expected to find 2.1% of the time. It also found the gallery defects above.

The synthesis named this fallback in advance: "fold the sampler into the S4 sweep as a plain feature and drop the headline".

## Proposal

Build three things, all small:

1. Show the parameter ranges.
2. Fix the fit report so it cannot read a contact or a wide gap as nothing.
3. Give `run` the corner-first `sweep` that S4 already lists.

Then fix the gallery.

### 1. Parameters out

- `packages/compute/src/types.ts`: `JobResult` gains `paramSpecs` (name, type, default, min, max, step, integer, options). `job.ts` passes through what `collect.ts` already builds.
- `packages/mcp/src/store.ts`: `RevisionRecord.param_specs`.
- `inspect fields=[params]` returns them, within `CONCISE_REPORT_CHARS`. The CLI does the same with `open3dj inspect --fields params`.

### 2. Fit report

- **The mated-pair exemption** drops only the contact of the mated seat, not every contact between the two parts. A lid that touches its base wall at zero gap then reports `contact`, not nothing. This is the existing Kaizen issue, and it starts with a failing test (box-with-lid at Clearance 0).
- **`JobRequest.fitOptions`** (`{ watchDistance }`) reaches `computeFits`. This is the 3-line patch c344a1f from the spike, and the default stays 0.5 mm.
- **A bench `fits` assertion may set its own watch distance.** A larger watch can then never break a `distance` check. In the spike, raising the watch to 1 mm made the enclosure's `shank-in-pocket` fail on extra 0.7 and 1.0 mm lines.

### 3. The sweep

`run` already sketches `sweep?` in [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 9, and [PLAN.md](../docs/PLAN.md) S4 ships "`candidates[]` (best-of-N) and `sweep` on the batch lane". This RFC fixes what that sweep does.

**Input:**

```
run { project, base_rev, sweep: { budget?, seed?, gates?, build? } }
```

- `budget` is 8 to 256, default 64.
- `seed` is an integer, default 1.
- `gates` is a gate profile such as `fdm.v1`, and `build` is a build direction per target.
- The call returns `{ job_id }`. The job runs on the batch lane. Slot 0 stays interactive, and `cancel_job` and the watchdog apply.

**Points, in this order, all inside the declared box:**

1. nominal;
2. corners: every numeric axis at its min or max (all 2^k corners for k up to 8, a pairwise covering array above that), crossed with the values of choice, bool and small integer axes, capped at 3/8 of the budget;
3. special values: each axis alone at its ends, 0 inside a range, each discrete value;
4. a seeded Halton sequence for the rest of the budget.

Results are kept in index order, so worker scheduling cannot change the result. The sampler is `scripts/envelope-spike/search.ts` without the compass, shrink and bisect phases. It is pure, needs no kernel, and its unit tests come with it.

**Checks at each point.** The sweep needs no brief. It reports what the run already measures:

- the build error code;
- `status`;
- validity;
- gate verdicts, when `gates` is set;
- clashes.

It lists only failures that are new relative to nominal. Failures at nominal are listed apart, as nominal failures. On the spike's data, these checks alone catch:

- 14 of 15 corpus defects;
- every counterexample of flange and tapered-cup;
- 34 of 35 of box-with-lid, 22 of 23 of bracket and 16 of 30 of vented-box.

**Events.** Between neighbouring points, a change in the per-definition counts, the fit set or the gate verdicts is reported as an interval, for example "faces change between Diameter 51.875 and 53.75". Events are information, not failures: a pattern count that changes, as on the hinge, legitimately changes the counts. The defects that the checks above miss all show as events:

- the knob's bore through the dome;
- the bracket's holes in the other flange;
- the vented-box slots running through its corners;
- the box-with-lid gap line that disappears at Clearance 0.

**Output.** `{ budget, seed, points: [{ params, status, report_hash, failing }], nominal_failures, failures: [{ check, points, worst }], events: [{ axis, between, changed }], statement }`.

- The statement is always "checked at N points", never "for all values".
- `report_hash` is the SHA-256 of the canonical report, so a rerun on the same platform can be compared point by point. In the spike, 2357 of 2357 points matched.

**Limits.** `SWEEP_TOO_SLOW` refuses when the nominal run takes more than 5 s. For scale, the enclosure takes about 1.7 s of worker time per point (108.2 s for 64 points on 1 worker). The 145-occurrence reference plate spends 20.4 s on fits alone on a fresh worker ([ASSEMBLIES.md](../docs/ASSEMBLIES.md)).

**CLI parity.** `open3dj run <script> --sweep [--budget N] [--seed S] [--gates fdm.v1] [--build x,y,z] [--json]`. It exits 0 when no point fails beyond nominal, 1 when one does, 2 on error and 3 on usage.

### 4. Gallery

The ten defects K1 to K10 from the experiment report are fixed one example at a time, each with a sweep before and after:

- most need only a narrower range;
- the knob's flutes need a geometry fix;
- the fit report needs the core fix above.

The seeded corpus moves to `corpora/envelope/` as a regression corpus, like `corpora/gates/`. That is 15 defects, 10 controls and the analytic regions.

### What is dropped

- compass search, shrinking and bisection;
- briefs with parameter-relative bounds, and the `set_brief` op;
- certificates as a trust artifact: Ed25519 signatures, the `prev_hash` chain, the evidence sidecar field and `open3dj verify`;
- counterexample side revisions `r_NNNN~cxK`;
- process profiles with worst-case gaps;
- spec strength by mutation (M6 never ran);
- the certified pass^3 and env-* bench split.

Each comes back only through a new pre-registered experiment.

### What stays the same

- five MCP tools;
- exports are never blocked;
- `ANALYSIS_VERSION`;
- the concise report budget;
- the goldens, apart from the knob fix (K6) and andon #19.

## Security and privacy

- Nothing leaves the machine, and there are no network calls.
- The sweep adds no new input files. Each point is an ordinary run of the same script in the same QuickJS sandbox with `DEFAULT_LIMITS`.
- **Denial of service.** The budget is capped at 256 points, and each point is one batch-lane job with the existing job timeout. `SWEEP_TOO_SLOW` refuses slow scripts, slot 0 stays free for interactive work, and `cancel_job` stops a sweep.
- A sweep result holds parameter values, counts and hashes, not geometry.
- Update the threat table in [ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 12 (a sweep as a resource-exhaustion path) in the same pull request as the code.

## Dependencies and licenses

- None new.
- `node:crypto` and `worker_threads` are built-ins.
- occt-wasm 5.8.1 is unchanged. Its `package.json` declares `MIT OR Apache-2.0`. It ships `dist/occt-wasm.wasm` (OCCT, LGPL-2.1) unmodified as a separate, replaceable file, which is the licence gate's recorded exception. Both were checked on this branch on 2026-11-10.
- In-repo MIT code only.

## Alternatives

- **Do nothing.** Six of the ten gallery examples keep their silent off-nominal failures, and agents keep shipping ranges that nobody checked.
- **Certified envelopes as first proposed.** Killed by the pre-registered spike: guided search was 12.0 points better than random, against a 15-point line. See [Why not certified envelopes](#why-not-certified-envelopes).
- **Uniform random sampling only.** Simpler, but it misses corner slivers. At budget 64 it finds d14 2.1% of the time, d08 71.2% and d02 75.8%. Corner-first sampling finds all three.
- **Revive the guided search later.** The audit's exploratory runs showed compass search 26 points ahead of random at budget 128 on thin interior bands. That needs its own pre-registered experiment:
  - defects that random sampling finds less than half the time;
  - 100 or more independent random seeds;
  - budget 128;
  - a watch distance set per assertion.
- **3dj.app's joint sweep.** Its `cad_check_assembly` tool description says it "sweeps each placeAt joint across its Param range" (read in the tool description on 2026-11-10; not run). It covers joints only, and it runs as a hosted service, not on the person's computer.

## Risks and open questions

- **Sampling is not proof.** A thin band can hide between samples: d14 is 0.022% of its box. The wording rule "checked at N points" must hold everywhere, in docs and in announcements.
- **A nominal failure masks the same check off nominal.** The knob's thin skin above Height 12 could not be reported, because min_wall already fails at nominal. Open: report the worst value per check, not only a verdict?
- **Gates need a build direction per part.** With the default [0, 0, 1], 8 of 12 natural scripts fail the overhang gate at nominal.
- **Gate read error.** min_wall reads up to 0.013 mm off the analytic wall on curved faces. That is within its documented 0.04 mm marginal band, but a verdict can flip within about 0.01 mm of the fail line.
- **Kernel fillet limit.** OCCT fails a fillet whose two sides meet across a face (2r equal to the face width), as in d03 and the bracket at Thickness 2.
- **Determinism** is shown on Linux x64 under Node 24.22.1 only. A rerun on another platform may differ in the last printed decimal.
- **Cost.** The enclosure takes 42 to 45 s at budget 64 on the batch lane with 4 workers (3 usable). Large assemblies hit `SWEEP_TOO_SLOW`.
- Open questions:
  - Should CI sweep the gallery, and at what budget? Budget 32 found all 15 seeded defects. It should take about half the budget-64 time, but that is an estimate, not a measurement.
  - Should the sweep accept optional bench-style assertions (sizes, counts, gaps)? The corpus defect d13 and the box-with-lid zero-gap case need one.
  - Should the viewer show the swept range on each slider?

## How we will know it worked

- **Gallery:** every example sweeps clean at budget 64 with its stated build direction, apart from listed nominal failures. Today 6 of 10 do not. This is the Kaizen metric for G3.
- **Seeded corpus** (`corpora/envelope/`): the sweep with gates on finds at least 14 of 15 defects at budget 64, with 0 failures on the 10 controls.
- **Replay:** a second sweep of the same revision on the same platform gives the same report hash on at least 99% of points.
- **Time:** the enclosure at budget 64 takes 60 s or less on 4 workers on the batch lane.
- **Fit report:** box-with-lid at Clearance 0 reports `contact`, and at Clearance 0.6 with `watchDistance` 2 it reports a 0.6 mm clearance.

## Plan

- **PR 0** (no code): the operator files the Kaizen issues K1 to K10 and the experiment issue that links the report.
- **PR 1:** parameters out: `paramSpecs` in `JobResult`, `RevisionRecord.param_specs`, `inspect fields=[params]` and CLI parity.
- **PR 2:** the mated-pair contact fix, starting from a failing test. This is maintainer lane if goldens move.
- **PR 3:** `fitOptions.watchDistance` per job, and a per-assertion watch distance in bench `fits` assertions. Maintainer lane, because it touches the bench.
- **PR 4:** `packages/compute/src/sweep.ts`, the pure sampler (corners, special values, Halton, index order) with unit tests on analytic regions.
- **PR 5:** `run.sweep` on the batch lane with the checks, the event list, `SWEEP_TOO_SLOW`, `open3dj run --sweep`, and docs (GETTING-STARTED, `skills/open3dj/SKILL.md`, ARCHITECTURE sections 9 and 12).
- **PR 6:** the seeded envelope corpus under `corpora/envelope/` with `npm run sweep-corpus`.
- **PRs 7 and later:** the gallery fixes, one example per pull request, with the sweep before and after, and the matching bench reference change.

## Decision

Left empty until the final comment period ends. The spike's recommendation is to reject certified envelopes and accept the corner-first range sweep above.
