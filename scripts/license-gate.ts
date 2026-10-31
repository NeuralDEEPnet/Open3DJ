// Licence gate (layer 1 of ARCHITECTURE.md section 11: package metadata). Walks every
// installed package and fails on any licence outside the allowlist, on a missing licence,
// and on a dependency in our own package.json files that is not pinned to an exact version.
//
// One exception is recorded, not silent: occt-wasm's tooling is MIT OR Apache-2.0, but its
// occt-wasm.wasm binary is LGPL-2.1-only. We may ship it only unmodified, as a separate file
// a user can replace, so the gate checks that the file exists on its own in dist/.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ROOT, rel } from "./lib.ts";
import { spdxAllowed } from "./license-gate-lib.ts";

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "BlueOak-1.0.0"]);
const LGPL_WASM_EXCEPTIONS: Record<string, string> = {
  "occt-wasm": "dist/occt-wasm.wasm",
};

interface Pkg {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
}

const read = (p: string): Pkg => JSON.parse(readFileSync(p, "utf8")) as Pkg;

/** Every package directory under a node_modules folder, including scoped and nested ones. */
function packageDirs(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];
  const out: string[] = [];
  for (const e of readdirSync(nodeModules, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(nodeModules, e.name);
    if (e.name.startsWith("@")) {
      for (const s of readdirSync(p, { withFileTypes: true })) out.push(...withNested(join(p, s.name)));
    } else out.push(...withNested(p));
  }
  return out;
}
function withNested(dir: string): string[] {
  if (!existsSync(join(dir, "package.json"))) return [];
  return [dir, ...packageDirs(join(dir, "node_modules"))];
}

function licenseOf(p: Pkg): string | undefined {
  if (typeof p.license === "string") return p.license;
  if (p.license && typeof p.license.type === "string") return p.license.type;
  const types = (p.licenses ?? []).map((l) => l.type).filter((t): t is string => typeof t === "string");
  return types.length ? `(${types.join(" OR ")})` : undefined;
}

const problems: string[] = [];
const notes: string[] = [];

// 1. Exact pins in our own package.json files.
const ownManifests = [join(ROOT, "package.json"), ...readdirSync(join(ROOT, "packages")).map((d) => join(ROOT, "packages", d, "package.json")).filter(existsSync)];
for (const m of ownManifests) {
  const p = read(m);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    for (const [name, range] of Object.entries(p[field] ?? {})) {
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(range)) problems.push(`${rel(m)}: ${name}@${range} is not pinned to an exact version`);
    }
  }
  if (p.private !== true) problems.push(`${rel(m)}: must be "private": true until the name is cleared (founder decision 1)`);
  if (licenseOf(p) !== "MIT") problems.push(`${rel(m)}: our packages are MIT, found ${String(licenseOf(p))}`);
}

// 2. Licences of everything installed.
const dirs = packageDirs(join(ROOT, "node_modules"));
let checked = 0;
for (const dir of dirs) {
  // Workspace links (symlinks, or junctions on Windows) point back into packages/; checked above.
  if (rel(realpathSync(dir)).startsWith("packages/")) continue;
  const p = read(join(dir, "package.json"));
  if (!p.name || !p.version) continue; // nested package.json files that only set "type"
  checked++;
  const id = `${p.name}@${p.version}`;
  const lic = licenseOf(p);
  if (!lic) {
    problems.push(`${id}: no licence in package.json (${rel(dir)})`);
    continue;
  }
  let ok: boolean;
  try {
    ok = spdxAllowed(lic, ALLOWED);
  } catch (e) {
    problems.push(`${id}: ${(e as Error).message}`);
    continue;
  }
  if (!ok) problems.push(`${id}: licence "${lic}" is not on the allowlist (${rel(dir)})`);
  const wasm = LGPL_WASM_EXCEPTIONS[p.name];
  if (wasm) {
    if (!existsSync(join(dir, wasm))) problems.push(`${id}: expected the LGPL-2.1 binary as a separate file at ${wasm}`);
    else notes.push(`${id}: ${wasm} is LGPL-2.1-only, shipped unmodified as a separate, replaceable file (recorded exception)`);
  }
}

for (const n of notes) process.stderr.write(`NOTE ${n}\n`);
if (problems.length > 0) {
  process.stderr.write(`FAIL licence gate (${problems.length}):\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
process.stderr.write(`PASS licence gate: ${checked} installed packages, ${ownManifests.length} own manifests pinned and MIT\n`);
