// The five tool handlers, shared by the MCP server and the CLI. The daemon never loads the
// kernel: every geometric question becomes a job on the compute pool, and the handlers only
// read and write the project store.
import { inventoryHash } from "@open3dj/compute";
import type { ArtifactFormat, JobKind, JobRequest, JobResult } from "@open3dj/compute";
import { validate } from "@open3dj/schemas";
import type {
  ComputeBlock, ComputeMode, DocsInput, DocsOutput, ExportOutput, GeometryReport, InspectOutput,
  ParamValue, PartReport, ProvenanceLine, RenderOutput, RunInput, RunOutput, ScriptError, ToolName,
} from "@open3dj/schemas";
import { loadDocs, searchDocs } from "./docs.ts";
import type { DocSection } from "./docs.ts";
import { ToolError, toScriptError } from "./errors.ts";
import { hashJson } from "./hash.ts";
import { JobTable } from "./jobs.ts";
import { lockProject, projectKey, resolveProject, writeOutputs, safeSegments } from "./paths.ts";
import { FILES, ProjectStore, STORE_ENTRIES, inputsHash, isKnownRev } from "./store.ts";
import type { Engine, RevisionRecord } from "./store.ts";
import { placements, resolveTargets, tree } from "./tree.ts";
import type { HandlerDeps, RenderResult, ToolHandlers } from "./types.ts";
import { describeIssues } from "./validator.ts";

export const DEFAULT_INTERACTIVE_MS = 20_000;

/** The compute block of a result that needed no kernel job. */
export function noJob(reason: string): ComputeBlock {
  return { backend: "none", device: "daemon", placement_reason: reason };
}

