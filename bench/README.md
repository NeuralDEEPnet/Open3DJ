# o3dj-bench

o3dj-bench measures how well Open3DJ and the agents that drive it do real CAD work. Every task is an assembly brief with executable assertions, a reference solution that passes them, and a seeded mutant that must fail them. The design is in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) sections 2 (contract C7) and 16, and the way results feed the Friday scorecard is in [docs/PLAN.md](../docs/PLAN.md) section 4.3.

## Two suites

| Suite | What runs | Who runs it | Target |
|---|---|---|---|
| Regression split (`reg-*`) | The reference solution and the mutant of each task, replayed deterministically. No LLM in the loop. | `npm run check` on every pull request: task-lint inside `npm test` (through `scripts/bench.test.ts`), then `node bench/run-regression.ts --repeat 3` | 100%, always. A failure is a red andon ([PLAN.md](../docs/PLAN.md) section 4.4). |
| Capability split (`cap-*`) | An agent gets only the brief, builds the design over MCP, and the grader checks its result. Each task runs 3 times. | An operator, weekly, by hand ([run-capability.md](run-capability.md)) | A target, never a 100% rule. Reported as pass^3. |

**pass^3** is the share of tasks that pass in all 3 independent runs. A task that passes 2 runs out of 3 counts as a failure for pass^3, because a user who asks three times should get a good design three times. pass@1 (the share of single runs that pass) is reported next to it. With fewer than 30 tasks, a change of 2 or more tasks across 3 runs is a real gap; one task is noise ([PLAN.md](../docs/PLAN.md) section 4.4, yellow andon).

Today the regression split has 12 tasks: 9 built from [examples/](../examples/README.md) (one with a non-default parameter) and 3 new parts (a bolted plate stack, a pegboard hook and a gear blank). The capability split has 10 multi-part enclosure briefs. All tasks are original, written for Open3DJ by neuraldeep.net design agents, and MIT licensed. PLAN.md planned the regression split around the 18 public 3dj starters; those are closed, so the split uses our own parts instead.

## A task

A task is a folder `bench/tasks/<id>/`:

| File | Holds |
|---|---|
| `task.json` | The task, under the C7 schema [packages/schemas/json/bench-task.schema.json](../packages/schemas/json/bench-task.schema.json): `id`, `version` (an integer, starting at 1; bump it whenever the brief or an assertion changes), `split`, `title` (a short name, 3 to 80 characters), `brief`, `params`, `assertions`, `reference`, `mutant`, `mutant_defect`, `mutant_fails`, optional `more_mutants` (further mutants, each with a `file`, a `defect` and the assertion ids it `fails`), `tags`, `source`, `licence`, `authors` |
| `reference.o3j.js` | A DSL script that passes every assertion |
| `mutant.o3j.js` | The reference with one realistic defect, marked with a `MUTANT` comment |

The brief is written as a client would write it. In capability tasks it names the parts (for example "name the parts Base, Lid and PCB"), because the assertions find parts by name.

### Assertions

Assertions run on the detailed GeometryReport and the assembly's occurrence tree. Patterns are case-insensitive globs where `*` matches anything: `screw*` matches `screw#1` to `screw#4`. Numbers compare with `expect`: `{ "eq": 41308.93, "tol": { "rel": 1e-6 } }`, or a range `{ "min": 140, "max": 160 }`. A tolerance widens `eq`, `min` and `max` by `max(abs, rel x |value|)`.

| Kind | Checks | Example |
|---|---|---|
| `status` | The report status is one of a list | `{ "kind": "status", "in": ["ok"] }` |
| `valid` | Every matching definition is a valid solid | `{ "kind": "valid" }` |
| `measure` | Volume, area, mass, bounding-box size or corner of the assembly or of matching definitions (volume, area and mass count every occurrence). `size_max`, `size_mid` and `size_min` are the box's extents sorted from largest to smallest | `{ "kind": "measure", "quantity": "size_max", "target": "pcb", "expect": { "min": 84.99, "max": 85.01 } }` |
| `count` | Occurrences, definitions, or solids, faces and edges of matching definitions | `{ "kind": "count", "quantity": "faces", "target": "lid", "expect": { "min": 20 } }` |
| `fits` | The number of clash, contact or clearance results between two patterns, optionally with every distance in a range; or, with `gap`, the number of clearance lines in a range | `{ "kind": "fits", "fit": "clearance", "a": "panel", "b": "cap*", "gap": { "min": 0.2, "max": 0.3 }, "expect": { "eq": 3 } }` |
| `occurrences` | The number of occurrences whose path matches a name (and a definition) | `{ "kind": "occurrences", "name": "standoff*", "expect": { "eq": 4 } }` |
| `same_definition` | Two or more matching occurrences share one definition (clones) | `{ "kind": "same_definition", "name": "screw*" }` |

