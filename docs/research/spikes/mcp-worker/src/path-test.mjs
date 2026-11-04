// Export path policy: only relative .step/.stp paths that resolve inside --export-dir are written.
// Usage: node path-test.mjs <deps> <outdir>
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";

const [DEPS, OUT] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(join(DEPS, "node_modules", p)).href);
const { Client } = await imp("@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await imp("@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const root = join(OUT, "path-test"); rmSync(root, { recursive: true, force: true });
const exportDir = join(root, "exports"), outside = join(root, "outside");
mkdirSync(exportDir, { recursive: true }); mkdirSync(outside, { recursive: true });
symlinkSync(outside, join(exportDir, "link-out"));                    // directory symlink pointing outside
symlinkSync(join(outside, "victim.step"), join(exportDir, "file-link.step")); // dangling file symlink to outside
const t = new StdioClientTransport({ command: process.execPath, args: [new URL("./server.mjs", import.meta.url).pathname, "--deps", DEPS, "--export-dir", exportDir], stderr: "ignore" });
const c = new Client({ name: "path-test", version: "0" }); await c.connect(t);
const script = { js: "return box(10,10,10)" };
const cases = ["ok/part.step", "ok/part.step", "../escape.step", "/tmp/abs.step", "a/../../escape2.step", "notes.txt", "link-out/through-symlink.step", "link-out/new/deeper.step", "file-link.step", "PART.STP", { path: "file-link.step", overwrite: true }, { path: "ok/part.step", overwrite: true }];
const rows = [];
for (const cs of cases) {
  const p = typeof cs === "string" ? cs : cs.path;
  const r = await c.callTool({ name: "export", arguments: { script, path: p, overwrite: cs.overwrite } });
  rows.push({ path: p + (cs.overwrite ? " (overwrite)" : ""), accepted: !r.isError, message: r.isError ? r.content[0].text : r.structuredContent.path.replace(root, "<root>") });
}
rows.push({ check: "nothing written outside", outsideFiles: ["through-symlink.step", "new/deeper.step", "victim.step", "../escape.step"].filter((f) => existsSync(join(outside, f))) , escapeExists: existsSync(join(root, "escape.step")) || existsSync(join(root, "escape2.step")) });
await c.close();
writeFileSync(join(OUT, "path-results.json"), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(JSON.stringify(r));
