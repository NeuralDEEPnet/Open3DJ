// A small JSON Schema (draft 2020-12) validator for the subset of keywords the Open3DJ
// schemas use. It refuses to register a schema that uses any other keyword, so a schema
// author can never rely on a keyword this validator would silently ignore.

export interface ValidationIssue {
  /** JSON Pointer to the failing value, "" for the root. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

export type JsonSchema = boolean | SchemaObject;
export interface SchemaObject {
  [keyword: string]: unknown;
}

const ASSERTION_KEYWORDS = new Set([
  "$ref", "type", "enum", "const",
  "properties", "required", "additionalProperties", "propertyNames", "minProperties", "maxProperties",
  "items", "prefixItems", "minItems", "maxItems",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern",
  "oneOf", "anyOf", "allOf", "not",
]);
const ANNOTATION_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$comment", "title", "description", "default", "examples", "deprecated", "format",
]);
const DRAFT = "https://json-schema.org/draft/2020-12/schema";

export class SchemaRegistry {
  #byId = new Map<string, SchemaObject>();
  #patterns = new Map<string, RegExp>();

  /** Register a root schema. It must carry $schema (draft 2020-12) and a unique $id. */
  add(schema: SchemaObject): void {
    if (schema.$schema !== DRAFT) throw new Error(`schema ${String(schema.$id)} must declare $schema ${DRAFT}`);
    const id = schema.$id;
    if (typeof id !== "string" || id === "") throw new Error("schema must have a string $id");
    if (this.#byId.has(id)) throw new Error(`duplicate schema $id ${id}`);
    this.#checkKeywords(schema, id);
    this.#byId.set(id, schema);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  ids(): string[] {
    return [...this.#byId.keys()];
  }

  get(id: string): SchemaObject | undefined {
    return this.#byId.get(id);
  }

  /** Check that every $ref in every registered schema resolves. Throws on the first broken one. */
  checkRefs(): void {
    for (const [id, schema] of this.#byId) this.#walkRefs(schema, id);
  }

  /**
   * A self-contained copy of a schema with every $ref inlined and no $defs, for consumers
   * that cannot resolve references across documents (MCP tools/list, some clients).
   * The schemas have no recursive references; a cycle throws.
   */
  dereference(id: string): SchemaObject {
    const root = this.#byId.get(id);
    if (!root) throw new Error(`unknown schema ${id}`);
    const inline = (node: unknown, base: string, trail: string[]): unknown => {
      if (Array.isArray(node)) return node.map((n) => inline(n, base, trail));
      if (!node || typeof node !== "object") return node;
      const o = node as SchemaObject;
      const out: SchemaObject = {};
      if (typeof o.$ref === "string") {
        const key = o.$ref.startsWith("#") ? base + o.$ref : o.$ref;
        if (trail.includes(key)) throw new Error(`recursive $ref ${key} cannot be inlined`);
        const r = this.#resolve(o.$ref, base);
        Object.assign(out, inline(r.schema, r.base, [...trail, key]) as SchemaObject);
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === "$ref" || k === "$defs" || k === "$id" || k === "$schema") continue;
        out[k] = k === "enum" || k === "const" || k === "default" || k === "examples" ? v : inline(v, base, trail);
      }
      return out;
    };
    const body = inline(root, id, [id]) as SchemaObject;
    return { $schema: DRAFT, $id: id, ...body };
  }

  validate(id: string, value: unknown): ValidationResult {
    const root = this.#byId.get(id);
    if (!root) throw new Error(`unknown schema ${id}`);
    const errors: ValidationIssue[] = [];
    this.#validate(root, id, value, "", errors);
    return { valid: errors.length === 0, errors };
  }

  #checkKeywords(schema: JsonSchema, where: string): void {
    if (typeof schema === "boolean") return;
    for (const [k, v] of Object.entries(schema)) {
      if (!ASSERTION_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k)) {
        throw new Error(`unsupported keyword "${k}" at ${where}`);
      }
      if (k === "pattern" && typeof v === "string") new RegExp(v, "u");
    }
    const sub = (s: unknown, at: string) => this.#checkKeywords(s as JsonSchema, at);
    for (const k of ["properties", "$defs"] as const) {
      const m = schema[k];
      if (m && typeof m === "object") for (const [n, s] of Object.entries(m)) sub(s, `${where}/${k}/${n}`);
    }
    for (const k of ["additionalProperties", "propertyNames", "items", "not"] as const) {
      const s = schema[k];
      if (s !== undefined && typeof s !== "boolean" && typeof s === "object") sub(s, `${where}/${k}`);
    }
    for (const k of ["prefixItems", "oneOf", "anyOf", "allOf"] as const) {
      const a = schema[k];
      if (Array.isArray(a)) a.forEach((s, i) => sub(s, `${where}/${k}/${i}`));
    }
  }