export function createHandlers(deps: HandlerDeps): ToolHandlers {
  const root = deps.root ?? process.cwd();
  const now = deps.now ?? (() => new Date());
  const placeFn = deps.place ?? ((mode, kind) => deps.pool.place(mode, kind));
  const interactiveMs = deps.interactiveMs ?? DEFAULT_INTERACTIVE_MS;
  const jobs = new JobTable();
  const locks = new Map<string, Promise<unknown>>();
  let docs: DocSection[] | undefined;

  const runtime = deps.inventory.runtime;
  const engine: Engine = { open3dj: deps.version ?? runtime.open3dj ?? "0.0.0", occt_wasm: runtime.occt_wasm ?? "unknown" };
  if (runtime.brepjs) engine.brepjs = runtime.brepjs;
  const provenanceEngine: ProvenanceLine["engine"] = { ...engine };
  if (runtime.quickjs) provenanceEngine.quickjs = runtime.quickjs;
  // The provenance schema wants bare hex; compute's hash may carry a "sha256:" prefix.
  const deviceHash = inventoryHash(deps.inventory).replace(/^sha256:/, "");

  const place = (mode: ComputeMode | undefined, kind: JobKind): ComputeBlock => {
    try {
      return placeFn(mode ?? "auto", kind, deps.inventory);
    } catch (e) {
      const err = toScriptError(e);
      throw new ToolError(err.code === "NO_BACKEND" ? "NO_BACKEND" : "INTERNAL_ERROR", err.message, err.hint);
    }
  };

  /**
   * One commit at a time per project, so two runs cannot both claim the next revision: an
   * in-process queue per project folder, plus the project's lock file against other
   * processes (a second daemon, or the CLI next to an agent's daemon).
   */
  const withLock = async <T>(store: ProjectStore, fn: () => Promise<T> | T): Promise<T> => {
    const key = projectKey(store.project);
    const locked = async () => {
      const release = await lockProject(store.project);
      try {
        return await fn();
      } finally {
        release();
      }
    };
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.then(locked, locked);
    const tail = next.catch(() => undefined);
    locks.set(key, tail);
    try {
      return await next;
    } finally {
      if (locks.get(key) === tail) locks.delete(key);
    }
  };

  const provenance = (store: ProjectStore, tool: ToolName, input: unknown, output: unknown, compute: ComputeBlock, revs: { base_rev?: string; rev?: string }) => {
    if (!store.exists()) return;
    const line: ProvenanceLine = {
      ts: now().toISOString(), tool, args_hash: hashJson(input), result_hash: hashJson(output), engine: provenanceEngine,
      device_inventory_hash: deviceHash, compute,
    };
    if (revs.base_rev) line.base_rev = revs.base_rev;
    if (revs.rev) line.rev = revs.rev;
    store.appendProvenance(line);
  };

  const runPool = async (job: JobRequest, mode: ComputeMode | undefined, lane: "interactive" | "batch", signal?: AbortSignal): Promise<Extract<JobResult, { ok: true }>> => {
    let r: JobResult;
    try {
      const options: Parameters<typeof deps.pool.run>[1] = { lane, mode: mode ?? "auto" };
      if (signal) options.signal = signal;
      r = await deps.pool.run(job, options);
    } catch (e) {
      throw new JobFailure(toScriptError(e));
    }
    if (!r.ok) throw new JobFailure(r.error);
    return r;
  };

  const conflict = (store: ProjectStore, base: string, head: string | undefined, label: string) =>
    !isKnownRev(store, base)
      ? new ToolError("UNKNOWN_REV", `${base} is not a revision of ${label}; the head is ${head ?? "none yet"}`, head ? `Use base_rev "${head}", or leave base_rev out to build on the head.` : "Leave base_rev out to create the first revision.")
      : new ToolError("REV_CONFLICT", `${label} is at ${head ?? "no revision"}, not ${base}: another change landed first`, head
      ? `Call inspect {fields: ["tree"]} to see ${head}, then run again with base_rev "${head}" (or without base_rev to build on the head).`
      : "Run again without base_rev to create the first revision.");

  /**
   * Run the job and commit a revision. dropped names the stored working values that were not
   * used because the script changed: the result says so, so the reset is never silent.
   */
  async function runAndCommit(store: ProjectStore, input: RunInput, job: JobRequest, signal: AbortSignal, dropped: string[] = []): Promise<RunOutput> {
    const compute = job.compute!;
    let output: RunOutput;
    let rev: string | undefined;
    try {
      const r = await runPool(job, input.compute, "interactive", signal);
      if (signal.aborted) throw new ToolError("JOB_CANCELLED", "the job was cancelled; no revision was created");
      const report = r.report;
      rev = await withLock(store, () => {
        const head = store.head();
        if (input.base_rev !== undefined && head !== input.base_rev) throw conflict(store, input.base_rev, head, store.project.label);
        // The values in effect: declared names only, clamped as the script resolved them.
        const params = r.params;
        const hash = inputsHash(job.script, params);
        if (head) {
          const h = store.revision(head);
          // The same inputs on the same engine give the same design: keep the revision.
          if (h.inputs_hash === hash && hashJson(h.engine) === hashJson(engine)) return head;
        }
        const next = store.nextRev();
        const rec: RevisionRecord = {
          rev: next, ts: now().toISOString(), script: job.script, params, inputs_hash: hash, engine,
          assembly: r.assembly, report: { ...report, rev: next }, detail: job.detail ?? "concise",
        };
        if (head) rec.base_rev = head;
        store.commit(rec);
        return next;
      });
      output = runResult(report, rev, compute);
      if (dropped.length > 0 && output.report) {
        const names = dropped.slice(0, 8).join(", ") + (dropped.length > 8 ? ", ..." : "");
        output.report.warnings = [...(output.report.warnings ?? []), `the script changed, so the stored values of ${names} were not used; the run started from the new script's defaults (pass params to set them again)`];
        if (output.status === "ok") output.status = "warning";
      }
    } catch (e) {
      output = { status: "error", error: e instanceof JobFailure ? e.error : toScriptError(e), compute };
    }
    const revs: { base_rev?: string; rev?: string } = {};
    if (input.base_rev) revs.base_rev = input.base_rev;
    if (rev) revs.rev = rev;
    provenance(store, "run", input, output, compute, revs);
    return output;
  }

  const handlers: ToolHandlers = {
    async run(input) {
      try {
        checkInput("run", input);
        const ops = input.ops ?? [];
        const cancels = ops.filter((o) => o.op === "cancel_job");
        if (cancels.length > 0) {
          if (cancels.length !== ops.length || input.script !== undefined) {
            throw new ToolError("BAD_INPUT", "cancel_job cannot be combined with a script or other ops", "Send run {project, ops: [{op: \"cancel_job\", job_id}]} on its own.");
          }
          for (const c of cancels) {
            if (!jobs.cancel(c.job_id)) throw new ToolError("JOB_NOT_FOUND", `no job ${c.job_id} in this daemon`, "Jobs live in the daemon's memory; a restarted daemon forgets them.");
          }
          return { status: "ok", job_id: cancels[0]!.job_id, compute: noJob("cancel_job: no revision is created") };
        }
        const project = resolveProject(root, input.project);
        const store = new ProjectStore(project);
        const manifest = store.manifest();
        if (!manifest && input.script === undefined) throw new ToolError("PROJECT_NOT_FOUND", `${project.label} is not a project yet`, "Call run with a script first; it creates the project.");
        const head = manifest?.rev;
        if (input.base_rev !== undefined && input.base_rev !== head) throw conflict(store, input.base_rev, head, project.label);
        const working = store.script() ?? (head ? store.revision(head).script : undefined);
        const script = input.script ?? working;
        if (script === undefined) throw new ToolError("NO_REVISION", `${project.label} has no script (${FILES.script})`, "Call run with a script.");
        // The working copy's values (params.o3j.json) belong to the working script. A different
        // script starts from its own defaults, so stale values never resize a new design.
        const kept = store.params();
        const stored = script === working ? kept : {};
        const dropped = script === working ? [] : Object.keys(kept).filter((k) => !Object.hasOwn(input.params ?? {}, k));
        const params: Record<string, ParamValue> = { ...stored, ...input.params };
        for (const op of ops) if (op.op === "set_param") params[op.name] = op.value;
        const compute = place(input.compute, "run");
        store.create(engine);
        const job: JobRequest = { kind: "run", script, params, rev: store.nextRev(), compute };
        if (head) job.previous = store.revision(head).assembly;
        if (input.detail) job.detail = input.detail;
        const started = jobs.start("run", compute, (signal) => runAndCommit(store, input, job, signal, dropped), (out) => {
          const o: { ok: boolean; rev?: string; reason?: string; result: RunOutput } = { ok: out.status !== "error" || out.error === undefined, result: out };
          if (out.rev) o.rev = out.rev;
          if (out.error) o.reason = `${out.error.code}: ${out.error.message}`;
          return o;
        });
        if (!(await jobs.waitFor(started.id, interactiveMs))) return { status: "queued", job_id: started.id, compute };
        return await started.result;
      } catch (e) {
        return { status: "error", error: toScriptError(e), compute: noJob("refused before placement") };
      }
    },

    async inspect(input) {
      const out: InspectOutput = { status: "ok", compute: noJob("answered from the project store and the daemon") };
      try {
        checkInput("inspect", input);
        const fields = new Set(input.fields);
        if (fields.has("devices")) out.devices = deps.inventory;
        if (fields.has("job")) {
          if (!input.job_id) throw new ToolError("BAD_INPUT", "fields [job] needs job_id", "Pass the job_id that run returned with status queued.");
          const job = jobs.get(input.job_id);
          if (!job) throw new ToolError("JOB_NOT_FOUND", `no job ${input.job_id} in this daemon`, "Jobs live in the daemon's memory; a restarted daemon forgets them.");
          out.job = job;
        }
        const projectFields = (["tree", "refs", "fits", "measure"] as const).filter((f) => fields.has(f));
        if (projectFields.length === 0) return out;
        if (!input.project) throw new ToolError("PROJECT_REQUIRED", `fields ${projectFields.join(", ")} need a project`, "Pass project, for example \"bracket.o3j\". Only devices and job work without one.");
        const store = new ProjectStore(resolveProject(root, input.project));
        const rec = store.resolve(input.rev);
        out.rev = rec.rev;
        const targets = input.targets?.length ? resolveTargets(rec.assembly, input.targets) : undefined;
        if (fields.has("tree")) out.tree = tree(rec.assembly);
        if (fields.has("refs")) out.refs = rec.report.refs ?? [];
        if (fields.has("fits") || fields.has("measure")) {
          const { report, compute } = await detailedReport(store, rec, input.compute);
          if (compute) out.compute = compute;
          if (fields.has("fits")) {
            const paths = targets ? new Set(targets.paths) : undefined;
            out.fits = paths ? report.fits.filter((f) => paths.has(f.a) || paths.has(f.b)) : report.fits;
          }
          if (fields.has("measure")) {
            const defs = targets ? new Set(targets.defs) : undefined;
            const parts = defs ? report.parts.filter((p) => defs.has(p.def)) : report.parts;
            out.measure = input.detail === "concise" ? parts.map(concisePart) : parts;
            if (targets) {
              const boxes = new Map(report.parts.map((p) => [p.def, p.bbox]));
              out.placements = placements(rec.assembly, targets.paths, (def) => boxes.get(def));
            }
          }
        }
        return out;
      } catch (e) {
        return { status: "error", error: e instanceof JobFailure ? e.error : toScriptError(e), compute: out.compute };
      }
    },

    async render(input) {
      let compute = noJob("refused before placement");
      try {
        checkInput("render", input);
        const store = new ProjectStore(resolveProject(root, input.project));
        const rec = store.resolve(input.rev);
        compute = place(input.compute, "render");
        const render: NonNullable<JobRequest["render"]> = { view: input.view, format: input.format ?? "png" };
        if (input.targets) render.targets = input.targets;
        if (input.width) render.width = input.width;
        if (input.height) render.height = input.height;
        const job = jobFor("render", rec, compute);
        job.render = render;
        let result: RenderResult;
        try {
          const r = await runPool(job, input.compute, "interactive");
          const images = r.images ?? [];
          const files = writeOutputs(store.project, `${FILES.out}/${rec.rev}`, images.map((i) => ({ name: i.name, format: i.format, bytes: i.bytes })));
          const output: RenderOutput = { status: "ok", rev: rec.rev, view: input.view, files, compute };
          if (input.targets) output.targets = input.targets;
          result = { output, images };
        } catch (e) {
          result = { output: { status: "error", rev: rec.rev, error: e instanceof JobFailure ? e.error : toScriptError(e), compute }, images: [] };
        }
        provenance(store, "render", input, { ...result.output }, compute, { rev: rec.rev });
        return result;
      } catch (e) {
        return { output: { status: "error", error: toScriptError(e), compute }, images: [] };
      }
    },

    async export(input) {
      let compute = noJob("refused before placement");
      try {
        checkInput("export", input);
        const store = new ProjectStore(resolveProject(root, input.project));
        const rec = store.resolve(input.rev);
        const outDir = input.out_dir ?? `${FILES.out}/${rec.rev}`;
        const first = safeSegments(outDir)[0]!;
        if (STORE_ENTRIES.has(first)) {
          throw new ToolError("PATH_REFUSED", `out_dir "${outDir}" is inside ${first}, which the project store owns`, `Export to ${FILES.out}/${rec.rev} (the default) or to a folder such as exports.`);
        }
        compute = place(input.compute, "export");
        const job = jobFor("export", rec, compute);
        // A scoped export names its scope, as render names its targets, so it never replaces the root export.
        const baseName = input.scope ? `${store.project.name}-${input.scope.replace(/[^A-Za-z0-9_-]/g, "_")}` : store.project.name;
        const exp: NonNullable<JobRequest["export"]> = { formats: [input.format as ArtifactFormat], baseName };
        if (input.scope) exp.scope = input.scope;
        job.export = exp;
        let output: ExportOutput;
        try {
          const r = await runPool(job, input.compute, "batch");
          const artifacts = r.artifacts ?? [];
          const files = writeOutputs(store.project, outDir, artifacts.map((a) => ({ name: a.name, format: a.format, bytes: a.bytes })));
          output = { status: "ok", rev: rec.rev, files, compute };
          const warnings = [...new Set(artifacts.flatMap((a) => a.warnings ?? []))];
          if (warnings.length) output.warnings = warnings;
        } catch (e) {
          output = { status: "error", rev: rec.rev, error: e instanceof JobFailure ? e.error : toScriptError(e), compute };
        }
        provenance(store, "export", input, output, compute, { rev: rec.rev });
        return output;
      } catch (e) {
        return { status: "error", error: toScriptError(e), compute };
      }
    },

    async docs(input: DocsInput): Promise<DocsOutput> {
      const r = validate("tool-docs-input", input);
      const query = (input as { query?: unknown } | undefined)?.query;
      if (!r.valid || typeof query !== "string" || query.trim() === "") {
        const problem = !r.valid ? describeIssues(r.errors) : "the query is empty";
        return {
          query: typeof query === "string" ? query.slice(0, 200) : "",
          page: 1,
          pages: 0,
          hits: [],
          error: { code: "BAD_INPUT", message: `invalid docs input: ${problem}`, hint: "Send docs {query: \"fillet\"} with a non-empty query (an entry name, a topic or an error code), and optionally page." },
        };
      }
      docs ??= loadDocs(deps.docsFile);
      return searchDocs(docs, input);
    },

    shutdown() {
      jobs.cancelAll();
    },
  };

  function jobFor(kind: JobKind, rec: RevisionRecord, compute: ComputeBlock): JobRequest {
    return { kind, script: rec.script, params: rec.params, rev: rec.rev, compute, previous: rec.assembly };
  }

  /** The detailed report of a revision: stored, cached, or computed once by a job. */
  async function detailedReport(store: ProjectStore, rec: RevisionRecord, mode: ComputeMode | undefined): Promise<{ report: GeometryReport; compute?: ComputeBlock }> {
    if (rec.detail === "detailed") return { report: rec.report };
    const cached = store.cachedReport(rec.rev);
    if (cached) return { report: cached };
    const placed = place(mode, "run");
    // The job is a run, but the caller asked inspect: say so in the reason.
    const compute = { ...placed, placement_reason: `inspect (a detailed run of ${rec.rev}); ${placed.placement_reason.replace(/\brun runs\b/, "it runs")}` };
    const job = jobFor("run", rec, compute);
    job.detail = "detailed";
    const r = await runPool(job, mode, "interactive");
    const report = { ...r.report, rev: rec.rev };
    store.cacheReport(rec.rev, report);
    return { report, compute };
  }

  return handlers;
}

