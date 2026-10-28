// @open3dj/schemas: the v0 contract schemas (C1 tools and reports, C4 project files,
// C5 compute) and their TypeScript types, plus validate(schemaId, value).
import { SchemaRegistry } from "./validator.ts";
import type { SchemaObject, ValidationResult } from "./validator.ts";
import type { PackageStatus } from "./errors.ts";
import common from "../json/common.schema.json" with { type: "json" };
import compute from "../json/compute.schema.json" with { type: "json" };
import deviceInventory from "../json/device-inventory.schema.json" with { type: "json" };
import scriptError from "../json/script-error.schema.json" with { type: "json" };
import geometryReport from "../json/geometry-report.schema.json" with { type: "json" };
import provenance from "../json/provenance.schema.json" with { type: "json" };
import project from "../json/project.schema.json" with { type: "json" };
import assembly from "../json/assembly.schema.json" with { type: "json" };
import runIn from "../json/tool-run-input.schema.json" with { type: "json" };
import runOut from "../json/tool-run-output.schema.json" with { type: "json" };
import inspectIn from "../json/tool-inspect-input.schema.json" with { type: "json" };
import inspectOut from "../json/tool-inspect-output.schema.json" with { type: "json" };
import renderIn from "../json/tool-render-input.schema.json" with { type: "json" };
import renderOut from "../json/tool-render-output.schema.json" with { type: "json" };
import exportIn from "../json/tool-export-input.schema.json" with { type: "json" };
import exportOut from "../json/tool-export-output.schema.json" with { type: "json" };
import docsIn from "../json/tool-docs-input.schema.json" with { type: "json" };
import docsOut from "../json/tool-docs-output.schema.json" with { type: "json" };
import benchTask from "../json/bench-task.schema.json" with { type: "json" };

export type * from "./types.ts";
export type { ValidationIssue, ValidationResult, JsonSchema, SchemaObject } from "./validator.ts";
export { SchemaRegistry } from "./validator.ts";
export { NotImplementedError } from "./errors.ts";
export { MAX_NAME_LENGTH, cleanName } from "./names.ts";
export { collapseFits, rankFits } from "./fits.ts";
export { redactPaths } from "./redact.ts";
export type { PackageStatus } from "./errors.ts";

export const PACKAGE_STATUS: PackageStatus = "ready";

/** Major version of every schema in this package. */
export const SCHEMA_VERSION = "v0";

/**
 * Version of the analysis that turns a model into a report: fits, fingerprint references and
 * report fields. A revision records it, and a run reuses a revision for the same script and
 * params only when it matches. Package versions stay 0.0.0 in a checkout, so bump this
 * whenever a change moves what a report says for the same model.
 */
export const ANALYSIS_VERSION = 2;

/** Short names accepted by validate(), mapped to their $id. */
export const SCHEMA_IDS = {
  "common": "urn:open3dj:v0:common",
  "compute": "urn:open3dj:v0:compute",
  "device-inventory": "urn:open3dj:v0:device-inventory",
  "script-error": "urn:open3dj:v0:script-error",
  "geometry-report": "urn:open3dj:v0:geometry-report",
  "provenance": "urn:open3dj:v0:provenance",
  "project": "urn:open3dj:v0:project",
  "assembly": "urn:open3dj:v0:assembly",
  "tool-run-input": "urn:open3dj:v0:tool-run-input",
  "tool-run-output": "urn:open3dj:v0:tool-run-output",
  "tool-inspect-input": "urn:open3dj:v0:tool-inspect-input",
  "tool-inspect-output": "urn:open3dj:v0:tool-inspect-output",
  "tool-render-input": "urn:open3dj:v0:tool-render-input",
  "tool-render-output": "urn:open3dj:v0:tool-render-output",
  "tool-export-input": "urn:open3dj:v0:tool-export-input",
  "tool-export-output": "urn:open3dj:v0:tool-export-output",
  "tool-docs-input": "urn:open3dj:v0:tool-docs-input",
  "tool-docs-output": "urn:open3dj:v0:tool-docs-output",
  "bench-task": "urn:open3dj:v0:bench-task",
} as const;

export type SchemaName = keyof typeof SCHEMA_IDS;

const ALL: SchemaObject[] = [
  common, compute, deviceInventory, scriptError, geometryReport, provenance, project, assembly,
  runIn, runOut, inspectIn, inspectOut, renderIn, renderOut, exportIn, exportOut, docsIn, docsOut, benchTask,
];

/** The registry holding every v0 schema. Built once; every $ref is checked at load. */
export const registry: SchemaRegistry = (() => {
  const r = new SchemaRegistry();
  for (const s of ALL) r.add(s);
  r.checkRefs();
  return r;
})();

/** Raw JSON Schema document by short name or $id, for example to publish in tools/list. */
export function getSchema(schemaId: SchemaName | string): SchemaObject {
  const id = resolveId(schemaId);
  const s = registry.get(id);
  if (!s) throw new Error(`unknown schema ${schemaId}`);
  return s;
}

/**
 * A self-contained copy of a schema (every $ref inlined, no $defs). Use it wherever a schema
 * leaves this package, for example as an MCP tool's inputSchema or outputSchema.
 */
export function dereferencedSchema(schemaId: SchemaName | string): SchemaObject {
  return registry.dereference(resolveId(schemaId));
}

/** Validate a value against a schema given by short name (geometry-report) or $id. */
export function validate(schemaId: SchemaName | string, value: unknown): ValidationResult {
  return registry.validate(resolveId(schemaId), value);
}

/** Like validate(), but throws a SchemaValidationError listing every issue. */
export function assertValid(schemaId: SchemaName | string, value: unknown): void {
  const r = validate(schemaId, value);
  if (!r.valid) throw new SchemaValidationError(schemaId, r);
}

export class SchemaValidationError extends Error {
  readonly schemaId: string;
  readonly issues: ValidationResult["errors"];
  constructor(schemaId: string, result: ValidationResult) {
    const lines = result.errors.slice(0, 10).map((e) => `${e.path || "/"}: ${e.message}`);
    super(`value does not match ${schemaId}:\n  ${lines.join("\n  ")}`);
    this.name = "SchemaValidationError";
    this.schemaId = schemaId;
    this.issues = result.errors;
  }
}

function resolveId(schemaId: string): string {
  return (SCHEMA_IDS as Record<string, string>)[schemaId] ?? schemaId;
}
