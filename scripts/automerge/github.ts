// A small GitHub REST and GraphQL client on top of fetch, for the automerge workflows. No
// dependencies. It reads GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_API_URL from the
// environment that GitHub Actions provides, and never prints the token.
import type { ChangedFile } from "./policy.ts";

export interface Gh {
  token: string;
  owner: string;
  repo: string;
  api: string;
  graphqlUrl: string;
}

export function fromEnv(env: Record<string, string | undefined> = process.env): Gh {
  const token = env.GITHUB_TOKEN ?? "";
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!token || !owner || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const api = (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
  return { token, owner, repo, api, graphqlUrl: env.GITHUB_GRAPHQL_URL ?? `${api}/graphql` };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The x-ratelimit-remaining header of the latest response, so long runs can stop before the limit. */
export const rate = { remaining: Number.POSITIVE_INFINITY };

export async function request<T>(gh: Gh, method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<T> {
  const url = /^https?:\/\//.test(path) ? path : `${gh.api}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${gh.token}`,
      accept,
      "x-github-api-version": "2022-11-28",
      "user-agent": "open3dj-automerge",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const left = Number(res.headers.get("x-ratelimit-remaining"));
  if (res.headers.has("x-ratelimit-remaining") && Number.isFinite(left)) rate.remaining = left;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, `${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET every page of a list endpoint (per_page=100), up to maxPages. itemsKey picks the list out of an object response. */
export async function paginate<T>(gh: Gh, path: string, maxPages = 30, itemsKey?: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page++) {
    const data = await request<unknown>(gh, "GET", `${path}${sep}per_page=100&page=${page}`);
    const items = (itemsKey ? (data as Record<string, unknown>)[itemsKey] : data) as T[];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

export async function graphql<T>(gh: Gh, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await request<{ data?: T; errors?: Array<{ message: string }> }>(gh, "POST", gh.graphqlUrl, { query, variables });
  if (res.errors && res.errors.length > 0) throw new Error(res.errors.map((e) => e.message).join("; "));
  return res.data as T;
}

export const repoPath = (gh: Gh) => `/repos/${gh.owner}/${gh.repo}`;

export interface PullRequest {
  number: number;
  node_id: string;
  state: string;
  draft: boolean;
  merged: boolean;
  title: string;
  body: string | null;
  changed_files: number;
  commits: number;
  author_association: string;
  user: { login: string };
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
  labels: Array<{ name: string }>;
  auto_merge: unknown;
  updated_at?: string;
}

export const getPr = (gh: Gh, n: number) => request<PullRequest>(gh, "GET", `${repoPath(gh)}/pulls/${n}`);
/** Open pull requests, most recently updated first. */
export const listOpenPrs = (gh: Gh, maxPages = 3) => paginate<PullRequest>(gh, `${repoPath(gh)}/pulls?state=open&sort=updated&direction=desc`, maxPages);

export interface ApiFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  patch?: string;
  /** Blob id of the file in the head commit. */
  sha?: string | null;
}

/** GitHub's compare API lists at most this many files. */
export const COMPARE_FILE_CAP = 300;

const refPath = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

/** Files changed between base and head (three-dot: from their merge base), as GitHub's compare API lists them. */
export async function compareFiles(gh: Gh, base: string, head: string): Promise<{ files: ApiFile[]; truncated: boolean }> {
  const c = await request<{ files?: ApiFile[] }>(gh, "GET", `${repoPath(gh)}/compare/${refPath(base)}...${refPath(head)}`);
  const files = c.files ?? [];
  return { files, truncated: files.length >= COMPARE_FILE_CAP };
}

/**
 * The changed files of a pull request at exactly the head commit `sha`, with mode and size
 * from that commit's tree. Everything is read for `sha`, never for "the current head", so a
 * push during the evaluation cannot mix two commits' files into one verdict.
 */
export async function changedFiles(gh: Gh, pr: PullRequest, sha: string): Promise<{ files: ChangedFile[]; api: ApiFile[]; total: number }> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("changedFiles needs a full commit id");
  const { files: api, truncated } = await compareFiles(gh, pr.base.ref, sha);
  const meta = await treeMeta(gh, sha, api.filter((f) => f.status !== "removed").map((f) => f.filename));
  const files = api.map((f): ChangedFile => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.previous_filename === undefined ? {} : { previous_filename: f.previous_filename }),
    hasPatch: typeof f.patch === "string",
    size: meta.get(f.filename)?.size ?? null,
    mode: meta.get(f.filename)?.mode ?? null,
  }));
  // A full compare list may be cut short: count one more file than listed, so the evaluator sends it to the maintainer lane.
  return { files, api, total: truncated ? api.length + 1 : api.length };
}

/** Mode and size of the given paths in a commit: one recursive tree call, or one call per path when the tree is truncated. */
async function treeMeta(gh: Gh, sha: string, paths: string[]): Promise<Map<string, { mode: string; size: number | null }>> {
  const out = new Map<string, { mode: string; size: number | null }>();
  if (paths.length === 0) return out;
  try {
    const tree = await request<{ truncated: boolean; tree: Array<{ path: string; mode: string; type: string; size?: number }> }>(gh, "GET", `${repoPath(gh)}/git/trees/${sha}?recursive=1`);
    if (!tree.truncated) {
      const want = new Set(paths);
      for (const e of tree.tree) if (want.has(e.path)) out.set(e.path, { mode: e.mode, size: e.size ?? null });
      return out;
    }
  } catch {
    // fall through to per-path lookups
  }
  for (const p of paths.slice(0, 60)) {
    try {
      const c = await request<{ type: string; size: number }>(gh, "GET", `${repoPath(gh)}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`);
      // The contents API reports type, not mode: it cannot tell an executable file from a plain one.
      if (c.type === "symlink") out.set(p, { mode: "120000", size: c.size });
      else if (c.type === "submodule") out.set(p, { mode: "160000", size: null });
    } catch {
      // unknown: the evaluator puts files of unknown mode in the maintainer lane
    }
  }
  return out;
}

/** State of every check run and commit status on a commit, by name; the newest of each name wins. */
export async function checkStates(gh: Gh, sha: string): Promise<{ checks: Record<string, "success" | "failure" | "pending">; statuses: Map<string, { state: string; description: string }> }> {
  const checks: Record<string, "success" | "failure" | "pending"> = {};
  const runs = await paginate<{ id: number; name: string; status: string; conclusion: string | null }>(gh, `${repoPath(gh)}/commits/${sha}/check-runs?filter=latest`, 5, "check_runs");
  for (const r of [...runs].sort((a, b) => a.id - b.id)) {
    checks[r.name] = r.status !== "completed" ? "pending" : ["success", "neutral", "skipped"].includes(r.conclusion ?? "") ? "success" : "failure";
  }
  const combined = await request<{ statuses: Array<{ context: string; state: string; description: string | null }> }>(gh, "GET", `${repoPath(gh)}/commits/${sha}/status?per_page=100`);
  const statuses = new Map<string, { state: string; description: string }>();
  for (const s of combined.statuses) {
    statuses.set(s.context, { state: s.state, description: s.description ?? "" });
    if (!(s.context in checks)) checks[s.context] = s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure";
  }
  return { checks, statuses };
}

export async function setStatus(gh: Gh, sha: string, context: string, state: "success" | "pending" | "failure" | "error", description: string, targetUrl?: string): Promise<void> {
  await request(gh, "POST", `${repoPath(gh)}/statuses/${sha}`, { state, context, description: description.slice(0, 140), ...(targetUrl ? { target_url: targetUrl } : {}) });
}

// The same colors as the label table in docs/REPO-SETTINGS.md, used only when a label is missing.
const LABEL_COLORS: Record<string, string> = {
  "lane: auto": "c2e0c6",
  "lane: maintainer": "fef2c0",
  "needs-maintainer": "fbca04",
  "ai-review: pass": "0e8a16",
  "ai-review: changes-suggested": "d93f0b",
};

/** Create a label when it does not exist yet. */
export async function ensureLabel(gh: Gh, name: string): Promise<void> {
  try {
    await request(gh, "GET", `${repoPath(gh)}/labels/${encodeURIComponent(name)}`);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    await request(gh, "POST", `${repoPath(gh)}/labels`, { name, color: LABEL_COLORS[name] ?? "ededed", description: "Set by the merge bot (.github/merge-policy.json)" });
  }
}

export async function addLabels(gh: Gh, n: number, labels: string[]): Promise<void> {
  if (labels.length === 0) return;
  for (const l of labels) await ensureLabel(gh, l);
  await request(gh, "POST", `${repoPath(gh)}/issues/${n}/labels`, { labels });
}

export async function removeLabel(gh: Gh, n: number, label: string): Promise<void> {
  try {
    await request(gh, "DELETE", `${repoPath(gh)}/issues/${n}/labels/${encodeURIComponent(label)}`);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
  }
}

/** Repository permission and role of a user, for example ["write", "maintain"]; ["none"] when unknown. */
export async function permissionOf(gh: Gh, user: string): Promise<string[]> {
  try {
    const r = await request<{ permission: string; role_name?: string }>(gh, "GET", `${repoPath(gh)}/collaborators/${encodeURIComponent(user)}/permission`);
    return [r.permission, ...(r.role_name ? [r.role_name] : [])];
  } catch {
    return ["none"];
  }
}

/** How many pull requests an author opened in this repository since the given time (search API). */
export async function prsOpenedSince(gh: Gh, author: string, since: Date): Promise<number> {
  const q = `repo:${gh.owner}/${gh.repo} is:pr author:${author} created:>=${since.toISOString().slice(0, 19)}Z`;
  const r = await request<{ total_count: number }>(gh, "GET", `/search/issues?per_page=1&q=${encodeURIComponent(q)}`);
  return r.total_count;
}

/** Turn on GitHub auto-merge, pinned to the head commit that was evaluated. Never merges directly. */
export async function enableAutoMerge(gh: Gh, pr: PullRequest, method: string, sha: string): Promise<void> {
  await graphql(gh, `mutation($id: ID!, $method: PullRequestMergeMethod!, $oid: GitObjectID!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $oid }) { clientMutationId }
  }`, { id: pr.node_id, method, oid: sha });
}
