// Tests for the merge-lane evaluator against the real .github/merge-policy.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { classifyPath, decideMerge, evaluate, globToRegExp, matchesGlob, pathProblem, renderEvaluation, summarizeReviews, validatePolicy, type ChangedFile, type MergeInput, type Policy, type Review } from "./policy.ts";

const policy: Policy = validatePolicy(JSON.parse(readFileSync(new URL("../../.github/merge-policy.json", import.meta.url), "utf8")));

function file(filename: string, status = "modified", extra: Partial<ChangedFile> = {}): ChangedFile {
  return { filename, status, additions: 3, deletions: 1, hasPatch: true, size: 1000, mode: "100644", ...extra };
}
const laneOf = (...files: ChangedFile[]) => evaluate(files, policy).lane;

describe("globs", () => {
  it("keeps * inside one folder and lets ** cross folders", () => {
    assert.ok(matchesGlob("examples/bracket/bracket.o3j.js", "examples/*/*.o3j.js"));
    assert.ok(!matchesGlob("examples/a/b/c.o3j.js", "examples/*/*.o3j.js"));
    assert.ok(matchesGlob("docs/a/b/c.md", "docs/**"));
    assert.ok(matchesGlob("docs", "docs/**"));
    assert.ok(!matchesGlob("docsx/a.md", "docs/**"));
    assert.ok(matchesGlob("README.md", "**/*.md"));
    assert.ok(matchesGlob("a/b/README.md", "**/*.md"));
    assert.ok(matchesGlob("x/.github/y", "**/.*/**"));
    assert.ok(!matchesGlob("docs/a.md", "**/.*"));
  });
  it("ignores case, so Windows and macOS checkouts cannot alias a protected path", () => {
    assert.ok(matchesGlob("Scripts/check.ts", "scripts/**"));
    assert.ok(matchesGlob("EXAMPLES/Bracket/Expected.JSON", "examples/*/expected.json"));
    assert.equal(globToRegExp("a.b").test("aXb"), false, "dots are literal");
  });
});

describe("path checks", () => {
  const limits = policy.limits;
  for (const [path, why] of [
    ["docs/../packages/x.md", "dot segment"],
    ["./docs/a.md", "dot segment"],
    ["docs//a.md", "empty folder"],
    ["/docs/a.md", "leading"],
    ["docs\\a.md", "backslash"],
    ["docs/a.md:stream", "Windows does not allow"],
    ["scripts./check.md", "ending in a dot"],
    ["docs /a.md", "ending in a dot or space"],
    ["PACKAG~1/x.md", "8.3"],
    ["docs/CON.md", "reserved"],
    ["docs/nul", "reserved"],
    ["docs/a\nb.md", "control"],
    ["docs/сripts.md", "non-ASCII"],
    ["docs/" + "a".repeat(300) + ".md", "longer"],
  ] as const) {
    it(`flags ${JSON.stringify(path)}`, () => {
      assert.match(pathProblem(path, limits) ?? "", new RegExp(why, "i"));
      assert.equal(laneOf(file(path)), "maintainer");
    });
  }
  it("accepts plain paths", () => {
    assert.equal(pathProblem("docs/images/viewer-tree.png", limits), undefined);
    assert.equal(pathProblem("examples/phone-stand/phone-stand.o3j.js", limits), undefined);
  });
});