/** A part measure for detail concise: 3 digits, and no area, centre of mass or full counts. */
function concisePart(p: PartReport): PartReport {
  const r = (x: number) => Number(x.toFixed(3)) + 0;
  const rv = (v: [number, number, number]): [number, number, number] => [r(v[0]), r(v[1]), r(v[2])];
  const out: PartReport = { def: p.def, valid: p.valid, volume_mm3: r(p.volume_mm3), bbox: { min: rv(p.bbox.min), max: rv(p.bbox.max) } };
  if (p.occurrences !== undefined) out.occurrences = p.occurrences;
  if (p.mass_g !== undefined) out.mass_g = r(p.mass_g);
  if (p.counts && p.counts.solids !== 1) out.counts = { solids: p.counts.solids };
  return out;
}

/** A run result: status, rev and compute once at the top, and the report without them. */
export function runResult(report: GeometryReport, rev: string, compute: ComputeBlock): RunOutput {
  const { status, rev: _rev, compute: _compute, ...rest } = report;
  return { status, rev, report: rest, compute };
}

/** A job that ended with a ScriptError (from the worker, or a compute failure). */
class JobFailure extends Error {
  readonly error: ScriptError;
  constructor(error: ScriptError) {
    super(error.message);
    this.error = error;
  }
}

