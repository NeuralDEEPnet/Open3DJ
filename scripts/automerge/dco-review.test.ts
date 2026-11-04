// Tests for the DCO check and the AI review helpers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCommit, checkDco, mergeAddsNothing, renderDco, signOffEmails, type DcoCommit } from "./dco.ts";
import { escapeHtml } from "./policy.ts";
import { ATTRIBUTION, buildDiff, COMMENT_MARKER, filesFingerprint, fingerprintInStatus, looksLikeCredential, parseReviewOutput, renderComment, revealInvisible, reviewLog, safeText, truncateBytes } from "./review.ts";

const commit = (message: string, over: Partial<DcoCommit> = {}): DcoCommit => ({ sha: "c".repeat(40), message, authorEmail: "ada@example.com", committerEmail: "noreply@github.com", parents: 1, ...over });

describe("dco", () => {
  it("accepts a sign-off that matches the author or the committer, in any case", () => {
    assert.ok(checkCommit(commit("Fix it\n\nSigned-off-by: Ada Lovelace <ada@example.com>")).ok);
    assert.ok(checkCommit(commit("Fix it\n\nSigned-off-by: Ada Lovelace <ADA@Example.com>\n")).ok);
    assert.ok(checkCommit(commit("Fix\n\nsigned-off-by: Ada <bot@example.com>", { committerEmail: "bot@example.com" })).ok);
  });
  it("rejects a missing or mismatched sign-off", () => {
    assert.equal(checkCommit(commit("Fix it")).ok, false);
    assert.equal(checkCommit(commit("Fix it\n\nSigned-off-by: Someone <someone@example.com>")).ok, false);
    assert.equal(checkCommit(commit("Fix it\n\nThe text Signed-off-by: Ada <ada@example.com> mid-line")).ok, false);
    assert.equal(checkCommit(commit("Fix it\n\nSigned-off-by: Ada")).ok, false);
  });
  it("accepts a merge commit without a sign-off only when it adds nothing beyond its parents", () => {
    const clean = mergeAddsNothing([{ files: ["docs/a.md"], truncated: false }, { files: ["docs/mine.md"], truncated: false }]);
    assert.ok(clean.clean, "docs/a.md came unchanged from the second parent");
    assert.ok(checkCommit(commit("Merge branch 'main' into feature", { parents: 2, merge: clean })).ok);
    const evil = mergeAddsNothing([{ files: ["docs/a.md", "packages/x.ts"], truncated: false }, { files: ["docs/mine.md", "packages/x.ts"], truncated: false }]);
    assert.equal(evil.clean, false, "packages/x.ts matches neither parent");
    const r = checkCommit(commit("Merge branch 'main' into feature", { parents: 2, merge: evil }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /packages\/x\.ts/);
    assert.equal(checkCommit(commit("Merge", { parents: 2 })).ok, false, "an unchecked merge commit fails");
    assert.equal(mergeAddsNothing([{ files: [], truncated: true }, { files: [], truncated: false }]).clean, false);
    assert.ok(checkCommit(commit("Merge\n\nSigned-off-by: Ada <ada@example.com>", { parents: 2, merge: evil })).ok, "a signed-off merge passes");
  });
  it("reads every trailer and fails the whole pull request on one bad commit", () => {
    assert.deepEqual(signOffEmails("x\n\nSigned-off-by: A <a@x.org>\nSigned-off-by: B <b@x.org>"), ["a@x.org", "b@x.org"]);
    const out = checkDco([commit("ok\n\nSigned-off-by: Ada <ada@example.com>"), commit("bad", { sha: "d".repeat(40) })]);
    assert.equal(out.ok, false);
    const md = renderDco(out, new Map([["d".repeat(40), "<b>bad</b> @team"]]), escapeHtml);
    assert.match(md, /CONTRIBUTING\.md#sign-your-work/);
    assert.ok(!md.includes("<b>") && !md.includes("@team"));
  });
  it("fails when GitHub could not list every commit", () => {
    const out = checkDco([commit("ok\n\nSigned-off-by: Ada <ada@example.com>")], 300);
    assert.equal(out.ok, false);
    assert.match(out.problem ?? "", /squash/);
  });
});

describe("ai review", () => {
  it("reveals invisible and bidirectional characters", () => {
    assert.equal(revealInvisible("a‮b​c\u0007"), "a[U+202E]b[U+200B]c");
    assert.equal(revealInvisible("tag󠁁"), "tag[U+E0041]");
  });
  it("builds a capped diff", () => {
    const d = buildDiff([{ filename: "a.md", status: "modified", patch: "+x".repeat(100) }, { filename: "b.png", status: "added" }], 120);
    assert.ok(d.truncated);
    assert.ok(d.text.length < 200);
    assert.match(buildDiff([{ filename: "b.png", status: "added" }], 1000).text, /no text diff/);
  });
  it("validates the structured output", () => {
    assert.throws(() => parseReviewOutput("not json"));
    assert.throws(() => parseReviewOutput(JSON.stringify({ verdict: "approve", summary: "x" })));
    assert.throws(() => parseReviewOutput(JSON.stringify({ verdict: "pass", summary: "" })));
    const r = parseReviewOutput(JSON.stringify({ verdict: "pass", summary: "ok", findings: [{ path: "a", severity: "blocker", note: "no tests" }] }));
    assert.equal(r.verdict, "changes-suggested", "a blocker overrides a pass");
    assert.equal(parseReviewOutput(JSON.stringify({ verdict: "pass", summary: "ok", findings: Array(20).fill({ note: "n" }) })).findings.length, 10);
  });
  it("refuses output that looks like a credential, plain or spaced out", () => {
    for (const leak of [
      "the key is sk-ant-api03-abcdefghijklmnop",
      "s k - a n t - a p i 0 3 - x",
      "token ghs_0123456789abcdefghijABCDEFGHIJ012345",
      "github_pat_11ABC",
      "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHNlY3JldCB2YWx1ZQ1234XYZ",
      "a b c d e f g h i j k l m n o p q r s t u v w x y z 0 1 2",
      "e".repeat(64),
    ]) assert.ok(looksLikeCredential(leak), leak);
    for (const fine of [
      "Clear doc. Thanks for the fix; please add a test in packages/assembly/src/export/step.test.ts.",
      `Reviewed commit ${"a".repeat(40)} and the risk analysis of the examples/box-with-lid script.`,
      "Use plain sentences, no em-dashes, American spelling. Bounding box 7.0 x 7.0 x 16.0 mm.",
    ]) assert.equal(looksLikeCredential(fine), false, fine);
    assert.throws(() => parseReviewOutput(JSON.stringify({ verdict: "pass", summary: "ok", findings: [{ path: "a", severity: "nit", note: "ghp_0123456789abcdefghij0123456789abcd" }] })), /credential/);
  });
  it("fingerprints file lists, finds the fingerprint in a status, and caps bytes", () => {
    const a = filesFingerprint([{ filename: "docs/a.md", status: "modified", sha: "1" }, { filename: "docs/b.md", status: "added", sha: "2" }]);
    assert.equal(a, filesFingerprint([{ filename: "docs/b.md", status: "added", sha: "2" }, { filename: "docs/a.md", status: "modified", sha: "1" }]), "order does not matter");
    assert.notEqual(a, filesFingerprint([{ filename: "docs/a.md", status: "modified", sha: "3" }, { filename: "docs/b.md", status: "added", sha: "2" }]), "content does");
    assert.equal(fingerprintInStatus(`advisory review: pass; files ${a}`), a);
    assert.equal(fingerprintInStatus("advisory review: pass"), undefined);
    const t = truncateBytes("ab€€", 4);
    assert.equal(t.text, "ab", "a cut never splits a character");
    assert.ok(t.truncated);
  });
  it("records review times in the comment for the daily budget", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    const body = renderComment({ verdict: "pass", summary: "ok", findings: [] }, { headSha: "e".repeat(40), lane: "auto", log: [new Date("2026-10-28T09:00:00Z"), now] });
    assert.deepEqual(reviewLog(body).map((d) => d.toISOString()), ["2026-10-28T09:00:00.000Z", "2026-10-29T10:00:00.000Z"]);
    assert.deepEqual(reviewLog("no log here"), []);
  });
  it("renders a comment without mentions, links, images or HTML, ending with the attribution", () => {
    const body = renderComment(
      { verdict: "pass", summary: "Looks fine @NeuralDEEPnet see https://evil.example/x ![i](https://x/y.png) <script>x</script>", findings: [{ path: "docs/a.md", severity: "nit", note: "[click](https://evil.example)" }] },
      { headSha: "e".repeat(40), lane: "auto" },
    );
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.ok(body.endsWith(ATTRIBUTION));
    assert.ok(!/@NeuralDEEPnet/.test(body));
    assert.ok(!body.includes("https://evil"));
    assert.ok(!body.includes("<script>"));
    assert.ok(!/[^\\]\]\(/.test(body.slice(0, -ATTRIBUTION.length)), "every ]( is escaped, so no markdown link or image survives");
    assert.equal(safeText("a".repeat(50), 10).length <= 10, true);
  });
});
