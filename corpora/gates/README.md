# Seeded gate corpus

Small parts with known answers for the `fdm.v1` print checks (`watertight`, `min_wall`, `overhang` and `bed`; [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) section 10). The S3 exit in [PLAN.md](../../docs/PLAN.md) asks for zero false passes on this corpus: no seeded defect may pass the gate that should catch it. Controls guard the other direction, so a fix that makes a gate fail everything shows up at once. All cases are original and MIT licensed.

Each case is one DSL script, `<id>.o3j.js`, and one entry in [cases.json](cases.json) with the expected verdict of every gate, the value range where it matters, and the build direction or bed when the case needs one.

## How a case is checked

`scripts/gate-corpus.test.ts` runs every case in `npm test`, so `npm run check` fails on any problem. Each script runs on the real compute pool, in the sandbox, through the same job as `inspect fields=[gates]`: a run job with gates and without the fit check. For each of the four gates the runner compares the verdict with the expected one:

| Result | Meaning | Fails the run |
|---|---|---|
| false pass | A gate that must fail passed: a seeded defect got through | yes |
| false failure | A gate that must pass failed: a control was rejected | yes |
| value | The verdict is right, but the gate's number is outside the case's range | yes |
| marginal | A seeded defect failed only as `marginal`, or a case that expects `marginal` failed outright | yes |
| unmeasured | `min_wall` failed with a value where the case expects none, or the reverse | yes |
| known miss | A documented miss: the truth is a fail and the gate passes today | no, it is reported |
| miss caught | A known miss now fails: update the case and the docs that describe the miss | yes |
| error | The run failed where it should not, or with another error code | yes |

The number compared with `value` is the failure's value, or for a `min_wall` pass the thinnest wall found (`wall.min_mm`). A control with a thin wall, such as the 0.9 mm tray, gives a range, so it cannot pass without its wall being measured. Overhang values come from the surface normals at the mesh points, so a hole's top, which faces straight down, reads 86 degrees here. At a cone's apex, where the tessellator's normals are not the surface's, the triangles' own normals stand in.

## Commands

```sh
node scripts/gate-corpus.ts                  # every case on the compute pool: a table, exit 1 on any problem
node scripts/gate-corpus.ts wall-tray-0.6    # one case (or several ids)
node scripts/gate-corpus.ts --cli            # through the real CLI: open3dj inspect --fields gates, a fresh process per case
node scripts/gate-corpus.ts --json           # the results as JSON
npm run gate-corpus                          # the same as the first line
```

Measured on 2026-11-04 on a shared Linux container (4 vCPUs, Node 24.22.1): 57 cases in 6.6 s on a pool of 4 workers, 6.5 s in `scripts/gate-corpus.test.ts` on a pool of 2, and 89 s with `--cli`. The slowest case is `wall-ellipse-tube-0.7` at about 3.4 s (the exact elliptical offset is a dense B-spline). Results: 0 false passes, 0 false failures, 1 known miss.

## The cases

### watertight

| Case | Seeds | Expected |
|---|---|---|
| `watertight-loose-blocks` | Two 10 mm cubes 10 mm apart in one part: two solids | `watertight` fails |
| `watertight-edge-contact` | Two 10 mm cubes touching along one vertical edge: two solids and a non-manifold mesh edge | `watertight` fails |
| `watertight-point-contact` | One solid whose block and post touch at a single point: a non-manifold vertex, the only defect | `watertight` fails |
| `watertight-corner-on-face` | One solid: an 8 mm cube balanced on a corner that touches the middle of a plate's top face, inside one of its mesh triangles | `watertight` fails |
| `watertight-tip-on-face` | One solid: the tip of a cone pointing down (80 degree tip) touches the middle of a plate's top face | `watertight` fails |
| `watertight-self-crossing` | A self-crossing (bow-tie) outline extruded: not a valid solid | the run refuses it (`KERNEL_INVALID_RESULT`) |

The DSL returns only solids that pass the kernel's validity check, so an open shell never reaches the gates: `watertight-self-crossing` shows the run refusing an invalid solid, which counts as a false pass if the run ever accepts it.

### min_wall

