# Getting started

This guide takes you from a fresh clone to your own checked part. The first half is for people at a terminal. The second half is for AI agents and the people who connect them. The last section is for contributors.

Open3DJ is early (step S1 of [PLAN.md](PLAN.md)). It has a command line and an MCP server, but no desktop app yet. Everything runs on your own computer.

## What you need

- [Node.js 24](https://nodejs.org) or newer. Check with `node --version`. `npm ci` refuses older versions.
- git.
- Memory: a worker used about 200 MB at peak on small parts. The pool runs one worker per core minus one, fewer when free memory is short.
- Windows, macOS or Linux. The geometry kernel is WebAssembly, so nothing is compiled on install. So far Open3DJ has been run on Linux only. CI for Windows and macOS is set up but has not run yet.

```sh
git clone https://github.com/NeuralDEEPnet/Open3DJ.git
cd Open3DJ
npm ci
npx open3dj --version
```

Nothing is published to npm yet. Run `npx open3dj` from inside the clone, or `node /path/to/Open3DJ/packages/open3dj/src/cli.ts` from anywhere.

## For people

### Run an example

```sh
npx open3dj run examples/bracket/bracket.o3j.js
```

```text
ok  r_0001  1 occurrence, 1 definition, 14.04 g
parts:
  bracket  valid    11320.61 mm3  40 x 35 x 35 mm  1 solid
warning: mass_g assumes 1.24 g/cm3 (PLA).
next: render view=multiview
next: export format=step
compute: cpu.wasm on cpu x1 (...)
```

This is the GeometryReport. Read it from the top:

- `ok` is the status. `warning` means the design is valid but something needs a look, such as a clash. `error` means a part is not a valid solid.
- `r_0001` is the revision. Every successful run that changes the script or its parameters makes a new one.
- Every design is an assembly. A single part is an assembly with one occurrence of one definition.
- Each part line gives validity, volume, size and solid count. Check these numbers against what you meant to build. Add `--detailed` for area, centre of mass and face and edge counts.
- `fits` (on assemblies) lists clashes, contacts and clearances between parts. Identical fits share one line, for example `contact  lid / screw#1..4  0 mm (measured) x4`.
- `next` suggests the next command.

The run created a project folder next to the script, `examples/bracket/bracket.o3j/`. It holds the script, the parameter values, every revision and the outputs.

### See it and export it

```sh
npx open3dj render examples/bracket/bracket.o3j --out bracket.png
npx open3dj export examples/bracket/bracket.o3j --format step
```

`render` draws four views (front, top, right and isometric) with hidden lines dashed. Add `--format svg` for a vector drawing, or `--targets lid,screw#2` to draw only some parts. `export` writes `bracket.step` and `bracket.evidence.json` (hashes and measures) under `examples/bracket/bracket.o3j/out/r_0001/`. The formats are `step`, `stl`, `glb` and `3mf`. Add `--out folder` to copy the files somewhere else.

### Change a parameter

Scripts declare parameters with `Param.number`, `Param.choice` and friends. Override them from the command line:

```sh
npx open3dj run examples/flange/flange.o3j.js --param "Bolt holes=8"
```

The value is saved in the project's `params.o3j.json`, so later runs of the same script keep using it. Pass the parameter again, or edit or delete that file, to change it back. When you change the script itself, the run starts from the new script's defaults (plus any `--param` you pass), so old values never carry over to a different design.

### Make your own part

```sh
npx open3dj new mypart                     # mypart.o3j with a part template
npx open3dj new mybox --template assembly  # an enclosure with a lid and screws
npx open3dj run mypart.o3j
```

Edit `mypart.o3j/main.o3j.js` and run again. Or write a script file anywhere and run it directly, as with the examples. A script is plain JavaScript that ends with a return:

```js
// A 60 x 40 x 6 mm plate with four M4 holes and rounded top edges. Units are mm, Z is up.
const plate = box(60, 40, 6);
const holes = [[-22, -12], [22, -12], [-22, 12], [22, 12]].map(([x, y]) =>
  lib.clearanceHole("M4", { length: 7 }).translate(x, y, 6));
return fillet(plate.subtract(holes), 1, { atZ: 6 }).name("Plate");
```

Return several parts as `[{ name: "Base", shape: base }, { name: "Lid", shape: lid }]`. Parts made with `.clone()` share one definition, so four screws are four occurrences of one screw. Connectors and `matchTo` seat one part on another. Look up any entry with `npx open3dj docs fillet`, or read [DSL.md](DSL.md). The [examples](../examples/README.md) show most entries in real parts.

### When something goes wrong

Errors point at the line in your script and suggest a fix:

```text
error KERNEL_FILLET_FAILED at bad.o3j.js:2:1: fillet failed: produced an invalid solid
  op: fillet
  hint: fillet failed: try a smaller radius, or fillet fewer edges at once (narrow the edge query).
```

| Exit code | Meaning |
|---|---|
| 0 | ok, including results with warnings such as clashes |
| 1 | the run finished but a part is not a valid solid |
| 2 | script, kernel or tool error |
| 3 | the command line was wrong |

Other things to know:

- Scripts run in a sandbox with no files, network, timers or `Date`. They get 2 s of script time and 128 MiB of memory, and a job is stopped after 30 s.
- Each command starts a worker and loads the kernel, so even a small part takes one to three seconds. The MCP server keeps its workers warm.
- Set `OPEN3DJ_VERBOSE=1` to see the kernel's own messages on stderr.
- `npx open3dj doctor --bench` shows what your machine can run and how fast.

## For agents

Open3DJ is an MCP server over stdio. It offers five tools:

| Tool | Does |
|---|---|
| `docs` | Searches the DSL reference, the error playbook and examples. |
| `run` | Runs a script in a project and returns the GeometryReport and a new `rev`. |
| `render` | Returns the four-view drawing as a PNG image, or SVG. |
| `export` | Writes STEP, STL, glTF (.glb) or 3MF plus an evidence sidecar into the project. |
| `inspect` | Reads the tree, references, fits, measures of chosen targets, job status or the device inventory. |

### Connect a client

The server command is `node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp`. Projects must be inside the server's root folder. The root is the folder the client starts the server in, or the folder you pass with `--root`. If the `node` on your PATH is older than 24, put the full path to a Node 24 binary in `command`. `--workers n` caps the worker pool.

Claude Code, from the folder where your designs should live:

```sh
claude mcp add open3dj -- node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.open3dj]
command = "node"
args = ["/path/to/Open3DJ/packages/open3dj/src/cli.ts", "mcp", "--root", "/path/to/designs"]
```

Gemini CLI (`.gemini/settings.json`), Cursor (`.cursor/mcp.json`) and Claude Desktop (`claude_desktop_config.json`) use the same shape:

```json
{
  "mcpServers": {
    "open3dj": {
      "command": "node",
      "args": ["/path/to/Open3DJ/packages/open3dj/src/cli.ts", "mcp", "--root", "/path/to/designs"]
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "open3dj": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/Open3DJ/packages/open3dj/src/cli.ts", "mcp", "--root", "${workspaceFolder}"]
    }
  }
}
```

The server speaks the 2025-06-18, 2025-11-25 and 2026-07-28 protocol versions. Automated tests drive it with the official MCP SDK clients (v1 1.32.2 and v2 2.4.0) in each version. The client configurations above follow each client's documentation; not all of them have been tried by hand yet. Please report what works for you in an issue.

### The loop

1. `docs {query: "fillet"}` when you are unsure of an entry. Do not guess signatures.
2. `run {project: "bracket.o3j", script}`. Check `status`, each part's `valid` flag, the volume and the bounding box against the intent. Keep the `rev`.
3. `render {project: "bracket.o3j", view: "multiview"}` to look at the result.
4. Change the script and `run` again with `base_rev` set to the last `rev`. A stale `base_rev` returns `REV_CONFLICT` instead of overwriting someone else's change.
5. When the report is clean, `export {project, format: "step"}`.

Rules that save time:

- Errors are tool results, not protocol errors. Read `error.code`, `error.line`, `error.elements` (for example `edge:3`) and `error.hint`, fix the script and run again.
- Report status `warning` with a clash means two parts overlap. The `next` hints name the parts to render.
- Measures are in mm and mm3. Mass assumes PLA at 1.24 g/cm3 until materials arrive.
- A run longer than 20 s returns `status: "queued"` with a `job_id`. Poll it with `inspect {fields: ["job"], job_id}`. When the job's `state` is `done` or `failed`, `job.result` holds exactly what `run` would have returned: the `rev`, `status` and concise report with its warnings, or the `error` with its line, column and hint. Jobs live in the server's memory, so a restarted server forgets them.
- `params` are saved as the project's working values. Later runs of the same script keep them until you change them; a different script starts from its own defaults plus the params you pass.
- Scripts run in a QuickJS sandbox with limits. Never put secrets or file paths in a script.

The same loop works from the command line: every CLI command calls the same handlers, and `--json` prints the exact tool result.

## For contributors

Read [AGENTS.md](../AGENTS.md) (agents) or [CONTRIBUTING.md](../CONTRIBUTING.md) (people) first. Then:

```sh
npm ci
npm run check        # typecheck, every test, the stdout-leak gate and the licence gate
npm test -- dsl      # only the tests whose path contains "dsl"
npm run examples     # run every example through the CLI and print timings
```

`npm run check` must pass before a pull request. It includes the examples regression test, so a change that moves a measured volume fails until you explain it and regenerate the expected files with `node scripts/examples.ts --write`. The package map and the data flow are in [packages/README.md](../packages/README.md).
