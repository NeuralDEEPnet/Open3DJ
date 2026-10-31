// Static safety checks for .github/workflows. They guard the rules that keep a public
// repository safe with fork pull requests: no untrusted text in shell scripts, no pull
// request code in privileged workflows, minimal permissions, and check names that match
// the merge policy. Line based on purpose: the repository has no YAML dependency.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { classifyPath, validatePolicy } from "./policy.ts";

const dir = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((name) => ({ name, text: readFileSync(new URL(name, dir), "utf8") }));
const policy = validatePolicy(JSON.parse(readFileSync(new URL("../../.github/merge-policy.json", import.meta.url), "utf8")));

const UNTRUSTED = /github\.head_ref|github\.event\.(?:pull_request\.(?:title|body|head\.ref|head\.label)|issue\.(?:title|body)|comment\.body|review\.body|review_comment\.body|head_commit\.(?:message|author)|commits|pages|workflow_run\.(?:head_branch|display_title|head_commit|pull_requests))/;
const PRIVILEGED = /^\s*(pull_request_target|workflow_run|check_suite|schedule|pull_request_review):/m;
/** Workflows that build and run the repository's code (CI and the install smoke). */
const BUILDS = ["ci.yml", "install-smoke.yml"];

/** The text of every run: script, single-line or block. */
function runScripts(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    if (!/^[|>]/.test(m[2]!)) {
      out.push(m[2]!);
      continue;
    }
    const indent = m[1]!.length;
    const body: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1]!.trim() === "" || /^\s*/.exec(lines[i + 1]!)![0].length > indent + 2)) body.push(lines[++i]!);
    out.push(body.join("\n"));
  }
  return out;
}