The fit check reports one result per pair of occurrences, at their smallest distance, and only within the 0.5 mm watch distance. It also lists further gaps of a pair as lines marked `extra`. A fit assertion counts pairs by their closest relation and skips extra lines in the count, so a count still means pairs. Its `distance` range applies to every gap of the counted pairs, extra lines included: a plunger that clears its hole by 0.45 mm fails "0.2 to 0.3 mm" even when its flange gap of 0.3 mm is the pair's smallest. So a fit assertion can say "these parts touch", "every gap between these is 0.2 to 0.3 mm" or "nothing is within 0.5 mm of the board", but not "at least 2 mm apart". Gaps above 0.5 mm are not reported, so they are not checked.

With `gap` (and `fit: "clearance"`, without `distance`), the assertion counts the clearance lines of the matching pairs whose distance is in the range, extra lines included, instead of counting pairs. Use it when a brief sets the size of one gap of a pair: a flange 0.35 to 0.45 mm behind a panel next to a plunger gap of 0.2 to 0.3 mm, or the lip gap of a mated lid, whose seat contact is not listed. Give each gap its own range in the brief, and keep the ranges apart, so a missing gap (too wide to be reported, or closed to a contact) fails the count. A bound on every line through `distance` is not monotonic for a second gap: 0.4 mm fails it while 0.6 mm, too wide to be reported, passes.

A brief fixes that Z is up, not which horizontal axis is the length. Assert lengths and widths with `size_max`, `size_mid` and `size_min` (or with `size_z` for a height), not `size_x` and `size_y`; task-lint checks it by turning each capability reference 90 degrees about Z.

### task-lint

`node bench/lint.ts` checks every task:

1. `task.json` matches the C7 schema, its `id` equals the folder name and starts with `reg-` or `cap-`, and both scripts exist and differ.
2. Assertion ids are unique, every id in `mutant_fails` exists, every task has a `status` and a `valid` assertion, a regression task has at least one `measure` with `eq` (so a drift in the numbers fails it), and a capability task asserts its occurrences.
3. The reference runs on the real compute pool and passes every assertion. Patterns that match no occurrence are reported, because they are almost always typos.
4. The mutant runs (a script error is not a seeded defect) and fails at least one assertion, including every id in `mutant_fails`. Each of `more_mutants` runs and fails every id in its `fails`.
5. A capability reference turned 90 degrees about Z still passes every assertion, so grading does not depend on which horizontal axis a design runs along. A `gap` assertion has `fit: "clearance"` and no `distance`.

```sh
node bench/lint.ts                 # all 22 tasks on the compute pool (about 10 s on 4 cores)
node bench/lint.ts cap-pi5-case    # one task
node bench/lint.ts --cli           # through the real CLI, one fresh process per script
node bench/lint.ts --static        # schema and layout only, no kernel
```

## Commands

```sh
node bench/run-regression.ts               # the regression split: a table, exit 1 on any failure
node bench/run-regression.ts --repeat 3    # also replay each reference 3 times; the measures must not change
node bench/grade.ts cap-pi5-case my.o3j.js # grade any script (or project folder) against a task
node bench/grade.ts --runs <folder>        # grade a capability run folder and compute pass^3
```

Measured on 2026-10-28 on a shared Linux container with 4 vCPUs, Node 24.22.1: `node bench/lint.ts` takes 9.5 s for all 22 tasks, `node bench/run-regression.ts --repeat 3` 12.7 s with identical replays, and `scripts/bench.test.ts` 14.5 s.

## Adding a task

1. Open a [bench task proposal](../.github/ISSUE_TEMPLATE/bench_task.yml) or pick up a failure report: every failure that a brief can reproduce should become a task ([PLAN.md](../docs/PLAN.md) section 4.5).
2. Write `reference.o3j.js` and check it with `npx open3dj run` and `npx open3dj render`.
3. Write `task.json`. For regression tasks, take the numbers from a detailed run (`npx open3dj run reference.o3j.js --detailed --json`) and use `rel` 1e-6, or 1e-4 when the part has fillets or lofts. For capability tasks, use ranges that any good solution meets, not the reference's exact numbers.
4. Copy the reference to `mutant.o3j.js` and seed one realistic defect: a part that clashes, a missing part, a size over a limit, a clearance that is too tight. List the assertions that catch it in `mutant_fails`.
5. Run `node bench/lint.ts <id>` until it passes, and paste its output into the pull request.

Tolerances in existing tasks are protected by a Claude Code hook ([AGENTS.md](../AGENTS.md#claude-code-hooks)). Loosening one needs the operator's acknowledgement and a reason in the pull request.

## Not yet

- A held-out split that runs only in maintainer CI ([ARCHITECTURE.md](../docs/ARCHITECTURE.md) section 16). Every task here is public.
- Tokens and tool calls per task are recorded by hand in capability runs; there is no automatic capture.
- Gates (minimum wall, overhang) arrive in S3. Until then, briefs cannot assert printability.
