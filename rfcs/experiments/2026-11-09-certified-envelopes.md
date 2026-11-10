# Experiment: certified envelopes (the RFC 0002 spike)

- **Dates:** 2026-11-09 to 2026-11-10
- **Branch:** `experiment/envelope-spike`, not merged and not yet pushed: it is on the operator's machine until it has a place in the repository. Spike code in `scripts/envelope-spike.ts` and `scripts/envelope-spike/`, raw results (6.4 MB) in `scripts/envelope-spike/results/`. Paths below refer to that branch.
- **Issue:** #67. The RFC that follows from it is #68.
- **Decision:** **kill.** The deciding line was "guided search at least 15 points better than uniform random sampling". Guided search was 12.0 points better (100% against 88.0%).
- **What survives:** corner-first sampling of the declared range, as a plain sweep. RFC 0002 (#68) records why the headline died and proposes that smaller feature.
- **Real defects found:** 10, listed with reproducers in [Defects, filed as issues](#defects-filed-as-issues) (#60 to #66):
  - 8 off-nominal defects in 5 gallery examples (flange, bracket, knob, tapered-cup, vented-box);
  - 1 core fit-report defect, shown by box-with-lid;
  - 1 knife edge in the knob at its nominal values.

## Summary

We asked whether a guided search could check a part across its whole declared parameter box, and beat random sampling at finding failures. The search combined corners, special values, Halton points, compass search, shrinking and bisection, and it wrote a replayable certificate.

On a pre-registered corpus of 15 seeded defects, the guided search found all 15 within 64 evaluations. Uniform random sampling with the same budget found 88.0% (seeds 1 to 10). The gap is 12.0 points, under the 15-point line, so the experiment is killed.

The audits showed that the whole guided advantage comes from testing the corners of the box. Corners, then special points, then uniform random points reach 99.4% in simulation. Compass search, shrinking and bisection found no defect at seed 1. The corpus also made the line impossible to clear: random sampling was expected to find 87.2% before any search ran, so even a perfect search could lead by at most 12.8 points. This was recorded before the search.

Everything else held. There were 0 false counterexamples in 356, every point replayed with the same report hash, and the enclosure took 34 to 45 s at budget 64 on 4 workers. On natural scripts, the sweep found real design defects in 4 gallery examples beyond the 2 already known. Those defects and the corner-first sampler are the value of this spike.

## What we tried

The design came from the research synthesis that proposed RFC 0002 (a working document, not in the repository; "the synthesis" below). Its idea is that every declared `Param` range is a promise, so check the part across the whole range, not only at the default values. A brief lists the assertions with their sources. The search either returns a shrunk counterexample, or a certificate that lists every point it evaluated.

The spike built that design as scripts, not as product code:

- **Search** (`scripts/envelope-spike/search.ts`, pure, no kernel, 7 unit tests). The phases run in this order within one budget:
  1. nominal;
  2. corners (every numeric axis at its min or max, crossed with discrete values, capped at 3/8 of the budget);
  3. special values (each axis alone at its ends, 0, each discrete value, the step grid);
  4. a seeded Halton sequence up to 3/4 of the budget;
  5. compass search on the assertion with the smallest margin, only while no counterexample exists;
  6. QuickCheck-style shrinking toward nominal;
  7. bisection down to max(step, 0.01);
  8. leftover Halton points.

  Results are kept in index order, so the order in which the pool finishes jobs cannot change the trace.
- **Event guard:** it compares neighbouring points (counts, fit set, gate verdicts, status) and reports an interval where they change.
- **Briefs** (`brief.ts`): bench assertion kinds plus `builds` and `gate`. Bounds can refer to parameters (`"2 * $Radius"`) through a parser that never calls eval. The brief raises the fit watch distance to max(0.5, 2 times the largest gap bound).
- **Certificates and replay** (`certify.ts`): one point per job on the compute pool. For each point the certificate holds the params, the report hash, the gate shape hashes and the margins. `verify` re-runs every point in a new process with `freshKernel: true`.
- **One core patch** (c344a1f): `JobRequest.fitOptions` reaches `computeFits` in `packages/compute/src/job.ts`. When the field is absent nothing changes, because `computeFits` defaults its options to `{}`.

## Pre-registration

The briefs, the corpus, the regions and the scoring rule were committed before any search or random sampling ran. Commit dates come from `git log`.

| Order | Commit | Date (UTC) | What it fixed in place |
|---|---|---|---|
| 1 | 78d3b57 | 2026-11-09 16:45:30 | 12 natural briefs, written from each script's `Param` declarations and header comment |
| 2 | c344a1f | 2026-11-10 00:02:18 | The `fitOptions` patch to `job.ts` and `types.ts` |
| 3 | 52e2f3c | 2026-11-10 00:02:28 | The seeded corpus: 15 defects, 10 controls, the analytic region of each defect, the scoring rule, the seeds and the expected random rate |
| 4 | f323f9d | 2026-11-10 00:11:52 | The search harness |
| 5 | 646b657 | 2026-11-10 00:35:02 | A scoring field (first random hit) |
| 6 | ebc5716 | 2026-11-10 00:35:03 | All measurements |

Before 52e2f3c, only the corpus lint ran. It ran each brief at nominal, at analytic points inside each region and at points just outside it. Skeptic 1 checked this from file times: the only kernel outputs before the commit are the two lint logs. The corpus and the briefs are byte-identical from their commits to HEAD.

One change came after pre-registration and before measurement. Smoke runs on flange, d01, d05 and c07 showed that the compass followed equality assertions, whose margin is 0 wherever they pass. The compass now follows only assertions whose margin varies, and unused budget goes to more Halton points. This cannot have affected M1: every first hit came at index 23 or earlier, before the compass phase.

The briefs index says the 9 bench copies are identical to the examples. They differ by the canary line. It counts them once, which is still correct.

## Method

**Seeded corpus** (`scripts/envelope-spike/corpus/`). There are 15 defects (d01 to d15) and 10 controls (c01 to c10). Each defect passes at its nominal values and fails inside its declared box. The defect families are hole breakout, a boss through a wall, merging slots, the sign of a clearance, a fillet that fails at a corner, and pattern overlap at the maximum count. `regions.ts` holds each defect's failure region as an analytic predicate, written from the geometry.

Region shares range from 0.022% (d14) to 18.875% (d09), with a median of 5.5%. A corner point lies inside 11 of the 15 regions. d05, d06, d11 and d12 are reachable only from inside the box. The source is `results/reconcile/region-shares.txt`.

**Natural briefs** (`scripts/envelope-spike/briefs/`). There are 12: the 10 examples plus the bench references gear-blank and pegboard-hook. The 9 bench copies of examples count once. `reg-bolted-stack` and the capability references declare no Params, so they have no envelope.

**Scoring**, as pre-registered in `corpus/index.json`:

- A counterexample is a point where an assertion fails that passes at nominal.
- A defect is found when the search evaluates a counterexample inside its region.
- The guided run uses budget 64 and seed 1.
- The random baseline uses 64 uniform points over the box per run, with seeds 1 to 10.
- A false counterexample is one that does not fail again in a new process on a fresh kernel.

**Measures:**

- **M1:** detection rate, guided against random.
- **M2:** false counterexamples, from `verify`.
- **M3:** the share of points whose report hash is the same in the warm-pool search and in the fresh-kernel replay. The report hash is a SHA-256 of the canonical report JSON, with measures printed to 6 decimals. For the 29 build-error points it hashes only the error code.
- **M4:** natural counterexamples, classified by hand.
- **M5:** enclosure process wall time at budget 64, pool start included.
- **M6:** mutants (optional).

**Kill criterion**, from the synthesis. The deciding kills were:

- M1 below 80%;
- guided less than 15 points better than random;
- any false counterexample.

The secondary kills were:

- M3 below 99%;
- M5 over 120 s;
- M4 finding nothing beyond the 2 known cases;
- the M6 mutant rules.

**Platform.** One 4-core, 15 GiB Linux x64 container, Node v24.22.1, occt-wasm 5.8.1. The guided run used `--workers 4 --lane interactive --jobs 4` and took 3 min 2 s for 37 briefs. The random baseline took 7 min 46 s and `verify` took 3 min 33 s. The exact commands are in `results/run.json`.

## Results

### M1: detection on the seeded corpus

| Measure | Value | How |
|---|---|---|
| Guided, budget 64, seed 1 | **15 of 15 (100%)** | `results/certs/`, scored in `summary.json` |
| First hit by phase | corner 11, special 1 (d11, index 6), Halton 3 (d05 index 19, d06 16, d12 23) | Same certificates. The compass never ran on a defect, because every defect had a counterexample earlier |
| Corners only | 11 of 15 (d01, d02, d03, d04, d07, d08, d09, d10, d13, d14, d15) | Exactly the 11 regions that contain a corner, as computed before the run |
| Counterexamples on defects | 161, of which 160 lie inside their region | One d10 point at Boss radius 4.046875 is 0.007 mm outside. Its analytic wall is 0.847 mm, the gate reads 0.837 mm, and it fails again on replay |
| Shrunk counterexamples inside their region | 15 of 15 | `summary.json` |
| Controls | 0 nominal failures, 0 guided and 0 random counterexamples on all 10 | `summary.json` |
| Uniform random, seeds 1 to 10 | **13.2 of 15 (88.0%)**. Per seed: 13, 14, 13, 14, 13, 14, 14, 14, 9, 14 | `results/random/` |
| Random misses | d14 found 0 of 10 runs, d08 6 of 10, d02, d03, d04 and d07 9 of 10 each, all others 10 of 10. Seed 9 missed 6 defects (d02, d03, d04, d07, d08, d14) | `results/reconcile/agreement.txt` |
| Random rate expected from region shares | 87.2%, recorded in `corpus/index.json` before any search | `(1 - share)^64` per defect |

**Kill line:** 100.0 minus 88.0 is 12.0 points, which is less than 15. **The line triggers.**

### M2: false counterexamples

**0 of 356.** These are 161 counterexamples on corpus defects and 195 on natural briefs. All 356 failed again in a new process, each point on a fresh kernel, with exactly the same set of failing assertions (`results/verify.json`).

### M3: replay

**2357 of 2357 points (100%)** had the same report hash in the warm-pool search and in the fresh-kernel replay. That is 36 briefs at 64 points plus gear-blank, whose 53 values were all enumerated.

Two limits apply to this result:

- "Same hash" means the same canonical report at 6 decimals, not the same raw float bits.
- It was shown on Linux x64 only.

### M4: natural scripts

The counterexamples were classified by hand after the run (`results/m4-classification.json`).

**Known cases, re-found:**

- **flange.** The holes break out between Diameter 51.875 and 53.75. The event guard found this; the analytic value is 53.2. min_wall changes verdict between Diameter 56.5625 (margin -0.008 mm) and 56.914 (+0.080 mm).
- **box-with-lid.**
  - Below Clearance 0 the lid clashes. The worst case is W150 D120 H15 C-1, with a 2094.8 mm3 clash (the cube root, 12.8, is the margin).
  - At Clearance 0, `lip-gap` fails because no gap line is listed. Bisection puts the boundary between C 0.0156 and -0.0625.

**New design defects:** 4 more scripts. All have reproducers below.

- **bracket:**
  - It fails to build at Thickness 2, the bottom of its range.
  - At short Leg the holes cut into the other flange.
  - At narrow Width the holes come 0.751 mm from the side.
- **knob:** at Height 12 and below, the 12 mm D-bore opens the dome.
- **tapered-cup:** min_wall fails for Wall below about 1.31 to 1.42 mm, depending on Height.
- **vented-box:**
  - The top vent row thins the rim below Height 32.34.
  - The outer vent columns run into the corner radii below Width 78.

**Brief errors**, which are not design defects:

- **gear-blank:** the brief assumed size x 54 for every tooth count. All 53 values were enumerated, and odd counts and 57 to 60 teeth differ.
- **lid-interference:** a negative test whose declared range includes non-clashing clearances.
- **enclosure:** `shank-in-pocket` fails at nominal only because the raised watch distance exposes extra 0.7 and 1.0 mm lines. It passes at 0.5 mm.

**Held**, apart from nominal overhang failures with build direction [0, 0, 1]: enclosure, hinge, phone-stand and pegboard-hook.

The secondary kill "M4 finds nothing beyond the 2 known cases" does not trigger.

### M5: enclosure wall time, budget 64

Each configuration ran as its own process, one after another, on an otherwise idle machine. Every run wrote a certificate byte-identical to `results/certs/enclosure.cert.json`.

| Configuration | Builder | Skeptic 1 | Reconciliation (2026-11-10) |
|---|---|---|---|
| 1 worker, batch lane | 101.8 s | 110.7 s | 108.8 s |
| 4 workers, batch lane (slot 0 reserved, 3 usable) | 42.2 s | 44.6 s (3 workers, interactive) | 45.4 s |
| 4 workers, interactive lane | 33.9 s | not run (memory limit of 3 workers) | 37.6 s |

Every configuration is under the 120 s line. The secondary kill does not trigger. The source is `results/m5/` and `results/reconcile/m5.json`.

### M6: mutants

Not run. The phase was optional, and no mutants were generated or scored.

### Kill criterion, applied strictly

| Criterion | Line | Measured | Verdict |
|---|---|---|---|
| M1 detection | at least 80% | 100% | pass |
| Guided minus random | at least 15 points | 12.0 points | **kill** |
| False counterexamples | 0 | 0 of 356 | pass |
| M3 replay (secondary) | at least 99% | 100% | pass |
| M5 enclosure (secondary) | at most 120 s | 33.9 to 45.4 s on 4 workers | pass |
| M4 beyond known cases (secondary) | more than 0 | 4 scripts | pass |
| M6 mutant rules (secondary) | | not run | not evaluated |

## The audits, and what they changed

Two independent skeptics re-ran the spike, with their own code where they could.

- **Skeptic 0** reproduced all 37 certificates (2357 of 2357 point hashes the same). It also reproduced the random baseline record for record (16000 of 16000 points), and ran a full fresh-kernel verify (0 of 356 false). It ran guided seeds 2 to 30, which found 15 of 15 on every seed, and kernel random seeds 11 to 20. It also wrote three harder thin-band defects.
- **Skeptic 1** confirmed the pre-registration order. It reproduced M1 from the committed certificates with its own scorer, and reproduced all 15 first hits through the product CLI with no spike code. It re-ran six certify runs byte-identically and re-ran M2 and M3.

Neither audit found an "invalidates" finding, and both agreed with "kill". Their "weakens" findings change how the kill should be read, not the decision. The reconciliation re-ran or recomputed every point of disagreement. The new numbers come from `scripts/envelope-spike/reconcile.ts` and `reconcile-repro.sh`, with outputs in `results/reconcile/`.

| Finding | Severity | Reconciliation | What it changed |
|---|---|---|---|
| The 10-seed random baseline is too noisy to separate 12 points from 15. Kernel seeds 11 to 20 gave 82.0% (18.0 points ahead), and seeds 1 to 20 pooled gave 85.0% (exactly 15.0) | weakens | Simulated with the spike's own sampler and the region predicates. The predicates match the kernel on every (defect, seed) cell of seeds 1 to 10, and gave 82.7% on seeds 11 to 20 (the kernel's 82.0% differs by one d06 cell). Over 10,000 seeds the expected rate is **87.32%**, so guided leads by 12.7 points. The per-seed standard deviation is 8.3 points, so a 10-seed mean has a standard error of 2.6. **183 of 1000** disjoint 10-seed blocks would have cleared the line (`sim.txt`) | The kill stands under the pre-registered seeds and in expectation. A different 10-seed draw would have cleared this one criterion about 18% of the time. A future baseline needs 100 or more seeds, and an independent seed stream per brief |
| The corpus is easy and favors corners, so M1 measured whether the search tests corners | weakens (both) | Confirmed. Corners (the first 24) then 40 uniform points give **98.6%**. Corners, special points, then uniform points give **99.4%** (`sim.txt`). Expected random detection per defect: d14 2.1%, d08 71.2%, d02 75.8%, d04 81.3%, d03 93.0%, and 94.5% or more for the rest | The finding of the spike is "corner-first sampling carries all of the value". Compass, shrinking and bisection added no detection at the pre-registered budget |
| The verdict depends on the budget | weakens | Re-ran guided at budget 32, seed 1: **15 of 15** (`score-budget32.txt`). Expected random at 32 is 76.1%, a 23.9-point lead. Skeptic 0's thin interior bands (0.60% to 0.73% of the box, no corner) give guided 31.1% against random 35.3% at budget 64, and 84.4% against 58.1% at budget 128 | The kill applies to budget 64 as pre-registered. Both other results are exploratory. The budget-128 defects were written by someone who knew the search, and their margins fall linearly, which favors a compass. Reviving the guided search needs a new pre-registered experiment |
| d06's region is too wide | minor | Confirmed. **10 of 57** random points inside the d06 region pass on the kernel (seeds 1 to 10; skeptic 0 found 22 of 127 over seeds 1 to 20). No (defect, seed) cell disagrees on seeds 1 to 10 (`agreement.txt`). Skeptic 1's sentence "every random point inside a region failed" is wrong for d06 | None for M1, which is scored on kernel failures |
| Region edges and gate readings disagree by about 0.01 mm | minor | Confirmed. In the tapered cup, the gate reads 0.002 to 0.013 mm thinner than the analytic web on 9 of 9 failing points (`mechanisms.txt`). Skeptic 1 found readings about 0.01 mm thicker between cylindrical holes. At budget 32, d03 fails to fillet at exactly 2r = W (Width 13.5, Corner radius 6.75), where the strict region inequality says it passes | Read errors of up to 0.013 mm are smaller than the gate's documented 0.04 mm marginal band. So in this data no wall under the 0.8 mm limit read as a pass |
| The builder wrote "seed 9 missed 5" | minor | It missed 6: d02, d03, d04, d07, d08 and d14 | Corrected here |
| "Bit-identical" means the same rounded report hash | minor | Confirmed in `brief.ts` (`reportHash`) | Wording corrected in M3 |
| 4 counterexamples rest only on a fit line missing at zero gap (box-with-lid C0 `lip-gap`; d07 Bore = Pin = 6.4 at Length 20, 25 and 30) | minor | Not re-run | None for M1. It is a symptom of the core fit defect K2 below |
| `score()` could turn a harness exception into a counterexample | minor | No margin detail in 2357 points starts with "brief:" | None |
| The knob's 9.915 mm is at Radius 10, not nominal | minor | Confirmed: 9.915 at Radius 10, 9.974 at Radius 16 | Wording corrected |
| Median region share of 7.7% (skeptic 0) | minor | The pre-registered grid gives a median of **5.5%** (d10). 7.7% is d13's share | Corrected here |
| The 4-worker M5 runs were never reproduced | minor | Re-ran all three configurations (see M5) | None. All are under 120 s |

The reconciliation also explained two M4 items that the builder left open:

- **The tapered-cup mechanism**, which the builder marked unverified, is the outer 3 mm base fillet against the cavity's sharp bottom corner. The fillet is a circle of radius 3, tangent to z = 0 and to the cone r = 30 + s z, where s = 8 / Height. The web from the cavity corner (30 + s W - W, W) to that circle matches the gate on all 9 failing points within 0.013 mm.
- **The knob fails min_wall at its nominal values** (0.076 mm at face:34), which is why its brief listed min_wall as a nominal failure. Each flute is a cylinder of radius 1.6 at radius R + 0.6, so its inner edge is at R - 1. It ends at z = H - 4, which is exactly where the 45 degree chamfer of the profile is also at radius R - 1. Every flute's top therefore grazes the chamfer and leaves a knife edge.
  - All 56 fluted points of the certificate fail, and all 8 points with Flutes 0 pass.
  - A copy with flutes 1 mm shorter reads 1.072 mm and passes (`repro.txt`).

The audits also found a measurement limit: **a nominal failure masks the same assertion off nominal.** The knob's thin skin over the bore, just above Height 12, could not be reported, because min_wall already fails at nominal.

## What did not work

- **The deciding line could not be cleared on this corpus.** Random sampling was expected to find 87.2%, so a perfect search could lead by at most 12.8 points. This was known and recorded before the search, and the corpus was not reshaped. The 15-point line and the corpus were designed separately, and nobody checked them against each other before pre-registration. That check belongs in the next pre-registration.
- **Compass, shrinking and bisection added no detection** on the corpus at budget 64 and seed 1. Their only use was to locate boundaries.
  - On seeds 2 to 30 (skeptic 0), the compass made the first hit on d05 in 3 seeds where the Halton points had missed.
  - Uniform random sampling alone finds d05 94.7% of the time.
- **3 of 12 natural briefs were wrong.** Briefs written from header comments are error-prone. An M4 count without classification by hand would have overstated the real defects.
- **The watch-distance rule broke a bench assertion.** Raising the watch to 2 times the largest gap bound (1 mm for the enclosure) exposed extra 0.7 and 1.0 mm lines, and the bench `distance` check bounds every gap of a counted pair. A watch distance has to apply per assertion.
- **Nominal failures masked envelope failures** of the same assertion (the knob).
- **All briefs shared one random seed stream**, so misses were correlated: seed 9 missed 6 defects at once. The mean is unbiased, but the per-seed spread is not.
- **The bulk runs used the interactive lane** for throughput. The design puts this work on the batch lane, which leaves 3 of 4 workers usable.
- **M6 did not run.**
- **The results take 6.3 MB of JSON.** The three M5 certificates are byte-identical copies, kept for re-scoring.

## Decision

**Kill.** Applied strictly, the deciding criterion fails: guided search was 12.0 points better than random, below the 15-point line. Every other criterion passes. Neither audit found a reason to reverse this.

The kill means the following:

- **Killed:** the headline of a guided counterexample search with shrinking, bisection and a signed certificate, as the thing that makes declared ranges trustworthy. On this evidence the search adds nothing over corner-first sampling at the budget we registered.
- **Not killed:** checking declared ranges. Corner-first sampling found every seeded defect, including d14, which random sampling found in 0 of 10 runs. It also found real defects in 6 of the 10 gallery examples (flange, box-with-lid, bracket, knob, tapered-cup and vented-box), and it replays deterministically. The synthesis names this as the fallback: "fold the sampler into the S4 sweep as a plain feature and drop the headline". RFC 0002 (#68) proposes it.
- **How the guided search could come back:** only through a new pre-registered experiment. That experiment should use interior-band defects that random sampling finds less than half the time, 100 or more independent random seeds, budget 128, and a watch distance set per assertion.

## Defects, filed as issues

Each reproducer uses the product CLI on today's example with no spike code. Run it from the repository root. The CLI writes a `<name>.o3j/` project folder next to the script, which `.gitignore` covers for `examples/`. The outputs below were captured on a byte-identical copy (`results/reconcile/repro.txt`, Linux x64, Node v24.22.1, 2026-11-10). All ten were run again on `main` at 8fd1d9f on 2026-11-10, with the same results, before they were filed.

Range fixes (a new `min` or `max`) change no golden, because `expected.json` records the nominal run only. A fix that changes nominal geometry (K6) moves `expected.json` and `drawing.png`, and needs a maintainer. Each of these six examples has a bench copy under `bench/tasks/reg-*/reference.o3j.js` that must change with it. That is maintainer lane, and the bench regression must stay at 100%.

**K1 (#60). flange: the bolt holes break the rim below Diameter 53.2, and the run still says ok.**

```
npx open3dj run examples/flange/flange.o3j.js --param Diameter=52 --no-save-params
  ok ... flange valid 18662.06 mm3 51.92 x 52 x 20 mm 1 solid, 20 faces
npx open3dj inspect examples/flange/flange.o3j.js --param Diameter=52 --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.006 against 0.8 at face:7
(--param Diameter=56: FAIL min_wall 0.692 at face:5; nominal Diameter 80: thinnest wall 5.99 mm, pass)
```

The hole centre radius is D/4 + 10 and the hole radius is 3.3, so the holes break out at D = 53.2. The wall D/4 - 13.3 falls under the 0.84 mm fail line below D = 56.56. The declared range is 50 to 160. To fix it, raise `min` to 57, or derive the bolt circle from D. The same applies to `bench/tasks/reg-flange-8`.

**K2 (#61). Core fit report: a zero-gap contact and a gap over 0.5 mm both give no fit line, so they read the same as each other.**

```
npx open3dj run examples/box-with-lid/box-with-lid.o3j.js --param Clearance=0.25 --detailed --no-save-params
  clearance base / lid 0.25 mm (measured) beside a mated seat
... --param Clearance=0    -> no fit line
... --param Clearance=0.6  -> no fit line
... --param Clearance=-0.3 -> warning, clash base / lid 265.811 mm3
```

There are two causes:

- `packages/assembly/src/fits.ts:49` drops every contact between mated parts, not only the mated seat.
- `job.ts` calls `computeFits` with the default 0.5 mm watch distance, and no run option can raise it. The spike's patch c344a1f adds `JobRequest.fitOptions`.

It is filed as #61, the mated-pair exemption. It sits next to andon #19 (the box-with-lid and enclosure goldens). The negative Clearance range of box-with-lid is reported correctly (clash, status warning), so it is not part of this defect.

**K3 (#62). bracket: it fails to build at Thickness 2, the bottom of its declared range.**

```
npx open3dj run examples/bracket/bracket.o3j.js --param Thickness=2 --no-save-params
  error KERNEL_FILLET_FAILED at bracket.o3j.js:20:8 ... elements: edge:5, edge:7, edge:14, edge:19, edge:22, edge:32, edge:39
(--param Thickness=2.125: ok; the same script with a 0.9 mm fillet: ok at Thickness 2)
```

The fixed 1 mm edge fillet equals half the thickness, so the two fillets on each flange end meet across the whole end face. OCCT fails there, just as it did on d03 at exactly 2r = W. This failed at all 20 Thickness 2 points of the certificate. To fix it, raise `min` to 2.5, or use a fillet of min(1, 0.4 T).

**K4 (#62). bracket: at short Leg with thick Thickness, the holes cut into the other flange.**

```
npx open3dj run examples/bracket/bracket.o3j.js --param Width=100 --param Leg=20 --param Thickness=10 --param Screw=M5 --detailed --json --no-save-params
  "edges": 84   (64 at nominal, and 64 at Leg 21)
```

The hole centre is at 0.62 L = 12.4 and the M5 clearance radius is 2.75. The hole therefore reaches y = 9.65, inside the upright, which spans y 0 to Thickness 10. The fix is to keep the hole centre at least T + r + 0.84 from the corner.

**K5 (#62). bracket: at narrow Width with thick Thickness, the holes come 0.751 mm from the side.**

```
npx open3dj inspect examples/bracket/bracket.o3j.js --param Width=24 --param Leg=80 --param Thickness=10 --param Screw=M5 --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.751 against 0.8 at face:21
```

The hole centre is at W/4 + T/4 = 8.5, so its edge is at 11.25 and the side at 12: a 0.75 mm wall.

**K6 (#63). knob: at its nominal values, every flute leaves a 0.076 mm knife edge under the chamfer.**

```
npx open3dj inspect examples/knob/knob.o3j.js --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.076 against 0.8 at face:34
(the same script with cylinder(H - 7, 1.6) instead of cylinder(H - 6, 1.6): thinnest wall 1.072 mm, min_wall passes)
```

The flute's inner edge (R + 0.6 - 1.6 = R - 1) meets the chamfer exactly at the flute's top (z = H - 4). This happens for every Radius and Height with Flutes above 0. It fails at 56 of 56 certificate points with flutes, and passes at 8 of 8 without. The fix changes nominal geometry, so the knob's `expected.json` and `drawing.png` move.

**K7 (#64). knob: at Height 12 and below, the 12 mm D-bore opens the dome.**

```
npx open3dj run examples/knob/knob.o3j.js --param Height=12 --no-save-params
  knob valid 7823.92 mm3 32 x 32 x 11.97 mm 1 solid, 45 faces
(--param Height=12.25: 32 x 32 x 12.25 mm, 46 faces)
```

The declared range is 10 to 40. To fix it, raise `min` to about 14, or make the bore depth min(12, H - 2).

**K8 (#65). tapered-cup: min_wall fails for Wall below 1.31 to 1.42 mm (declared min 1.2).**

```
npx open3dj inspect examples/tapered-cup/tapered-cup.o3j.js --param Height=120 --param Wall=1.2 --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.531 against 0.8 at face:7
(Height 70: Wall 1.35 FAIL (marginal) 0.77; Wall 1.45 thinnest 0.903, pass; nominal Wall 2.5: 2.307, pass)
```

The cause is the 3 mm outer base fillet against the cavity's sharp bottom corner. The fail line is Wall 1.309 at Height 30 and Wall 1.424 at Height 120 (`mechanisms.txt`). To fix it, raise `min` to 1.45, round the cavity's bottom corner, or scale the fillet with Wall.

**K9 (#66). vented-box: the top vent row thins and then cuts the rim below Height 32.34.**

```
npx open3dj inspect examples/vented-box/vented-box.o3j.js --param Height=32 --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.5 against 0.8 at face:4
(--param Height=25: faces 130 and edges 384, against 167 and 492 at nominal)
```

The top row of slots ends at z = 31.5, so the rim web is Height - 31.5. The declared range is 25 to 80. To fix it, raise `min` to 33, or place the rows from Height.

**K10 (#66). vented-box: the outer vent columns run into the corner radii below Width 78, and into the end walls below 70.**

```
npx open3dj inspect examples/vented-box/vented-box.o3j.js --param Width=66.4 --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params
  FAIL min_wall 0.028 against 0.8 at face:65
(--param Width=66.4: faces 159, edges 564)
```

The outer columns reach |x| = 33, while the straight part of the long walls ends at W/2 - 6 and the end walls start at W/2 - 2. At Width 60 the slots cut through the corners with no thin wall, and only the counts change (edges 540). The declared range is 60 to 160. To fix it, raise `min` to 80, or space the columns from Width.

**Observed, not filed as defects:**

- OCCT fails a fillet whose two sides meet across a face (2r equal to the face width, d03 and K3). Open3DJ already reports it as `KERNEL_FILLET_FAILED` with the edges and a hint.
- The min_wall gate reads up to 0.013 mm off the analytic wall, in both directions. That is within its documented 0.04 mm marginal band.
- 8 of 12 natural scripts fail the overhang gate at nominal with build direction [0, 0, 1]. Without a stated build direction per part, that is not a design defect.

## Limits of this evidence

- One 4-core Linux x64 container under Node v24.22.1. Determinism is shown on this platform only.
- One corpus of 15 defects, written by the same builder who wrote the search, although the corpus was committed first.
- The kill rests on 10 pre-registered random seeds. The 10,000-seed expectation agrees with it.
- The budget-32 and budget-128 results are exploratory.
- `npm run check` on this branch, run during the reconciliation, took 115.2 s:
  - typecheck passes;
  - 917 of 920 tests pass and 1 is skipped;
  - the 2 failures are the box-with-lid and enclosure goldens of andon #19. The base commit 3f7d7ed already has them, because the spike patch does nothing when `fitOptions` is absent;
  - the bench regression split passes 12 of 12 (100%, 3 replays, identical);
  - the leak gate and the licence gate pass.

## How to reproduce

From the root of the `experiment/envelope-spike` branch, with Node 24:

```
node scripts/envelope-spike/lint-corpus.ts
node scripts/envelope-spike.ts certify scripts/envelope-spike/corpus/*.brief.json scripts/envelope-spike/briefs/*.brief.json --budget 64 --seed 1 --workers 4 --lane interactive --jobs 4
node scripts/envelope-spike.ts random scripts/envelope-spike/corpus/*.brief.json --budget 64 --seeds 1-10 --workers 4 --lane interactive --jobs 4
node scripts/envelope-spike.ts verify scripts/envelope-spike/results/certs/*.cert.json --workers 4 --lane interactive
node scripts/envelope-spike.ts score
node scripts/envelope-spike/corpus/regions.ts
node scripts/envelope-spike/reconcile.ts sim
node scripts/envelope-spike/reconcile.ts agreement
node scripts/envelope-spike/reconcile.ts mechanisms
node scripts/envelope-spike/reconcile.ts brief-free
node scripts/envelope-spike/reconcile.ts score scripts/envelope-spike/results/certs
bash scripts/envelope-spike/reconcile-repro.sh
```

`brief-free` measures how much of the detection needs a written brief. That number shapes the plain feature in RFC 0002:

- On the corpus, 14 of 15 defects have a counterexample that fails a build, status, validity, gate or clash check. d13 needs a gap bound.
- On the natural scripts, these checks catch every counterexample of flange and tapered-cup, 34 of 35 of box-with-lid, 22 of 23 of bracket and 16 of 30 of vented-box.
- They catch none of the knob's 19 counterexamples. Every counterexample they miss still changes the event signature (counts, fits or gate verdicts) from nominal.
