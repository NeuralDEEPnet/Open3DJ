// The export path policy: files land only inside the chosen directory, under plain file
// names, never through a symlink, and (with a project root) never outside the project.
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileRef } from "@open3dj/schemas";
import type { WriteOptions } from "../types.ts";
import { AssemblyError } from "../errors.ts";
import { sha256Hex } from "../names.ts";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function refuse(message: string): never {
  throw new AssemblyError("PATH_REFUSED", message, "Use a relative folder inside the project, for example out/r_1.");
}

/**
 * Resolve dir for writing. With root: dir must be relative, free of "..", and stay inside
 * root after symlinks are resolved. Creates missing folders one level at a time and refuses
 * any folder on the way that is a symlink.
 */
export async function prepareDir(dir: string, options: WriteOptions = {}): Promise<string> {
  if (options.root === undefined) {
    const abs = resolve(dir);
    await mkdir(abs, { recursive: true });
    if ((await lstat(abs)).isSymbolicLink()) refuse(`export folder ${dir} is a symlink`);
    return abs;
  }
  if (dir.includes("\0")) refuse("export folder contains a NUL byte");
  if (isAbsolute(dir) || /^[A-Za-z]:/.test(dir) || dir.startsWith("\\")) refuse(`export folder ${dir} must be relative to the project`);
  const segments = dir.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) refuse(`export folder ${dir} must not contain ".."`);
  const root = await realpath(resolve(options.root));
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink()) refuse(`export folder ${dir} passes through a symlink (${segment})`);
      if (!st.isDirectory()) refuse(`export folder ${dir} passes through a file (${segment})`);
    } catch (e) {
      if (e instanceof AssemblyError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await mkdir(current);
    }
  }
  const real = await realpath(current);
  if (real !== root && !real.startsWith(root + sep)) refuse(`export folder ${dir} resolves outside the project`);
  return real;
}

/** Write artifacts under plain names into dir (see prepareDir) and return their FileRefs. */
export async function writeArtifacts(artifacts: ReadonlyArray<{ name: string; format: string; bytes: Uint8Array }>, dir: string, options: WriteOptions = {}): Promise<FileRef[]> {
  for (const a of artifacts) {
    if (!SAFE_NAME.test(a.name) || a.name.includes("..")) refuse(`file name ${JSON.stringify(a.name)} is not a plain file name`);
  }
  const target = await prepareDir(dir, options);
  const base = options.root === undefined ? undefined : await realpath(resolve(options.root));
  const refs: FileRef[] = [];
  for (const a of artifacts) {
    const path = join(target, a.name);
    try {
      if ((await lstat(path)).isSymbolicLink()) refuse(`${a.name} exists as a symlink`);
    } catch (e) {
      if (e instanceof AssemblyError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // O_NOFOLLOW closes the gap between the check above and the open (not on Windows).
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(path, flags, 0o644);
    try {
      await handle.writeFile(a.bytes);
    } finally {
      await handle.close();
    }
    const shown = base === undefined ? path : relative(base, path).split(sep).join("/");
    refs.push({ path: shown, format: a.format, bytes: a.bytes.byteLength, sha256: sha256Hex(a.bytes) });
  }
  return refs;
}