| Case | Seeds | Expected |
|---|---|---|
| `wall-tray-0.6` | A 30 x 20 x 15 mm open tray with 0.6 mm flat walls and floor | fails, 0.59 to 0.61 mm |
| `wall-tray-0.8-marginal` | The same tray with 0.8 mm walls, inside the 0.04 mm guard band | fails as marginal, 0.79 to 0.81 mm |
| `wall-rib-0.3` | A 0.3 mm rib, 30 mm long and 8 mm tall, on a 3 mm plate | fails, 0.29 to 0.31 mm |
| `wall-tube-0.5` | A 20 mm tube with a 0.5 mm wall (curved faces) | fails, 0.47 to 0.53 mm |
| `wall-ellipse-tube-0.7` | A 30 x 16 mm elliptical tube with a 0.7 mm wall: the curvature changes along the wall | fails, 0.67 to 0.73 mm |
| `wall-drafted-cup-0.4` | A cup with an 8 degree draft and a 0.4 mm side wall (curved and slanted faces) | fails, 0.37 to 0.43 mm |
| `wall-slanted-fin-0.5` | A 0.5 mm fin leaning 30 degrees from vertical on a 4 mm plate (slanted faces) | fails, 0.48 to 0.52 mm |
| `wall-tilted-tray-0.7` | The tray with 0.7 mm walls, tilted 25 degrees about [1, 2, 0] and built along its own tilted axis | fails, 0.68 to 0.72 mm |
| `web-groove-50deg-0.3` | A 50 degree V-groove under a 2 mm plate leaving a 0.3 mm web | fails, 0.28 to 0.32 mm |
| `web-scoring-25deg-0.3` | A 25 degree scoring line under a 2 mm plate leaving a 0.3 mm web | fails, 0.28 to 0.32 mm |
| `neck-double-notch-0.5` | Two 70 degree V-notches, top and bottom, leaving a 0.5 mm neck in a 10 mm block | fails, 0.48 to 0.52 mm |
| `neck-fused-rods-0.63` | Two 10 mm rods fused 9.98 mm apart: a 0.63 mm neck between curved faces | fails, 0.6 to 0.66 mm |
| `web-between-holes-0.5` | Two 6 mm holes through a 5 mm plate with a 0.5 mm web between them | fails, 0.49 to 0.56 mm |
| `bridge-0.5-large-faces` | Two 100 mm blocks joined only by a 0.5 mm bridge whose faces are parts of large faces; built along +Y | fails, 0.49 to 0.51 mm |
| `shim-tip-0.65` | A 100 x 30 mm shim tapering from 12 mm to a 0.65 mm end | fails, 0.62 to 0.72 mm |
| `wedge-doorstop-tip-0.5` | A 120 x 40 mm doorstop, 25 mm at the back and 0.5 mm at the tip: a long wedge tip | fails, 0.48 to 0.62 mm |
| `wedge-knife-edge` | A 100 mm knife edge of 22.6 degrees standing on its back (built along -X) | fails, 0 to 0.2 mm |
| `wall-arrow-tip-0.4` | A 90 degree arrow pocket through a 60 x 60 mm plate, its tip 0.4 mm from the back face | fails, 0.35 to 0.45 mm |
| `pocket-cone-45deg-0.5` | A conical pocket 45 degrees from its axis, its tip 0.5 mm above the bottom | fails, 0.48 to 0.52 mm |
| `pocket-cone-10deg-0.5` | A narrow conical pocket 10 degrees from its axis, its tip 0.5 mm above the bottom | fails, 0.48 to 0.52 mm |
| `pockets-tip-to-tip-30deg-0.5` | Two conical pockets 30 degrees from their axis, from the top and the bottom of a 10 mm block, 0.5 mm between their tips | fails, 0.48 to 0.52 mm |
| `web-under-drill-point-0.5` | A 6 mm blind hole with a 118 degree drill point, its tip 0.5 mm above the bottom | fails, 0.48 to 0.52 mm |
| `unmeasured-tetrahedron` | A regular tetrahedron: no two faces come close to facing each other, so no wall is measured | fails unmeasured, without a value |
| `known-miss-leaning-pocket-tip-0.7` | A narrow conical pocket whose axis leans 35 degrees from vertical, its tip 0.7 mm above the bottom | should fail; passes today at 0.85 mm (known miss) |

