// Runs every *.test.ts under packages/*/src with node:test. Extra arguments narrow the run
// to paths that contain them, for example: npm test -- kernel
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, findFiles, rel } from "./lib.ts";

const filters = process.argv.slice(2);
const files = [...findFiles(join(ROOT, "packages"), (n) => n.endsWith(".test.ts")), ...findFiles(join(ROOT, "scripts"), (n) => n.endsWith(".test.ts"))]
  .filter((f) => filters.length === 0 || filters.some((x) => rel(f).includes(x)));

if (files.length === 0) {
  process.stderr.write(`no test files match ${filters.join(" ")}\n`);
  process.exit(1);
}
process.stderr.write(`running ${files.length} test files\n`);
const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
