# Getting started

This guide takes you from installing Open3DJ to your own checked part. The first half is for people at a terminal. The second half is for AI agents and the people who connect them. The last section is for contributors.

Open3DJ is early (step S1 of [PLAN.md](PLAN.md)). It has a command line and an MCP server, but no desktop app yet. Everything runs on your own computer.

## Install

Open3DJ runs on Windows, macOS and Linux, on x64 and ARM64. It is not published to npm yet, so you install it from GitHub, with an installer script or from a git clone. The installers need no admin rights and no sudo. Unless you choose to install Node with winget on Windows, they change nothing outside your user account.

### Help us test on your platform

CI installs Open3DJ with these scripts on Linux (x64 and ARM64), macOS, and Windows (x64 and ARM64), but real computers differ more than CI runners do. Please install it on yours, try an example, and tell us what happened, even if it just worked. [TESTING.md](TESTING.md) has a 15-minute checklist. The most useful part of a report is:

```sh
open3dj doctor --report
```

It measures your machine for about a minute and prints a Markdown report with your operating system, CPU, memory, GPU names, versions, the commit and timings. It holds no user names, host names or file paths. Read it, then paste all of it into a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml). If something failed, a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml) with the installer's output helps most.

### Windows (PowerShell)

Download the installer, read it, then run it:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 -OutFile install-open3dj.ps1
notepad install-open3dj.ps1
powershell -ExecutionPolicy Bypass -File .\install-open3dj.ps1
```

Many projects offer a one-line form instead, and this one works too:

```powershell
irm https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 | iex
```

The one-liner runs whatever the server sends at that moment, and you never see it. The two steps above let you read the exact file you run and keep it. `-ExecutionPolicy Bypass` applies to that one run only; it does not change your settings.

The script works in Windows PowerShell 5.1 (built into Windows 10 and 11) and in PowerShell 7. It:

1. Uses the `node` on your PATH if it is version 24 or newer. If not, it asks how to get one: download the official Node 24 zip from nodejs.org into the install folder (the default: private to Open3DJ, no admin, checked against nodejs.org's `SHASUMS256.txt`, which catches a broken or cut-off download; that the file comes from nodejs.org rests on HTTPS), or install Node LTS for every program with `winget` (`OpenJS.NodeJS.LTS`, only when its LTS line is 24 or newer; this may ask for admin rights).
2. Downloads the Open3DJ source for the chosen ref from GitHub and runs `npm ci --omit=dev --ignore-scripts` in it. Only runtime dependencies are installed, and no package install scripts run.
3. Writes `open3dj.cmd` to `%LOCALAPPDATA%\Open3DJ\bin` and adds that folder to your user PATH. It never touches the machine PATH. A `.cmd` runs in cmd.exe, Windows PowerShell 5.1 and PowerShell 7 alike, whatever their execution policies. Pressing `Ctrl+C` in a command such as `open3dj view` makes cmd.exe ask `Terminate batch job (Y/N)?`; type `Y`.
4. Runs `open3dj doctor` and prints the next steps, including the exact MCP configuration for Claude Code and Claude Desktop with full paths.

Options: `-Ref <branch, tag or commit>` (default `main`), `-InstallDir <folder>` (default `%LOCALAPPDATA%\Open3DJ`), `-NoPath`, `-Yes` (no questions; picks the private Node), `-PrivateNode`, `-UseWinget`, `-Source <folder>` (install from a local copy, as CI does) and `-Uninstall`. To pass options to the one-liner, use `& ([scriptblock]::Create((irm <url>))) -Ref main -Yes`.

Open a new terminal afterwards, so that it sees the new PATH.

### macOS and Linux

Download the installer, read it, then run it:

```sh
curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.sh -o install-open3dj.sh
less install-open3dj.sh
sh install-open3dj.sh
```

The one-line form, with the same caveat as on Windows, is `curl -fsSL <url> | sh`, and `curl -fsSL <url> | sh -s -- --yes` passes options.

It uses the `node` on your PATH if it is version 24 or newer. If not, it downloads the official Node 24 build for your platform from nodejs.org, checks it against `SHASUMS256.txt` (a guard against broken downloads; trust in the server rests on HTTPS) and keeps it in the install folder. It never changes a system Node. Then it downloads the source, runs `npm ci --omit=dev --ignore-scripts`, writes the `open3dj` command to `~/.local/bin` and, if that folder is not on your PATH yet, adds one marked line to `~/.profile` and to your shell's rc file (`~/.bashrc`, `~/.zshrc` or a fish `conf.d` file). Alpine and other musl systems need Node 24 from their package manager first, because nodejs.org builds are for glibc.

Options: `--ref <ref>`, `--prefix <dir>` (default `~/.local/share/open3dj`), `--bin-dir <dir>` (default `~/.local/bin`), `--no-path`, `--yes`, `--private-node`, `--source <dir>` and `--uninstall`.

### Upgrade, uninstall and where things are

Run the installer again to upgrade. It replaces the app folder in place and keeps the old one until the new one has its dependencies and starts. Close programs that run Open3DJ first (an MCP client such as Claude Desktop, or `open3dj view`), because Windows does not let the installer replace or remove files in use. If one is still running, the Windows installer stops before it changes anything; close it and run the command again.

| | Windows | macOS and Linux |
|---|---|---|
| App (the source and its `node_modules`) | `%LOCALAPPDATA%\Open3DJ\app` | `~/.local/share/open3dj/app` |
| Private Node, when it was needed | `%LOCALAPPDATA%\Open3DJ\node` | `~/.local/share/open3dj/node` |
| Command | `%LOCALAPPDATA%\Open3DJ\bin\open3dj.cmd` | `~/.local/bin/open3dj` |
| What was installed (paths, ref, commit) | `%LOCALAPPDATA%\Open3DJ\install.json` | `~/.local/share/open3dj/install.json` |
| Uninstall (close Claude Desktop and other MCP clients first) | In PowerShell: `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Open3DJ\app\scripts\install\install.ps1" -Uninstall` | `sh ~/.local/share/open3dj/app/scripts/install/install.sh --uninstall` |

