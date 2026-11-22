# RFC 0003: Transport design track

- **Status:** draft
- **Issue:** #84 (labeled `rfc`)
- **Author:** the maintainer's operator account, with neuraldeep.net design agents
- **Started:** 2026-11-22
- **Final comment period:** not started

## Problem

The founder asked on 22 Nov 2026 for Open3DJ to be "very industrial design orientated, also automotive, which I mean transport design in general". The surfacing core (#78) gives agents the shapes a vehicle needs:
- sweeps along 3D curves, for tubes, rails and springs;
- lofts through station sections placed along X;
- grid surfaces, fills, sewing and panels.

Nothing yet checks a vehicle as a vehicle:

- **Package.** There are no wheels, ground or axles, so there is no wheelbase, overhang, ground clearance or approach angle to read.
- **Wheel envelopes.** A tyre sweeps through its wheelhouse over steering lock and suspension travel. A body that fits at rest can hit at full lock and full bump. No check sees that.
- **Gap and flush.** Panel joints are judged by their gap (across the joint) and flush (the step between the surfaces). No report measures them.

Studios check these by hand in their surfacing tools, or late in engineering packages. Agents cannot check them at all, and an agent that cannot read a number cannot fix it.

Open3DJ already has the parts to build on:
- **The exact clash, contact and clearance table** between occurrences (ARCHITECTURE.md section 9, `inspect fields=[fits]`).
- **Connectors and `matchTo`**, which seat a wheel on a hub frame.
- **The sweep overlap guard** (#81), which already measures a profile's reach against a path.
- **The corner-first parameter sweep** proposed in RFC 0002 (#71, draft), which runs a part at the corners of its ranges.

## Proposal

Everything below lives in the existing five tools. It adds DSL entries under `lib.vehicle` and three `inspect` fields, and no new dependency. Every number is labelled a design check, not a certification or homologation result.

### 1. The vehicle frame

Vehicle scripts use the axis directions of ISO 8855 (vehicle dynamics vocabulary): **X forward, Y left, Z up**. Several independent sources agree on these directions (sources 3 and 4). They also match Open3DJ's Z-up world.

The origin:
- **Z = 0** is the ground the vehicle stands on.
- **Y = 0** is the vehicle's centre plane, the Y0 plane that designers mirror about.
- **X = 0** is the front axle centre line, so the rear axle sits at X = -wheelbase.

ISO 4130 defines the reference planes and fiducial marks that manufacturers record dimensions against (source 2). It is cited by number only. Its axis directions were not checked here, and many studios measure body X rearward from the front axle. Decision 1 asks which way Open3DJ points X.

### 2. `lib.vehicle.package`

```js
const pkg = lib.vehicle.package({
  axles: [
    { x: 0, track: 1560, tire: { diameter: 680, width: 225 }, steer: 35 },   // steer: the outer wheel's lock, degrees
    { x: -2700, track: 1570, tire: { diameter: 680, width: 225 } },
  ],
  travel: { bump: 80, rebound: 70 },                                        // mm at the wheel centre
});
// pkg.parts: the ground plane and one wheel occurrence per tyre (track 0: one centre wheel)
// pkg.refs: axle and hub frames, the Y0 plane, as named references and connectors
return [...pkg.parts, body];
```

- **Axles.** An axle with `track: 0` has one wheel on the centre line, for bicycles, scooters and motorcycles. Three or more axles cover trucks and buses.
- **Wheels.** A wheel is a schematic tyre (a torus with flat sidewalls, at the declared diameter and width) placed at its hub. It is reference geometry: it appears in the report and the viewer, and it is excluded from mass and from the bill of materials.
- **Tyre radius.** The static loaded radius defaults to half the tyre diameter, labelled "assumed". A `loadedRadius` overrides it. Decision 2.

### 3. `inspect fields=[package]`

The report, for a run whose assembly holds a vehicle package:

| Field | What it is |
|---|---|
| `length`, `width`, `height` | The body's overall extents, with the wheels included in width |
| `wheelbase`, `tracks` | From the axles |
| `overhang.front`, `overhang.rear` | From the front axle forward, and from the rear axle back, to the body's extremes |
| `runningClearance` | The distance from the ground to the lowest point of the body, unsprung parts excluded (49 CFR 523.2) |
| `approachAngle`, `departureAngle`, `breakoverAngle` | As defined in 49 CFR 523.2 (source 1), in the side view, from each tyre's static loaded radius arc to the body's underside |
| `turningCircle` | An estimate: diameter 2 L / sin(delta) at the outer front tyre's centre plane, from wheelbase L and the outer wheel's lock delta, labelled "estimate, geometric Ackermann, no slip or scrub" |

How each angle is computed:
- **Approach angle:** the smallest angle to the ground of a line tangent to the front tyre's arc that touches the underside ahead of the tyre.
- **Departure angle:** the same at the rear.
- **Breakover angle:** the supplement of the largest angle formed by two lines tangent to the front and rear arcs, which meet on the underside between them.

The side-view underside is sampled on the CPU kernel, with sections at X stations. The sampling step is reported with each angle, and a feature narrower than one step can be missed. The tests use bodies whose angles have exact answers (section "How we will know it worked").

### 4. `inspect fields=[envelopes]`

For each steered wheel, the tyre is placed at a grid of poses:
- steer from -lock to +lock in steps of at most 5 degrees;
- travel at -rebound, 0 and +bump.

The poses are fused into one envelope solid. The existing exact clearance table then gives the minimum clearance from the envelope to the body, where it occurs, and at which pose. A `minClearance` parameter, for example 10 mm, turns that into a pass or a fail.

The grid is not corners alone. The certified-envelopes experiment (`rfcs/experiments/2026-11-09-certified-envelopes.md`) found a thinnest wall inside a range that its corners missed (the vented box at Width 66.4). Once RFC 0002 is accepted, its sweep machinery runs the poses.

The model is a stated simplification: steer about a vertical axis through the wheel centre, and vertical travel. Suspension geometry (kingpin inclination, caster, camber gain) waits for the S6 joints and the S11 loop solver. The envelope says so in its label.

### 5. `inspect fields=[gapflush] pairs=[[a, b]]`

For two panel occurrences, a station is placed every `step` mm (default 50) along the edges of `a` that lie within 10 mm of `b`. At each station:
- the nearest point on `b` gives a vector;
- **flush** is that vector's component along `a`'s surface normal;
- **gap** is its component across the joint in `a`'s tangent plane.

The report gives each station and the minimum, maximum and mean, judged against declared targets, for example gap 3.5 +- 0.5 mm and flush 0 +- 0.5 mm.

### 6. What stays the same

- No sixth tool.
- The GeometryReport is unchanged; the new fields are `inspect` results with their own JSON schemas in `packages/schemas`.
- Scripts without a vehicle package see no difference.

## Security and privacy

No data leaves the machine and no new input is trusted. The new entries take numbers from the script, which already runs in the sandbox. The threat table in ARCHITECTURE.md section 12 does not change.

## Dependencies and licenses

None. The code is Open3DJ's own (MIT today), and it runs on occt-wasm (already a dependency).

On sources:
- **SAE and ISO standards** are cited by number only, and nothing is copied from them.
- **49 CFR 523.2** is a United States federal regulation; its definitions are paraphrased here with a link.
- **ANSUR II occupant data** is not part of this RFC. The public measurement files were released in 2017 under a government distribution statement ("approved for public release; distribution unlimited"), and the 3D scans are not public (source 5). Its reuse terms need a check before an occupant package is proposed.

## Alternatives

- **Do nothing.** Designers keep checking packages by hand in studio and engineering tools, and agents stay blind to them.
- **A separate vehicle tool beside the CAD.** Its numbers would not come from the same geometry and the same evidence file, and the agent loop (run, read the number, fix the script) would break in two.
- **Full suspension kinematics now.** The right model, but it needs joints (S6) and a loop solver (S11). The simplified envelope gives a useful, honestly labelled number today.
- **Only the angles, no envelopes.** The angles are the easy part. The wheelhouse is where a body that looks right fails.

## Risks and open questions

1. **Frame direction (decision 1).** The proposal is ISO 8855: X forward, Y left, Z up. The alternative is the studio habit of body X rearward from the front axle. Changing the frame later would break every vehicle script, so it is decided before C1.
2. **Default tyre radius (decision 2).** Half the tyre diameter, labelled "assumed", or a required `loadedRadius`?
3. **Scope of vehicle types (decision 3).** Cars, vans, trucks and buses (any number of axles) and bicycles, scooters and motorcycles (track 0) are in. Rail, marine and aircraft are out.
4. **Sampling.** The angles and the underside depend on the station step. Each result reports its step, and the tests check that a feature on a station is found and that the step is honoured.
5. **Envelope cost.** Fusing 3 x 15 poses per wheel is about 45 booleans. This is measured in C2 against the 2 s interactive budget; heavy cases go to the batch lane.
6. **Gap and flush on strongly curved joints.** The local frame comes from panel `a`'s face. Seeded cases include a curved joint before the field ships.
7. **Mislabelled numbers.** These are design checks. Regulations and type approval use their own procedures and loads, and the report must never call a number compliant.

## How we will know it worked

- **C1, package:** a box body on four wheels, whose angles, overhangs and clearance have closed-form answers, matches them within 1e-6 (angles in degrees, lengths in mm). Bodies with a sloped nose and a step between the axles test that the tangent point is found.
- **C2, envelopes:** a seeded wheelhouse corpus, with one case clearing by 25 mm at full lock and bump and one hitting by 5 mm. Every verdict is right, with zero false passes.
- **C3, gap and flush:** seeded panel pairs with known gaps and steps, flat and curved, read within 0.01 mm.
- **A person checks it:** the founder or a volunteer transport designer checks two generic packages by hand and records the result in the build log.
- **Kaizen metric:** the share of seeded package faults the report names. The target is 100%, with zero false passes.

## Plan

Each pull request is about 400 changed lines, tests first:

1. **C1:** `lib.vehicle.package`, the vehicle frame and `inspect fields=[package]`, with the closed-form test bodies.
2. **C2:** `inspect fields=[envelopes]` and the seeded wheelhouse corpus in `corpora/`.
3. **C3:** `inspect fields=[gapflush]` and its seeded panel pairs.
4. **C4:** three examples, in the operator's goldens session: a generic car package with a lofted body, a bicycle frame from swept tubes, and a scooter deck. Each gets a range test.
5. **Docs:** a "Transport design" section in docs/INDUSTRIAL-DESIGN.md, the track in docs/PLAN.md and ROADMAP.md, and SKILL.md notes, each in the pull request whose behaviour it describes.

## Sources

All checked on 22 Nov 2026.

1. **49 CFR 523.2, definitions** (approach angle, breakover angle, departure angle, running clearance, axle clearance, static loaded radius arc), read at [law.cornell.edu/cfr/text/49/523.2](https://www.law.cornell.edu/cfr/text/49/523.2). That page lists amendments up to 89 FR 52945 (24 June 2024). The eCFR page redirected the fetch, so the current text is to verify against [ecfr.gov](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-523/section-523.2). The 2005 revision of SAE J1100 aligned its angle definitions with this regulation ([SAE J1100_200509](https://saemobilus.sae.org/content/J1100_200509/)), and SAE J689, the older guideline, was cancelled in August 2009 ([SAE J689_200908](https://www.sae.org/standards/content/J689_200908/)).
2. **ISO 4130:1978**, *Road vehicles: three-dimensional reference system and fiducial marks: definitions*, last reviewed and confirmed in 2025 ([iso.org](https://www.iso.org/standard/9886.html)). Its axis directions are not verified here.
3. **ISO 8855:2011**, *Road vehicles: vehicle dynamics and road-holding ability: vocabulary*: X forward, Y left, Z up, right-handed. From the catalogue excerpt ([iteh](https://standards.iteh.ai/catalog/standards/iso/42f554c2-7f3c-4970-adc6-8153efa1bf1a/iso-8855-2011)), not the full text.
4. **Secondary confirmation of the ISO 8855 axes:** [MathWorks, coordinate systems in Automated Driving Toolbox](https://www.mathworks.com/help/driving/ug/coordinate-systems-for-3d-simulation-in-automated-driving-toolbox.html) and [OxTS, navigation frame](https://support.oxts.com/hc/en-us/articles/115002859149).
5. **ANSUR II:** the public measurement files ([Penn State OpenLab](https://www.openlab.psu.edu/ansur2/)), their 2017 release ([army.mil](https://www.army.mil/article/188601/for_good_measure_natick_releases_raw_data_from_army_wide_anthropometric_survey)), and the note that the 3D scans are not public ([Defense Health Agency](https://ph.health.mil/topics/workplacehealth/ergo/Pages/Anthropometric-Database.aspx)).

## Decision

To be filled in at the end of the final comment period.
