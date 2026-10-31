// Small helpers shared by the repo scripts. No dependencies, no shell: every command is
// spawned with process.execPath so it works the same on Linux, macOS and Windows.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Recursively list files under dir whose name passes the filter, skipping node_modules. */
export function findFiles(dir: string, filter: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Repo-relative path with forward slashes, for stable output on every OS. */
export function rel(p: string): string {
  return relative(ROOT, p).split(sep).join("/");
}

export function ms(start: bigint): number {
  return Number((process.hrtime.bigint() - start) / 1_000_000n);
}