No face ray reaches the web under a pointed pocket: the face rays leave along the pocket's wall normals, which point away from the web. Rays from pocket tips and inside corners measure it, along the pocket's axis, so every pocket tip above reads its web to 0.01 mm whatever the cone's angle. The known miss is what is left: under a tip that leans towards the face it nears, the axis is longer than the web by 1 / cos of the lean. A 0.5 mm web under a tip leaning 40 degrees reads 0.65 mm and still fails; a 0.7 mm web under a tip leaning 35 degrees reads 0.85 mm and passes.

### overhang

| Case | Seeds | Expected |
|---|---|---|
| `overhang-tee-shelf` | A 30 mm shelf on a 10 mm column: 200 mm2 facing straight down | fails, 89.9 to 90 degrees |
| `overhang-ledge-50deg` | A ledge held up by a chamfer leaning 50 degrees past vertical | fails, 49.9 to 50.1 degrees |
| `overhang-ledge-45deg-marginal` | The ledge with a chamfer at exactly 45 degrees, inside the 1 degree band | fails as marginal, 44.9 to 45.1 degrees |
| `overhang-cone-pocket-from-below-45deg-marginal` | A conical pocket cut up from below, 45 degrees from its axis: its wall leans exactly 45 degrees past vertical | fails as marginal, 44.8 to 45.1 degrees |
| `overhang-horizontal-hole` | An 8 mm hole straight through a 20 mm block along X: the top of the hole faces down | fails, 84 to 90 degrees |
| `overhang-ball` | A 20 mm ball resting on one point: its lower half overhangs | fails, 85 to 90 degrees |

### bed

| Case | Seeds | Expected |
|---|---|---|
| `bed-long-300` | A 300 mm bar: longer than the 220 mm bed either way round | fails, 300 mm |
| `bed-tall-260` | A 260 mm post: taller than the 250 mm build height | fails, 260 mm |
| `bed-only-turned-230` | A 230 mm bar: it would fit only on the diagonal or stood on end, and the gate checks the part as designed | fails, 230 mm |

### Controls: every gate must pass

| Case | What it guards |
|---|---|
| `control-block` | A 20 x 20 x 10 mm block (thinnest wall 10 mm) |
| `control-tray-0.9` | The tray with 0.9 mm walls: thin, but above the limit and its band (0.89 to 0.91 mm) |
| `control-tube-0.9` | The tube with a 0.9 mm wall: curved walls read up to 0.04 mm thin (0.86 to 0.92 mm) |
| `control-twisted-bar` | A 20 x 4 mm bar twisted 90 degrees over 40 mm: B-spline faces (3.5 to 4.01 mm) |
| `control-drafted-puck` | A 20 mm puck with a 2.9 degree draft: a grazing exit beside the rim is not a wall |
| `control-frustum-69deg` | A small frustum whose base edge is 69 degrees, blunter than the 60 that read as thin |
| `control-filleted-boss` | A drafted boss with a 1 mm fillet round its top |
| `control-filleted-block` | A block with 5 mm vertical and 2 mm top fillets |
| `control-cone-on-post` | A cone with an 80 degree tip on a post |
| `control-cone-pocket-from-below-40deg` | A conical pocket cut up from below, 40 degrees from its axis: its wall leans 40 degrees past vertical at its tip too, and the 4 mm over the tip is its thinnest wall (3.99 to 4.01 mm) |
| `control-corner-above-face-0.3` | The cube of `watertight-corner-on-face` 0.3 mm higher: a gap is not a contact (thinnest wall 1.99 to 2.01 mm) |
| `control-truncated-tetrahedron` | The tetrahedron with its apex cut off 2 mm below the tip |
| `control-tee-upside-down` | The tee of `overhang-tee-shelf` built along -Z: the shelf top rests on the bed |
| `control-ledge-43deg` | The ledge with a 43 degree chamfer, under the limit and its band |
| `control-flare-40deg` | A solid flare leaning 40 degrees past vertical: a curved overhang under the limit |
| `control-bed-turned-90` | A 240 x 200 mm plate on a 220 x 250 x 250 mm bed: it fits only turned 90 degrees, which the gate tries |
| `control-bed-standing-230` | The 230 mm bar built along +X: stood on end it fits the 250 mm height |
| `control-bed-diagonal-300` | A 300 mm bar designed on the diagonal: its box is 219.2 x 219.2 mm, so it fits as designed |

## What the corpus found

