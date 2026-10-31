// npm run check: the one command that must pass before every merge. It runs the typecheck,
// every test (task-lint of every bench task runs there, in scripts/bench.test.ts), the bench
// regression split with 3 identical replays, the stdout-leak gate and the licence gate, then
// prints a summary. The budget for a fresh clone to a green check is 10 minutes (PLAN.md S0
// Kaizen metric).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, ms } from "./lib.ts";

const BUDGET_MS = 10 * 60 * 1000;
const steps: Array<{ name: string; args: string[] }> = [
  { name: "typecheck", args: [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", join(ROOT, "tsconfig.json")] },
  { name: "test", args: [join(ROOT, "scripts", "test.ts")] },
  { name: "bench", args: [join(ROOT, "bench", "run-regression.ts"), "--repeat", "3"] },
  { name: "leak", args: [join(ROOT, "scripts", "leak-gate.ts")] },
  { name: "licenses", args: [join(ROOT, "scripts", "license-gate.ts")] },
];

const start = process.hrtime.bigint();
const results: Array<{ name: string; ok: boolean; ms: number }> = [];
for (const step of steps) {
  process.stderr.write(`\n== ${step.name}\n`);
  const t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, step.args, { cwd: ROOT, stdio: "inherit", timeout: BUDGET_MS });
  results.push({ name: step.name, ok: r.status === 0, ms: ms(t) });
}
const total = ms(start);
process.stderr.write("\n== summary\n");
for (const r of results) process.stderr.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(10)} ${(r.ms / 1000).toFixed(1)} s\n`);
process.stderr.write(`total ${(total / 1000).toFixed(1)} s (budget ${BUDGET_MS / 60000} min)\n`);
const failed = results.filter((r) => !r.ok);
if (total > BUDGET_MS) process.stderr.write("check is over its 10 minute budget: stop the line and make it faster\n");
process.exit(failed.length > 0 || total > BUDGET_MS ? 1 : 0);
