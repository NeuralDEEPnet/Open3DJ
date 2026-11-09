// Prints the bounty feed (docs/BOUNTIES.md) as JSON: every capability task of o3dj-bench as
// a bounty record an agent platform can import, and where the `agent-ready` issues are.
//   node scripts/bounties.ts                     the feed, with the commit of HEAD
//   node scripts/bounties.ts --commit <sha>      the feed, naming that commit
// The output is deterministic for a commit: no time stamps. Only the brief of each task goes
// into the solver half of a record; the verifier half names the task files.
import { spawnSync } from "node:child_process";
import { loadTasks } from "../bench/lib.ts";
import { bountyFeed } from "./bounties-lib.ts";
import { ROOT } from "./lib.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--commit");
let commit: string | null = at >= 0 ? (args[at + 1] ?? null) : null;
if (at >= 0 && !commit) {
  process.stderr.write("bounties: --commit needs a value\n");
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
process.stdout.write(`${JSON.stringify(bountyFeed(tasks, commit), null, 2)}\n`);
