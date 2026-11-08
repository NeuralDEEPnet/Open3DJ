// Tests for the ship-it rules: a maintainer's one-tap approval and DCO certification of their
// own pull request from this repository. The rules are pure; cli.test.ts runs them end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validatePolicy } from "./policy.ts";
import { ACTIONS_BOT, certificationText, latestShipIt, parseCertification, shipItAction, shipItCandidate, verifyShipIt, withdrawalText, type ShipItEvent, type ShipItPr, type StatusRecord } from "./shipit.ts";

const policy = validatePolicy(JSON.parse(readFileSync(new URL("../../.github/merge-policy.json", import.meta.url), "utf8")));
const names = { label: policy.labels.shipIt, context: policy.statusContexts.shipIt };
const HEAD = "a".repeat(40);
const AT = new Date("2026-11-08T18:50:07.123Z");

const pr = (over: Partial<ShipItPr> = {}): ShipItPr => ({ author: "lead", sameRepo: true, headSha: HEAD, labels: ["ship-it"], ...over });
const ev = (over: Partial<ShipItEvent> = {}): ShipItEvent => ({ action: "labeled", label: "ship-it", sender: { login: "lead", type: "User" }, ...over });
const status = (over: Partial<StatusRecord> = {}): StatusRecord => ({ id: 10, context: "ship-it", state: "success", description: certificationText("lead", AT), creator: ACTIONS_BOT, ...over });

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
  it("removes the stale label after a push to a pull request from this repository, and only then", () => {
    assert.deepEqual(shipItAction(ev({ action: "synchronize", label: undefined }), pr(), names), { kind: "remove-label" });
    assert.equal(shipItAction(ev({ action: "synchronize", label: undefined }), pr({ labels: ["documentation"] }), names).kind, "none");
    assert.equal(shipItAction(ev({ action: "synchronize", label: undefined }), pr({ sameRepo: false }), names).kind, "none", "a fork's token is read-only, and its label never counted");
  });
  it("withdraws the certification of the event's commit when anyone removes the label", () => {
    assert.deepEqual(shipItAction(ev({ action: "unlabeled" }), pr({ labels: [] }), names), { kind: "withdraw", sha: HEAD });
    assert.deepEqual(shipItAction(ev({ action: "unlabeled", sender: { login: "maint", type: "User" } }), pr({ labels: [] }), names), { kind: "withdraw", sha: HEAD });
    assert.equal(shipItAction(ev({ action: "unlabeled" }), pr({ labels: [], sameRepo: false }), names).kind, "none");
  });
});

describe("the certification text", () => {
  it("names the author and the time to the second, and fits a status description", () => {
    const text = certificationText("lead", AT);
    assert.equal(text, "DCO and approval by @lead at 2026-11-08T18:50:07Z");
    assert.deepEqual(parseCertification(text), { by: "lead", at: "2026-11-08T18:50:07Z" });
    assert.ok(certificationText("a".repeat(39), AT).length <= 140);
    assert.equal(withdrawalText("maint", AT), "withdrawn by @maint at 2026-11-08T18:50:07Z");
  });
  it("parses nothing else", () => {
    for (const d of ["", "DCO and approval by @lead", "dco and approval by @lead at 2026-11-08T18:50:07Z", "DCO and approval by @lead at 2026-11-08T18:50:07Z extra", "DCO and approval by @le ad at 2026-11-08T18:50:07Z", withdrawalText("lead", AT)]) {
      assert.equal(parseCertification(d), undefined, d);
    }
  });
});

describe("reading a ship-it back", () => {
  it("picks the newest status that the GitHub Actions bot wrote, and ignores every other creator", () => {
    const list = [status({ id: 1 }), status({ id: 3, state: "failure", description: withdrawalText("lead", AT) }), status({ id: 2 }), status({ id: 9, creator: "lead" }), status({ id: 8, context: "ci" })];
    assert.equal(latestShipIt(list, "ship-it")?.id, 3);
    assert.equal(latestShipIt([status({ creator: "someone" })], "ship-it"), undefined);
    assert.equal(latestShipIt([], "ship-it"), undefined);
  });
  it("counts a certification by the author, a maintainer, on the head commit, while the label is set", () => {
    assert.deepEqual(verifyShipIt(pr(), { names, authorIsMaintainer: true, status: status() }), { ok: true, by: "lead", at: "2026-11-08T18:50:07Z", sha: HEAD });
  });
  const refused: Array<[string, ShipItPr, boolean, StatusRecord | undefined, RegExp]> = [
    ["a fork", pr({ sameRepo: false }), true, status(), /fork/],
    ["a removed label", pr({ labels: [] }), true, status(), /no ship-it label/],
    ["a non-maintainer author", pr(), false, status(), /not a maintainer/],
    ["a new push (no status on the new head commit)", pr({ headSha: "b".repeat(40) }), true, undefined, /no ship-it certification/],
    ["a withdrawn certification", pr(), true, status({ state: "failure", description: withdrawalText("lead", AT) }), /withdrawn/],
    ["a status by another creator", pr(), true, status({ creator: "lead" }), /GitHub Actions bot/],
    ["a status for someone else", pr(), true, status({ description: certificationText("maint", AT) }), /someone other than the author/],
    ["an unexpected description", pr(), true, status({ description: "looks good" }), /unexpected description/],
  ];
  for (const [what, p, maint, s, why] of refused) {
    it(`refuses ${what}`, () => {
      const v = verifyShipIt(p, { names, authorIsMaintainer: maint, status: s });
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
