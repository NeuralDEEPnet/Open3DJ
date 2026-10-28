import { Worker } from "node:worker_threads";
import { depsPath } from "./lib/util.mjs";
const deps = depsPath();
for (const stackSizeMb of [4, 8]) {
  const w = new Worker(new URL("./exp-stack.mjs", import.meta.url), { workerData: { deps, variant: process.argv[3] || "quickjs", stackSizeMb }, resourceLimits: { stackSizeMb } });
  await new Promise((res) => { w.on("message", (m) => { console.log(m); }); w.on("error", (e) => { console.log("worker error", e.message); res(); }); w.on("exit", res); });
}
