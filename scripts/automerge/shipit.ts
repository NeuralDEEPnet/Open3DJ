// Pure rules for the `ship-it` label (no I/O, no dependencies): a maintainer's one-tap approval
// and Developer Certificate of Origin for their own pull request from this repository.
//
// The label counts only when all of these hold:
// - the pull request comes from a branch of this repository, not from a fork;
// - its author is a maintainer by the merge policy's rule (approvals.permissions);
// - the label that is on the pull request now was added by the author themself, with a user
//   account, not a bot: the newest ship-it event in the pull request's issue events is the
//   author's `labeled` event;
// - the dco workflow recorded that tap as a `ship-it` commit status on the exact head commit of
//   the labeled event: the status's creator is the GitHub Actions bot, it names the author and
//   this pull request, and it is not older than the author's latest tap.
// A push makes a new head commit with no such status, and the dco workflow removes the stale
// label and marks the old commit's tap as superseded, so every new version needs a new tap.
// Removing the label withdraws the certification, and a label put back by anyone else never
// revives it. cli.ts applies these rules in the dco check and in the merge bot. No bot ever
// writes a Signed-off-by line: the status is the record of the maintainer's certification.

/** The creator login of statuses that a workflow writes with its GITHUB_TOKEN. */
export const ACTIONS_BOT = "github-actions[bot]";

/** The label and the commit status context, from .github/merge-policy.json. */
export interface ShipItNames {
  label: string;
  context: string;
}

/** Facts about one pull request at one head commit. */
export interface ShipItPr {
  /** The pull request number. */
  number: number;
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
  /** For synchronize: the head commit before the push. */
  before?: string;
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
  /** When GitHub created it (ISO time). */
  createdAt: string;
}

/** One labeled or unlabeled event from the pull request's issue events (issues/{n}/events). */
export interface LabelEvent {
  /** Larger ids are newer. */
  id: number;
  event: "labeled" | "unlabeled";
  label: string;
  /** Who added or removed the label; type is "User" for a person's account and "Bot" for an app. */
  actor: { login: string; type: string };
  /** When GitHub recorded it (ISO time). */
  createdAt: string;
}

/**
 * What the dco workflow does about ship-it for one event, before it checks the commits.
 * certify: record a certification on `sha` if the author is a maintainer (the caller asks
 * GitHub). withdraw: record a withdrawal on `sha` if it holds a certification now.
 * remove-label: take the stale label off after a push, and mark a certification of the commit
 * before the push (`supersede`, when the event names it) as superseded.
 */
export type ShipItPlan =
  | { kind: "certify"; sha: string }
  | { kind: "withdraw"; sha: string }
  | { kind: "remove-label"; supersede?: string }
  | { kind: "none"; reason: string };

export type ShipItVerdict = { ok: true; by: string; at: string; sha: string } | { ok: false; reason: string };

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const FULL_SHA = /^[0-9a-f]{40}$/;
/** A GitHub login: letters, digits and single hyphens, at most 39 characters. Bots ("name[bot]") never match. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ISO = "(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z)";
const PR = "for #([1-9]\\d{0,8})";
const CERTIFICATION = new RegExp(`^DCO and approval by @([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})) at ${ISO} ${PR}$`);
/** Every ship-it status this code writes ends with the pull request it is for. */
const FOR_PR = new RegExp(` ${PR}$`);

export function hasLabel(labels: string[], name: string): boolean {
  return labels.some((l) => same(l, name));
}

/** An ISO time to the second, for example 2026-11-08T18:50:07Z. */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The description of a certification status (at most 99 characters, within the 140 a status allows). */
export function certificationText(login: string, at: Date, pr: number): string {
  return `DCO and approval by @${login} at ${isoSeconds(at)} for #${pr}`;
}

/** The description of a withdrawal status. */
export function withdrawalText(login: string, at: Date, pr: number): string {
  return `withdrawn by @${LOGIN.test(login) ? login : "a bot"} at ${isoSeconds(at)} for #${pr}`;
}

/** The description of the status that ends a certification when a push replaces its commit. */
export function supersededText(at: Date, pr: number): string {
  return `superseded by a push at ${isoSeconds(at)} for #${pr}`;
}

export function parseCertification(description: string): { by: string; at: string; pr: number } | undefined {
  const m = CERTIFICATION.exec(description);
  return m ? { by: m[1]!, at: m[2]!, pr: Number(m[3]) } : undefined;
}