/** Assembly ops named in ARCHITECTURE.md section 9 that arrive in S2; refused with a pointer to the script. */
const LATER_OPS = new Set(["add_occurrence", "remove", "set_transform", "replace_definition"]);

function checkInput(tool: ToolName, input: unknown): void {
  const ops = tool === "run" && input && typeof input === "object" ? (input as { ops?: unknown }).ops : undefined;
  const later = Array.isArray(ops) ? ops.find((o): o is { op: string } => !!o && typeof o === "object" && LATER_OPS.has((o as { op?: unknown }).op as string)) : undefined;
  if (later) {
    throw new ToolError("OP_NOT_IMPLEMENTED", `op ${later.op} arrives in S2; S1 runs support set_param and cancel_job`, "Change the script instead: return the parts with their placements, then run it.");
  }
  if (tool === "run" && input && typeof input === "object" && !("script" in input) && !("ops" in input)) {
    // The schema's anyOf message ("must match at least one of the anyOf schemas") says nothing useful.
    throw new ToolError("BAD_INPUT", "run needs a script, ops, or both", "Send the script to run it. To change a parameter of the stored script, use ops [{op: \"set_param\", name, value}]; params alone are only used together with a script.");
  }
  const r = validate(`tool-${tool}-input`, input);
  if (!r.valid) throw new ToolError("BAD_INPUT", `invalid ${tool} input: ${describeIssues(r.errors)}`, `Check the ${tool} tool's input schema in tools/list.`);
}
