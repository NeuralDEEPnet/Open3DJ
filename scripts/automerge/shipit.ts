// Pure rules for the `ship-it` label (no I/O, no dependencies): a maintainer's one-tap approval
// and Developer Certificate of Origin for their own pull request from this repository.
//
// The label counts only when all of these hold:
// - the pull request comes from a branch of this repository, not from a fork;
// - its author is a maintainer by the merge policy's rule (approvals.permissions);
// - the author added the label themself, with a user account, not a bot;
// - the dco workflow recorded the tap as a `ship-it` commit status on the exact head commit of
//   the labeled event, so the status's creator is the GitHub Actions bot.
// A push makes a new head commit with no such status, and the dco workflow removes the stale
// label, so every new version needs a new tap. Removing the label withdraws the certification.
// cli.ts applies these rules in the dco check and in the merge bot. No bot ever writes a
// Signed-off-by line: the status is the record of the maintainer's certification.

/** The creator login of statuses that a workflow writes with its GITHUB_TOKEN. */
export const ACTIONS_BOT = "github-actions[bot]";

/** The label and the commit status context, from .github/merge-policy.json. */
export interface ShipItNames {
  label: string;
  context: string;
}

/** Facts about one pull request at one head commit. */
export interface ShipItPr {
  author: string;
  /** True when the head branch lives in this repository, not in a fork. */
  sameRepo: boolean;
  headSha: string;
  labels: string[];
}

/** The parts of a pull_request event that matter here. */
export interface ShipItEvent {
  /** labeled, unlabeled, synchronize, opened, reopened... */
  action: string;
  /** For labeled and unlabeled: the label's name. */
  label?: string;
  /** Who caused the event; type is "User" for a person's account and "Bot" for an app. */
  sender: { login: string; type: string };
}

/** One commit status, as the list endpoint (commits/{sha}/statuses) reports it. */
export interface StatusRecord {
  /** Larger ids are newer. */
  id: number;
  context: string;
  state: string;
  description: string;
  /** The creator's login, "" when GitHub gives none. */
  creator: string;
}

/**
 * What the dco workflow does about ship-it for one event, before it checks the commits.
 * certify: record a certification on `sha` if the author is a maintainer (the caller asks
 * GitHub). withdraw: record a withdrawal on `sha` if it holds a certification now.
 */
export type ShipItPlan =
  | { kind: "certify"; sha: string }
  | { kind: "withdraw"; sha: string }
  | { kind: "remove-label" }
  | { kind: "none"; reason: string };

export type ShipItVerdict = { ok: true; by: string; at: string; sha: string } | { ok: false; reason: string };

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const FULL_SHA = /^[0-9a-f]{40}$/;
/** A GitHub login: letters, digits and single hyphens, at most 39 characters. Bots ("name[bot]") never match. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const CERTIFICATION = /^DCO and approval by @([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})) at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

export function hasLabel(labels: string[], name: string): boolean {
  return labels.some((l) => same(l, name));
}

/** An ISO time to the second, for example 2026-11-08T18:50:07Z. */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The description of a certification status (at most 84 characters). */
export function certificationText(login: string, at: Date): string {
  return `DCO and approval by @${login} at ${isoSeconds(at)}`;
}

/** The description of a withdrawal status. */
export function withdrawalText(login: string, at: Date): string {
  return `withdrawn by @${LOGIN.test(login) ? login : "a bot"} at ${isoSeconds(at)}`;
}

export function parseCertification(description: string): { by: string; at: string } | undefined {
  const m = CERTIFICATION.exec(description);
  return m ? { by: m[1]!, at: m[2]! } : undefined;
}

/** What to do about ship-it for one pull_request event. */
export function shipItAction(ev: ShipItEvent, pr: ShipItPr, names: ShipItNames): ShipItPlan {
  const none = (reason: string): ShipItPlan => ({ kind: "none", reason });
  if (ev.action === "synchronize") {
    if (!hasLabel(pr.labels, names.label)) return none("no ship-it label");
    // A fork's token is read-only, and the label never counted there.
    if (!pr.sameRepo) return none("the pull request comes from a fork");
    return { kind: "remove-label" };
  }
  if ((ev.action !== "labeled" && ev.action !== "unlabeled") || ev.label === undefined || !same(ev.label, names.label)) return none("not a ship-it label event");
  if (!pr.sameRepo) return none("the pull request comes from a fork");
  if (!FULL_SHA.test(pr.headSha)) return none("the event names no head commit");
  // Taking the label off is always safe, whoever does it: it stops a merge.
  if (ev.action === "unlabeled") return { kind: "withdraw", sha: pr.headSha };
  if (ev.sender.type !== "User" || !LOGIN.test(ev.sender.login)) return none("the label was added by a bot");
  if (!same(ev.sender.login, pr.author)) return none("the label was added by someone other than the author");
  return { kind: "certify", sha: pr.headSha };
}

/** Why a pull request cannot carry a ship-it, judged without any API call; undefined when it might. */
export function shipItCandidate(pr: ShipItPr, names: ShipItNames): string | undefined {
  if (!pr.sameRepo) return "the pull request comes from a fork";
  if (!hasLabel(pr.labels, names.label)) return "no ship-it label";
  return undefined;
}

/** The newest ship-it status on a commit that the GitHub Actions bot wrote. Statuses from any other creator are ignored. */
export function latestShipIt(statuses: StatusRecord[], context: string): StatusRecord | undefined {
  let best: StatusRecord | undefined;
  for (const s of statuses) {
    if (s.context !== context || s.creator !== ACTIONS_BOT) continue;
    if (!best || s.id > best.id) best = s;
  }
  return best;
}

/**
 * Whether the pull request's head commit carries a valid ship-it now. `status` is
 * latestShipIt() of the statuses on pr.headSha, and `authorIsMaintainer` the merge
 * policy's maintainer rule for pr.author.
 */
export function verifyShipIt(pr: ShipItPr, opts: { names: ShipItNames; authorIsMaintainer: boolean; status: StatusRecord | undefined }): ShipItVerdict {
  const no = (reason: string): ShipItVerdict => ({ ok: false, reason });
  const pre = shipItCandidate(pr, opts.names);
  if (pre) return no(pre);
  if (!opts.authorIsMaintainer) return no("the author is not a maintainer");
  const s = opts.status;
  if (!s) return no(`commit ${pr.headSha.slice(0, 12)} has no ship-it certification`);
  if (s.creator !== ACTIONS_BOT || s.context !== opts.names.context) return no("the ship-it status was not written by the GitHub Actions bot");
  if (s.state !== "success") return no("the ship-it certification was withdrawn");
  const c = parseCertification(s.description);
  if (!c) return no("the ship-it status has an unexpected description");
  if (!same(c.by, pr.author)) return no("the ship-it status names someone other than the author");
  return { ok: true, by: c.by, at: c.at, sha: pr.headSha };
}
