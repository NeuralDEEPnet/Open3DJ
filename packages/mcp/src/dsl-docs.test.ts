// docs/DSL.md must match its generator, cover every S1 entry, and every example in it must
// run through the real job runner (sandbox, DSL, kernel, assembly, report) without errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createJobRunner } from "@open3dj/compute/job";
import { DSL_ENTRIES } from "@open3dj/dsl";
import { initKernel } from "@open3dj/kernel";
import { validate } from "@open3dj/schemas";
import { DEFAULT_DOCS_FILE, parseDocs } from "./docs.ts";
import { ENTRY_EXAMPLES, EXAMPLES, PLAYBOOK, renderDslDoc } from "./dsl-docs.ts";

test("docs/DSL.md is up to date (node packages/mcp/src/dsl-docs.ts --write)", () => {
  assert.equal(readFileSync(DEFAULT_DOCS_FILE, "utf8"), renderDslDoc());
});

test("every S1 entry has a section and an example; later entries are listed", () => {
  const sections = parseDocs(renderDslDoc());
  const titles = new Set(sections.map((s) => s.title));
  for (const e of DSL_ENTRIES) {
    if (e.step === "S1") {
      assert.ok(titles.has(e.name), `section for ${e.name}`);
      assert.ok(ENTRY_EXAMPLES[e.name], `example for ${e.name}`);
    } else {
      assert.match(sections.find((s) => s.title === "Planned for later steps")!.text, new RegExp(e.signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
  for (const name of Object.keys(ENTRY_EXAMPLES)) assert.ok(DSL_ENTRIES.some((e) => e.name === name), `example for unknown entry ${name}`);
  const codes = PLAYBOOK.map((p) => p.code);
  assert.equal(new Set(codes).size, codes.length, "playbook codes are unique");
  for (const c of ["SCRIPT_SYNTAX", "DSL_NO_EDGES", "KERNEL_FILLET_FAILED", "REV_CONFLICT", "PATH_REFUSED", "NO_BACKEND", "JOB_TIMEOUT"]) assert.ok(codes.includes(c), c);
  for (const s of sections) assert.ok(["dsl", "lib", "error", "example"].includes(s.kind));
});

test("every example in docs/DSL.md runs and gives valid parts", async () => {
  const kernel = await initKernel({ sink: () => {} });
  const runner = createJobRunner(kernel);
  const all: Array<[string, string]> = [...Object.entries(ENTRY_EXAMPLES), ...EXAMPLES.map((e): [string, string] => [e.title, e.script])];
  let n = 0;
  for (const [name, script] of all) {
    const { result } = await runner.run({ kind: "run", script, rev: `r_${++n}` }, { workerId: 0, jobs: n });
    assert.ok(result.ok, `${name}: ${result.ok ? "" : `${result.error.code} ${result.error.message}`}`);
    if (!result.ok) continue;
    assert.ok(validate("geometry-report", result.report).valid, name);
    assert.equal(result.report.status, "ok", `${name}: ${JSON.stringify(result.report.warnings)} ${JSON.stringify(result.report.fits)}`);
    for (const p of result.report.parts) assert.ok(p.valid, `${name}: ${p.def} is invalid`);
  }
});

// Regression (review round 1): the mirrorCopy example said "a 50 mm bar" but built a 40 mm
// one. Agents check their numbers against these comments, so a size a comment states must
// be the size the script makes.
test("a bar length stated in an example comment is the length the example builds", async () => {
  const kernel = await initKernel({ sink: () => {} });
  const runner = createJobRunner(kernel);
  const sized = Object.entries(ENTRY_EXAMPLES).filter(([, script]) => /\/\/ a (\d+) mm bar/.test(script));
  assert.ok(sized.length > 0);
  for (const [name, script] of sized) {
    const want = Number(/\/\/ a (\d+) mm bar/.exec(script)![1]);
    const { result } = await runner.run({ kind: "run", script, rev: "r_1" }, { workerId: 0, jobs: 1 });
    assert.ok(result.ok, name);
    if (!result.ok) continue;
    const b = result.report.assembly.bbox ?? result.report.parts[0]!.bbox;
    assert.equal(b.max[0] - b.min[0], want, `${name}: the comment says ${want} mm`);
  }
});

// Regression (review round 2): the docs tool promises that an error code gives its fix, but
// codes such as INTERNAL_ERROR, KERNEL_TESSELLATION_FAILED and UNKNOWN_DEFINITION had no entry.
// The emitted codes are read from the sources, so a new code without a playbook entry fails here.
test("every error code the daemon, pool, sandbox, DSL, assembly, render and kernel can emit has a playbook entry", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const emitted = new Set<string>();
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name !== "node_modules") walk(p);
      } else if (/\.ts$/.test(d.name) && !/\.(test|testing)\.ts$/.test(d.name) && p.includes(`${sep}src${sep}`)) {
        const text = readFileSync(p, "utf8");
        const re = /(?:new (?:DslError|AssemblyError|RenderError|ToolError|StickyFault)\(|hostError\(|fail\(|code: )"([A-Z][A-Z0-9_]+)"/g;
        for (const m of text.matchAll(re)) emitted.add(m[1]!);
      }
    }
  };
  walk(root);
  // Kernel failures reach agents as KERNEL_<code>, for every member of KernelErrorCode.
  const kernelErrors = readFileSync(join(root, "kernel", "src", "errors.ts"), "utf8");
  const union = /export type KernelErrorCode =([^;]+);/.exec(kernelErrors)![1]!;
  for (const m of union.matchAll(/"([A-Z_]+)"/g)) emitted.add(`KERNEL_${m[1]}`);
  // Internal job-shape errors never reach an agent: the daemon builds every job itself.
  emitted.delete("BAD_JOB");
  const documented = new Set(PLAYBOOK.map((p) => p.code));
  const missing = [...emitted].filter((c) => !documented.has(c)).sort();
  assert.deepEqual(missing, [], `codes without a playbook entry: ${missing.join(", ")}`);
  for (const c of ["INTERNAL_ERROR", "KERNEL_TESSELLATION_FAILED", "UNKNOWN_DEFINITION", "XCAF_LOCATION_MISMATCH", "ASSEMBLY_TOO_DEEP", "DSL_OVERLAPPING_SOLIDS"]) assert.ok(emitted.has(c), `the scan finds ${c}`);
});
