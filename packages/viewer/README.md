# @open3dj/viewer

The read-only browser viewer of step S2 ([PLAN.md](../../docs/PLAN.md) S2, [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) sections 12 and 13). `open3dj view` serves it (see [packages/open3dj](../open3dj/README.md)):

```sh
npx open3dj view examples/enclosure/enclosure.o3j.js
```

The page is plain ES modules with no bundler and no build step. It loads three.js 0.186.1 (MIT, the one runtime dependency) through an import map.

## Files

| File | Holds |
|---|---|
| `src/index.ts` | The Node side: `viewerAssets()` (the fixed table of files a server may serve), `viewerPage(title)` (the HTML with its import map and Content-Security-Policy), `IMPORT_MAP`, `THREE_VERSION` |
| `web/index.html` | The page: toolbar, tree panel, 3D view, selection and fits panels, status bar, help overlay |
| `web/main.js` | Start-up, renderer choice, data loading, the event stream, tree, selection, measure, fits, keyboard and theme |
| `web/camera.js` | Orthographic and perspective cameras, OrbitControls, mouse presets, standard views, fit-to-view |
| `web/scene.js` | `ModelScene`: one `InstancedMesh` per definition and colour, edges, fit markers, highlight, hide and isolate |
| `web/glb.js` | Reads the GLB the export job writes into parts with occurrence paths and world matrices |
| `web/fits.js` | Fit marker positions, labels and pair counts (pure functions, tested in Node) |
| `web/viewer.css` | Layout and the dark and light themes |

## What the page does

- **Renderer.** three.js `WebGPURenderer` when `navigator.gpu` gives an adapter, else `WebGLRenderer` on WebGL2. If the WebGPU device fails after start-up (a lost device, or a software adapter that cannot map buffers), the page reloads itself once on WebGL2. With neither context it says so and shows the CPU hidden-line drawing of the same revision. `?renderer=webgl` or `?renderer=none` forces a path, for tests.
- **Model.** Units are mm and Z is up, as in the GeometryReport. The GLB's root node converts to metres and Y-up; the viewer drops that one transform. Every occurrence of a definition shares one `BufferGeometry`, drawn as one `InstancedMesh` per definition and colour. Part colours come from the model.
- **Edges.** One `EdgesGeometry` per definition (crease angle 25 degrees), shared by its occurrences.
- **Tree.** Every occurrence with its path, definition and validity. A click selects, `Ctrl`+click adds, a double-click fits that part. The eye button hides or shows it.
- **Selection.** A click in the view picks the part under the cursor (a CPU ray cast against the instanced meshes) and highlights it in the scene and the tree. The panel shows the report numbers of its definition (volume, area, mass, size, local bounding box, centre of mass, counts) and the world box of that occurrence. `C` copies the occurrence path for an agent, for example `screw#2`.
- **Fits.** Clash, contact and clearance lines from the report, clashes first. The header counts each pair once, by its closest relation; further gaps of a pair (report lines marked `extra`) are counted apart and labelled "further gap". When an extra line is its pair's only line (a mated lid: the seat contact is not listed, the lip clearance is), it counts as that pair's relation and says "beside a mated seat". `open3dj run` and `open3dj inspect --fields fits` use the same words. A marker sits between the two parts' world boxes: in the middle of their overlap, or in the middle of the gap between them. A click selects both parts and frames them. A marker is hidden while either part of its pair is hidden or left out of an isolated set.
- **Status bar.** Revision, report status and valid definitions, the compute block, the renderer, the last run (or its error and line) and the live link state.
- **Navigation.** Presets: Open3DJ (left orbit, right pan), SolidWorks (middle orbit, `Ctrl`+middle pan) and Onshape (right orbit, middle pan). The wheel zooms at the cursor. Orthographic by default; `P` switches to perspective. The preset, projection, theme, edges and markers are kept in the browser's local storage when it allows that.
- **Theme.** Dark or light, following the system until you press `T`.

Press `?` in the page for every shortcut.

## The server contract

`open3dj view` (`packages/open3dj/src/view.ts`) serves these routes, all under `/<nonce>/` and all GET or HEAD:

| Route | Answer |
|---|---|
| `/<nonce>/` | The page, with a CSP that allows only its own files and the hash of the inline import map |
| `app/<file>`, `vendor/<file>` | The files in `viewerAssets()`: the modules in `web/` and four three.js files |
| `api/model` | `{project, rev, head, run, tree, definitions, report, parts, fits, glb, drawing}` for the head revision; detailed measures and fits through `inspect` |
| `api/rev/<rev>/model.glb` | The revision's GLB from the export job on the compute pool, cached per revision |
| `api/rev/<rev>/drawing.png` | The revision's four-view hidden-line drawing from the render job |
| `api/events` | Server-sent events: `hello`, `run` (running, done or error with the ScriptError) and `revision` |

Security (ARCHITECTURE.md section 12): the server binds 127.0.0.1 only; the nonce is 24 random bytes per session; the Host header must name the loopback port; a request with an Origin from another page, or with `Sec-Fetch-Site` cross-site or same-site, is refused; there are no CORS headers; only GET and HEAD are answered. A request path is looked up in a fixed table and never joined onto a folder, so it cannot reach files outside the project outputs and the viewer assets.

## Tests

- `src/index.test.ts`: the asset table, the page CSP, the GLB reader (paths, mm Z-up matrices, shared geometry) and fit placement.
- `packages/open3dj/src/view.test.ts`: the server on the real compute pool: the nonce, Host and Origin checks, path traversal, the GLB route, the revision stream after a save, and a script error.
- `packages/open3dj/src/view-browser.test.ts`: opens `examples/enclosure` in headless Chromium with Playwright when `require("playwright")` resolves, and skips otherwise (CI runners do not have it). It waits for the scene, checks the tree lists 6 occurrences, clicks a screw in the 3D view and checks it is selected. Chromium gets `--enable-unsafe-swiftshader` for WebGL, in tests only. Set `OPEN3DJ_VIEWER_SHOTS=<folder>` to keep its screenshot.

## Not yet

- GPU picking and element addresses (`@elem:...`) for faces and edges: picking selects whole occurrences, on the CPU.
- The frame-time probe and the 145-occurrence frame-time gate of S2.
- Fit markers come from bounding boxes, because the report does not carry a contact location yet. Parts whose boxes nest (a pin inside a hinge) put their markers at one point, and the further gaps of a pair share the pair's point.
- The WebGPU path is written and starts, but it was not seen rendering on real GPU hardware: the only test machine had a software adapter, and there the page falls back to WebGL2.
- Approvals, the exploded-step editor and section views arrive in later steps (S4, S5).