describe("rules", () => {
  const cases: Array<[string, string, "auto" | "maintainer", string]> = [
    ["CONTRIBUTORS.md", "modified", "auto", "markdown"],
    ["docs/COMPUTE.md", "modified", "auto", "markdown"],
    ["docs/research/gap-1.md", "modified", "auto", "markdown"],
    ["docs/research/new-note.md", "added", "auto", "markdown"],
    ["rfcs/0001-idea.md", "added", "auto", "markdown"],
    ["docs/diagram.svg", "added", "auto", "docs"],
    ["docs/images/shot.png", "added", "auto", "doc-images"],
    ["examples/README.md", "modified", "auto", "markdown"],
    ["examples/bracket/bracket.o3j.js", "modified", "auto", "example-scripts"],
    ["examples/new-part/new-part.o3j.js", "added", "auto", "example-scripts"],
    ["examples/new-part/expected.json", "added", "auto", "example-goldens"],
    ["examples/new-part/drawing.png", "added", "auto", "example-drawings"],
    ["examples/old-part/drawing.png", "removed", "auto", "example-drawings"],
    ["bench/tasks/reg-new/task.json", "added", "auto", "bench-task-spec"],
    ["bench/tasks/reg-bracket/reference.o3j.js", "modified", "auto", "bench-task-scripts"],
    ["corpora/hdet/new-case.o3j.js", "added", "auto", "corpora"],
    ["corpora/hdet/README.md", "modified", "auto", "markdown"],
    ["lib/iso-4032/m4.o3j.js", "added", "auto", "standard-parts"],
    // maintainer lane
    ["README.md", "modified", "maintainer", "front-page-and-plan"],
    ["ROADMAP.md", "modified", "maintainer", "front-page-and-plan"],
    ["docs/PLAN.md", "modified", "maintainer", "front-page-and-plan"],
    ["docs/ARCHITECTURE.md", "modified", "maintainer", "front-page-and-plan"],
    ["docs/GETTING-STARTED.md", "modified", "maintainer", "front-page-and-plan"],
    ["docs/REPO-SETTINGS.md", "modified", "maintainer", "front-page-and-plan"],
    ["docs/research/README.md", "modified", "maintainer", "front-page-and-plan"],
    ["bench/README.md", "modified", "maintainer", "front-page-and-plan"],
    ["GEMINI.md", "added", "maintainer", "workflows-and-agent-config"],
    ["docs/AGENT.md", "added", "maintainer", "workflows-and-agent-config"],
    ["CLAUDE.local.md", "added", "maintainer", "workflows-and-agent-config"],
    ["CONVENTIONS.md", "added", "maintainer", "workflows-and-agent-config"],
    ["llms.txt", "added", "maintainer", "workflows-and-agent-config"],
    ["examples/bracket/drawing.png", "modified", "maintainer", "example-drawings"],
    ["docs/images/viewer-tree.png", "modified", "maintainer", "doc-images"],
    ["examples/bracket/expected.json", "modified", "maintainer", "example-goldens"],
    ["examples/bracket/expected.json", "removed", "maintainer", "example-goldens"],
    ["bench/tasks/reg-bracket/task.json", "modified", "maintainer", "bench-task-spec"],
    ["corpora/hdet/offset.o3j.js", "modified", "maintainer", "corpora"],
    ["corpora/hdet/offset.o3j.js", "removed", "maintainer", "corpora"],
    ["AGENTS.md", "modified", "maintainer", "workflows-and-agent-config"],
    ["CLAUDE.md", "modified", "maintainer", "workflows-and-agent-config"],
    ["docs/CLAUDE.md", "added", "maintainer", "workflows-and-agent-config"],
    ["examples/x/AGENTS.md", "added", "maintainer", "workflows-and-agent-config"],
    ["skills/open3dj/SKILL.md", "modified", "maintainer", "workflows-and-agent-config"],
    ["AI_POLICY.md", "modified", "maintainer", "governance"],
    ["CONTRIBUTING.md", "modified", "maintainer", "governance"],
    ["GOVERNANCE.md", "modified", "maintainer", "governance"],
    ["SECURITY.md", "modified", "maintainer", "governance"],
    ["CODE_OF_CONDUCT.md", "modified", "maintainer", "governance"],
    ["LICENSE", "modified", "maintainer", "governance"],
    ["docs/LICENSING.md", "modified", "maintainer", "governance"],
    [".github/workflows/ci.yml", "modified", "maintainer", "workflows-and-agent-config"],
    [".github/merge-policy.json", "modified", "maintainer", "workflows-and-agent-config"],
    [".github/CODEOWNERS", "modified", "maintainer", "workflows-and-agent-config"],
    [".claude/settings.json", "modified", "maintainer", "workflows-and-agent-config"],
    [".gitattributes", "modified", "maintainer", "workflows-and-agent-config"],
    ["docs/.hidden.md", "added", "maintainer", "workflows-and-agent-config"],
    ["examples/x/.npmrc", "added", "maintainer", "workflows-and-agent-config"],
    ["scripts/check.ts", "modified", "maintainer", "code"],
    ["scripts/README.md", "added", "maintainer", "code"],
    ["packages/kernel/src/index.ts", "modified", "maintainer", "code"],
    ["packages/kernel/README.md", "modified", "maintainer", "code"],
    ["package.json", "modified", "maintainer", "code"],
    ["package-lock.json", "modified", "maintainer", "code"],
    ["bench/lint.ts", "modified", "maintainer", "code"],
    ["bench/tasks/reg-x/helper.ts", "added", "maintainer", "code"],
    ["examples/x/run.js", "added", "maintainer", "code"],
    ["docs/tool.mjs", "added", "maintainer", "code"],
    ["lib/x/build.sh", "added", "maintainer", "code"],
    ["examples/x/package.json", "added", "maintainer", "code"],
    ["tsconfig.json", "modified", "maintainer", "code"],
    ["bench/tasks/reg-x/notes.txt", "added", "maintainer", "default"],
    ["ops/scorecard.csv", "added", "maintainer", "default"],
    ["newdir/file.txt", "added", "maintainer", "default"],
  ];
  for (const [path, status, lane, rule] of cases) {
    it(`${status} ${path} -> ${lane} (${rule})`, () => {
      const v = classifyPath(path, status, policy);
      assert.equal(v.lane, lane, v.reason);
      assert.equal(v.rule, rule);
      assert.equal(laneOf(file(path, status)), lane);
    });
  }
  it("matches protected paths in any case", () => {
    assert.equal(laneOf(file("Scripts/check.ts", "added")), "maintainer");
    assert.equal(laneOf(file("PACKAGES/x/README.md", "added")), "maintainer");
    assert.equal(laneOf(file("Examples/Bracket/Expected.json")), "maintainer");
    assert.equal(laneOf(file("agents.md")), "maintainer");
    assert.equal(laneOf(file(".GitHub/workflows/x.yml", "added")), "maintainer");
  });
});

