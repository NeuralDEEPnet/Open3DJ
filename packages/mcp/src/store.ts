// The .o3j project store (ARCHITECTURE.md section 8, S1 subset). Layout:
//
//   bracket.o3j/
//     project.o3j.json     manifest: format version, units mm, Z up, head rev, engine pins
//     main.o3j.js          the DSL script of the working copy
//     params.o3j.json      parameter values of the working copy
//     assembly.o3j.json    assembly graph derived by the last accepted run
//     evidence.json        GeometryReport of the head revision
//     provenance.jsonl     append-only: tool, args hash, result hash, engine pins, device
//     revisions/r_0001.json  one immutable record per revision (script, params, graph, report)
//     out/r_0001/          renders and exports of a revision (git-ignored)
//     .o3j-cache/          derived data such as detailed reports (git-ignored)
//
// Revisions are r_0001, r_0002, ... and only grow. Each record holds everything needed to
// rebuild that revision, so render and export of an old revision re-run its own script.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@open3dj/schemas";
import type { AssemblyFile, GeometryReport, ParamValue, ProjectManifest, ProvenanceLine, Rev } from "@open3dj/schemas";
import { ToolError } from "./errors.ts";
import { hashJson } from "./hash.ts";
import { checkGraphSize } from "./tree.ts";
import { LOCK_FILE, appendProjectLine, ensureProjectRoot, readProjectFile, writeProjectFile } from "./paths.ts";
import type { ProjectDir } from "./paths.ts";

export const FILES = Object.freeze({
  manifest: "project.o3j.json",
  script: "main.o3j.js",
  params: "params.o3j.json",
  assembly: "assembly.o3j.json",
  evidence: "evidence.json",
  provenance: "provenance.jsonl",
  revisions: "revisions",
  out: "out",
  cache: ".o3j-cache",
});

export type Engine = ProjectManifest["engine"];

export interface RevisionRecord {
  rev: Rev;
  base_rev?: Rev;
  ts: string;
  script: string;
  params: Record<string, ParamValue>;
  /** Hash of script and params: a run with the same inputs reuses the revision. */
  inputs_hash: string;
  engine: Engine;
  /** ANALYSIS_VERSION of the code that made the report. Missing in revisions made before it existed. */
  analysis?: number;
  assembly: AssemblyFile;
  report: GeometryReport;
  detail: "concise" | "detailed";
}

export function inputsHash(script: string, params: Record<string, ParamValue>): string {
  return hashJson({ script, params });
}

export class ProjectStore {
  readonly project: ProjectDir;

  constructor(project: ProjectDir) {
    this.project = project;
  }

  exists(): boolean {
    return readProjectFile(this.project, FILES.manifest) !== undefined;
  }

  manifest(): ProjectManifest | undefined {
    const text = readProjectFile(this.project, FILES.manifest);
    if (text === undefined) return undefined;
    const m = parseJson<ProjectManifest>(text, FILES.manifest, this.project.label);
    const r = validate("project", m);
    if (!r.valid) throw new ToolError("PROJECT_CORRUPT", `${this.project.label}/${FILES.manifest} is not a valid project manifest: ${r.errors[0]?.path || "/"} ${r.errors[0]?.message}`, "Fix the file by hand, or restore it from git.");
    return m;
  }

  /** The manifest, or a PROJECT_NOT_FOUND error. */
  require(): ProjectManifest {
    const m = this.manifest();
    if (!m) throw new ToolError("PROJECT_NOT_FOUND", `${this.project.label} is not a project yet`, "Call run with a script first; it creates the project.");
    return m;
  }

  head(): Rev | undefined {
    return this.manifest()?.rev;
  }

  /** Create the folder, manifest and .gitignore. Keeps an existing manifest. */
  create(engine: Engine): ProjectManifest {
    const existing = this.manifest();
    if (existing) return existing;
    ensureProjectRoot(this.project);
    const m: ProjectManifest = { o3j: "0", name: this.project.name, units: "mm", up: "Z", engine };
    writeProjectFile(this.project, FILES.manifest, json(m));
    if (readProjectFile(this.project, ".gitignore") === undefined) writeProjectFile(this.project, ".gitignore", `${FILES.out}/\n${FILES.cache}/\n${LOCK_FILE}\n`);
    return m;
  }

  /** The working script (main.o3j.js), if any. */
  script(): string | undefined {
    return readProjectFile(this.project, FILES.script);
  }

  params(): Record<string, ParamValue> {
    const text = readProjectFile(this.project, FILES.params);
    if (text === undefined) return {};
    const p = parseJson<unknown>(text, FILES.params, this.project.label);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new ToolError("PROJECT_CORRUPT", `${this.project.label}/${FILES.params} must be an object of name: value`);
    for (const [k, v] of Object.entries(p)) {
      if (!["number", "string", "boolean"].includes(typeof v)) throw new ToolError("PROJECT_CORRUPT", `${this.project.label}/${FILES.params}: ${k} must be a number, string or boolean`);
    }
    return p as Record<string, ParamValue>;
  }

