// The bounty feed (docs/BOUNTIES.md): every capability task of o3dj-bench as a bounty record
// that an agent platform can import, plus a pointer to the `agent-ready` issues. Pure
// functions over the loaded tasks; scripts/bounties.ts prints the feed.
//
// Each record has two halves. `solver` is what a platform may show the agent that solves the
// bounty: the brief, the fixed prompt and the limits of a capability run, and nothing else. A
// capability run counts only if the solver never saw the task files (bench/run-capability.md),
// so this half names no path, no assertion, no reference or mutant script and no canary;
// scripts/bounties.test.ts checks it with the grader's own leak check. `verifier` is for whoever
// grades the answer in an Open3DJ checkout: the task, its version and the grader command.
import type { LoadedTask } from "../bench/lib.ts";

export const FEED_FORMAT = "open3dj-bounties/1";
export const REPOSITORY = "https://github.com/NeuralDEEPnet/Open3DJ";
export const AGENT_READY_ISSUES = `${REPOSITORY}/issues?q=is%3Aopen+label%3Aagent-ready`;

/** The fixed prompt of a capability run (bench/run-capability.md, step 3). `<brief>` stands for the brief. */
export const SOLVER_PROMPT = [
  "You are designing a part for a client with the Open3DJ MCP tools (run, inspect, render, export, docs).",
  "Work in the project solution.o3j in this folder. Use docs to look up the DSL. Check your design with",
  "run and inspect (fits and measures) and look at it with render before you finish. When you are done,",
  "the project's current script is your answer. Units are mm and Z is up.",
  "",
  "The client's brief:",
  "<brief>",
].join("\n");

/** The limits of a capability run (bench/run-capability.md, step 4). */
export const SOLVER_LIMITS = { minutes: 60, tool_calls: 100 } as const;

export interface CapabilityBounty {
  /** `open3dj:bench:<task>@<version>`; a new version of the task is a new bounty. */
  id: string;
  kind: "capability-task";
  title: string;
  tags: string[];
  licence: "MIT";
  /** What the solving agent may see. Nothing in here points at the task files. */
  solver: {
    brief: string;
    /** SOLVER_PROMPT with the brief filled in. */
    prompt: string;
    tools: string;
    limits: { minutes: number; tool_calls: number };
    answer: string;
  };
  /** What the grader needs, in an Open3DJ checkout at `commit`. */
  verifier: {
    kind: "o3dj-bench";
    task: string;
    version: number;
    repository: string;
    commit: string | null;
    path: string;
    command: string;
    passes_when: string;
    proof: string[];
  };
  /** Open3DJ attaches no money to a task. The platform that lists the bounty sets the reward. */
  reward: null;
}

export interface BountyFeed {
  format: typeof FEED_FORMAT;
  source: "open3dj";
  repository: string;
  commit: string | null;
  docs: string;
  capability: CapabilityBounty[];
  issues: {
    kind: "github-issue";
    label: "agent-ready";
    url: string;
    who: string;
    proof: string;
  };
}

export function capabilityBounty(t: LoadedTask, commit: string | null): CapabilityBounty {
  const { id, version, title, tags, licence, brief } = t.task;
  return {
    id: `open3dj:bench:${id}@${version}`,
    kind: "capability-task",
    title,
    tags: [...tags],
    licence,
    solver: {
      brief,
      prompt: SOLVER_PROMPT.replace("<brief>", brief),
      tools: "The Open3DJ MCP tools only (run, inspect, render, export, docs), rooted in an empty folder. No file, search or shell tools.",
      limits: { ...SOLVER_LIMITS },
      answer: "The current script of the project solution.o3j when the agent says it is done, plus the full transcript of the session.",
    },
    verifier: {
      kind: "o3dj-bench",
      task: id,
      version,
      repository: REPOSITORY,
      commit,
      path: `bench/tasks/${id}/task.json`,
      command: `node bench/grade.ts ${id} <solution.o3j.js>`,
      passes_when: "The grader exits 0: every assertion of the task passes. It prints each assertion with its result.",
      proof: ["the grader's output", "the commit of the Open3DJ checkout that graded it", "the full transcript of the solve, checked with the grader's suspect rules"],
    },
    reward: null,
  };
}

export function bountyFeed(tasks: LoadedTask[], commit: string | null): BountyFeed {
  const capability = tasks
    .filter((t) => t.task.split === "capability")
    .sort((a, b) => a.task.id.localeCompare(b.task.id))
    .map((t) => capabilityBounty(t, commit));
  return {
    format: FEED_FORMAT,
    source: "open3dj",
    repository: REPOSITORY,
    commit,
    docs: `${REPOSITORY}/blob/main/docs/BOUNTIES.md`,
    capability,
    issues: {
      kind: "github-issue",
      label: "agent-ready",
      url: AGENT_READY_ISSUES,
      who: "An operator and their agent. The agent does the work; the operator reads the diff, opens the pull request and signs it off.",
      proof: "The merged pull request's URL. It links the issue (Closes #<number>) and its merge-policy status is green.",
    },
  };
}
