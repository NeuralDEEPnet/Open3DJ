// Pure merge-lane logic for pull requests (no I/O, no dependencies). The workflows in
// .github/workflows run it from the default branch's checkout, never from a pull request,
// so a pull request cannot change the rules it is judged by. See README.md in this folder.

export type Lane = "auto" | "maintainer";

export interface Rule {
  id: string;
  lane: Lane;
  globs: string[];
  exceptGlobs?: string[];
  /** File statuses this rule accepts. A matching file with another status goes to the maintainer lane. */
  statuses?: string[];
  /** Largest allowed size in bytes for a file this rule accepts. */
  maxBytes?: number;
  why?: string;
}

export interface Policy {
  version: number;
  defaultLane: Lane;
  rules: Rule[];
  limits: {
    maxFiles: number;
    maxChangedLines: number;
    maxBinaryBytesPerFile: number;
    maxBinaryBytesTotal: number;
    maxPathLength: number;
    asciiPathsOnly: boolean;
  };
  requiredChecks: string[];
  approvals: { required: number; permissions: string[]; mustMatchHeadCommit: boolean };
  labels: { laneAuto: string; laneMaintainer: string; needsMaintainer: string; aiPass: string; aiChanges: string; hold: string[] };
  /** Budget for the AI review, so that pushes cannot run up the cost of the AI secret. */
  aiReview: { maxReviewsPerPullRequestPerDay: number; maxNewPullRequestsPerAuthorPerDay: number };
  statusContexts: { mergePolicy: string; aiReview: string };
  mergeMethod: "SQUASH" | "REBASE" | "MERGE";
}

/** One changed file, as the pull request files API reports it, plus facts from the head commit's tree. */
export interface ChangedFile {
  filename: string;
  /** added, removed, modified, renamed, copied, changed or unchanged. */
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  /** False when the API gave no text patch: a binary file or a very large text change. */
  hasPatch: boolean;
  /** Size in bytes in the head commit; null when unknown. Not needed for removed files. */
  size?: number | null;
  /** Git file mode in the head commit (100644, 100755, 120000 symlink, 160000 submodule); null when unknown. */
  mode?: string | null;
}

export interface FileVerdict {
  path: string;
  status: string;
  lane: Lane;
  rule: string;
  reason: string;
}

export interface Evaluation {
  lane: Lane;
  /** Reasons that apply to the whole pull request (size, incomplete file list). */
  reasons: string[];
  files: FileVerdict[];
  stats: { files: number; changedLines: number; binaryBytes: number };
}

const RANK: Record<Lane, number> = { auto: 0, maintainer: 1 };
export const stricter = (a: Lane, b: Lane): Lane => (RANK[a] >= RANK[b] ? a : b);

const globCache = new Map<string, RegExp>();

