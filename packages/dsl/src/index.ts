// @open3dj/dsl: DSL v1 (contract C2), a 3dj-compatible modelling surface on the kernel adapter
// and brepjs 20.11.1, exposed to scripts through the sandbox. Ported from the DSL spike
// (docs/research/spikes/dsl-brepjs/src/dsl.mjs).
//
// How a run uses it (inside a worker that owns the kernel):
//   const dsl = createDsl(kernel);          // once per worker
//   const mark = kernel.checkpoint();
//   dsl.reset(params);                      // per run
//   const r = await runScript(source, { hostApi: dsl.hostApi, params, limits });
//   if (r.ok) { const out = dsl.collect(r.value); ... }
//   kernel.releaseSince(mark);              // after the parts are exported or measured
//
// - The guest sees integer ids only; the host table in RunState maps them to kernel handles.
// - Booleans, fillet, chamfer, shell, extrude, revolve and loft run through the kernel adapter,
//   which checks validity after each. Twisted and tapered extrusions use brepjs and are
//   checked the same way here. Failures reach the script as errors with code KERNEL_<code>,
//   the faulty elements and a hint; uncaught, they become the run's ScriptError.
// - Entries not in S1 throw DSL_NOT_IMPLEMENTED with the entry name (see DSL_ENTRIES).
import type { PackageStatus } from "@open3dj/schemas";

export type * from "./types.ts";
export { DslError } from "./errors.ts";
export { DSL_ENTRIES } from "./entries.ts";
export { runtimeHint } from "./hints.ts";
export { DEFAULT_QUERY_TOLERANCE, createDsl } from "./dsl.ts";
export { FASTENERS } from "./lib.ts";
export { describeKind, elementAddress, faceFingerprint, judgeReference, moveFingerprint, roundFaceConvex, sameSignature, signatureCandidates } from "./refs.ts";
export type { Judgement } from "./refs.ts";
export type { FastenerSpec } from "./lib.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";
