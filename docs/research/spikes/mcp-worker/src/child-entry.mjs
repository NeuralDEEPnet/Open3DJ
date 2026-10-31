// child_process entry: the kernel lives in its own OS process. Messages travel over the Node
// IPC channel (fd 3, serialization "advanced"), never over the child's stdout, so anything the
// kernel prints cannot be mistaken for a message. Usage: node child-entry.mjs <deps> <printHook 0|1>
import { createKernelCore } from "./kernel-core.mjs";

const [deps, hook] = process.argv.slice(2);
if (!process.send) { process.stderr.write("child-entry must be spawned with an IPC channel\n"); process.exit(2); }
const core = await createKernelCore({ deps, printHook: hook === "1" });
process.on("message", async ({ id, method, params }) => {
  try {
    const result = await core.handle(method, params);
    process.send({ id, ok: true, result });
  } catch (e) {
    process.send({ id, ok: false, error: { message: String(e?.message ?? e), code: e?.code } });
  }
});
process.on("disconnect", () => process.exit(0)); // parent gone -> exit, never orphan a kernel
process.send({ ready: true, initMs: core.initMs });
