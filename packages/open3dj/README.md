# open3dj

The `open3dj` command: the CLI for people and the `open3dj mcp` server for agents. Every command calls the same handlers as the MCP tools (`@open3dj/mcp`), on a compute pool whose workers hold the kernel.

From a checkout (Node 24):

```sh
node packages/open3dj/src/cli.ts new bracket                 # bracket.o3j with a starter script
node packages/open3dj/src/cli.ts run bracket.o3j             # GeometryReport, revision r_0001
node packages/open3dj/src/cli.ts render bracket.o3j --out bracket.png
node packages/open3dj/src/cli.ts export bracket.o3j --format step --out exports
```

## Commands

| Command | Does |
|---|---|
| `run <script.o3j.js \| project.o3j> [--param k=v] [--no-save-params] [--base-rev r] [--detailed]` | Runs the script and prints the report, including named faces and edges (`refs`). A script file keeps its project next to it (`part.o3j.js` uses `part.o3j/`). A project runs its `main.o3j.js`. `--param` values are saved to the project's `params.o3j.json`, and the CLI prints `saved params: ...` when that file changes; `--no-save-params` runs with the values but keeps the file as it was. |
| `run <script \| project> --waive min_wall\|overhang --target <part> --reason <text> [--build x,y,z] [--base-rev r]` | Accepts a failing 3D printing check of one part, with a reason, and records it in the project's `waivers.o3j.json` without a new revision. A script source runs first, so the waiver is checked on its current revision. The waiver holds for that part's shape and that failure: a change to either opens the failure again. `watertight` and `bed` need a person (from S5). `--build` is the build direction the overhang was checked with (default `0,0,1`). |
| `render <script \| project> [--view multiview\|highlight] [--targets a,b] [--format png\|svg\|both] [--out file.png] [--rev r]` | Four-view drawing, written under `out/<rev>/`; `--out` also copies it. `--view highlight --targets lid@elem:face:5,screw#2` draws nothing and points a running `open3dj view` of the project at the targets (`--note "text"` adds a short message, 200 characters at most). |
| `export <script \| project> --format step\|stl\|glb\|3mf [--scope path] [--out dir] [--rev r]` | Files under `out/<rev>/`, and the evidence sidecar, which lists every export of that revision in that folder; `--out` also copies them. `glb` and `gltf` are the same format. Every export also prints `gates fdm.v1: pass\|fail\|unchecked, N open, M waived`, the 3D printing checks of the exported parts at build +Z on the default bed, with the project's waivers applied. The evidence sidecar lists each failure. A failure never blocks the export. |
| `inspect [<script \| project>] [--fields tree,refs,fits,measure,devices,job,selection,gates] [--targets ...] [--job id] [--gates fdm.v1] [--build x,y,z] [--bed x,y,height]` | Reads details; `devices` needs no project. `selection` is what the person selected in `open3dj view` (element addresses such as `lid@elem:face:5`), rebuilt from its revision. `gates` runs the `fdm.v1` 3D printing checks per part (`--build` and `--bed` change the build direction and the printer size in mm, x then y then height). |
| `docs <query> [--page n]` | Searches docs/DSL.md. |
| `view <script \| project> [--port n] [--no-open] [--param k=v] [--no-sync-script]` | The browser viewer ([packages/viewer](../viewer/README.md)). It prints a one-time link, `http://127.0.0.1:<port>/<nonce>/`; the browser that opens it gets a session cookie and moves to `http://127.0.0.1:<port>/`. For another browser, use **Open in another browser** in the page's help (`?`). Runs the script, then runs it again on every save, and shows each new revision, including revisions an agent makes in the same project. An agent's revision is never run again, and `--param` values apply until the first one. Each save passes `base_rev`, so a save that is behind an agent's revision is not run: the page and the terminal say `part.o3j.js is based on r_0003; r_0004 was made by an agent`. A script outside the project gets the agent's revision written into it while it has no changes that did not run, also at start-up after an agent worked while the viewer was closed; `--no-sync-script` turns that off. In project mode, a save that an agent's commit replaced while it ran is kept in `.o3j-view/unrun.o3j.js`. Stops on Ctrl+C. |
| `new <name> [--template part\|assembly]` | Creates `<name>.o3j` with a starter script that runs as it is. |
| `mcp [--root dir] [--workers n]` | The stdio MCP server. Projects must be inside the root (default: the working folder). `--workers` caps the worker pool (default: cores minus one, limited by free memory at about 1.5 GiB per worker). |
| `doctor [--bench]` | The DeviceInventory, and with `--bench` kernel load, warm part time, peak worker memory, kernel micro-benchmarks (boolean, fillet, shell, GLB tessellation, STEP write, HLR render) and pool scaling over 1..N workers. |
| `tools` | The tool schemas as MCP `tools/list` publishes them. A test checks that they are equal. |

Add `--json` to print the tool result itself (notes such as `saved params` then go to stderr). When `render`, `export` or `inspect` get a script file, they run it first, so the result matches the file on disk; they take `--param` and `--no-save-params` too.

Set `OPEN3DJ_VERBOSE=1` to see the workers' kernel output on stderr.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok, including results with warnings such as clashes |
| 1 | the run finished but a part is invalid (report status error) |
| 2 | script, kernel or tool error (for example SCRIPT_RUNTIME, KERNEL_FILLET_FAILED, REV_CONFLICT) |
| 3 | usage error |

## Not yet

- `bin` points at `src/cli.ts`. Node does not strip types under `node_modules`, so a published package needs a JavaScript entry or a build step first.
- Inspect fields `params` and `errors`, and run ops other than `set_param`, `cancel_job` and `waive` arrive in later steps.
