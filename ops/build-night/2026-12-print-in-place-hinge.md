# Build Night, December 2026: print-in-place hinge

The first [Agent Build Night](README.md) brief. A hinge that comes off the printer in one piece and already moves is a classic test of clearances and printability, and every check below can be read from Open3DJ's evidence files.

The brief is original, written for Open3DJ by neuraldeep.net design agents, and MIT licensed, like the bench tasks.

## The brief

Paste this text into the prompt in [README.md](README.md#on-the-night-for-operators), in place of `<brief>`:

```text
We want a small hinge that prints flat in one piece and comes off the printer already working: no supports, no assembly, no pin to push in afterwards. It has two leaves joined along one long edge by five knuckles that alternate between them: three on the first leaf (both ends and the middle) and two on the second. Laid flat, as it is printed, the hinge is 50 mm long along its axis, 44 mm across, and no taller than 8 mm, and both leaves sit on the print bed. How the knuckles hold together is up to you, for example a pin through them or cones between them, but the hinge must not come apart. The two leaves must never touch anywhere, because touching surfaces fuse when printed: every gap between them must be 0.3 to 0.45 mm. Add a parameter named Open angle, 180 when the hinge lies flat as printed, that swings the second leaf about the hinge axis; at 90 degrees the leaves must still not touch. Both leaves should pass the 3D printing checks with Z up. Name the parts Leaf A (three knuckles) and Leaf B (two knuckles).
```

## The checks

Part names become ids in the report: `Leaf A` is `leaf_a` and `Leaf B` is `leaf_b`. Each check names the evidence it is read from and the o3dj-bench assertion it would become ([bench/README.md](../../bench/README.md#assertions)).

| id | Check | Evidence | Assertion when it becomes a task |
|---|---|---|---|
| `status` | The run is `ok` | `run` | `status` in `["ok"]` |
| `valid` | Both leaves are valid solids, one solid each | `run --detailed` | `valid` |
| `leaf-a`, `leaf-b` | Exactly one Leaf A and one Leaf B, and nothing else | `run` | `occurrences` `leaf_a` eq 1, `leaf_b` eq 1, and `count` of occurrences eq 2 |
| `no-clash` | Nothing interferes | `run` fits | `fits` `clash` eq 0 |
| `no-contact` | The leaves never touch | `run` fits | `fits` `contact` between `leaf_a` and `leaf_b` eq 0 |
| `gaps` | Every gap between the leaves is 0.3 to 0.45 mm | `run` fits | `fits` `clearance` between `leaf_a` and `leaf_b`, `distance` 0.3 to 0.45, eq 1 pair |
| `length` | 50 mm along the axis | `run` header size | `measure` `size_max` 49.99 to 50.01 |
| `across` | 44 mm across, laid flat | `run` header size | `measure` `size_mid` 43.99 to 44.01 |
| `height` | No taller than 8 mm | `run` header size | `measure` `size_z` at most 8 |
| `on-bed` | Both leaves sit on the bed: the lowest point of each is at Z = 0 | `inspect --fields measure --json`, `bbox.min` | `measure` `min_z` of `leaf_a` and of `leaf_b`, each -0.01 to 0.01 |
| `open-90` | At Open angle 90, still no clash, no contact, and every gap 0.3 to 0.45 mm | `run --param "Open angle=90"` fits | the same three `fits` assertions in a second pose (see below) |
| `print` | Both leaves pass `fdm.v1` with +Z up: watertight, 0.8 mm wall, 45 degree overhang, the bed | `inspect --fields gates`, and `gates` in the export's evidence file | none yet (see below) |
| `five-knuckles` | Five knuckles, alternating, three on Leaf A; the leaves cannot come apart | the drawing, by eye | none: a person checks it |

**Waivers.** An agent may waive a `min_wall` or `overhang` failure with a written reason ([GETTING-STARTED.md](../../docs/GETTING-STARTED.md#see-it-and-export-it)). For this brief, a waived failure counts as a pass of `print` only if the post lists each waiver and its reason, so readers can judge it. `watertight` and `bed` cannot be waived by an agent.

**Why the gap range is 0.3 to 0.45 mm.** The fit check reports gaps up to 0.5 mm only ([bench/README.md](../../bench/README.md#assertions)). Keeping the range under 0.5 mm means every gap the brief asks for is reported and checked. A gap that is too wide is not reported at all, which is why `no-contact` and the drawing check stay in the list: a hinge whose knuckles sit 2 mm apart passes `gaps` but is a poor hinge.

## Collect the evidence

From your run folder, after the agent finishes (use `node /path/to/Open3DJ/packages/open3dj/src/cli.ts` in place of `open3dj` if you work from a clone):

```sh
open3dj run solution.o3j --detailed                                   # status, parts, size, fits
open3dj run solution.o3j --param "Open angle=90" --no-save-params     # fits at 90 degrees
open3dj inspect solution.o3j --fields measure --json                  # bbox.min of each leaf for on-bed
open3dj inspect solution.o3j --fields gates                           # the print checks
open3dj render solution.o3j --out hinge.png                           # the drawing
open3dj export solution.o3j --format 3mf                              # the file to print, with its evidence
```

If you print it: say whether it came off the bed in one piece, whether it moved without force, and the printer, slicer, material and layer height. A photo is welcome.

## Becoming a capability task

What `cap-print-in-place-hinge` would need, beyond a reference solution, a seeded mutant (for example knuckles that touch) and a passing task-lint:

- **The second pose.** A task grades one set of parameter values, and a project's saved values win over the task's (`solutionOf` in [bench/lib.ts](../../bench/lib.ts)). So `open-90` needs a grader change, a code change in the maintainer lane, or it stays a manual check.
- **The print checks.** No bench assertion reads the `fdm.v1` gates yet ([bench/README.md](../../bench/README.md#not-yet)). A `gates` assertion kind would be a schema and grader change, in the maintainer lane.
- **The task count.** `scripts/bench.test.ts` asserts exactly 10 capability tasks today, so adding one changes that test too.
- **Pattern names.** Use `leaf_a` and `leaf_b` as the assertion patterns, as `reg-hinge` does.
