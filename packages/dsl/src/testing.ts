// Test helper: one kernel and one DSL per test file, and a run() that measures every part
// before releasing the run's kernel handles. Not exported from the package index.
import { initKernel } from "@open3dj/kernel";
import type { Kernel, ShapeMeasure } from "@open3dj/kernel";
import { runScript } from "@open3dj/sandbox";
import type { RunScriptResult, ScriptLog, SandboxLimits } from "@open3dj/sandbox";
import type { ParamValue, ScriptError } from "@open3dj/schemas";
import { createDsl } from "./dsl.ts";
import type { Dsl, ScriptPart, ScriptReturn } from "./types.ts";

export interface MeasuredPart extends Omit<ScriptPart, "shape"> {
  m: ShapeMeasure;
}

export interface RunOutcome {
  ok: boolean;
  error?: ScriptError;
  parts: MeasuredPart[];
  out?: ScriptReturn;
  /** console.log lines of the script, JSON-parsed when they are JSON. */
  logs: unknown[];
  raw: RunScriptResult;
}

export interface Harness {
  kernel: Kernel;
  dsl: Dsl;
  run(code: string, params?: Record<string, ParamValue>, limits?: SandboxLimits): Promise<RunOutcome>;
}

let shared: Promise<Harness> | undefined;

export function harness(): Promise<Harness> {
  shared ??= (async () => {
    const kernel = await initKernel();
    const dsl = createDsl(kernel);
    const run = async (code: string, params: Record<string, ParamValue> = {}, limits: SandboxLimits = {}): Promise<RunOutcome> => {
      const mark = kernel.checkpoint();
      try {
        dsl.reset(params);
        const raw = await runScript(code, { hostApi: dsl.hostApi, params, limits: { cpuMs: 20_000, ...limits } });
        const logs = raw.logs.map((l: ScriptLog) => {
          try {
            return JSON.parse(l.message) as unknown;
          } catch {
            return l.message;
          }
        });
        if (!raw.ok) return { ok: false, error: raw.error, parts: [], logs, raw };
        let out: ScriptReturn;
        try {
          out = dsl.collect(raw.value);
        } catch (e) {
          const err = e as { code?: string; message: string };
          return { ok: false, error: { code: err.code ?? "HOST_ERROR", message: err.message }, parts: [], logs, raw };
        }
        const parts = out.parts.map(({ shape, ...rest }) => ({ ...rest, m: kernel.measure(shape) }));
        return { ok: true, parts, out, logs, raw };
      } finally {
        kernel.releaseSince(mark);
      }
    };
    return { kernel, dsl, run };
  })();
  return shared;
}

export const near = (a: number, b: number, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
export const vecNear = (a: readonly number[], b: readonly number[], tol = 1e-4) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < tol);
export const center = (m: ShapeMeasure) => m.bbox.min.map((x, i) => (x + m.bbox.max[i]!) / 2);
export const size = (m: ShapeMeasure) => m.bbox.min.map((x, i) => m.bbox.max[i]! - x);
