# Gap 2: How big is the job of porting "Open3DJ DSL v1"? (replicad API surface, OC leakage, brepjs kernel layer)

Measured 2026-10-27 against replicad **v1.2.0** (npm, published 2026-10-23), brepjs **v20.11.0**, occt-wasm **5.8.1** (main @ 5c05b8d). Method: I cloned each repo, ran `npm pack` on each package, and walked the shipped `.d.ts` files with the TypeScript compiler API. Source-level counts come from grep over `packages/replicad/src`.

## 1. replicad's surface (v1.2.0)

| Metric | Count | Source |
|---|---|---|
| Exported symbols, root entry (`dist/replicad.d.ts`) | **224** (243 declarations): 53 function declarations, 72 const arrow functions, 43–46 classes, 22–26 interfaces, 29–40 type aliases | [`src/index.ts`](https://github.com/sgenoud/replicad/blob/v1.2.0/packages/replicad/src/index.ts) |
| Non-private class members | 365 methods, 91 accessors, 30 props, 26 ctors (**≈600 callables** including the free functions) | same d.ts |
| Second entry point `replicad/shape-functions` | 78 exports; the docs say they operate "directly on OpenCascade topological shapes (`TopoDS_*`)" | [`shapeFunctions/index.ts`](https://github.com/sgenoud/replicad/blob/v1.2.0/packages/replicad/src/shapeFunctions/index.ts) |
| Library size | 83 TS files, **14,312 LOC** | repo |

The library is low five figures, not five to six figures.

**OpenCascade.js leakage in the public API.** `replicad.d.ts` imports 33 OCJS types. **48 public symbols** name an OCJS type in their signature: 12 accept one (`downcast`, `translate/rotate/mirror/scale(TopoDS_Shape)`, `Transformation`/`BoundingBox`/`Curve2D` constructors), and 41 return or expose one (`getOC`, `setOC`, `makeAx1/2/3`, `makePln`, `Vector.toPnt/toDir`, `TopologyMap`, `GenericSweepConfig.support/law`, `Plane.oc`). Structurally, **22 classes are generic over OCJS types** and **28 classes extend `WrappingObj`**. Through that base class every `Shape`, `Curve2D`, `Vector`, `Transformation` and `BoundingBox` exposes `.wrapped`, the raw OCJS object, plus `.delete()` ([`register.ts`](https://github.com/sgenoud/replicad/blob/v1.2.0/packages/replicad/src/register.ts)). The `Point` type even accepts any `{XYZ(): gp_XYZ}`.

**Internal coupling.** There are **134 `getOC()` calls in 30 of 83 files** ([`oclib.ts`](https://github.com/sgenoud/replicad/blob/v1.2.0/packages/replicad/src/oclib.ts)). The heaviest are `shapeHelpers.ts` (25), `curves.ts` (15), `Curve2D.ts` (9) and `geom.ts` (8). The code also has 25 `this.oc` uses, 221 `new oc.X(...)` constructions over 112 distinct OCCT classes, and 150 distinct `oc.*` names. The files that call OCCT directly hold **≈7.7k LOC**. Another ≈5.9k LOC (blueprints/2D booleans, `draw.ts`, `sketcherlib.ts`, finders, sketches) never calls OCCT directly; it reaches OCCT only through the wrappers. The 2D engine itself (`Curve2D`, intersections, offsets) is built on OCCT `Geom2d_*`, not pure TS. The custom WASM build binds **248 OCCT symbols** plus 6 hand-written C++ extractors ([`custom_build_single.yml`](https://github.com/sgenoud/replicad/blob/v1.2.0/packages/replicad-opencascadejs/build-config/custom_build_single.yml)).

**Kernel version.** Since v1.0.0 (2026-08-14) replicad runs on **OCCT 8.0.1** through taucad's opencascade.js canary images. An OCCT 7 module is explicitly incompatible ([`docs/occt-v8-migration.md`](https://github.com/sgenoud/replicad/blob/v1.2.0/docs/occt-v8-migration.md)). The brief says 3dj.app runs OCJS 7.7.2, so it is on a different, older kernel than current replicad. That changes what "bit-compatible with 3dj" can even mean.

**What it implies.** You cannot put a QuickJS membrane under *unmodified* replicad. `setOC()` would need an object that mimics the embind classes, overloads, `Handle` unwrapping and `.delete()` for about 150–250 OCCT classes. In other words, you would be re-implementing opencascade.js's binding generator for QuickJS. Rewriting replicad's OCCT-touching half (~8k LOC) on opaque handles is feasible, but it is a fork you then have to maintain.

## 2. The real compatibility target is smaller than replicad

3dj publishes its DSL as a machine-readable `dslReference` string through the **public** MCP tool `cad_get_starters`, alongside 18 starters (fetched 2026-10-27). It is **not replicad's API**. It is a custom facade:

- `box(w,d,h)` centred on XY and Z-up, and `cylinder(h,r,rTop)`
- `.add/.subtract`
- `fillet(shape,r,{atZ,parallel,…})`
- `Param.*`, `lib.*` (13 documented helpers)
- `withReferences/attachTo/onFace/hole/cutout`
- `connector.male/female` with `matchTo`, and `tolerance/minWall`

By my count it has **about 150 documented entry points**. The starters also use calls the reference does not list: `.color()`, `.name()`, `lib.bolt/nut/washer` and `.cutPlane("XY", z, "negative")`. That last one matches replicad 1.1.0's `cutPlane(plane, offset, keep)` exactly (added 2026-09-04, [commit a0bc495](https://github.com/sgenoud/replicad/commit/a0bc495)). This suggests the DSL objects are replicad shapes that also expose the raw replicad method surface. The reference is a one-page cheat sheet, not a specification. For example, it does not define edge-query tolerance, connector frames, or failure behaviour. `cad_validate_script` is static only: it passed a script that calls `getOC()` and `makeBaseBox`.

## 3. brepjs does have a pluggable-kernel interface a native OCCT backend could implement

- `KernelAdapter` is the intersection of 15 sub-interfaces plus `Kernel2DCapability` ([`src/kernel/interfaces/index.ts`](https://github.com/andymai/brepjs/blob/main/src/kernel/interfaces/index.ts)). I count **280 members (217 3D + 63 2D), 15 optional, 0 returning `Promise`**, so the contract is fully synchronous. The docs' "~164 methods" figure is stale ([`docs/kernel-swap.md`](https://github.com/andymai/brepjs/blob/main/docs/kernel-swap.md)).
- Shapes are opaque: `KernelShape = any` ([`src/kernel/types.ts`](https://github.com/andymai/brepjs/blob/main/src/kernel/types.ts)). Layer 2+ code only passes handles to `getKernel().method()`. An ESLint rule bans `.wrapped.method()` and `.oc` access outside `kernel/`/`core/` ([`eslint.config.js`](https://github.com/andymai/brepjs/blob/main/eslint.config.js)). I found **0** `.oc` uses outside `src/kernel` and 352 `getKernel()` call sites.
- **Four adapters already exist**: occt-wasm (default), OCJS (legacy), brepkit (Rust) and Manifold. Each is 7.5–9.3k LOC, and they come with an auto-generated cross-kernel conformance matrix ([`docs/kernel-conformance.md`](https://github.com/andymai/brepjs/blob/main/docs/kernel-conformance.md), [`src/kernel/README.md`](https://github.com/andymai/brepjs/blob/main/src/kernel/README.md), [brepjs.dev/concepts/kernels](https://brepjs.dev/concepts/kernels)).
- **The occt-wasm facade is already the "native OCCT + opaque handles" design.** It is OCCT **V8.0.1** with u32 arena handles and synchronous calls ([README](https://github.com/andymai/occt-wasm)). Its C++ facade has **230 distinct bound functions** across ≈6.1k LOC ([`facade/include/occt_kernel.h`](https://github.com/andymai/occt-wasm/blob/main/facade/include/occt_kernel.h), `facade/src/kernel.cpp`, `facade/generated/kernel.cpp`). Only `generated/bindings.cpp` includes Emscripten; the rest is plain C++ on OCCT. Compiling that facade natively and binding its 230 primitive/handle-typed functions into QuickJS would let brepjs's existing `OcctWasmAdapter` (8.7k LOC) be reused nearly unchanged.
- **Caveats.**
  - brepjs is **Apache-2.0** (needs a NOTICE file; compatible with MIT).
  - It is a one-maintainer, mostly AI-assisted project ([AI-DISCLOSURE.md](https://github.com/andymai/brepjs/blob/main/AI-DISCLOSURE.md)) with 515 npm versions and majors v9→v20 during 2026.
  - Its public API is huge (954 root exports) and not replicad-compatible: it is functional, uses `Result` types, and reverses the fillet argument order ([migration guide](https://brepjs.dev/migration/replicad)).
  - occt-wasm builds against a patched OCCT fork, and its compiled output is LGPL-2.1.
  - `brepkit-wasm` is **AGPL-3.0-only** ([npm](https://www.npmjs.com/package/brepkit-wasm)), so do not bundle it.

## Effort read-out

| Path | New work | Risk |
|---|---|---|
| A. Unmodified replicad over a QuickJS→native OCJS shim | A binding generator for ~250 OCCT classes | Very high |
| B. Fork replicad onto opaque handles | ~8k LOC rewrite, plus a native 2D curve layer | High (maintaining a fork) |
| C. **Own the ~150-entry 3dj DSL on top of a brepjs-style `KernelAdapter`**, backed by a natively compiled occt-wasm facade (WASM occt-wasm as the browser/fallback backend) | DSL ≈150 entries + `lib.*` content; port 230 C++ functions to N-API/QuickJS bindings; vendor and pin the adapter | Medium |

Path C fits the 28-week plan best. A week-12 Agent Preview could run on the WASM occt-wasm backend while the native build lands.

Sources: repos and files linked inline. npm metadata comes from `npm view replicad|brepjs|occt-wasm|brepkit-wasm` (2026-10-27). The 3dj DSL comes from the public 3dj MCP `cad_get_starters` (`dslReference`) and `cad_validate_script`.
