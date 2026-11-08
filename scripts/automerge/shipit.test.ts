// Tests for the ship-it rules: a maintainer's one-tap approval and DCO certification of their
// own pull request from this repository. The rules are pure; cli.test.ts runs them end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validatePolicy } from "./policy.ts";
import { ACTIONS_BOT, certificationText, latestLabelEvent, latestShipIt, parseCertification, shipItAction, shipItCandidate, statusPr, supersededText, verifyShipIt, withdrawalText, type LabelEvent, type ShipItEvent, type ShipItPr, type StatusRecord } from "./shipit.ts";

const policy = validatePolicy(JSON.parse(readFileSync(new URL("../../.github/merge-policy.json", import.meta.url), "utf8")));
const names = { label: policy.labels.shipIt, context: policy.statusContexts.shipIt };
const HEAD = "a".repeat(40);
const BEFORE = "b".repeat(40);
const AT = new Date("2026-11-08T18:50:07.123Z");
const LEAD = { login: "lead", type: "User" };

const pr = (over: Partial<ShipItPr> = {}): ShipItPr => ({ number: 7, author: "lead", sameRepo: true, headSha: HEAD, labels: ["ship-it"], ...over });
const ev = (over: Partial<ShipItEvent> = {}): ShipItEvent => ({ action: "labeled", label: "ship-it", sender: LEAD, ...over });
const status = (over: Partial<StatusRecord> = {}): StatusRecord => ({ id: 10, context: "ship-it", state: "success", description: certificationText("lead", AT, 7), creator: ACTIONS_BOT, createdAt: "2026-11-08T18:50:07Z", ...over });
const labelEv = (over: Partial<LabelEvent> = {}): LabelEvent => ({ id: 100, event: "labeled", label: "ship-it", actor: LEAD, createdAt: "2026-11-08T18:50:05Z", ...over });
/** The author tapped at 18:50:05, and the dco run recorded it at 18:50:07. */
const tapped = (s: StatusRecord = status(), events: LabelEvent[] = [labelEv()]) => ({ names, authorIsMaintainer: true, status: s, events, eventsComplete: true });

describe("ship-it names", () => {
  it("are set in the merge policy, so the docs and the bot use one name", () => {
    assert.equal(names.label, "ship-it");
    assert.equal(names.context, "ship-it");
    assert.throws(() => validatePolicy({ ...structuredClone(policy), labels: { ...policy.labels, shipIt: "" } }));
    assert.throws(() => validatePolicy({ ...structuredClone(policy), statusContexts: { ...policy.statusContexts, shipIt: undefined } }));
  });
});

describe("the ship-it label event", () => {
  it("certifies the exact head commit of the event when the author, a user, adds the label to their own pull request", () => {
    assert.deepEqual(shipItAction(ev(), pr(), names), { kind: "certify", sha: HEAD });
    assert.deepEqual(shipItAction(ev({ label: "Ship-It", sender: { login: "LEAD", type: "User" } }), pr(), names), { kind: "certify", sha: HEAD }, "logins and labels ignore case");
  });
  it("ignores the label when someone else adds it, even another maintainer", () => {
    const a = shipItAction(ev({ sender: { login: "maint", type: "User" } }), pr(), names);
    assert.equal(a.kind, "none");
    assert.match((a as { reason: string }).reason, /someone other than the author/);
  });
  it("ignores the label when a bot adds it, even a bot that authored the pull request", () => {
    assert.equal(shipItAction(ev({ sender: { login: "lead", type: "Bot" } }), pr(), names).kind, "none");
    assert.equal(shipItAction(ev({ sender: { login: "helper[bot]", type: "Bot" } }), pr({ author: "helper[bot]" }), names).kind, "none");
    assert.equal(shipItAction(ev({ sender: { login: "helper[bot]", type: "User" } }), pr({ author: "helper[bot]" }), names).kind, "none", "a [bot] login never certifies");
  });
  it("ignores the label on a pull request from a fork", () => {
    const a = shipItAction(ev(), pr({ sameRepo: false }), names);
    assert.equal(a.kind, "none");
    assert.match((a as { reason: string }).reason, /fork/);
  });
  it("ignores other labels and other actions", () => {
    assert.equal(shipItAction(ev({ label: "documentation" }), pr(), names).kind, "none");
    assert.equal(shipItAction(ev({ action: "opened", label: undefined }), pr(), names).kind, "none");
    assert.equal(shipItAction(ev({ action: "reopened", label: undefined }), pr(), names).kind, "none");
  });
  it("needs a full head commit id in the event", () => {
    assert.equal(shipItAction(ev(), pr({ headSha: "abc" }), names).kind, "none");
  });
  it("removes the stale label after a push to a pull request from this repository, supersedes the commit before it, and does nothing else", () => {
    const push = (over: Partial<ShipItEvent> = {}) => ev({ action: "synchronize", label: undefined, before: BEFORE, ...over });
    assert.deepEqual(shipItAction(push(), pr(), names), { kind: "remove-label", supersede: BEFORE });
    assert.deepEqual(shipItAction(push({ before: undefined }), pr(), names), { kind: "remove-label" }, "an event without the old commit still removes the label");
    assert.deepEqual(shipItAction(push({ before: "0" }), pr(), names), { kind: "remove-label" });
    assert.equal(shipItAction(push(), pr({ labels: ["documentation"] }), names).kind, "none");
    assert.equal(shipItAction(push(), pr({ sameRepo: false }), names).kind, "none", "a fork's token is read-only, and its label never counted");
  });
  it("withdraws the certification of the event's commit when anyone removes the label", () => {
    assert.deepEqual(shipItAction(ev({ action: "unlabeled" }), pr({ labels: [] }), names), { kind: "withdraw", sha: HEAD });
    assert.deepEqual(shipItAction(ev({ action: "unlabeled", sender: { login: "maint", type: "User" } }), pr({ labels: [] }), names), { kind: "withdraw", sha: HEAD });
    assert.equal(shipItAction(ev({ action: "unlabeled" }), pr({ labels: [], sameRepo: false }), names).kind, "none");
  });
});

