// One job on one kernel: sandbox + dsl + assembly + render, inside checkpoint/releaseSince.
// The worker entry and runJobInline() share this, so the pool and the inline path give the
// same results.
import { getHeapStatistics } from "node:v8";
import { AssemblyError, buildAssembly, computeFits, exportArtifacts, report, writeArtifacts } from "@open3dj/assembly";
import { DslError, createDsl, runtimeHint } from "@open3dj/dsl";
import type { Dsl } from "@open3dj/dsl";
import { KernelError, isFatalWasmError, toKernelError } from "@open3dj/kernel";
import type { Kernel } from "@open3dj/kernel";
import { RenderError, renderAssembly } from "@open3dj/render";
import { runScript } from "@open3dj/sandbox";
import type { HostApi, ScriptLog } from "@open3dj/sandbox";
import { redactPaths as redactAll } from "@open3dj/schemas";
import type { ComputeBlock, ScriptError } from "@open3dj/schemas";
import { runtimeVersions } from "./inventory.ts";
import { INLINE_COMPUTE } from "./place.ts";
import type { JobRequest, JobResult, WorkerStats } from "./types.ts";

export { INLINE_COMPUTE };

export interface JobContext {
  workerId: number;
  /** Jobs this runner has run, including this one. */
  jobs: number;
  /** Cooperative cancel, checked by the sandbox and between stages. */
  signal?: { readonly aborted: boolean };
}

export interface JobOutcome {
  result: JobResult;
  /** Set when the kernel that ran the job must not run another one, with the reason. */
  recycle?: string;
}

export interface JobRunner {
  readonly kernel: Kernel;
  run(job: JobRequest, context: JobContext): Promise<JobOutcome>;
}

class Cancelled extends Error {}

type Shared = "kind" | "logs" | "stats" | "compute";
/** A JobResult before the runner adds kind, logs, stats and compute. */
type ResultBody = JobResult extends infer R ? (R extends JobResult ? Omit<R, Shared> : never) : never;

/** Bind a runner to one kernel. One runner per thread: the DSL registers brepjs globally. */
export function createJobRunner(kernel: Kernel): JobRunner {
  const dsl = createDsl(kernel);
  // The last kernel error code a host function raised in this job. A script can catch a
  // kernel error and still succeed, but the kernel that raised it is retired all the same.
  let kernelFault: string | undefined;
  const hostApi = watchKernelErrors(dsl, (code) => (kernelFault = code));

  return {
    kernel,
    async run(job, context) {
      const t0 = performance.now();
      const compute = job.compute ?? INLINE_COMPUTE;
      const params = job.params ?? {};
      const mark = kernel.checkpoint();
      let logs: ScriptLog[] = [];
      let recycle: string | undefined;
      kernelFault = undefined;
      const finish = (body: ResultBody): JobOutcome => {
        try {
          kernel.releaseSince(mark);
        } catch (e) {
          recycle ??= `releaseSince failed: ${(e as Error).message}`;
        }
        if (kernelFault) recycle ??= `kernel error ${kernelFault}`;
        const stats = workerStats(kernel, context, performance.now() - t0);
        const result = { ...body, kind: job.kind, logs, stats, compute } as JobResult;
        return recycle ? { result, recycle } : { result };
      };
      const checkCancel = () => {
        if (context.signal?.aborted) throw new Cancelled();
      };

      try {
        dsl.reset(params);
        const run = await runScript(job.script, { hostApi, params, ...(job.limits ? { limits: job.limits } : {}), ...(context.signal ? { signal: context.signal } : {}) });
        logs = run.logs;
        if (!run.ok) {
          const hint = runtimeHint(run.error, job.script);
          return finish({ ok: false, error: hint ? { ...run.error, hint } : run.error });
        }
        const out = dsl.collect(run.value);
        checkCancel();
        const asm = buildAssembly(kernel, out, { ...(job.rootName ? { rootName: job.rootName } : {}), ...(job.previous ? { previous: job.previous } : {}) });
        const fits = computeFits(kernel, asm);
        const geometry = report(kernel, asm, { rev: job.rev, compute, fits, ...(job.detail ? { detail: job.detail } : {}) });
        const base = { ok: true as const, report: geometry, assembly: asm.file, params: out.params };
        if (job.kind === "run") return finish(base);
        checkCancel();
        if (job.kind === "render") {
          const images = await renderAssembly(kernel, asm, job.render ?? { view: "multiview" });
          return finish({ ...base, images });
        }
        if (job.kind === "export") {
          if (!job.export || job.export.formats.length === 0) {
            return finish({ ok: false, error: { code: "BAD_JOB", message: "an export job needs export.formats", hint: "Pass export: { formats: ['step'] }." } });
          }
          const { formats, baseName, scope, dir, root, author, organization } = job.export;
          const artifacts = exportArtifacts(kernel, asm, formats, {
            rev: job.rev, engine: engineVersions(), ...(baseName ? { baseName } : {}), ...(scope ? { scope } : {}),
            ...(author ? { author } : {}), ...(organization ? { organization } : {}),
          });
          if (dir === undefined) return finish({ ...base, artifacts });
          const files = await writeArtifacts(artifacts, dir, root === undefined ? {} : { root });
          return finish({ ...base, artifacts, files });
        }
        return finish({ ok: false, error: { code: "BAD_JOB", message: `unknown job kind '${String(job.kind)}'`, hint: "Use run, render or export." } });
      } catch (e) {
        const { error, fault } = toScriptError(e);
        if (fault) recycle = fault;
        return finish({ ok: false, error });
      }
    },
  };
}

