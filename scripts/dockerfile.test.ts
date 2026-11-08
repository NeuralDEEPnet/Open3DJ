// The Dockerfile at the repository root builds the MCP server image that MCP directories such
// as Glama build and list. Tests have no network and CI has no Docker build, so this checks
// the file itself: a Node base image pinned by version and digest on the major in .nvmrc,
// runtime dependencies from the lockfile without install scripts (as the installers do), a
// non-root user, an entry point that exists in this checkout, and a .dockerignore that lets
// in every file the server reads at run time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOCS_FILE } from "@open3dj/mcp";
import { ROOT } from "./lib.ts";

/** Dockerfile instructions as [keyword, arguments], with comments dropped and continuation lines joined. */
function instructions(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (current === "" && (line === "" || line.startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      current += `${line.slice(0, -1)} `;
      continue;
    }
    current += line;
    const [keyword = "", ...rest] = current.split(/\s+/);
    out.push([keyword.toUpperCase(), rest.join(" ")]);
    current = "";
  }
  return out;
}

const steps = instructions(readFileSync(join(ROOT, "Dockerfile"), "utf8"));
const args = (keyword: string) => steps.filter(([k]) => k === keyword).map(([, a]) => a);
const indexOf = (keyword: string) => steps.findIndex(([k]) => k === keyword);

test("the base image is Node at the .nvmrc major, pinned by exact version and digest", () => {
  const from = args("FROM");
  assert.equal(from.length, 1, "one stage");
  const m = /^node:(\d+)\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/.exec(from[0]!);
  assert.ok(m, `FROM ${from[0]} is not node:<major>.<minor>.<patch>-<distro>-slim@sha256:<digest>`);
  assert.equal(m[1], readFileSync(join(ROOT, ".nvmrc"), "utf8").trim(), "the Node major in .nvmrc");
});

test("dependencies come from the lockfile, runtime only, without install scripts", () => {
  const run = args("RUN").join(" && ");
  assert.match(run, /npm ci\b[^&]*--omit=dev/);
  assert.match(run, /npm ci\b[^&]*--ignore-scripts/);
  assert.doesNotMatch(run, /npm (install|i)\b/);
});

test("the server runs as a non-root user from an entry point in this checkout", () => {
  const users = args("USER");
  assert.ok(users.length > 0, "a USER instruction");
  assert.ok(!/^(root|0)(:|$)/.test(users.at(-1)!), `USER ${users.at(-1)}`);
  assert.ok(indexOf("USER") < indexOf("ENTRYPOINT"), "USER comes before ENTRYPOINT");

  assert.equal(args("WORKDIR")[0], "/app", "the checkout is copied to /app");
  assert.ok(args("COPY").includes(". ."), "COPY . . into /app");
  const entry = JSON.parse(args("ENTRYPOINT")[0] ?? "null") as string[];
  assert.equal(entry[0], "node");
  assert.ok(entry[1]?.startsWith("/app/"), `${entry[1]} is under /app`);
  const cli = entry[1]!.slice("/app/".length);
  assert.ok(existsSync(join(ROOT, cli)), `${cli} exists`);
  assert.deepEqual(entry.slice(2, 4), ["mcp", "--root"]);
});

test(".dockerignore lets in only what the server needs, including the docs tool's DSL reference", () => {
  const rules = readFileSync(join(ROOT, ".dockerignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  assert.equal(rules[0], "*", "everything is left out first");
  const docs = relative(ROOT, fileURLToPath(DEFAULT_DOCS_FILE)).split(sep).join("/");
  for (const needed of ["package.json", "package-lock.json", ".npmrc", "LICENSE", "packages/", docs]) {
    assert.ok(rules.includes(`!${needed}`), `.dockerignore lets in ${needed}`);
  }
  assert.ok(rules.includes("packages/**/node_modules"), "local node_modules stay out");
});