  /** Revision ids on disk, in order. */
  revisions(): Rev[] {
    const dir = join(this.project.dir, FILES.revisions);
    try {
      if (lstatSync(dir).isSymbolicLink()) throw new ToolError("PATH_REFUSED", `${this.project.label}/${FILES.revisions} is a symlink`);
    } catch (e) {
      if (e instanceof ToolError) throw e;
      return [];
    }
    // Only regular files with a sane number count: a folder or a 22-digit name (an export
    // into revisions/, or a cloned project) must not move the next revision number.
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => /^(r_\d{1,7})\.json$/.exec(d.name)?.[1])
      .filter((r): r is string => r !== undefined && revNumber(r) <= MAX_REV)
      .sort((a, b) => revNumber(a) - revNumber(b));
  }

  nextRev(): Rev {
    const all = this.revisions();
    const last = all.length ? revNumber(all[all.length - 1]!) : 0;
    return formatRev(last + 1);
  }

  revision(rev: Rev): RevisionRecord {
    if (!/^r_\d{1,7}$/.test(rev)) throw new ToolError("UNKNOWN_REV", `${rev} is not a revision of ${this.project.label}`, this.revHint());
    const text = readProjectFile(this.project, `${FILES.revisions}/${rev}.json`);
    if (text === undefined) throw new ToolError("UNKNOWN_REV", `${rev} is not a revision of ${this.project.label}`, this.revHint());
    const rec = parseJson<RevisionRecord>(text, `${FILES.revisions}/${rev}.json`, this.project.label);
    // A cloned or downloaded project is untrusted: check the graph before anything walks it.
    const where = `${this.project.label}/${FILES.revisions}/${rev}.json`;
    if (!rec || typeof rec !== "object" || typeof rec.script !== "string") throw new ToolError("PROJECT_CORRUPT", `${where} is not a revision record`, "Restore the file from git.");
    const r = validate("assembly", rec.assembly);
    if (!r.valid) throw new ToolError("PROJECT_CORRUPT", `${where} holds an invalid assembly graph: ${r.errors[0]?.path || "/"} ${r.errors[0]?.message}`, "Restore the file from git.");
    checkGraphSize(rec.assembly, where);
    return rec;
  }

  /** The record for rev, or for the head when rev is omitted. */
  resolve(rev?: Rev): RevisionRecord {
    this.require();
    const r = rev ?? this.head();
    if (!r) throw new ToolError("NO_REVISION", `${this.project.label} has no revision yet`, "Call run with a script first.");
    return this.revision(r);
  }

  private revHint(): string {
    const all = this.revisions();
    return all.length ? `Known revisions: ${all.slice(-8).join(", ")}; the head is ${this.head() ?? "none"}.` : "The project has no revisions yet; call run first.";
  }

  /**
   * Write a new revision and move the working copy and the head to it. Call it under the
   * project lock. The revision file is created exclusively: if another writer took that
   * number anyway, this throws REV_CONFLICT and changes nothing.
   */
  commit(rec: RevisionRecord, options: { saveParams?: boolean } = {}): void {
    const m = this.require();
    try {
      writeProjectFile(this.project, `${FILES.revisions}/${rec.rev}.json`, json(rec), { exclusive: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      throw new ToolError("REV_CONFLICT", `${this.project.label}/${FILES.revisions}/${rec.rev}.json already exists: another change landed first`, "Run again; the next run builds on the new head.");
    }
    writeProjectFile(this.project, FILES.script, rec.script);
    // save_params: false tries values without changing the working copy's params.
    if (options.saveParams ?? true) writeProjectFile(this.project, FILES.params, json(rec.params));
    writeProjectFile(this.project, FILES.assembly, json(rec.assembly));
    writeProjectFile(this.project, FILES.evidence, json(rec.report));
    writeProjectFile(this.project, FILES.manifest, json({ ...m, rev: rec.rev, engine: rec.engine }));
  }

  appendProvenance(line: ProvenanceLine): void {
    appendProjectLine(this.project, FILES.provenance, JSON.stringify(line));
  }

  cachedReport(rev: Rev): GeometryReport | undefined {
    const text = readProjectFile(this.project, `${FILES.cache}/${rev}.report.json`);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as GeometryReport;
    } catch {
      return undefined;
    }
  }

  cacheReport(rev: Rev, report: GeometryReport): void {
    writeProjectFile(this.project, `${FILES.cache}/${rev}.report.json`, json(report));
  }
}

/** Largest revision number: r_9999999. */
export const MAX_REV = 9_999_999;

/** Names at the top of a project folder that belong to the store; exports may not write there. */
export const STORE_ENTRIES: ReadonlySet<string> = new Set([...Object.values(FILES).filter((f) => f !== FILES.out), ".gitignore", LOCK_FILE]);

/** True when rev names a revision file of this project. */
export function isKnownRev(store: ProjectStore, rev: Rev): boolean {
  return store.revisions().includes(rev);
}

export function revNumber(rev: Rev): number {
  return Number(rev.slice(2));
}

export function formatRev(n: number): Rev {
  return `r_${String(n).padStart(4, "0")}`;
}

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

function parseJson<T>(text: string, file: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ToolError("PROJECT_CORRUPT", `${label}/${file} is not valid JSON: ${(e as Error).message}`, "Fix the file by hand, or restore it from git.");
  }
}