Uninstalling removes the install folder, the command and the PATH entries the installer added. It never touches your designs. Both installers refuse to install into, or remove, a folder they did not create.

The rest of this guide writes `npx open3dj`, which works inside a clone. After an install, type `open3dj` instead. Where the guide says `/path/to/Open3DJ`, an installed copy lives in the app folder above, and `node` is the Node the installer printed.

### From a git clone

Use a clone to contribute, or if you prefer to see every step. You need:

- [Node.js 24](https://nodejs.org) or newer. Check with `node --version`. `npm ci` refuses older versions.
- git.

```sh
git clone https://github.com/NeuralDEEPnet/Open3DJ.git
cd Open3DJ
npm ci
npx open3dj --version
```

Run `npx open3dj` from inside the clone, or `node /path/to/Open3DJ/packages/open3dj/src/cli.ts` from anywhere.

### What your computer needs

- Windows 10 or 11, macOS, or Linux with glibc, on x64 or ARM64. The geometry kernel is WebAssembly, so nothing is compiled on install.
- Disk: about 85 MB for the app and its dependencies, plus 100 to 210 MB when the installer downloads a private Node (the Windows zip is the smaller one).
- Memory: a worker used about 200 MB at peak on small parts. The pool runs one worker per core minus one, fewer when free memory is short.

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
saved params: Width=40, Leg=35, Thickness=4, Screw="M4" in examples/bracket/bracket.o3j/params.o3j.json
```

This is the GeometryReport. Read it from the top:

- `ok` is the status. `warning` means the design is valid but something needs a look, such as a clash. `error` means a part is not a valid solid.
- `r_0001` is the revision. Every successful run that changes the script or its parameters makes a new one.
- Every design is an assembly. A single part is an assembly with one occurrence of one definition.
- Each part line gives validity, volume, size and solid count. Check these numbers against what you meant to build. Add `--detailed` for area, centre of mass and face and edge counts.
- `fits` (on assemblies) lists clashes, contacts and clearances between parts. Identical fits share one line, for example `contact  lid / screw#1..4  0 mm (measured) x4`. The closest relation comes first (clash, then contact, then clearance), and a pair's further gaps come last. The terminal lists every fit line; the MCP report to an agent keeps to its token budget and says how many it left out.
- `next` suggests the next command.
- `saved params` shows the parameter values the run saved as the project's working copy. A first run saves the script's defaults; later it appears only when a run changes a value.

The run created a project folder next to the script, `examples/bracket/bracket.o3j/`. It holds the script, the parameter values, every revision and the outputs.

### See it and export it

```sh
npx open3dj render examples/bracket/bracket.o3j --out bracket.png
npx open3dj export examples/bracket/bracket.o3j --format step
```

`render` draws four views (front, top, right and isometric) with hidden lines dashed. Add `--format svg` for a vector drawing, or `--targets lid,screw#2` to draw only some parts. `export` writes `bracket.step` and `bracket.evidence.json` (hashes and measures) under `examples/bracket/bracket.o3j/out/r_0001/`. The formats are `step`, `stl`, `glb` and `3mf`. Add `--out folder` to copy the files somewhere else.

### Watch it in the viewer

```sh
npx open3dj view examples/enclosure/enclosure.o3j.js
```

```text
open3dj view: http://127.0.0.1:52817/Xq3...nonce.../
watching examples/enclosure/enclosure.o3j.js; save it to update the view. Press Ctrl+C to stop.
[10:42:07] r_0001 ok: 3 of 3 definitions valid, 16 fit lines
```

![The viewer with the enclosure example: the assembly tree, the parts in 3D with fit markers, and the selected screw's measures and fits.](images/viewer-enclosure.png)

`view` runs the script, opens the printed URL in your browser and shows the assembly in 3D. Open the script in your editor: every save runs it again, and the page updates to the new revision. If the save has an error, the page keeps the last good revision and shows the error and its line. Revisions that an agent makes in the same project through `open3dj mcp` show up too. A save that changes the script drops the parameter values an agent stored (a change to `//` comments or blank lines only keeps them); the status bar then says `warning`, the Warnings panel names the values, and the terminal prints the same line.

- **Tree.** The left panel lists every occurrence with its definition and validity. Click a row or a part to select it; `Ctrl`+click adds to the selection. The right panel shows the selected part's numbers from the report (volume, area, mass, size, bounding box).
- **Fits.** Clashes, contacts and clearances from the report are listed on the right and marked in the scene. Click one to select both parts and frame them. The header counts each pair once; a further gap of a pair that is already listed (for example a screw shank's clearance in a lid it touches) says "further gap". A mated pair's contact is not listed, so its gap (a lid's lip clearing the wall) is the pair's only line: it counts as a clearance and says "beside a mated seat". The CLI uses the same words.
- **Navigation.** Left drag orbits, right drag pans and the wheel zooms at the cursor. The Mouse menu switches to SolidWorks-style or Onshape-style buttons. `F` fits all, `1` to `4` give the front, top, right and iso views, `H` hides, `I` isolates. Press `?` for every shortcut.
- **No GPU.** The page uses WebGPU when the browser has it and WebGL2 otherwise. Without either, it shows the hidden-line drawing of the same revision instead. `D` shows that drawing at any time.

The server listens on 127.0.0.1 only, and the URL carries a random key for this session. Other pages and other machines cannot read it. The page is read-only. Add `--port 8123` to choose the port and `--no-open` to skip opening the browser.

### Change a parameter

Scripts declare parameters with `Param.number`, `Param.choice` and friends. Override them from the command line:

```sh
npx open3dj run examples/flange/flange.o3j.js --param "Bolt holes=8"
```

The value is saved in the project's `params.o3j.json`, so later runs of the same script keep using it, and the CLI prints `saved params: Bolt holes=8 (was 6) in .../params.o3j.json` whenever a run changes that file. Pass the parameter again, or edit or delete that file, to change it back. To try a value without saving it, add `--no-save-params` (the CLI then says which values the file keeps). When you change the script itself, the run starts from the new script's defaults (plus any `--param` you pass), so old values never carry over to a different design. The report then says which stored values it did not use, and `open3dj view` shows that warning too. A change to `//` comments or blank lines only keeps the stored values.

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
| `export` | Writes STEP, STL, glTF (.glb) or 3MF into the project, plus one evidence sidecar (`<name>.evidence.json`) per revision and folder that lists every file exported there with its sha256. STEP headers name the file, the revision's time (UTC) as the time stamp, Open3DJ and its version, and the `author` and `organization` set in `project.o3j.json` (empty when unset). Exporting the same revision again gives the same STEP bytes. |
| `inspect` | Reads the tree, references, fits, measures of chosen targets, job status or the device inventory. |

### Connect a client

The server command is `node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp`. Projects must be inside the server's root folder. The root is the folder the client starts the server in, or the folder you pass with `--root`. If the `node` on your PATH is older than 24, put the full path to a Node 24 binary in `command`. `--workers n` caps the worker pool.

Give the agent the skill too: [skills/open3dj/SKILL.md](../skills/open3dj/SKILL.md) holds the DSL essentials, the error-fix loop and the assembly rules in under 5k tokens. The server alone gives the tools, not that know-how.

Claude Code, from the folder where your designs should live, loads the server and the skill together with the plugin in this checkout (run `npm ci` first):

```sh
claude --plugin-dir /path/to/Open3DJ/skills/claude-code-plugin
```

Or add the server alone:

```sh
claude mcp add open3dj -- node /path/to/Open3DJ/packages/open3dj/src/cli.ts mcp
```

For every other client, add the server as below and give the agent `skills/open3dj/SKILL.md` as instructions (a system prompt, rules file or project instructions). [skills/README.md](../skills/README.md) has the details.

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
- `params` are saved to the project's working copy (`params.o3j.json`). Later runs of the same script keep them until you change them; a different script starts from its own defaults plus the params you pass. Pass `save_params: false` to try values without saving them.
- Name faces and edges with `withReferences({ top: { face: { normal: [0, 0, 1], atZ: 5 } } })`. The report's `refs` say after each run whether every name is `exact`, `ambiguous` (with `candidates`, never picked for you) or `broken` (with a `reason`); `inspect {fields: ["refs"]}` adds element addresses and fingerprints.
- Fits list every distinct gap of a pair: a lid seated on a rim by a mate (contact, not listed) whose lip clears the wall by 0.25 mm shows a 0.25 mm clearance.
- Scripts run in a QuickJS sandbox with limits. Never put secrets or file paths in a script.

The same loop works from the command line: every CLI command calls the same handlers, and `--json` prints the exact tool result.

## For contributors

Read [AGENTS.md](../AGENTS.md) (agents) or [CONTRIBUTING.md](../CONTRIBUTING.md) (people) first. Then:

```sh
npm ci
npm run check             # typecheck, every test, the bench regression split, the stdout-leak gate and the licence gate
npm test -- dsl           # only the tests whose path contains "dsl"
npm run examples          # run every example through the CLI and print timings
npm run bench:lint        # task-lint every bench task: schema, reference passes, mutant fails
npm run bench:regression  # the bench regression split; add -- --repeat 3 to replay it
npm run hdet              # determinism: 20 fresh and 20 warm runs per corpus case (about 4 minutes)
npm run corpus            # time the 145 and 1,025 occurrence reference assemblies
```

`npm run check` must pass before a pull request. It takes about 2 minutes on a 4-core Linux machine, within its 10 minute budget. It includes the examples regression test, so a change that moves a measured volume fails until you explain it and regenerate the expected files with `node scripts/examples.ts --write`. It also runs task-lint on all 22 bench tasks (inside `npm test`) and the 12-task regression split three times, which must give identical numbers. The package map and the data flow are in [packages/README.md](../packages/README.md).

When you open a pull request, CI runs the same `npm run check` on Linux x64 and ARM64, macOS, and Windows x64 and ARM64, together with a sign-off check, an evaluation that picks the merge lane and an advisory AI review. Documentation, examples, new bench tasks and similar data merge automatically when everything passes (the auto lane); code merges after one maintainer approves (the maintainer lane). [CONTRIBUTING.md](../CONTRIBUTING.md#how-your-pull-request-is-evaluated-and-merged) explains the lanes and how to see why a pull request is not merging yet.

Other places to know:

- [ROADMAP.md](../ROADMAP.md): where the project is going, step by step, with concrete ways to help in each step.
- [bench/README.md](../bench/README.md): o3dj-bench, its task format and how capability runs are graded.
- [corpora/](../corpora/): the reference assemblies and the determinism corpus.
- [ops/](../ops/): the scorecard and A3 templates, the value-stream log and the build log.
- [AI_POLICY.md](../AI_POLICY.md): the rules for AI-assisted contributions. Claude Code users also get the project hooks in `.claude/settings.json` (see [AGENTS.md](../AGENTS.md#claude-code-hooks)).
- [skills/](../skills/README.md): the Open3DJ skill and Claude Code plugin for agents.
