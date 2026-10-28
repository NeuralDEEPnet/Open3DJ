// One of several processes that run the same project at once, for the cross-process lock
// test in store.test.ts. Prints {who, revs} as JSON on stdout.
// Usage: node race-child.testing.ts <root> <who> <runs>
import { createHandlers } from "./handlers.ts";
import { FAKE_INVENTORY, fakePlace, fakePool } from "./testing.ts";

const [root, who, n] = [process.argv[2]!, process.argv[3]!, Number(process.argv[4] ?? 50)];
const h = createHandlers({ pool: fakePool(), inventory: FAKE_INVENTORY, place: fakePlace, root, version: "0.0.0" });
const revs: string[] = [];
const errors: string[] = [];
for (let i = 0; i < n; i++) {
  const r = await h.run({ project: "c.o3j", script: `return box(1, 1, 1); // ${who} ${i}` });
  if (r.status !== "error" && r.rev) revs.push(r.rev);
  else errors.push(`${r.error?.code}: ${r.error?.message}`);
}
process.stdout.write(`${JSON.stringify({ who, revs, errors })}\n`);