/** Glob to an anchored, case-insensitive RegExp: * stays in one folder, ** crosses folders, ? is one character. */
export function globToRegExp(glob: string): RegExp {
  const hit = globCache.get(glob);
  if (hit) return hit;
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slashAfter = glob[i + 2] === "/";
      const atStart = i === 0 || glob[i - 1] === "/";
      if (atStart && slashAfter) {
        re += "(?:.*/)?"; // "**/" matches zero or more folders
        i += 2;
      } else if (atStart && i + 2 === glob.length && i > 0) {
        re = re.slice(0, -1) + "(?:/.*)?"; // "/**" at the end matches the folder and everything in it
        i += 1;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const out = new RegExp(`^${re}$`, "i");
  globCache.set(glob, out);
  return out;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Why a path is unsafe to judge by its spelling, or undefined when it is plain. Such paths
 * could alias a protected file on Windows or macOS checkouts (case folding is handled by
 * case-insensitive globs; trailing dots, 8.3 short names and streams are handled here).
 */
export function pathProblem(path: string, limits: Pick<Policy["limits"], "maxPathLength" | "asciiPathsOnly">): string | undefined {
  if (path.length === 0) return "empty path";
  if (path.length > limits.maxPathLength) return `path longer than ${limits.maxPathLength} characters`;
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control character in path";
  if (limits.asciiPathsOnly && /[^ -~]/.test(path)) return "non-ASCII character in path";
  if (path.includes("\\")) return "backslash in path";
  if (/[<>:"|?*]/.test(path)) return "character that Windows does not allow in a path";
  if (path.startsWith("/") || path.endsWith("/")) return "leading or trailing slash";
  for (const seg of path.split("/")) {
    if (seg === "") return "empty folder name (double slash)";
    if (seg === "." || seg === "..") return "dot segment in path";
    if (/[. ]$/.test(seg)) return "folder or file name ending in a dot or space (Windows drops it)";
    if (/^ /.test(seg)) return "folder or file name starting with a space";
    if (/~[0-9]/.test(seg)) return "name that looks like a Windows 8.3 short name";
    if (WINDOWS_RESERVED.test(seg)) return "reserved Windows device name";
  }
  return undefined;
}

/** The first rule whose globs match the path, if any. */
export function findRule(path: string, rules: Rule[]): Rule | undefined {
  return rules.find((r) => r.globs.some((g) => matchesGlob(path, g)) && !(r.exceptGlobs ?? []).some((g) => matchesGlob(path, g)));
}

/** Lane of one path with a given status, by the first matching rule. */
export function classifyPath(path: string, status: string, policy: Policy): FileVerdict {
  const problem = pathProblem(path, policy.limits);
  if (problem) return { path, status, lane: "maintainer", rule: "path-check", reason: problem };
  const rule = findRule(path, policy.rules);
  if (!rule) return { path, status, lane: policy.defaultLane, rule: "default", reason: "no rule covers this path" };
  if (rule.statuses && !rule.statuses.includes(status)) {
    return { path, status, lane: "maintainer", rule: rule.id, reason: `${status} file; this rule only accepts ${rule.statuses.join(", ")} files` };
  }
  return { path, status, lane: rule.lane, rule: rule.id, reason: rule.why ?? rule.id };
}

/** Evaluate a pull request's changed files. totalFiles is the count GitHub reports, to catch a truncated list. */
export function evaluate(files: ChangedFile[], policy: Policy, totalFiles: number = files.length): Evaluation {
  const reasons: string[] = [];
  const verdicts: FileVerdict[] = [];
  let changedLines = 0;
  let binaryBytes = 0;
  const { limits } = policy;

  if (files.length === 0) reasons.push("the pull request changes no files");
  if (totalFiles > files.length) reasons.push(`GitHub listed ${files.length} of ${totalFiles} changed files`);
  if (Math.max(totalFiles, files.length) > limits.maxFiles) reasons.push(`more than ${limits.maxFiles} changed files`);

  for (const f of files) {
    changedLines += Math.max(0, f.additions) + Math.max(0, f.deletions);
    // A rename or copy is judged at both ends: the old path as removed, the new path with its own status.
    if (f.previous_filename !== undefined && f.previous_filename !== f.filename) {
      const oldStatus = f.status === "copied" ? "copied-from" : "removed";
      const old = classifyPath(f.previous_filename, oldStatus, policy);
      // A copy leaves its source unchanged, so only a protected source matters.
      if (f.status !== "copied" || old.lane === "maintainer") verdicts.push({ ...old, reason: `old path of a ${f.status} file: ${old.reason}` });
    }
    let v = classifyPath(f.filename, f.status, policy);
    if (v.lane === "auto" && f.status !== "removed") {
      const rule = policy.rules.find((r) => r.id === v.rule);
      const problem = contentProblem(f, rule, limits);
      if (problem) v = { ...v, lane: "maintainer", reason: problem };
      else if (!f.hasPatch) binaryBytes += f.size ?? 0;
    }
    verdicts.push(v);
  }
  if (changedLines > limits.maxChangedLines) reasons.push(`${changedLines} changed lines, more than ${limits.maxChangedLines}`);
  if (binaryBytes > limits.maxBinaryBytesTotal) reasons.push(`${binaryBytes} bytes of binary files, more than ${limits.maxBinaryBytesTotal}`);

  let lane: Lane = reasons.length > 0 ? "maintainer" : "auto";
  for (const v of verdicts) lane = stricter(lane, v.lane);
  return { lane, reasons, files: verdicts, stats: { files: Math.max(totalFiles, files.length), changedLines, binaryBytes } };
}

function contentProblem(f: ChangedFile, rule: Rule | undefined, limits: Policy["limits"]): string | undefined {
  if (f.mode === undefined || f.mode === null) return "file mode in the head commit is unknown";
  if (f.mode === "120000") return "symbolic link";
  if (f.mode === "160000") return "git submodule";
  if (f.mode !== "100644") return `file mode ${f.mode} (only plain, non-executable files are in the auto lane)`;
  const size = f.size ?? null;
  if (!f.hasPatch) {
    if (size === null) return "binary or very large file of unknown size";
    if (size > limits.maxBinaryBytesPerFile) return `binary or very large file of ${size} bytes, more than ${limits.maxBinaryBytesPerFile}`;
  }
  if (rule?.maxBytes !== undefined) {
    if (size === null) return "file size is unknown";
    if (size > rule.maxBytes) return `${size} bytes, more than ${rule.maxBytes} for this rule`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Reviews and the merge decision

export interface Review {
  user: string;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED or PENDING. */
  state: string;
  commitId: string;
  /** Order of submission; later reviews win. */
  submittedAt: string;
}

export interface ReviewSummary {
  approvedBy: string[];
  changesRequestedBy: string[];
}

/**
 * Each maintainer's latest deciding review. Comments do not change a decision; a dismissal
 * clears it. The author's own reviews never count, and with mustMatchHeadCommit an approval
 * of an older commit is stale.
 */
export function summarizeReviews(reviews: Review[], opts: { headSha: string; author: string; isMaintainer: (user: string) => boolean; mustMatchHeadCommit: boolean }): ReviewSummary {
  const latest = new Map<string, Review>();
  const sorted = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  for (const r of sorted) {
    const key = r.user.toLowerCase();
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") latest.set(key, r);
    else if (r.state === "DISMISSED") latest.delete(key);
  }
  const approvedBy: string[] = [];
  const changesRequestedBy: string[] = [];
  for (const r of latest.values()) {
    if (r.user.toLowerCase() === opts.author.toLowerCase() || !opts.isMaintainer(r.user)) continue;
    if (r.state === "CHANGES_REQUESTED") changesRequestedBy.push(r.user);
    else if (!opts.mustMatchHeadCommit || r.commitId === opts.headSha) approvedBy.push(r.user);
  }
  return { approvedBy: approvedBy.sort(), changesRequestedBy: changesRequestedBy.sort() };
}

export type CheckState = "success" | "failure" | "pending" | "missing";
export type AiVerdict = "pass" | "changes-suggested" | "error" | "none";

export interface MergeInput {
  policy: Policy;
  evaluation: Pick<Evaluation, "lane" | "reasons">;
  pr: { open: boolean; draft: boolean; baseIsDefault: boolean; autoMergeEnabled: boolean };
  labels: string[];
  /** The ai-review commit status on the head commit. */
  aiStatus: AiVerdict;
  /** State of every check and status on the head commit, by name. */
  checks: Record<string, CheckState>;
  reviews: ReviewSummary;
}

export interface MergeDecision {
  /** False when the bot should leave the pull request alone (closed, or not aimed at the default branch). */
  act: boolean;
  status: { state: "success" | "pending"; description: string };
  addLabels: string[];
  removeLabels: string[];
  enableAutoMerge: boolean;
  notes: string[];
}

/** The merge-policy status, labels and auto-merge action for one pull request. */
export function decideMerge(input: MergeInput): MergeDecision {
  const { policy, evaluation, pr, labels, reviews } = input;
  const L = policy.labels;
  const has = (l: string) => labels.some((x) => x.toLowerCase() === l.toLowerCase());
  const add: string[] = [];
  const remove: string[] = [];
  const notes: string[] = [];
  const want = (label: string, on: boolean) => {
    if (on && !has(label)) add.push(label);
    if (!on && has(label)) remove.push(label);
  };
  const idle: MergeDecision = { act: false, status: { state: "pending", description: "" }, addLabels: [], removeLabels: [], enableAutoMerge: false, notes };
  if (!pr.open) return { ...idle, notes: ["the pull request is closed"] };
  if (!pr.baseIsDefault) return { ...idle, notes: ["the pull request does not target the default branch"] };

  const lane = evaluation.lane;
  want(L.laneAuto, lane === "auto");
  want(L.laneMaintainer, lane === "maintainer");

  const approved = reviews.approvedBy.length >= policy.approvals.required;
  const aiPass = input.aiStatus === "pass" && has(L.aiPass);
  const hold = L.hold.find((h) => has(h));

  const failed = policy.requiredChecks.filter((c) => input.checks[c] === "failure");
  const waiting = policy.requiredChecks.filter((c) => input.checks[c] !== "success" && input.checks[c] !== "failure");

  let gate: string | undefined; // why the policy itself is not yet satisfied
  if (reviews.changesRequestedBy.length > 0) gate = "a maintainer requested changes";
  else if (lane === "maintainer" && !approved) gate = "maintainer lane: waiting for a maintainer approval";
  else if (lane === "auto" && !approved && !aiPass) {
    gate = input.aiStatus === "changes-suggested" ? "auto lane: the AI review suggested changes; push a fix or ask a maintainer" : "auto lane: waiting for the AI review";
  }
  want(L.needsMaintainer, lane === "maintainer" ? !approved : (input.aiStatus === "changes-suggested" && !approved) || reviews.changesRequestedBy.length > 0);

  let description: string;
  let state: "success" | "pending" = "pending";
  if (pr.draft) description = "draft: mark it ready for review to start merging";
  else if (hold) description = `on hold: the "${hold}" label is set`;
  else if (failed.length > 0) description = `required check failed: ${failed.join(", ")}`;
  else if (gate) description = gate;
  else if (waiting.length > 0) description = `waiting for: ${waiting.join(", ")}`;
  else {
    state = "success";
    description = lane === "auto" ? (approved ? "auto lane: approved by a maintainer" : "auto lane: all checks and the AI review passed") : "maintainer lane: approved by a maintainer";
  }
  if (lane === "maintainer") notes.push(...evaluation.reasons);
  const enableAutoMerge = !pr.draft && !hold && !pr.autoMergeEnabled;
  return { act: true, status: { state, description: truncate(description, 140) }, addLabels: add, removeLabels: remove, enableAutoMerge, notes };
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
}

// ---------------------------------------------------------------------------------------
// Markdown for job summaries. File names come from the pull request, so they are escaped.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`|\\[\]@]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/[\u0000-\u001f\u007f]/g, "?");
}

export function renderEvaluation(ev: Evaluation, title = "Merge lane"): string {
  const lines = [`## ${title}: ${ev.lane}`, ""];
  lines.push(ev.lane === "auto"
    ? "Every changed file is in the auto lane. The pull request merges by itself when every required check and the AI review pass."
    : "This pull request is in the maintainer lane. It is evaluated automatically and merges by itself after one maintainer approval.");
  lines.push("", `${ev.stats.files} files, ${ev.stats.changedLines} changed lines, ${ev.stats.binaryBytes} bytes of binary files.`);
  if (ev.reasons.length > 0) lines.push("", "Pull request:", ...ev.reasons.map((r) => `- ${escapeHtml(r)}`));
  lines.push("", "| File | Status | Lane | Rule | Reason |", "|---|---|---|---|---|");
  for (const f of ev.files) lines.push(`| <code>${escapeHtml(f.path)}</code> | ${escapeHtml(f.status)} | ${f.lane} | ${escapeHtml(f.rule)} | ${escapeHtml(f.reason)} |`);
  return lines.join("\n") + "\n";
}

/** Validate a parsed merge-policy.json enough that a typo fails loudly instead of widening a lane. */
export function validatePolicy(p: unknown): Policy {
  const fail = (m: string): never => {
    throw new Error(`merge-policy.json: ${m}`);
  };
  if (typeof p !== "object" || p === null) fail("not an object");
  const o = p as Partial<Policy>;
  if (o.version !== 1) fail("version must be 1");
  if (o.defaultLane !== "maintainer" && o.defaultLane !== "auto") fail("defaultLane must be auto or maintainer");
  if (!Array.isArray(o.rules)) fail("rules must be a list");
  const ids = new Set<string>();
  for (const r of o.rules ?? []) {
    if (!r || typeof r.id !== "string" || ids.has(r.id)) fail(`rule ids must be unique strings (${String(r?.id)})`);
    ids.add(r.id);
    if (r.lane !== "auto" && r.lane !== "maintainer") fail(`rule ${r.id}: lane must be auto or maintainer`);
    if (!Array.isArray(r.globs) || r.globs.length === 0 || r.globs.some((g) => typeof g !== "string" || g === "")) fail(`rule ${r.id}: globs must be non-empty strings`);
  }
  const l = o.limits;
  if (!l || !["maxFiles", "maxChangedLines", "maxBinaryBytesPerFile", "maxBinaryBytesTotal", "maxPathLength"].every((k) => Number.isInteger((l as unknown as Record<string, unknown>)[k]))) fail("limits must be integers");
  if (!Array.isArray(o.requiredChecks)) fail("requiredChecks must be a list");
  if (!o.approvals || !Number.isInteger(o.approvals.required) || o.approvals.required < 1) fail("approvals.required must be 1 or more");
  if (!o.labels || !o.statusContexts) fail("labels and statusContexts are required");
  const ai = o.aiReview;
  if (!ai || !(Number.isInteger(ai.maxReviewsPerPullRequestPerDay) && ai.maxReviewsPerPullRequestPerDay >= 1) || !(Number.isInteger(ai.maxNewPullRequestsPerAuthorPerDay) && ai.maxNewPullRequestsPerAuthorPerDay >= 1)) {
    fail("aiReview.maxReviewsPerPullRequestPerDay and aiReview.maxNewPullRequestsPerAuthorPerDay must be integers of 1 or more");
  }
  return o as Policy;
}