- **A false pass, fixed.** `watertight-point-contact` passed all four gates: one solid whose block and post touch at a single point has a closed mesh in which every edge has two faces, so the watertight check, which counted open and non-manifold edges, saw nothing. The mesh is not a manifold at that vertex, where two fans of triangles meet. The watertight check now also counts non-manifold vertices (`nonManifoldVertices` in `packages/assembly/src/gates.ts`, regression test in `gates.test.ts`). Across the 1,176 parts of the examples, the bench references, the H-det corpus, the 1,025-part reference grid and this corpus, it fires only on this case. It sees a point contact where the mesh has one vertex for both pieces, as at the corner in this case.
- **A contact inside a face, fixed.** A review found two more false passes of `watertight`: a cube balanced on its corner and a cone pointing down, each touching the middle of a plate's top face (`watertight-corner-on-face`, `watertight-tip-on-face`). The corner or the tip is not a vertex of the plate's mesh, so no vertex has two fans. The check now also counts mesh points that lie on a triangle they are not part of, within the weld tolerance plus the rounding of 32-bit coordinates (`touchingVertices`); triangles that use the point or one of its neighbours do not count, so a sliver beside the point is not a contact. Raised 0.3 mm, the cube passes (`control-corner-above-face-0.3`). What is left: a curved face that touches another face between its mesh points (a ball resting on a plate away from its pole) still passes, pinned by a known-limit test in `gates.test.ts`.
- **Pocket tips, fixed.** The review also found that the web under a pointed pocket was measured only where face rays happened to reach it: every pocket up to about 20 degrees from its axis passed over a 0.5 mm web (narrower ones read the full 5 mm), between about 20 and 26 degrees the result depended on where the rays fell, two pockets tip to tip passed up to about 55 degrees, and drill points read 0.2 to 0.3 mm long. Rays from pocket tips and inside corners now read all of them to 0.01 mm (`pocket-cone-10deg-0.5`, the former known miss, `pockets-tip-to-tip-30deg-0.5`, `web-under-drill-point-0.5`). The new known miss is the leaning tip above.
- **Cone apex normals, fixed.** At a cone's apex the tessellator writes one point per side of the seam, each with a normal that is not the surface's: a pocket cut up from below at 40 degrees read 52.7 degrees and failed `overhang`, and at 45 degrees it read 58.1 instead of a marginal 45. Where copies of one point on one face carry different normals, the overhang check now uses the triangles' own normals (`control-cone-pocket-from-below-40deg`, `overhang-cone-pocket-from-below-45deg-marginal`).
- **No other part moved.** Across the 197 part definitions of every script in `examples/`, `bench/` and `corpora/`, these three changes alter only the cases above; the gate time grows by about 5% (48.8 s to 51.3 s in one process).
- **Wide cones read as thin.** A cone standing on its base with a tip wider than 60 degrees has a base rim of 60 degrees or sharper, which reads as thin (a 90 degree cone reads 0.01 mm). So the cone control stands on a post (`control-cone-on-post`), and the frustum's base edge is 69 degrees.
- **Bottom fillets overhang.** A fillet on a bottom edge faces down above the bed, so the filleted controls round only vertical and top edges.

## Adding a case

1. Write `<id>.o3j.js` with a header comment that says what it seeds. Use one part, keep it small (a case should run in well under a second), and seed one defect, so the case says which gate must catch it. The id is lower case, with digits, dots and dashes.
2. Run it alone: `node scripts/gate-corpus.ts <id>` fails with "has no case in cases.json" until step 3. `npx open3dj inspect <id>.o3j.js --fields gates` shows what the gates say today.
3. Add the entry to `cases.json`: `id`, `kind` (`defect`, `control` or `known-miss`), `seeds` (one sentence), `build` or `bed` if the case needs them, and `expect` with all four gates. A verdict is `"pass"`, `"fail"`, or an object `{ "verdict": "fail", "value": [min, max], "marginal": true, "unmeasured": true, "known_miss": "<why>" }` with the fields that matter. Set `expect` to `{ "error": "<code>" }` for a part the run must refuse.
4. Write the expected verdict from the truth, not from what the gate says today. If the gate disagrees, that is a false pass or a false failure: open an issue, or fix the gate test first (a regression test in `packages/assembly/src/gates.test.ts`, then the fix). Mark a case `known-miss` only for a limit the docs already describe.
5. Run `node scripts/gate-corpus.ts` until it passes, and paste its summary into the pull request. Never loosen a range or flip a verdict to make the run pass without saying why in the pull request.