describe("workflows", () => {
  it("finds the expected workflow files", () => {
    assert.deepEqual(workflows.map((w) => w.name), ["ai-review.yml", "automerge.yml", "ci.yml", "dco.yml", "evaluate.yml", "install-smoke.yml", "review-relay.yml"]);
  });

  for (const w of workflows) {
    describe(w.name, () => {
      it("declares top-level permissions", () => {
        assert.match(w.text, /^permissions:/m);
      });
      it("never puts an expression into a shell script", () => {
        for (const s of runScripts(w.text)) assert.ok(!s.includes("${{"), `run: script uses an expression; pass it through env instead:\n${s}`);
      });
      it("uses untrusted pull request text only in run-name and concurrency groups", () => {
        for (const line of w.text.split("\n")) {
          if (/^\s*(run-name|group):/.test(line)) continue;
          assert.ok(!UNTRUSTED.test(line), `untrusted value outside run-name or group: ${line.trim()}`);
        }
      });
      it("does not persist checkout credentials", () => {
        const checkouts = w.text.split("uses: actions/checkout").length - 1;
        const off = w.text.split("persist-credentials: false").length - 1;
        assert.equal(off, checkouts);
      });
      if (BUILDS.includes(w.name)) {
        // These two exist to install and run the code under test, so they may only do it
        // unprivileged: pull_request (never pull_request_target), a read-only token.
        it("runs pull request code only without privileges", () => {
          assert.ok(!PRIVILEGED.test(w.text), "a privileged trigger");
          assert.ok(!/pull_request_target/.test(w.text));
          assert.match(w.text, /^permissions:\n  contents: read\n/m);
          assert.ok(!/^\s+[a-z-]+: write$/m.test(w.text), "a write permission");
        });
      } else {
        it("never installs or runs the repository's packages", () => {
          assert.ok(!/\bnpm (ci|install|run|test|exec)\b|\bnpx\b|\byarn\b|\bpnpm\b/.test(w.text));
        });
      }
      if (PRIVILEGED.test(w.text) || w.name === "evaluate.yml" || w.name === "dco.yml") {
        it("checks out only the default branch, never pull request code", () => {
          assert.ok(!/head\.sha|head_sha|head\.ref|refs\/pull|github\.sha|merge_commit_sha/.test(w.text), "a reference to pull request code");
          const refs = [...w.text.matchAll(/uses: actions\/checkout@[^\n]+\n\s+with:\n((?:\s{10}.*\n)+)/g)].map((m) => m[1]!);
          const checkouts = w.text.split("uses: actions/checkout").length - 1;
          assert.equal(refs.length, checkouts);
          for (const r of refs) assert.match(r, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
        });
      }
    });
  }

  it("gives write permissions only to the jobs that need them", () => {
    const writes = (name: string) => [...(workflows.find((w) => w.name === name)?.text ?? "").matchAll(/^\s+([a-z-]+): write$/gm)].map((m) => m[1]).sort();
    assert.deepEqual(writes("ci.yml"), []);
    assert.deepEqual(writes("install-smoke.yml"), []);
    assert.deepEqual(writes("evaluate.yml"), []);
    assert.deepEqual(writes("dco.yml"), []);
    assert.deepEqual(writes("review-relay.yml"), []);
    assert.deepEqual(writes("ai-review.yml"), ["issues", "pull-requests", "statuses"]);
    assert.deepEqual(writes("automerge.yml"), ["actions", "contents", "issues", "pull-requests", "statuses"]);
  });

  it("names the checks the merge policy requires", () => {
    const ci = workflows.find((w) => w.name === "ci.yml")!.text;
    assert.match(ci, /name: check \(\$\{\{ matrix\.os \}\}\)/);
    const oses = /os: \[([^\]]+)\]/.exec(ci)![1]!.split(",").map((s) => s.trim());
    const fromCi = oses.map((os) => `check (${os})`);
    assert.deepEqual(policy.requiredChecks.filter((c) => c.startsWith("check (")), fromCi);
    assert.match(ci, /^\s+pull_request:$/m);
    assert.match(ci, /^\s+merge_group:$/m);
    assert.match(ci, /branches: \[main\]/);
    assert.match(workflows.find((w) => w.name === "evaluate.yml")!.text, /^\s+name: evaluate$/m);
    assert.match(workflows.find((w) => w.name === "dco.yml")!.text, /^\s+name: dco$/m);
    assert.ok(policy.requiredChecks.includes("evaluate") && policy.requiredChecks.includes("dco"));
  });

  it("gives the AI reviewer no tools, its input inline, a read-only token and a schema that matches the publisher", () => {
    const ai = workflows.find((w) => w.name === "ai-review.yml")!.text;
    const schema = JSON.parse(/--json-schema '(.+)'/.exec(ai)![1]!) as { properties: { verdict: { enum: string[] } } };
    assert.deepEqual(schema.properties.verdict.enum, ["pass", "changes-suggested"]);
    assert.ok(!/--allowedTools/.test(ai), "the reviewer is given no tools");
    const denied = /--disallowedTools "([^"]+)"/.exec(ai)![1]!.split(",");
    const settings = JSON.parse(/settings: '(.+)'/.exec(ai)![1]!) as { disableAllHooks: boolean; permissions: { deny: string[] } };
    assert.equal(settings.disableAllHooks, true);
    for (const t of ["Bash", "Read", "Glob", "Grep", "LS", "Edit", "Write", "NotebookRead", "WebFetch", "WebSearch", "Task"]) {
      assert.ok(denied.includes(t), `--disallowedTools lacks ${t}`);
      assert.ok(settings.permissions.deny.includes(t), `settings deny lacks ${t}`);
    }
    assert.match(ai, /--max-turns \d+/);
    assert.match(ai, /timeout-minutes: \d+/);
    const review = /\n {2}review:\n([\s\S]*?)\n {2}publish:/.exec(ai)![1]!;
    assert.match(review, /\$\{\{ needs\.prepare\.outputs\.input \}\}/, "the input is inline in the prompt");
    assert.deepEqual([...review.matchAll(/^ {6}([a-z-]+): (read|write)$/gm)].map((m) => `${m[1]}: ${m[2]}`), ["contents: read"], "the reviewer's token can only read contents");
    assert.ok(!/scripts\/automerge|review-input|GITHUB_TOKEN/.test(review), "the job with the secret runs none of our scripts and reads no files");
    const prepare = /\n {2}prepare:\n([\s\S]*?)\n {2}review:/.exec(ai)![1]!;
    assert.ok(!/secrets\.[A-Z_]+ *\}\}/.test(prepare), "the prepare job never holds the AI secret, only whether it exists");
  });

  it("pins every action outside GitHub's own actions/ to a full commit id", () => {
    for (const w of workflows) {
      for (const m of w.text.matchAll(/uses: ([^@\s]+)@(\S+)/g)) {
        if (m[1]!.startsWith("actions/")) continue;
        assert.match(m[2]!, /^[0-9a-f]{40}$/, `${w.name}: ${m[1]} must be pinned to a 40-character commit id`);
      }
    }
    for (const name of ["ai-review.yml", "automerge.yml"]) {
      for (const m of workflows.find((w) => w.name === name)!.text.matchAll(/uses: ([^@\s]+)@(\S+)/g)) assert.match(m[2]!, /^[0-9a-f]{40}$/, `${name} has write tokens: pin ${m[1]}`);
    }
  });

  it("never runs two automerge evaluations at once", () => {
    assert.match(workflows.find((w) => w.name === "automerge.yml")!.text, /concurrency:\n\s+group: automerge\n\s+cancel-in-progress: false/);
  });
});

