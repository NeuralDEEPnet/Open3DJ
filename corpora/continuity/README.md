# Seeded continuity corpus

The cases behind `inspect fields=[continuity]` (#78). Each case in [cases.json](cases.json) is a short DSL script and the class counts its edges must read: how many are G2, G1, G0 or a gap. The answers come from the geometry, not from a run, and `why` says where each comes from. For example, a box meets at 90 degrees, a fillet is tangent to a flat with a curvature step of 1/r, and faces cut from one smooth surface are curvature-continuous across the cut.

`scripts/continuity-corpus.test.ts` runs every case through the real job runner in `npm test`, so `npm run check` fails on any miss. An edge counted in a higher class than the geometry allows is a false pass, reported as such, and it stops the line.

To add a case:

1. Write the script and work out its answer from the geometry first.
2. Add it to `cases.json` with `why`.
3. Run `node --test scripts/continuity-corpus.test.ts`.

If the run disagrees, find out which is wrong before changing either. The `swept-tube` case found a measurement bug that way.