/** The pull request a ship-it status is for, from the end of its description. */
export function statusPr(description: string): number | undefined {
  const m = FOR_PR.exec(description);
  return m ? Number(m[1]) : undefined;
}

/** What to do about ship-it for one pull_request event. */
export function shipItAction(ev: ShipItEvent, pr: ShipItPr, names: ShipItNames): ShipItPlan {
  const none = (reason: string): ShipItPlan => ({ kind: "none", reason });
  if (ev.action === "synchronize") {
    if (!hasLabel(pr.labels, names.label)) return none("no ship-it label");
    // A fork's token is read-only, and the label never counted there.
    if (!pr.sameRepo) return none("the pull request comes from a fork");
    return { kind: "remove-label", ...(ev.before !== undefined && FULL_SHA.test(ev.before) ? { supersede: ev.before } : {}) };
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

/**
 * The newest ship-it status on a commit that the GitHub Actions bot wrote for pull request
 * `pr`. Statuses from any other creator, and statuses for another pull request with the same
 * head commit, are ignored.
 */
export function latestShipIt(statuses: StatusRecord[], context: string, pr: number): StatusRecord | undefined {
  let best: StatusRecord | undefined;
  for (const s of statuses) {
    if (s.context !== context || s.creator !== ACTIONS_BOT || statusPr(s.description) !== pr) continue;
    if (!best || s.id > best.id) best = s;
  }
  return best;
}

/** The newest labeled or unlabeled event of the ship-it label. */
export function latestLabelEvent(events: LabelEvent[], label: string): LabelEvent | undefined {
  let best: LabelEvent | undefined;
  for (const e of events) {
    if ((e.event !== "labeled" && e.event !== "unlabeled") || !same(e.label, label)) continue;
    if (!best || e.id > best.id) best = e;
  }
  return best;
}

/**
 * Whether the pull request's head commit carries a valid ship-it now. `status` is
 * latestShipIt() of the statuses on pr.headSha, `authorIsMaintainer` the merge policy's
 * maintainer rule for pr.author, and `events` the pull request's label events; `eventsComplete`
 * is false when the list may miss the newest ones.
 */
export function verifyShipIt(pr: ShipItPr, opts: { names: ShipItNames; authorIsMaintainer: boolean; status: StatusRecord | undefined; events: LabelEvent[]; eventsComplete: boolean }): ShipItVerdict {
  const no = (reason: string): ShipItVerdict => ({ ok: false, reason });
  const pre = shipItCandidate(pr, opts.names);
  if (pre) return no(pre);
  if (!opts.authorIsMaintainer) return no("the author is not a maintainer");
  // Who put the label on: only the author's own tap counts, so a label that someone else put
  // back can never revive an older certification.
  if (!opts.eventsComplete) return no("the pull request has too many events to tell who added the ship-it label");
  const tap = latestLabelEvent(opts.events, opts.names.label);
  if (!tap) return no("no event shows who added the ship-it label");
  if (tap.event !== "labeled") return no("the ship-it label was removed");
  if (tap.actor.type !== "User" || !LOGIN.test(tap.actor.login)) return no("the ship-it label on the pull request was added by a bot");
  if (!same(tap.actor.login, pr.author)) return no("the ship-it label on the pull request was added by someone other than the author");
  const s = opts.status;
  if (!s) return no(`commit ${pr.headSha.slice(0, 12)} has no ship-it certification`);
  if (s.creator !== ACTIONS_BOT || s.context !== opts.names.context) return no("the ship-it status was not written by the GitHub Actions bot");
  if (s.state !== "success") return no(s.description.startsWith("superseded") ? "the ship-it certification was superseded by a push" : "the ship-it certification was withdrawn");
  const c = parseCertification(s.description);
  if (!c) return no("the ship-it status has an unexpected description");
  if (c.pr !== pr.number) return no("the ship-it status certifies another pull request");
  if (!same(c.by, pr.author)) return no("the ship-it status names someone other than the author");
  // The status must come from the tap that put the label on now (it is written after it).
  const written = Date.parse(s.createdAt);
  const tapped = Date.parse(tap.createdAt);
  if (!Number.isFinite(written) || !Number.isFinite(tapped) || written < tapped) return no("the ship-it certification is older than the author's latest tap");
  return { ok: true, by: c.by, at: c.at, sha: pr.headSha };
}
