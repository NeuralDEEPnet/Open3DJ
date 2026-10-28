# Packages

Each package is an npm workspace named `@open3dj/<dir>` (the CLI is `open3dj`). Its `exports` point at `src/index.ts`, which Node 24 runs directly. Tests sit next to the code as `*.test.ts`.

| Package | Status | Owns | Main entry points |
|---|---|---|---|
| `schemas` | ready | v0 JSON Schemas (C1, C4, C5) and their TypeScript types | `validate`, `assertValid`, `dereferencedSchema`, all report and tool types |
| `kernel` | ready | `KernelAdapter` (C3) on occt-wasm 5.8.1 | `initKernel`, `KernelError`, `withScope`, transform helpers |
| `sandbox` | ready | QuickJS-WASM boundary for agent scripts | `runScript(source, { params, hostApi, limits })` |
| `dsl` | ready | DSL v1 (C2) on brepjs 20.11.1 and the kernel | `createDsl(kernel)` returning `hostApi`, `reset`, `collect` |
| `assembly` | ready | Graph, clone sharing, fits, GeometryReport, exports | `buildAssembly`, `computeFits`, `report`, `exportArtifacts`, `exportFiles` |
| `render` | ready | Four-view HLR PNG and SVG | `renderAssembly(kernel, asm, { view, targets, format })` |
| `compute` | ready | DeviceInventory, placement, worker pool, job worker | `deviceInventory`, `place`, `createPool`, `doctor`, `runJobInline`; `createJobRunner` from `@open3dj/compute/job` |
| `mcp` | ready | Five tool handlers and the dual-era stdio server | `TOOL_DEFINITIONS`, `createHandlers`, `serveStdio`, `guardStdout` |
| `open3dj` | ready | CLI and daemon entry | `main(argv)`, `parseCommand` |

## How a run flows

1. `open3dj run part.o3j.js` or the MCP `run` tool calls the shared handler in `mcp`.
2. The handler places the job (`compute.place`) and sends it to the pool (`compute.createPool`).
3. A worker thread (stdout captured) runs `sandbox.runScript` with the `dsl` host API on its own kernel, inside `checkpoint()` and `releaseSince()`.
4. `dsl.collect` turns the result into parts; `assembly.buildAssembly` makes definitions and occurrences; `assembly.computeFits` and `assembly.report` make the GeometryReport.
5. For render and export jobs the worker adds `render.renderAssembly` or `assembly.exportArtifacts`, and the daemon writes the files inside the project folder.

## Rules for every package

- A package declared but not built exports `PACKAGE_STATUS = "stub"`. Its behaviour tests are skipped until it flips to `"ready"` in the change that implements it. Some skipped tests are placeholders that fail on purpose once the status flips, so the implementer writes them.
- The interfaces in each `index.ts` and `types.ts` are the contract between packages. Change one only together with its callers, and say so in the pull request.
- Runtime dependencies are already declared and pinned. Do not add one without an issue; the licence gate checks every installed package.
- Nothing may write to `process.stdout` in the MCP process except the transport. The kernel runs only in workers created with `stdout: true` and `stderr: true`.