describe("renames, copies and deletions", () => {
  it("judges a rename at both ends", () => {
    assert.equal(laneOf(file("docs/moved.md", "renamed", { previous_filename: "scripts/notes.md" })), "maintainer");
    assert.equal(laneOf(file("docs/new.md", "renamed", { previous_filename: "AGENTS.md" })), "maintainer");
    assert.equal(laneOf(file("docs/new.md", "renamed", { previous_filename: "docs/old.md" })), "auto");
  });
  it("does not let a rename create a golden or a bench task", () => {
    assert.equal(laneOf(file("examples/b/expected.json", "renamed", { previous_filename: "examples/a/expected.json" })), "maintainer");
    assert.equal(laneOf(file("bench/tasks/new/task.json", "renamed", { previous_filename: "docs/task.json" })), "maintainer");
    assert.equal(laneOf(file("examples/b/expected.json", "renamed", { previous_filename: "docs/x.json" })), "maintainer");
  });
  it("judges a copy by its new path, unless its source is protected", () => {
    assert.equal(laneOf(file("docs/copy.md", "copied", { previous_filename: "docs/a.md" })), "auto");
    assert.equal(laneOf(file("docs/copy.md", "copied", { previous_filename: "packages/x/a.ts" })), "maintainer");
  });
  it("lets docs be deleted but not goldens, bench tasks, corpora or code", () => {
    assert.equal(laneOf(file("docs/old.md", "removed", { size: null, mode: null })), "auto");
    assert.equal(laneOf(file("examples/bracket/expected.json", "removed", { size: null, mode: null })), "maintainer");
    assert.equal(laneOf(file("bench/tasks/reg-bracket/task.json", "removed", { size: null, mode: null })), "maintainer");
    assert.equal(laneOf(file("corpora/hdet/offset.o3j.js", "removed", { size: null, mode: null })), "maintainer");
    assert.equal(laneOf(file("packages/x/a.ts", "removed", { size: null, mode: null })), "maintainer");
  });
});

