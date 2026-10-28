import type { Color3, Connector, DefinitionRef, ParamValue, Transform, Vec3 } from "@open3dj/schemas";
import type { ShapeHandle } from "@open3dj/kernel";
import type { GuestValue, HostApi } from "@open3dj/sandbox";

/** One shape the script returned, still in world coordinates as the script placed it. */
export interface ScriptPart {
  /** Descriptor name ({ name, shape }) or "part" for a bare shape; made unique with #n by the assembly builder. */
  name: string;
  /** Kernel handle, valid until the job's releaseSince(). */
  shape: ShapeHandle;
  color?: Color3;
  /**
   * Clone provenance: parts derived by clone() (then moved) from the same source share this
   * id, so the assembly builder can share one definition with label "measured".
   */
  cloneOf?: string;
  /** Rigid transform from the clone source to this part, when cloneOf is set. */
  cloneTransform?: Transform;
  /** Named reference points carried through transforms (withReferences, onFace, hole). */
  refs?: Record<string, Vec3>;
  /** Named faces and edges (withReferences with a face or edge query), resolved on this part, in its world frame. */
  namedRefs?: DefinitionRef[];
  /** Connectors (connector.male/female), in the part's world frame. */
  connectors?: Connector[];
  /** Sub-assembly path segments from asm.part()/groups, for example ["pcb_assy"]. */
  group?: string[];
  /** 1-based script line that created the part, for error and report addresses. */
  line?: number;
}

/** A matchTo call: a script-owned fastened mate between two connector paths. */
export interface ScriptMate {
  /** part.connector of the moving part. */
  a: string;
  /** part.connector of the target part. */
  b: string;
  flip: boolean;
  line?: number;
}

/** Everything a run produced, handed to @open3dj/assembly buildAssembly(). */
export interface ScriptReturn {
  parts: ScriptPart[];
  mates: ScriptMate[];
  /** Resolved Param values (declared default or caller override). */
  params: Record<string, ParamValue>;
  /** Every Param.* declaration in order, with its default, range and unit, for the report and UIs. */
  paramSpecs?: ParamSpec[];
  warnings: string[];
}

/** One Param.* declaration as the script made it. */
export interface ParamSpec {
  name: string;
  type: "number" | "bool" | "choice" | "string";
  default: ParamValue;
  value: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  options?: ParamValue[];
  maxLength?: number;
}

export interface DslOptions {
  /** Positional tolerance for edge and face queries in mm. 3dj publishes none; the spike used 1e-3. */
  queryTolerance?: number;
}

/**
 * The DSL bound to one kernel. Create it once per worker; reset() before every run.
 *
 *   const dsl = createDsl(kernel);
 *   dsl.reset(params);
 *   const r = await runScript(source, { hostApi: dsl.hostApi, params, limits });
 *   if (r.ok) { const parts = dsl.collect(r.value); ... }
 */
export interface Dsl {
  /** Host functions plus the guest prelude that defines the 3dj surface in the sandbox. */
  readonly hostApi: HostApi;
  /** Clear per-run state: the guest handle table, Param declarations and collected warnings. */
  reset(params?: Record<string, ParamValue>): void;
  /**
   * Turn the run's result value (what the prelude's __finish returned) into parts and mates.
   * Throws a DslError (code DSL_BAD_RETURN) when the value holds no shapes.
   */
  collect(value: GuestValue): ScriptReturn;
  /**
   * Cut this DSL's link to brepjs before its kernel is disposed, so the kernel can be freed.
   * Call it for a DSL on a short-lived kernel (a fresh instance), then register another
   * DSL with reset() before the next run. The DSL must not be used afterwards.
   */
  dispose(): void;
  /** Entry names and one-line signatures, for the docs tool. */
  readonly entries: ReadonlyArray<DslEntry>;
}

export interface DslEntry {
  name: string;
  signature: string;
  summary: string;
  /** Plan step that ships it, for example S1. */
  step: string;
}
