# @open3dj/mcp

The five tool handlers (`run`, `inspect`, `render`, `export`, `docs`), the `.o3j` project store and the dual-era stdio MCP server. The CLI (`packages/open3dj`) calls the same handlers, so the MCP tools and the commands give the same results.

## How a call flows

1. The handler checks the input against its `tool-*-input` schema and resolves the project under the path policy below.
2. It reads the project store, checks `base_rev`, and asks the pool for a placement (`compute: auto | cpu`; `gpu` and `cloud` return `NO_BACKEND` in S1).
3. It sends a job to the compute pool. The kernel runs only in pool workers with captured stdout; this process never loads it.
4. It writes the result into the project (a new revision, renders or exports), appends a provenance line, and returns a schema-valid result.

Handlers never throw for user errors. Every failure is a result with `status: "error"` and a ScriptError: `code`, `message`, and where known `line`, `column`, `op`, `elements` and `hint`. Over MCP these are tool results with `isError: true`, never JSON-RPC errors. The codes are listed in the error playbook in [docs/DSL.md](../../docs/DSL.md#error-playbook).

## The project store

A project is a folder whose name ends in `.o3j` (ARCHITECTURE.md section 8, S1 subset):

| File | Holds |
|---|---|
| `project.o3j.json` | Format version `"0"`, name, units `mm`, `Z` up, the head `rev`, engine pins, and optionally `author` and `organization` for STEP headers |
| `main.o3j.js` | The DSL script of the working copy |
| `params.o3j.json` | Parameter values of the working copy: `run` saves its params and set_param values here unless `save_params` is false |
| `assembly.o3j.json` | The assembly graph from the head revision |
| `evidence.json` | The GeometryReport of the head revision |
| `provenance.jsonl` | One line per run, render and export call: tool, args hash, result hash, engine pins, DeviceInventory hash, compute block, revs |
| `revisions/r_0001.json` | One record per revision: script, params, inputs hash, engine, graph and report |
| `out/<rev>/` | Renders and exports (git-ignored), with one `<name>.evidence.json` that lists every export of the revision in that folder. An earlier entry stays only while its file is on disk with the recorded hash |
| `.o3j-cache/` | Detailed reports computed for `inspect` (git-ignored) |
| `.o3j-view/` | What `open3dj view` shares with agents (git-ignored, never part of a revision): `selection.json`, the person's selection, which `inspect fields=[selection]` returns; `highlight.json`, what an agent points the viewer at with `render view=highlight`. Both are checked against their schema (`viewer-selection`, `viewer-highlight`) and the revision on every read and write (`src/viewstate.ts`) |

- **Revisions** are `r_0001`, `r_0002`, ... and only grow. A run that succeeds creates the next revision. A run with the same script and parameters as the head, on the same engine, keeps the head revision. A failed run creates none.
- **base_rev.** `run` with a `base_rev` that is not the head returns `REV_CONFLICT` and changes nothing. The check runs again at commit time under a per-project lock, so two runs racing from one base revision cannot both win. Without `base_rev`, a run builds on the head.
- **Old revisions.** `render`, `export` and `inspect` take `rev`. Each revision record holds its own script and parameters, so an old revision re-runs exactly what it was. `export` writes the revision's `ts` as the STEP time stamp, so exporting a revision again gives the same STEP bytes; a record whose `ts` is not ISO 8601 with a time zone falls back to the wall clock.
- **From a single script.** `run` with a script on a missing project creates the folder, the manifest and a `.gitignore`. The CLI keeps a script's project next to it: `part.o3j.js` uses `part.o3j/`.
- **Not yet:** `parts/*.o3j.js` (one script per definition) and imported STEP definitions. The store writes from one daemon at a time; two processes writing one project at once are not coordinated yet.

## Path policy

Ported from the mcp-worker spike.

- The project must be a folder named `*.o3j` inside the server's root (its working folder, or `open3dj mcp --root`). Its parent folder must exist.
- Paths inside the project are relative: no absolute paths, no `..`, no hidden or unusual names. `out_dir` follows the same rule.
- Symlinked project folders, symlinked folders inside the project and symlinked target files are refused (`PATH_REFUSED`). Files are written to a temporary name opened with `O_EXCL` and `O_NOFOLLOW`, then renamed into place.
- Error messages name paths relative to the project, never absolute paths.

## The job model (S1)

A `run` that takes longer than the interactive deadline (20 s by default, `interactiveMs`) returns `status: "queued"` with a `job_id` and keeps running. Poll it with `inspect {fields: ["job"], job_id}`; when it is `done`, the job status carries the new `rev`. Cancel it with `run {project, ops: [{op: "cancel_job", job_id}]}`, which creates no revision. Jobs live in the daemon's memory only and are not tied to MCP sessions.

## The server

`serveStdio()` uses `@modelcontextprotocol/server` 2.4.0 with `legacy: "serve"`: one factory answers 2025-06-18 and 2025-11-25 `initialize` and 2026-07-28 `server/discover`. Tools are registered from `TOOL_DEFINITIONS` with `fromJsonSchema()` and a validator built on `@open3dj/schemas`, so `tools/list` publishes exactly the schemas in `packages/schemas` and the same rules check every input. Results carry `structuredContent` and a JSON text mirror. `render` adds the PNG as image content and the SVG as an embedded resource.

`guardStdout()` sends every console method to stderr. `open3dj mcp` calls it before anything else.

## docs

The `docs` tool searches [docs/DSL.md](../../docs/DSL.md): each `###` section is one hit, and its `##` section sets the kind (`dsl`, `lib`, `error`, `example`). Five hits per page. The file is generated from `DSL_ENTRIES` in `@open3dj/dsl`, the examples and the error playbook in `src/dsl-docs.ts`:

```sh
node packages/mcp/src/dsl-docs.ts --write   # regenerate
node packages/mcp/src/dsl-docs.ts --check   # exit 1 when stale
```

A test fails when the file is stale, and another runs every example through the real job runner.

## Tests

- `handlers.test.ts`: the store, revisions, `REV_CONFLICT` (also for two racing runs), provenance, `set_param`, the job model and cancel, inspect, render, export, the path policy and docs, on a fake compute pool (`src/testing.ts`).
- `server.test.ts`: the real server code on the fake pool, driven by a raw 2025-06-18 session, the v1 SDK client (1.32.2) and the v2 client (2.4.0) in legacy mode and pinned to 2026-07-28. `tools/list` must equal `TOOL_DEFINITIONS`, and errors must be tool results.
- `dsl-docs.test.ts`: docs/DSL.md is current and its examples run.
- The stdout-leak gate (`scripts/leak-gate.ts`) drives the real `open3dj mcp` with the real pool through a run, two STEP exports, a render and an inspect.