// Wrap every host function so kernel errors are seen even when the script catches them.
function watchKernelErrors(dsl: Dsl, onFault: (code: string) => void): HostApi {
  const functions: HostApi["functions"] = {};
  for (const [name, fn] of Object.entries(dsl.hostApi.functions)) {
    functions[name] = (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === "string" && code.startsWith("KERNEL_")) onFault(code);
        else if (isFatalWasmError(e)) onFault("KERNEL_KERNEL_ABORT");
        throw e;
      }
    };
  }
  return { ...dsl.hostApi, functions };
}

/** Convert a failure after the script ran into a ScriptError. fault is set when the kernel must be retired. */
export function toScriptError(e: unknown): { error: ScriptError; fault?: string } {
  if (e instanceof Cancelled) return { error: { code: "JOB_CANCELLED", message: "the job was cancelled" } };
  if (e instanceof KernelError || isFatalWasmError(e)) {
    const k = e instanceof KernelError ? e : toKernelError("job", e);
    const error: ScriptError = { code: `KERNEL_${k.code}`, message: k.message, op: k.op };
    if (k.elements.length) error.elements = k.elements;
    if (k.hint) error.hint = k.hint;
    return { error, fault: `kernel error KERNEL_${k.code}` };
  }
  if (e instanceof DslError || e instanceof AssemblyError || e instanceof RenderError) {
    const error: ScriptError = { code: e.code, message: e.message };
    if (e.hint) error.hint = e.hint;
    if (e instanceof AssemblyError && e.line !== undefined) error.line = e.line;
    if (e instanceof DslError) {
      if (e.op) error.op = e.op;
      if (e.elements?.length) error.elements = e.elements;
    }
    return { error };
  }
  // Anything else is a bug or an I/O failure. Keep the message, drop file paths, and retire
  // the kernel because we cannot tell what state it is in.
  const message = e instanceof Error ? e.message : String(e);
  return {
    error: { code: "INTERNAL_ERROR", message: redactPaths(message), hint: "This is a bug in Open3DJ, not in the script. Please report it with the script." },
    fault: `unexpected error: ${redactPaths(message)}`,
  };
}

/** Absolute paths become "<path>", also those with spaces in them (see @open3dj/schemas). */
export function redactPaths(message: string): string {
  return redactAll(message);
}

function engineVersions(): Record<string, string> {
  const r = runtimeVersions();
  const out: Record<string, string> = {};
  if (r.open3dj) out["open3dj"] = r.open3dj;
  if (r.brepjs) out["brepjs"] = r.brepjs;
  if (r.quickjs) out["quickjs"] = r.quickjs;
  return out;
}

/** Kernel WebAssembly memory plus this thread's JS heap: what the pool compares with recycleBytes. */
export function memoryBytes(kernel: Kernel): number {
  return kernel.stats().wasmHeapBytes + getHeapStatistics().total_heap_size;
}

function workerStats(kernel: Kernel, context: JobContext, wallMs: number): WorkerStats {
  let liveShapes = -1;
  let memory = getHeapStatistics().total_heap_size;
  try {
    const s = kernel.stats();
    liveShapes = s.liveShapes;
    memory += s.wasmHeapBytes;
  } catch {
    // A broken kernel cannot report; the runner has already asked for a recycle.
  }
  return { workerId: context.workerId, jobs: context.jobs, wallMs: Math.round(wallMs * 10) / 10, memoryBytes: memory, liveShapes };
}