  #walkRefs(schema: unknown, base: string): void {
    if (!schema || typeof schema !== "object") return;
    if (Array.isArray(schema)) {
      for (const s of schema) this.#walkRefs(s, base);
      return;
    }
    const o = schema as SchemaObject;
    if (typeof o.$ref === "string") this.#resolve(o.$ref, base);
    for (const [k, v] of Object.entries(o)) {
      if (k === "enum" || k === "const" || k === "default" || k === "examples") continue;
      this.#walkRefs(v, base);
    }
  }

  #resolve(ref: string, base: string): { schema: JsonSchema; base: string } {
    const hash = ref.indexOf("#");
    const docId = hash === 0 ? base : hash > 0 ? ref.slice(0, hash) : ref;
    const pointer = hash >= 0 ? ref.slice(hash + 1) : "";
    const doc = this.#byId.get(docId);
    if (!doc) throw new Error(`unresolved $ref ${ref} (from ${base})`);
    let node: unknown = doc;
    if (pointer !== "") {
      for (const raw of pointer.split("/").slice(1)) {
        const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        if (!node || typeof node !== "object" || !(key in (node as object))) {
          throw new Error(`unresolved $ref ${ref} (from ${base})`);
        }
        node = (node as Record<string, unknown>)[key];
      }
    }
    return { schema: node as JsonSchema, base: docId };
  }

  #regex(p: string): RegExp {
    let r = this.#patterns.get(p);
    if (!r) {
      r = new RegExp(p, "u");
      this.#patterns.set(p, r);
    }
    return r;
  }

  #validate(schema: JsonSchema, base: string, value: unknown, path: string, errors: ValidationIssue[]): void {
    if (schema === true) return;
    if (schema === false) {
      errors.push({ path, message: "no value is allowed here" });
      return;
    }
    const s = schema;
    const fail = (message: string) => errors.push({ path, message });

    if (typeof s.$ref === "string") {
      const r = this.#resolve(s.$ref, base);
      this.#validate(r.schema, r.base, value, path, errors);
    }
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((t) => matchesType(t, value))) fail(`expected ${types.join(" or ")}, got ${typeName(value)}`);
    }
    if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, value))) {
      fail(`must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    }
    if ("const" in s && !deepEqual(s.const, value)) fail(`must equal ${JSON.stringify(s.const)}`);

    if (typeof value === "number") {
      if (typeof s.minimum === "number" && value < s.minimum) fail(`must be >= ${s.minimum}`);
      if (typeof s.maximum === "number" && value > s.maximum) fail(`must be <= ${s.maximum}`);
      if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) fail(`must be > ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) fail(`must be < ${s.exclusiveMaximum}`);
    }
    if (typeof value === "string") {
      const len = [...value].length;
      if (typeof s.minLength === "number" && len < s.minLength) fail(`must have at least ${s.minLength} characters`);
      if (typeof s.maxLength === "number" && len > s.maxLength) fail(`must have at most ${s.maxLength} characters`);
      if (typeof s.pattern === "string" && !this.#regex(s.pattern).test(value)) fail(`must match ${s.pattern}`);
    }
    if (Array.isArray(value)) {
      if (typeof s.minItems === "number" && value.length < s.minItems) fail(`must have at least ${s.minItems} items`);
      if (typeof s.maxItems === "number" && value.length > s.maxItems) fail(`must have at most ${s.maxItems} items`);
      const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as JsonSchema[]) : [];
      prefix.forEach((ps, i) => {
        if (i < value.length) this.#validate(ps, base, value[i], `${path}/${i}`, errors);
      });
      if (s.items !== undefined) {
        for (let i = prefix.length; i < value.length; i++) {
          this.#validate(s.items as JsonSchema, base, value[i], `${path}/${i}`, errors);
        }
      }
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (typeof s.minProperties === "number" && keys.length < s.minProperties) fail(`must have at least ${s.minProperties} properties`);
      if (typeof s.maxProperties === "number" && keys.length > s.maxProperties) fail(`must have at most ${s.maxProperties} properties`);
      if (Array.isArray(s.required)) {
        for (const r of s.required as string[]) if (!(r in value)) fail(`missing required property "${r}"`);
      }
      const props = (isObject(s.properties) ? s.properties : {}) as Record<string, JsonSchema>;
      for (const k of keys) {
        const p = `${path}/${escapePointer(k)}`;
        if (s.propertyNames !== undefined) {
          this.#validate(s.propertyNames as JsonSchema, base, k, p, errors);
        }
        if (k in props) this.#validate(props[k] as JsonSchema, base, value[k], p, errors);
        else if (s.additionalProperties === false) errors.push({ path: p, message: `unknown property "${k}"` });
        else if (s.additionalProperties !== undefined) {
          this.#validate(s.additionalProperties as JsonSchema, base, value[k], p, errors);
        }
      }
    }

    if (Array.isArray(s.allOf)) for (const sub of s.allOf as JsonSchema[]) this.#validate(sub, base, value, path, errors);
    if (Array.isArray(s.anyOf)) {
      const ok = (s.anyOf as JsonSchema[]).some((sub) => this.#passes(sub, base, value, path));
      if (!ok) fail("must match at least one of the anyOf schemas");
    }
    if (Array.isArray(s.oneOf)) {
      const branches = s.oneOf as JsonSchema[];
      const results = branches.map((sub) => {
        const e: ValidationIssue[] = [];
        this.#validate(sub, base, value, path, e);
        return e;
      });
      const passing = results.filter((e) => e.length === 0).length;
      if (passing === 0) {
        // Report the branch the author most likely meant: a failed const (a discriminator such
        // as "op") rules a branch out more strongly than any number of other errors.
        const score = (e: ValidationIssue[]) => e.length + 1000 * e.filter((x) => x.message.startsWith("must equal")).length;
        const best = results.reduce((a, b) => (score(b) < score(a) ? b : a));
        errors.push(...best);
        if (best.length === 0) fail("must match exactly one of the oneOf schemas");
      } else if (passing > 1) fail(`matches ${passing} oneOf schemas, expected exactly one`);
    }
    if (s.not !== undefined && this.#passes(s.not as JsonSchema, base, value, path)) fail("must not match the not schema");
  }

  #passes(schema: JsonSchema, base: string, value: unknown, path: string): boolean {
    const e: ValidationIssue[] = [];
    this.#validate(schema, base, value, path, e);
    return e.length === 0;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesType(t: string, v: unknown): boolean {
  switch (t) {
    case "null": return v === null;
    case "boolean": return typeof v === "boolean";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "string": return typeof v === "string";
    case "array": return Array.isArray(v);
    case "object": return isObject(v);
    default: throw new Error(`unknown type ${t}`);
  }
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number" && !Number.isFinite(v)) return "non-finite number";
  return typeof v;
}

function escapePointer(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}
