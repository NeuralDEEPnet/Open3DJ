// JSON Schema validation for the MCP SDK, backed by @open3dj/schemas. The SDK's default
// validator is ajv, which this package does not depend on; using our own validator also
// means tools/list and the handlers judge every input by the same rules.
import { SchemaRegistry, registry } from "@open3dj/schemas";
import type { SchemaObject, ValidationIssue } from "@open3dj/schemas";

type Result<T> = { valid: true; data: T; errorMessage: undefined } | { valid: false; data: undefined; errorMessage: string };

export interface SchemaValidatorProvider {
  getValidator<T>(schema: unknown): (input: unknown) => Result<T>;
}

/** A validator provider for fromJsonSchema(schema, provider). */
export function schemaValidator(): SchemaValidatorProvider {
  let n = 0;
  return {
    getValidator<T>(schema: unknown) {
      const s = schema as SchemaObject;
      // Our own schemas are registered by $id; anything else gets a private registry.
      let reg: SchemaRegistry = registry;
      let id = typeof s.$id === "string" ? s.$id : "";
      if (!id || !registry.has(id)) {
        reg = new SchemaRegistry();
        id = id || `urn:open3dj:mcp:anonymous-${++n}`;
        reg.add({ $schema: "https://json-schema.org/draft/2020-12/schema", ...s, $id: id });
      }
      return (input: unknown): Result<T> => {
        const r = reg.validate(id, input);
        if (r.valid) return { valid: true, data: input as T, errorMessage: undefined };
        return { valid: false, data: undefined, errorMessage: describeIssues(r.errors) };
      };
    },
  };
}

export function describeIssues(issues: ValidationIssue[], max = 5): string {
  const lines = issues.slice(0, max).map((e) => `${e.path || "/"} ${e.message}`);
  if (issues.length > max) lines.push(`and ${issues.length - max} more`);
  return lines.join("; ");
}
