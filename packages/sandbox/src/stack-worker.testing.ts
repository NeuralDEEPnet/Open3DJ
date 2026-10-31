// Worker entry for the stack test: runs deep-recursion scripts in a thread configured like the
// compute pool's workers (8 MB stack) and posts the error codes and messages back.
import { parentPort } from "node:worker_threads";
import { runScript } from "./index.ts";
import { fakeHost } from "./testing.ts";

const scripts = ["function f(n) { return f(n + 1) + 1; } f(0);", "JSON.parse('['.repeat(1e6));"];
const out: { code: string; message: string }[] = [];
for (const code of scripts) {
  const r = await runScript(code, { hostApi: fakeHost().hostApi, limits: { cpuMs: 2000 } });
  out.push(r.ok ? { code: "ok", message: "" } : { code: r.error.code, message: r.error.message });
}
parentPort!.postMessage(out);