describe("file content", () => {
  it("rejects symlinks, submodules, executables and unknown modes in the auto lane", () => {
    assert.equal(laneOf(file("docs/link.md", "added", { mode: "120000" })), "maintainer");
    assert.equal(laneOf(file("docs/sub", "added", { mode: "160000" })), "maintainer");
    assert.equal(laneOf(file("docs/run.md", "changed", { mode: "100755" })), "maintainer");
    assert.equal(laneOf(file("docs/a.md", "added", { mode: null })), "maintainer");
  });
  it("caps image and binary sizes", () => {
    assert.equal(laneOf(file("docs/images/a.png", "added", { hasPatch: false, size: 204800 })), "auto");
    assert.equal(laneOf(file("docs/images/a.png", "added", { hasPatch: false, size: 204801 })), "maintainer");
    assert.equal(laneOf(file("examples/x/drawing.png", "added", { hasPatch: false, size: 300000 })), "maintainer");
    assert.equal(laneOf(file("docs/a.pdf", "added", { hasPatch: false, size: null })), "maintainer");
    assert.equal(laneOf(file("docs/huge.md", "added", { hasPatch: false, size: 5_000_000 })), "maintainer");
  });
  it("caps the total binary size", () => {
    const images = Array.from({ length: 6 }, (_, i) => file(`docs/images/${i}.png`, "added", { hasPatch: false, size: 200_000, additions: 0, deletions: 0 }));
    const ev = evaluate(images, policy);
    assert.equal(ev.lane, "maintainer");
    assert.match(ev.reasons.join(), /binary/);
  });
});

describe("pull request limits", () => {
  it("sends a huge pull request to the maintainer lane", () => {
    assert.equal(evaluate([file("docs/a.md", "modified", { additions: 1400, deletions: 101 })], policy).lane, "maintainer");
    assert.equal(evaluate([file("docs/a.md", "modified", { additions: 1400, deletions: 100 })], policy).lane, "auto");
    const many = Array.from({ length: 51 }, (_, i) => file(`docs/f${i}.md`, "added", { additions: 1, deletions: 0 }));
    assert.equal(evaluate(many, policy).lane, "maintainer");
    assert.equal(evaluate(many.slice(0, 50), policy).lane, "auto");
  });
  it("treats an incomplete or empty file list as maintainer lane", () => {
    assert.equal(evaluate([file("docs/a.md")], policy, 3001).lane, "maintainer");
    assert.equal(evaluate([], policy).lane, "maintainer");
  });
  it("takes the strictest lane of mixed files", () => {
    const ev = evaluate([file("docs/a.md"), file("examples/bracket/bracket.o3j.js"), file("packages/kernel/src/index.ts")], policy);
    assert.equal(ev.lane, "maintainer");
    assert.deepEqual(ev.files.map((f) => f.lane), ["auto", "auto", "maintainer"]);
  });
  it("renders a summary that escapes file names", () => {
    const md = renderEvaluation(evaluate([file("docs/<img src=x>|@team.md", "added")], policy));
    assert.ok(!md.includes("<img"));
    assert.ok(!md.includes("@team"));
  });
});