describe("docs and CODEOWNERS match the merge policy", () => {
  it("REPO-SETTINGS.md requires every check the policy waits for, and the merge-policy status", () => {
    const doc = readFileSync(new URL("../../docs/REPO-SETTINGS.md", import.meta.url), "utf8");
    const block = /\*\*Require status checks to pass:\*\*[^\n]*\n((?: {2}- .*\n)+)/.exec(doc);
    assert.ok(block, "REPO-SETTINGS.md section 7 lists the required status checks");
    const listed = [...block[1]!.matchAll(/^ {2}- `([^`]+)`/gm)].map((m) => m[1]!);
    for (const c of [...policy.requiredChecks, policy.statusContexts.mergePolicy]) assert.ok(listed.includes(c), `REPO-SETTINGS.md does not require ${c}`);
    const count = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][listed.length];
    assert.match(doc, new RegExp(`the ${count} required checks`), `the checklist should say "the ${count} required checks"`);
    const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
    for (const c of [...policy.requiredChecks, policy.statusContexts.mergePolicy]) assert.ok(readme.includes(`\`${c}\``), `scripts/automerge/README.md does not name ${c}`);
  });

  // A small CODEOWNERS matcher: gitignore-style patterns, the last matching line wins.
  const owners = readFileSync(new URL("../../.github/CODEOWNERS", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const [pattern, ...who] = l.split(/\s+/);
      let p = pattern!;
      const anchored = p.startsWith("/") || p.replace(/\/$/, "").includes("/");
      p = p.replace(/^\//, "").replace(/\/$/, "");
      let re = "";
      for (let i = 0; i < p.length; i++) {
        if (p[i] === "*" && p[i + 1] === "*") (re += ".*"), i++;
        else if (p[i] === "*") re += "[^/]*";
        else if (p[i] === "?") re += "[^/]";
        else re += p[i]!.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
      return { re: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${re}(?:/.*)?$`), owned: who.length > 0 };
    });
  const owned = (path: string) => owners.filter((o) => o.re.test(path)).at(-1)?.owned ?? false;

  it("gives every maintainer-lane path an owner, in every folder", () => {
    const prefixes = ["", "docs/", "docs/images/", "examples/a/", "bench/tasks/a/", "corpora/", "lib/", "packages/a/"];
    let checked = 0;
    for (const rule of policy.rules.filter((r) => r.lane === "maintainer" && !r.statuses)) {
      for (const glob of rule.globs) {
        const samples = glob.startsWith("**/") ? prefixes.map((pre) => pre + glob.slice(3)) : [glob];
        for (const raw of samples) {
          const path = raw.replace(/\*\*/g, "x/y").replace(/\*/g, "x").replace(/\?/g, "x");
          if (classifyPath(path, "modified", policy).lane !== "maintainer") continue;
          checked++;
          assert.ok(owned(path), `${path} (rule ${rule.id}, glob ${glob}) is in the maintainer lane but has no code owner`);
        }
      }
    }
    assert.ok(checked > 100, `checked ${checked} sample paths`);
  });

  it("leaves auto-lane paths without an owner, so they need no approval", () => {
    for (const path of ["docs/guide.md", "docs/research/gap-9.md", "CONTRIBUTORS.md", "examples/nut/nut.o3j.js", "examples/nut/expected.json", "examples/nut/drawing.png", "bench/tasks/t1/ref.o3j.js", "bench/tasks/t1/task.json", "lib/iso-4032/m4.json", "corpora/hdet/case.json", "docs/images/shot.png"]) {
      assert.equal(classifyPath(path, "added", policy).lane, "auto", path);
      assert.equal(owned(path), false, `${path} is in the auto lane but has a code owner`);
    }
  });
});