describe("the certification text", () => {
  it("names the author, the time to the second and the pull request, and fits a status description", () => {
    const text = certificationText("lead", AT, 7);
    assert.equal(text, "DCO and approval by @lead at 2026-11-08T18:50:07Z for #7");
    assert.deepEqual(parseCertification(text), { by: "lead", at: "2026-11-08T18:50:07Z", pr: 7 });
    assert.ok(certificationText("a".repeat(39), AT, 999_999_999).length <= 140);
    assert.equal(withdrawalText("maint", AT, 7), "withdrawn by @maint at 2026-11-08T18:50:07Z for #7");
    assert.equal(supersededText(AT, 7), "superseded by a push at 2026-11-08T18:50:07Z for #7");
    for (const t of [text, withdrawalText("maint", AT, 7), supersededText(AT, 7)]) assert.equal(statusPr(t), 7, t);
  });
  it("parses nothing else", () => {
    const bad = [
      "", "DCO and approval by @lead", "dco and approval by @lead at 2026-11-08T18:50:07Z for #7", "DCO and approval by @lead at 2026-11-08T18:50:07Z for #7 extra",
      "DCO and approval by @le ad at 2026-11-08T18:50:07Z for #7", "DCO and approval by @lead at 2026-11-08T18:50:07Z", "DCO and approval by @lead at 2026-11-08T18:50:07Z for #07",
      withdrawalText("lead", AT, 7), supersededText(AT, 7),
    ];
    for (const d of bad) assert.equal(parseCertification(d), undefined, d);
    assert.equal(statusPr("DCO and approval by @lead at 2026-11-08T18:50:07Z"), undefined, "a status without a pull request number is for none");
  });
});

