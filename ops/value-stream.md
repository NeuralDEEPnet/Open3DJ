# Value stream

How long each stage of a real product project takes and how often it loops back. Until S5 there are no Open3DJ approval timestamps, so the S0 baseline is filled in by hand from 2 or 3 enclosure briefs carried out on 3dj.app ([PLAN.md](../docs/PLAN.md) S0 and section 12, issue 16). From S5, approval and provenance timestamps give the same numbers, and the Friday scorecard takes them from there. The stage list and the metric for each stage are in [INDUSTRIAL-DESIGN.md](../docs/INDUSTRIAL-DESIGN.md) sections 3 and 6.

## How to fill it in

- One table per project, one row per stage. Copy the blank table below.
- **Start** and **End** are dates with times (YYYY-MM-DD HH:MM). Start is when work on the stage began; End is when its output was accepted (approved, chosen or printed).
- **Rework count** is how many times the project came back to this stage after leaving it, for any reason.
- A stage the project skipped gets "skipped" and one line on why; a maker going from brief to print skips ideation and CMF.
- Notes are short and blameless: what caused the waits and the loops.
- Record the founder hours spent on each project in the build log, not here.

## Blank table

**Project:** short name. **Brief:** one line, or a link to the bench task it matches. **Tool:** 3dj.app, or Open3DJ at commit `<hash>`. **Recorded by:** name, YYYY-MM-DD.

| Stage | Start | End | Rework count | Notes |
|---|---|---|---|---|
| Brief | | | | |
| Research | | | | |
| Ideation | | | | |
| Concept 3D | | | | |
| Form | | | | |
| CMF | | | | |
| Ergonomics | | | | |
| Engineering (fits, fasteners) | | | | |
| DFM and DFA | | | | |
| Prototyping (print) | | | | |
| Validation | | | | |
| Drawings | | | | |
| RFQ | | | | |

**Summary:** total lead time from brief start to the last end; the stage with the longest lead time; the stage with the most rework; first-print fit (yes or no, and what did not fit); escapes (problems found after a stage was accepted).

## Baseline (S0)

Not recorded yet. It needs 2 or 3 enclosure briefs carried out by hand on 3dj.app, for example from the capability split in [bench/tasks](../bench/tasks/).