describe("policy validation", () => {
  it("rejects a malformed policy instead of widening a lane", () => {
    const bad = (patch: object) => () => validatePolicy({ ...structuredClone(policy), ...patch });
    assert.throws(bad({ version: 2 }));
    assert.throws(bad({ defaultLane: "fast" }));
    assert.throws(bad({ rules: [{ id: "x", lane: "auto", globs: [] }] }));
    assert.throws(bad({ rules: [{ id: "x", lane: "auto", globs: ["a"] }, { id: "x", lane: "auto", globs: ["b"] }] }));
    assert.throws(bad({ approvals: { required: 0, permissions: [], mustMatchHeadCommit: true } }));
  });
  it("keeps the deny list ahead of every auto rule", () => {
    const firstAuto = policy.rules.findIndex((r) => r.lane === "auto");
    for (const id of ["workflows-and-agent-config", "governance", "code"]) assert.ok(policy.rules.findIndex((r) => r.id === id) < firstAuto, id);
    assert.equal(policy.defaultLane, "maintainer");
  });
});

// ---------------------------------------------------------------------------------------

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const isMaintainer = (u: string) => ["maint", "lead"].includes(u);
const review = (user: string, state: string, commitId = HEAD, submittedAt = "2026-10-29T10:00:00Z"): Review => ({ user, state, commitId, submittedAt });

describe("reviews", () => {
  it("counts each maintainer's latest decision on the head commit", () => {
    const s = summarizeReviews([review("maint", "CHANGES_REQUESTED", HEAD, "1"), review("maint", "COMMENTED", HEAD, "2"), review("maint", "APPROVED", HEAD, "3")], { headSha: HEAD, author: "dev", isMaintainer, mustMatchHeadCommit: true });
    assert.deepEqual(s, { approvedBy: ["maint"], changesRequestedBy: [] });
  });
  it("ignores stale approvals, the author's own review, non-maintainers and dismissed reviews", () => {
    const opts = { headSha: HEAD, author: "lead", isMaintainer, mustMatchHeadCommit: true };
    assert.deepEqual(summarizeReviews([review("maint", "APPROVED", OLD)], opts).approvedBy, []);
    assert.deepEqual(summarizeReviews([review("lead", "APPROVED")], opts).approvedBy, []);
    assert.deepEqual(summarizeReviews([review("passerby", "APPROVED")], opts).approvedBy, []);
    assert.deepEqual(summarizeReviews([review("maint", "APPROVED", HEAD, "1"), review("maint", "DISMISSED", HEAD, "2")], opts).approvedBy, []);
    assert.deepEqual(summarizeReviews([review("maint", "APPROVED", OLD)], { ...opts, mustMatchHeadCommit: false }).approvedBy, ["maint"]);
  });
  it("keeps a maintainer's request for changes until they approve", () => {
    const s = summarizeReviews([review("maint", "CHANGES_REQUESTED", OLD, "1"), review("maint", "COMMENTED", HEAD, "2")], { headSha: HEAD, author: "dev", isMaintainer, mustMatchHeadCommit: true });
    assert.deepEqual(s.changesRequestedBy, ["maint"]);
  });
});

