# @open3dj/dsl

DSL v1 (contract C2): a 3dj-compatible modelling surface for scripts, on the kernel adapter and brepjs 20.11.1, exposed to the sandbox. Ported from the DSL spike in `docs/research/spikes/dsl-brepjs/`.

## Use (inside the worker that owns the kernel)

```ts
const dsl = createDsl(kernel);                 // once per worker
const mark = kernel.checkpoint();
dsl.reset(params);                             // per run
const r = await runScript(source, { hostApi: dsl.hostApi, params, limits });
if (r.ok) { const out = dsl.collect(r.value); /* parts, mates, params, paramSpecs, warnings */ }
kernel.releaseSince(mark);                     // after measuring and exporting the parts
dsl.dispose();                                 // only before disposing a short-lived kernel
```

`dispose()` revokes the DSL's brepjs registration. brepjs 20.11.1 never frees its shape handles, and each one keeps the registered adapter, so without it a disposed kernel (such as the fresh instance a STEP export runs on) stays in memory. Register another DSL with `reset()` before the next run.

`DSL_ENTRIES` lists every entry with its signature and the plan step that ships it.

## How it works

- The guest sees small integer ids. The host table maps them to kernel handles plus metadata: name, colour, named references, connectors, clone lineage and body identity.
- Booleans, fillet, chamfer, shell, extrude, revolve and loft run through the kernel adapter, which checks validity after each. Twisted and tapered extrusions use brepjs sweeps and are checked the same way.
- Kernel failures reach the script as errors with code `KERNEL_<code>`, the faulty elements (`edge:3`, `face:2`) and a hint. Uncaught, they become the run's `ScriptError` at the user's line.
- Entries that are not in S1 throw `DSL_NOT_IMPLEMENTED` with the entry name.

## Semantics we chose (3dj publishes none)

- Edge queries: `atX`, `atY`, `atZ` mean the whole edge lies at that coordinate within 1e-3 mm. `parallel` means a straight edge along the direction. `perpendicular` means the edge lies in a plane normal to the direction. `minLength` and `maxLength` use curve length, not bounding-box extent.
- `sketch.mirror([nx, ny])` takes the normal of the mirror line through the origin, like the 3D `mirror`. The spike used it as the direction, which gave silently wrong geometry.
- `path().arcTo(x, y, r)`: a positive radius bulges to the left of the direction of travel, a negative one to the right. The arc is always the shorter one.
- `shell(t)` keeps the outer skin and puts the wall inside. OCCT's thick-solid can return a shape that is valid but wrong (unchanged, or with walls of the wrong thickness, measured after fillets thinner than the wall). Every shell result is checked: each face must lie on the kept skin, in a removed face, or at distance `t` from the skin. A failure becomes `KERNEL_INVALID_RESULT` with the shell hint. For a straight extrusion, the DSL then cuts the cavity from the profile offset instead and adds a warning.
- `clone()` then rigid moves keep a clone lineage. Returned parts that share one get `cloneOf` and `cloneTransform`, so the assembly can share one definition.
- `matchTo` records a fastened mate (`flip: true`) between the returned parts that carry the two bodies. If either part is not returned exactly once, the mate is dropped with a warning.
- `ScriptPart.line` is the line of the call that made the returned shape.
- `.edges(query)` lists the edges a query matches. It is an Open3DJ extension for debugging queries.

## lib.*

`lib.fastener` covers M2 to M8. Dimensions come from the public tables of ISO 273 (clearance holes), ISO 4762 (socket head cap screws), ISO 10642 (countersunk socket screws, M3 and up), ISO 4032 (hexagon nuts) and ISO 7089 (washers). M2 and M2.5 countersunk heads use ISO 7046-1 values, because ISO 10642 starts at M3. Heat-set insert pockets have no standard; the sizes are typical values carried over from the spike and must be checked against the insert in use. Implemented: `clearanceHole`, `screwCutter`, `heatSetPocket`, `hexNutPocket`, `bolt`, `nut`, `washer`. Hardware is schematic, with no modelled threads.

## Tests

- `conformance.test.ts`: the spike's 47 checks against analytic values, each run through the sandbox.
- `script.test.ts`: mirror normals, error lines and hints, shell checks and fallback, params, return forms, path(), clones, limits, poisoning and memory.
- `lib.test.ts`: fastener data and analytic volumes of every lib shape.
- `assembly-script.test.ts`: multi-part scripts with connectors and `matchTo`.
