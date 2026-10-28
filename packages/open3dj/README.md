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
| `run <script.o3j.js \| project.o3j> [--param k=v] [--base-rev r] [--detailed]` | Runs the script and prints the report. A script file keeps its project next to it (`part.o3j.js` uses `part.o3j/`). A project runs its `main.o3j.js`. |
| `render <script \| project> [--targets a,b] [--format png\|svg\|both] [--out file.png] [--rev r]` | Four-view drawing, written under `out/<rev>/`; `--out` also copies it. |
| `export <script \| project> --format step\|stl\|glb\|3mf [--scope path] [--out dir] [--rev r]` | Files and the evidence sidecar under `out/<rev>/`; `--out` also copies them. `glb` and `gltf` are the same format. |
| `inspect [<script \| project>] [--fields tree,refs,fits,measure,devices,job] [--targets ...] [--job id]` | Reads details; `devices` needs no project. |
| `docs <query> [--page n]` | Searches docs/DSL.md. |
| `new <name> [--template part\|assembly]` | Creates `<name>.o3j` with a starter script that runs as it is. |
| `mcp [--root dir] [--workers n]` | The stdio MCP server. Projects must be inside the root (default: the working folder). `--workers` caps the worker pool (default: cores minus one, limited by free memory at about 1.5 GiB per worker). |
| `doctor [--bench]` | The DeviceInventory, and with `--bench` kernel timings and pool scaling. |
| `tools` | The tool schemas as MCP `tools/list` publishes them. A test checks that they are equal. |

Add `--json` to print the tool result itself. When `render`, `export` or `inspect` get a script file, they run it first, so the result matches the file on disk.

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
- `render --view highlight`, inspect fields `params` and `errors`, and run ops other than `set_param` and `cancel_job` arrive in later steps.
