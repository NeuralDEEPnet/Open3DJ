// Spawn os-child.mjs under several OS/runtime confinement layers and compare.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { depsPath, median } from "./lib/util.mjs";
const deps = depsPath(); const src = dirname(fileURLToPath(import.meta.url)); const child = `${src}/os-child.mjs`;
const node = process.execPath;
const perm = ["--permission", `--allow-fs-read=${deps}`, `--allow-fs-read=${src}`];
const configs = {
  "plain child process": [node, child, deps],
  "node --permission (fs-read: deps+src only)": [node, ...perm, child, deps],
  "unshare -n (no network) + node --permission": ["unshare", "-n", node, ...perm, child, deps],
  "unshare -rn (unprivileged userns, as on a desktop)": ["unshare", "-r", "-n", node, ...perm, child, deps],
};
const out = {};
for (const [name, argv] of Object.entries(configs)) {
  const walls = []; let last;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 60000, env: { PATH: process.env.PATH } });
    walls.push(performance.now() - t);
    last = { exit: r.status, stderr: r.stderr.trim().split("\n").slice(0, 2).join(" | ").slice(0, 300) };
    try { last.child = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { last.stdout = r.stdout.slice(0, 200); }
  }
  out[name] = { spawn_to_result_ms_median: Math.round(median(walls)), ...last };
}
console.log(JSON.stringify(out, null, 1));
