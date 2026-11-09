// Prints the bounty feed (docs/BOUNTIES.md) as JSON: every capability task of o3dj-bench as
// a bounty record an agent platform can import, and where the `agent-ready` issues are.
//   node scripts/bounties.ts                     the feed, with the commit of HEAD
//   node scripts/bounties.ts --commit <sha>      the feed, naming that commit
//   node scripts/bounties.ts --shelter           one AI Agent Shelter propose_bounty payload per
//                                                capability task, as a JSON array
//   node scripts/bounties.ts --shelter --reward 500   with that suggested reward in cents
// The output is deterministic for a commit: no time stamps. Only the brief of each task goes
// into the solver half of a record; the verifier half names the task files.
import { spawnSync } from "node:child_process";
import { loadTasks } from "../bench/lib.ts";
import { SHELTER_LIMITS, bountyFeed, shelterProposal } from "./bounties-lib.ts";
import { ROOT } from "./lib.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--commit");
let commit: string | null = at >= 0 ? (args[at + 1] ?? null) : null;
if (at >= 0 && !commit) {
  process.stderr.write("bounties: --commit needs a value\n");
  process.exit(3);
}
const shelter = args.includes("--shelter");
const rewardAt = args.indexOf("--reward");
const reward = rewardAt >= 0 ? Number(args[rewardAt + 1]) : SHELTER_LIMITS.rewardMin;
if (rewardAt >= 0 && (!shelter || !Number.isInteger(reward) || reward < SHELTER_LIMITS.rewardMin || reward > SHELTER_LIMITS.rewardMax)) {
  process.stderr.write(`bounties: --reward needs --shelter and an integer from ${SHELTER_LIMITS.rewardMin} to ${SHELTER_LIMITS.rewardMax} cents\n`);
  process.exit(3);
}
if (commit === null) {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  commit = git.status === 0 ? git.stdout.trim() : null;
}

const tasks = loadTasks();
const broken = tasks.filter((t) => t.problems.length > 0);
if (broken.length > 0) {
  process.stderr.write(`bounties: ${broken.map((t) => `${t.task.id}: ${t.problems.join("; ")}`).join("\n")}\n`);
  process.exit(1);
}
const feed = bountyFeed(tasks, commit);
const out = shelter ? feed.capability.map((b) => shelterProposal(b, reward)) : feed;
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