describe("merge decision", () => {
  const green = Object.fromEntries(policy.requiredChecks.map((c) => [c, "success" as const]));
  const base = (over: Partial<MergeInput> = {}): MergeInput => ({
    policy,
    evaluation: { lane: "auto", reasons: [] },
    pr: { open: true, draft: false, baseIsDefault: true, autoMergeEnabled: false },
    labels: [policy.labels.aiPass],
    aiStatus: "pass",
    checks: green,
    reviews: { approvedBy: [], changesRequestedBy: [] },
    ...over,
  });

  it("passes an auto-lane pull request with green checks and an AI pass on this commit", () => {
    const d = decideMerge(base());
    assert.equal(d.status.state, "success");
    assert.ok(d.enableAutoMerge);
    assert.deepEqual(d.addLabels, [policy.labels.laneAuto]);
  });
  it("needs both the AI status on the head commit and the label", () => {
    assert.equal(decideMerge(base({ labels: [] })).status.state, "pending", "a maintainer removing the label stops it");
    assert.equal(decideMerge(base({ aiStatus: "none" })).status.state, "pending", "a label left from an older commit is not enough");
    const d = decideMerge(base({ aiStatus: "changes-suggested", labels: [policy.labels.aiChanges] }));
    assert.equal(d.status.state, "pending");
    assert.ok(d.addLabels.includes(policy.labels.needsMaintainer));
  });
  it("lets a maintainer approval stand in for the AI review", () => {
    const d = decideMerge(base({ aiStatus: "none", labels: [], reviews: { approvedBy: ["maint"], changesRequestedBy: [] } }));
    assert.equal(d.status.state, "success");
  });
  it("waits for every required check, and names failures", () => {
    const { ["dco"]: _, ...noDco } = green;
    assert.match(decideMerge(base({ checks: noDco })).status.description, /waiting for: dco/);
    assert.match(decideMerge(base({ checks: { ...green, "check (windows-11-arm)": "failure" } })).status.description, /failed: check \(windows-11-arm\)/);
    assert.equal(decideMerge(base({ checks: { ...green, evaluate: "pending" } })).status.state, "pending");
  });
  it("needs a maintainer approval in the maintainer lane, then enables auto-merge and passes", () => {
    const waiting = decideMerge(base({ evaluation: { lane: "maintainer", reasons: ["huge"] } }));
    assert.equal(waiting.status.state, "pending");
    assert.ok(waiting.enableAutoMerge, "auto-merge is on so it merges as soon as the approval arrives");
    assert.ok(waiting.addLabels.includes(policy.labels.needsMaintainer));
    assert.ok(waiting.addLabels.includes(policy.labels.laneMaintainer));
    const approved = decideMerge(base({ evaluation: { lane: "maintainer", reasons: [] }, labels: [policy.labels.needsMaintainer, policy.labels.laneMaintainer], reviews: { approvedBy: ["maint"], changesRequestedBy: [] } }));
    assert.equal(approved.status.state, "success");
    assert.deepEqual(approved.removeLabels, [policy.labels.needsMaintainer]);
  });
  it("blocks on a maintainer's request for changes, even with an approval from someone else", () => {
    const d = decideMerge(base({ reviews: { approvedBy: ["lead"], changesRequestedBy: ["maint"] } }));
    assert.equal(d.status.state, "pending");
    assert.match(d.status.description, /requested changes/);
  });
  it("holds drafts and held pull requests, and does not enable auto-merge for them", () => {
    const draft = decideMerge(base({ pr: { open: true, draft: true, baseIsDefault: true, autoMergeEnabled: false } }));
    assert.equal(draft.status.state, "pending");
    assert.equal(draft.enableAutoMerge, false);
    const held = decideMerge(base({ labels: [policy.labels.aiPass, "andon"] }));
    assert.equal(held.status.state, "pending");
    assert.equal(held.enableAutoMerge, false);
  });
  it("leaves closed pull requests and other base branches alone", () => {
    assert.equal(decideMerge(base({ pr: { open: false, draft: false, baseIsDefault: true, autoMergeEnabled: false } })).act, false);
    assert.equal(decideMerge(base({ pr: { open: true, draft: false, baseIsDefault: false, autoMergeEnabled: false } })).act, false);
  });
  it("swaps the lane label when the lane changes", () => {
    const d = decideMerge(base({ evaluation: { lane: "maintainer", reasons: [] }, labels: [policy.labels.laneAuto] }));
    assert.ok(d.removeLabels.includes(policy.labels.laneAuto));
    assert.ok(d.addLabels.includes(policy.labels.laneMaintainer));
  });
  it("does not enable auto-merge twice and keeps descriptions within 140 characters", () => {
    assert.equal(decideMerge(base({ pr: { open: true, draft: false, baseIsDefault: true, autoMergeEnabled: true } })).enableAutoMerge, false);
    const many = Object.fromEntries(policy.requiredChecks.map((c) => [c, "failure" as const]));
    assert.ok(decideMerge(base({ checks: many })).status.description.length <= 140);
  });
});