describe("reading a ship-it back", () => {
  it("picks the newest status that the GitHub Actions bot wrote for this pull request, and ignores every other creator and pull request", () => {
    const list = [status({ id: 1 }), status({ id: 3, state: "failure", description: withdrawalText("lead", AT, 7) }), status({ id: 2 }), status({ id: 9, creator: "lead" }), status({ id: 8, context: "ci" }), status({ id: 11, description: certificationText("lead", AT, 8) })];
    assert.equal(latestShipIt(list, "ship-it", 7)?.id, 3);
    assert.equal(latestShipIt(list, "ship-it", 8)?.id, 11, "two pull requests with the same head commit keep their own taps");
    assert.equal(latestShipIt([status({ creator: "someone" })], "ship-it", 7), undefined);
    assert.equal(latestShipIt([status({ description: "DCO and approval by @lead at 2026-11-08T18:50:07Z" })], "ship-it", 7), undefined);
    assert.equal(latestShipIt([], "ship-it", 7), undefined);
  });
  it("finds the newest event of the label, added or removed", () => {
    const events = [labelEv({ id: 1 }), labelEv({ id: 3, event: "unlabeled" }), labelEv({ id: 2 }), labelEv({ id: 9, label: "documentation" })];
    assert.equal(latestLabelEvent(events, "ship-it")?.id, 3);
    assert.equal(latestLabelEvent([labelEv({ label: "Ship-It" })], "ship-it")?.id, 100);
    assert.equal(latestLabelEvent([], "ship-it"), undefined);
  });
  it("counts a certification by the author, a maintainer, on the head commit, recorded for the author's tap that put the label on", () => {
    assert.deepEqual(verifyShipIt(pr(), tapped()), { ok: true, by: "lead", at: "2026-11-08T18:50:07Z", sha: HEAD });
    assert.equal(verifyShipIt(pr(), tapped(status({ createdAt: "2026-11-08T18:50:05Z" }))).ok, true, "a status written in the same second as the tap counts");
    const again = [labelEv({ id: 1, createdAt: "2026-11-08T18:40:00Z" }), labelEv({ id: 2, event: "unlabeled", createdAt: "2026-11-08T18:45:00Z" }), labelEv({ id: 3 })];
    assert.equal(verifyShipIt(pr(), tapped(status(), again)).ok, true, "a new tap after taking the label off counts once it is recorded");
  });
  const refused: Array<[string, ShipItPr, Parameters<typeof verifyShipIt>[1], RegExp]> = [
    ["a fork", pr({ sameRepo: false }), tapped(), /fork/],
    ["a removed label", pr({ labels: [] }), tapped(), /no ship-it label/],
    ["a non-maintainer author", pr(), { ...tapped(), authorIsMaintainer: false }, /not a maintainer/],
    ["a new push (no status on the new head commit)", pr({ headSha: "c".repeat(40) }), { ...tapped(), status: undefined }, /no ship-it certification/],
    ["a withdrawn certification", pr(), tapped(status({ state: "failure", description: withdrawalText("lead", AT, 7) })), /withdrawn/],
    ["a superseded certification (a push, then a force-push back)", pr(), tapped(status({ state: "failure", description: supersededText(AT, 7) })), /superseded by a push/],
    ["a status by another creator", pr(), tapped(status({ creator: "lead" })), /GitHub Actions bot/],
    ["a status for someone else", pr(), tapped(status({ description: certificationText("maint", AT, 7) })), /someone other than the author/],
    ["a status for another pull request", pr(), tapped(status({ description: certificationText("lead", AT, 8) })), /another pull request/],
    ["an unexpected description", pr(), tapped(status({ description: "looks good for #7" })), /unexpected description/],
    // Who put the label on now: the review's three ways around the event handler.
    ["a label that someone else put back (another maintainer)", pr(), tapped(status({ createdAt: "2026-11-08T19:00:00Z" }), [labelEv({ id: 1 }), labelEv({ id: 2, event: "unlabeled" }), labelEv({ id: 3, actor: { login: "maint", type: "User" } })]), /added by someone other than the author/],
    ["a label that a triager added after a force-push back", pr(), tapped(status(), [labelEv({ id: 1 }), labelEv({ id: 2, event: "unlabeled", actor: { login: "github-actions[bot]", type: "Bot" } }), labelEv({ id: 3, actor: { login: "triager", type: "User" } })]), /someone other than the author/],
    ["a label that a bot added", pr(), tapped(status(), [labelEv({ actor: { login: "lead", type: "Bot" } })]), /added by a bot/],
    ["a label added through a [bot] login", pr(), tapped(status(), [labelEv({ actor: { login: "helper[bot]", type: "User" } })]), /added by a bot/],
    ["no event that shows who added the label", pr(), tapped(status(), []), /no event shows who/],
    ["a label event list that may miss the newest events", pr(), { ...tapped(), eventsComplete: false }, /too many events/],
    ["a removal that is the newest event (read while the label came off)", pr(), tapped(status(), [labelEv({ id: 1 }), labelEv({ id: 2, event: "unlabeled" })]), /label was removed/],
    ["a certification older than the author's latest tap (its run was dropped)", pr(), tapped(status({ createdAt: "2026-11-08T18:50:07Z" }), [labelEv({ id: 5, createdAt: "2026-11-08T18:51:00Z" })]), /older than the author's latest tap/],
    ["a status with no creation time", pr(), tapped(status({ createdAt: "" })), /older than/],
  ];
  for (const [what, p, opts, why] of refused) {
    it(`refuses ${what}`, () => {
      const v = verifyShipIt(p, opts);
      assert.equal(v.ok, false);
      assert.match((v as { reason: string }).reason, why);
    });
  }
  it("needs no API call to rule out a fork or an unlabeled pull request", () => {
    assert.match(shipItCandidate(pr({ sameRepo: false }), names) ?? "", /fork/);
    assert.match(shipItCandidate(pr({ labels: ["hold"] }), names) ?? "", /no ship-it label/);
    assert.equal(shipItCandidate(pr(), names), undefined);
  });
});
