// Pure Developer Certificate of Origin check: every commit in a pull request needs a
// Signed-off-by line whose email matches the commit's author or committer. A merge commit
// without one passes only when it adds nothing of its own: every file it changes from its
// first parent is identical to that file in another parent (a clean "Update branch" merge).
// Its parents are commits of the pull request or of the base branch, and are checked too.

export interface DcoCommit {
  sha: string;
  message: string;
  authorEmail: string;
  committerEmail: string;
  parents: number;
  /** For a merge commit: whether it adds nothing beyond its parents (see mergeAddsNothing), and why not. */
  merge?: { clean: boolean; reason: string };
}

export interface DcoResult {
  sha: string;
  ok: boolean;
  reason: string;
}

export const DCO_HELP = "https://github.com/NeuralDEEPnet/Open3DJ/blob/main/CONTRIBUTING.md#sign-your-work-the-developer-certificate-of-origin";

/** Every email in a Signed-off-by trailer of the message, lowercased. */
export function signOffEmails(message: string): string[] {
  return [...message.matchAll(/^Signed-off-by:[ \t]*[^<>\n]*<([^<>\s]+@[^<>\s]+)>[ \t]*$/gim)].map((m) => m[1]!.trim().toLowerCase());
}

export function checkCommit(c: DcoCommit): DcoResult {
  const emails = signOffEmails(c.message);
  const want = [c.authorEmail, c.committerEmail].map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.some((e) => want.includes(e))) return { sha: c.sha, ok: true, reason: "signed off" };
  if (c.parents > 1) {
    if (c.merge?.clean) return { sha: c.sha, ok: true, reason: "merge commit that adds nothing beyond its parents" };
    return { sha: c.sha, ok: false, reason: `merge commit without a sign-off that ${c.merge?.reason ?? "could not be checked"}` };
  }
  if (emails.length === 0) return { sha: c.sha, ok: false, reason: "no Signed-off-by line" };
  return { sha: c.sha, ok: false, reason: "the Signed-off-by email matches neither the commit author nor the committer" };
}

/**
 * Whether a merge commit adds nothing of its own. changedFromParent[0] lists the files that
 * differ between the first parent and the merge; changedFromParent[k] does the same for parent
 * k. A file is clean when some other parent has it unchanged. Lists that may be cut short
 * (truncated) count as not clean.
 */
export function mergeAddsNothing(changedFromParent: Array<{ files: string[]; truncated: boolean }>): { clean: boolean; reason: string } {
  if (changedFromParent.length < 2) return { clean: false, reason: "has fewer than two parents" };
  if (changedFromParent.some((p) => p.truncated)) return { clean: false, reason: "changes too many files to check" };
  const [first, ...others] = changedFromParent;
  const otherSets = others.map((p) => new Set(p.files));
  const own = first!.files.filter((f) => otherSets.every((set) => set.has(f)));
  if (own.length === 0) return { clean: true, reason: "adds nothing beyond its parents" };
  return { clean: false, reason: `changes ${own.length === 1 ? "a file" : `${own.length} files`} beyond its parents (${own.slice(0, 3).join(", ")}${own.length > 3 ? ", ..." : ""})` };
}

export function checkDco(commits: DcoCommit[], totalCommits: number = commits.length): { ok: boolean; results: DcoResult[]; problem?: string } {
  if (totalCommits > commits.length) {
    return { ok: false, results: [], problem: `GitHub listed ${commits.length} of ${totalCommits} commits; please squash the branch into fewer commits` };
  }
  const results = commits.map(checkCommit);
  return { ok: results.every((r) => r.ok), results };
}

/** The job summary for the dco check. Commit subjects are escaped: they come from the pull request. */
export function renderDco(out: ReturnType<typeof checkDco>, subjects: Map<string, string>, esc: (s: string) => string): string {
  const lines = [out.ok ? "## DCO: every commit is signed off" : "## DCO: sign-off missing", ""];
  if (out.problem) lines.push(esc(out.problem), "");
  if (out.results.length > 0) {
    lines.push("| Commit | Subject | Result |", "|---|---|---|");
    for (const r of out.results) lines.push(`| ${r.sha.slice(0, 12)} | ${esc(subjects.get(r.sha) ?? "")} | ${r.ok ? "ok" : "missing"}: ${esc(r.reason)} |`);
    lines.push("");
  }
  if (!out.ok) {
    lines.push(
      "Every commit needs a `Signed-off-by: Your Name <email>` line that matches the commit author's email. This is the Developer Certificate of Origin, and only a person can sign it.",
      "",
      "- One commit: `git commit --amend -s --no-edit`, then `git push --force-with-lease`.",
      "- Several commits: `git rebase --signoff main`, then `git push --force-with-lease`.",
      "- A merge commit that combines changes to the same file (for example from **Update branch**) needs a sign-off too. Use **Update with rebase** instead, or `git rebase --signoff main`.",
      "- Edited in the browser? Comment on the pull request and a maintainer will help.",
      "",
      `How and why: ${DCO_HELP}`,
    );
  }
  return lines.join("\n") + "\n";
}
