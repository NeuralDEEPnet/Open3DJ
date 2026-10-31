// Path policy for everything the daemon writes (ported from the mcp-worker spike):
// - a project is a folder whose name ends in .o3j, inside the root the daemon serves;
// - files inside a project are addressed by relative paths only: no absolute paths, no "..",
//   no hidden or odd names, and no symlinked folders or files below the project;
// - files are written to a temporary name opened with O_EXCL and O_NOFOLLOW, then renamed,
//   so a planted symlink is never followed and readers never see half a file;
// - error messages name paths relative to the project, never absolute ones.
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { FileRef } from "@open3dj/schemas";
import { ToolError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._#-]{0,127}$/;
/** Hidden names the store itself uses; every other name must not start with a dot. */
const STORE_NAMES = new Set([".gitignore", ".o3j-cache", ".o3j-lock", ".o3j-view"]);
/** The lock file that serializes commits to one project across processes. */
export const LOCK_FILE = ".o3j-lock";
/** A lock file older than this belongs to a process that died while committing. */
const STALE_LOCK_MS = 30_000;

/** A project folder that passed the policy: its real path and a display name. */
export interface ProjectDir {
  /** Real absolute path of the .o3j folder (may not exist yet). */
  dir: string;
  /** Folder name, for example bracket.o3j. Used in messages instead of the path. */
  label: string;
  /** Project name: the folder name without .o3j. */
  name: string;
}

/**
 * Resolve a project argument against the root. The parent folder must exist; the project
 * folder itself may not exist yet (run creates it).
 */
export function resolveProject(root: string, project: string): ProjectDir {
  if (project.includes("\0")) throw new ToolError("PROJECT_PATH", "the project path contains a NUL byte");
  const abs = isAbsolute(project) ? project : resolve(root, project);
  const label = basename(abs);
  if (!/\.o3j$/.test(label) || label === ".o3j") {
    throw new ToolError("PROJECT_PATH", `a project is a folder whose name ends in .o3j, got "${label}"`, "Use a project path such as bracket.o3j; it is created on the first run.");
  }
  if (!SEGMENT.test(label)) throw new ToolError("PROJECT_PATH", `"${label}" is not a safe folder name`, "Use letters, digits, dot, dash and underscore.");
  let realRoot: string;
  let parent: string;
  try {
    realRoot = realpathSync(root);
    parent = realpathSync(dirname(abs));
  } catch {
    throw new ToolError("PROJECT_PATH", `the folder that should hold ${label} does not exist`, `Use a project directly in the server's folder, for example ${label}, or inside a folder that already exists there.`);
  }
  const dir = join(parent, label);
  if (!inside(realRoot, dir)) {
    throw new ToolError("PATH_REFUSED", `${label} is outside the folder this server may write to`, "Use a project path inside the server's working folder (or start the server with --root).");
  }
  if (existsSync(dir) || isSymlink(dir)) {
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) throw new ToolError("PATH_REFUSED", `${label} is a symlink; projects must be real folders`);
    if (!st.isDirectory()) throw new ToolError("PROJECT_PATH", `${label} exists and is not a folder`);
  }
  return { dir, label, name: label.slice(0, -4) };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Check a project-relative path and return its segments. Refuses absolute paths, "..",
 * empty, hidden and odd segments. Error text quotes only the relative path.
 */
export function safeSegments(relPath: string): string[] {
  if (relPath.includes("\0") || isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath) || relPath.startsWith("\\")) {
    throw new ToolError("PATH_REFUSED", `"${relPath}" must be a path relative to the project folder`, "Use a relative folder such as out/r_0001 or exports.");
  }
  const segs = relPath.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segs.length === 0) throw new ToolError("PATH_REFUSED", "the path is empty", "Use a relative folder such as exports.");
  for (const s of segs) {
    if (s === "..") throw new ToolError("PATH_REFUSED", `"${relPath}" leaves the project folder ("..")`, "Use a folder inside the project.");
    if (!SEGMENT.test(s) && !STORE_NAMES.has(s)) throw new ToolError("PATH_REFUSED", `"${s}" is not a safe file or folder name`, "Use letters, digits, dot, dash, underscore and #, not starting with a dot.");
  }
  return segs;
}

/** Create (or check) a folder inside the project, refusing symlinked folders on the way. */
export function ensureDir(project: ProjectDir, relDir: string): string {
  let p = project.dir;
  ensureProjectRoot(project);
  for (const s of safeSegments(relDir)) {
    p = join(p, s);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) throw new ToolError("PATH_REFUSED", `${relLabel(project, p)} is a symlink; refusing to write through it`);
      if (!st.isDirectory()) throw new ToolError("PATH_REFUSED", `${relLabel(project, p)} exists and is not a folder`);
    } catch (e) {
      if (e instanceof ToolError) throw e;
      mkdirSync(p);
    }
  }
  return p;
}

/** The project folder itself: create it if missing. */
export function ensureProjectRoot(project: ProjectDir): void {
  try {
    const st = lstatSync(project.dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new ToolError("PATH_REFUSED", `${project.label} is not a real folder`);
  } catch (e) {
    if (e instanceof ToolError) throw e;
    mkdirSync(project.dir);
  }
}

/**
 * Write a file inside the project atomically. relPath is relative to the project folder.
 * With exclusive, an existing file is never replaced: the write fails with code EEXIST.
 */
export function writeProjectFile(project: ProjectDir, relPath: string, data: string | Uint8Array, options: { exclusive?: boolean } = {}): string {
  const segs = safeSegments(relPath);
  const name = segs.pop()!;
  const dir = segs.length ? ensureDir(project, segs.join("/")) : (ensureProjectRoot(project), project.dir);
  const target = join(dir, name);
  if (isSymlink(target)) throw new ToolError("PATH_REFUSED", `${relLabel(project, target)} is a symlink; refusing to replace it`);
  const tmp = join(dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o644);
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let off = 0;
    while (off < buf.byteLength) off += writeSync(fd, buf, off, buf.byteLength - off);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  if (options.exclusive) {
    // link() refuses an existing target, unlike rename(), so a lost race cannot overwrite.
    try {
      linkSync(tmp, target);
    } finally {
      rmSync(tmp, { force: true });
    }
    return target;
  }
  try {
    renameWithRetry(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return target;
}

/** Error codes Windows gives while another process holds the target of a rename open. */
const RENAME_BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * renameSync that waits for readers on Windows. Windows refuses to replace a file that another
 * process has open, even for the moment of a read, with EPERM, EACCES or EBUSY. Those codes are
 * tried again with a growing wait, for up to retryMs in all. Other codes, and every code on
 * other systems (where EPERM is a real permission error), throw at once.
 */
export function renameWithRetry(
  from: string,
  to: string,
  options: { platform?: NodeJS.Platform; retryMs?: number; rename?: (from: string, to: string) => void; sleep?: (ms: number) => void } = {},
): void {
  const { platform = process.platform, retryMs = 3_000, rename = renameSync, sleep = sleepSync } = options;
  let waited = 0;
  for (let delay = 1; ; delay = Math.min(delay * 2, 100)) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (platform !== "win32" || code === undefined || !RENAME_BUSY.has(code) || waited >= retryMs) throw e;
    }
    sleep(delay);
    waited += delay;
  }
}

/** Blocks the thread for ms milliseconds; writeProjectFile is synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Take the project's lock file (created with O_EXCL), waiting up to waitMs. Returns the
 * release function. A lock older than 30 s is taken over: its holder died mid-commit.
 */
export async function lockProject(project: ProjectDir, waitMs = 15_000): Promise<() => void> {
  ensureProjectRoot(project);
  const file = join(project.dir, LOCK_FILE);
  const end = Date.now() + waitMs;
  for (let delay = 2; ; delay = Math.min(delay * 2, 50)) {
    try {
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o644);
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Something other than a lock file at the lock path (an export folder, a cloned entry)
    // can never be taken over: say so now instead of waiting and reporting a busy project.
    let st: ReturnType<typeof lstatSync> | undefined;
    try {
      st = lstatSync(file);
    } catch {
      st = undefined; // released in the meantime
    }
    if (st && !st.isFile()) {
      throw new ToolError("PROJECT_CORRUPT", `${project.label}/${LOCK_FILE} is a ${st.isDirectory() ? "folder" : st.isSymbolicLink() ? "symlink" : "special file"}, not a lock file`, `Delete the ${st.isDirectory() ? "folder" : "entry"} ${project.label}/${LOCK_FILE} (it holds no project data), then run again.`);
    }
    try {
      if (Date.now() - statSync(file).mtimeMs > STALE_LOCK_MS) unlinkSync(file);
    } catch {
      // released in the meantime
    }
    if (Date.now() > end) {
      throw new ToolError("PROJECT_BUSY", `${project.label} is being changed by another process`, `Try again. If no other open3dj process is running, delete ${project.label}/${LOCK_FILE}.`);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

/** A key that names one project folder however its path was spelled (case, symlinked parents). */
export function projectKey(project: ProjectDir): string {
  try {
    return realpathSync.native(project.dir);
  } catch {
    return project.dir;
  }
}

/** Append one line to a file inside the project (provenance.jsonl). */
export function appendProjectLine(project: ProjectDir, relPath: string, line: string): void {
  const segs = safeSegments(relPath);
  if (segs.length !== 1) throw new Error("appendProjectLine takes a file in the project root");
  ensureProjectRoot(project);
  const fd = openSync(join(project.dir, segs[0]!), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | NOFOLLOW, 0o644);
  try {
    writeSync(fd, `${line}\n`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read a file inside the project, or undefined when it does not exist. Refuses a symlink
 * anywhere on the way (the project folder, every folder below it, and the file), as writes
 * do: a cloned project can carry a symlinked revisions/ folder that points elsewhere.
 */
export function readProjectFile(project: ProjectDir, relPath: string): string | undefined {
  const bytes = readProjectBytes(project, relPath);
  return bytes === undefined ? undefined : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

/** Like readProjectFile, as bytes: undefined when missing, and never through a symlink. */
export function readProjectBytes(project: ProjectDir, relPath: string): Uint8Array | undefined {
  let p = project.dir;
  for (const s of ["", ...safeSegments(relPath)]) {
    if (s) p = join(p, s);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return undefined;
    }
    if (st.isSymbolicLink()) throw new ToolError("PATH_REFUSED", `${relLabel(project, p)} is a symlink; refusing to read through it`);
  }
  return readFileSync(p);
}

/** Write files into a project folder and describe them as FileRefs relative to the project. */
export function writeOutputs(project: ProjectDir, relDir: string, files: Array<{ name: string; format: string; bytes: Uint8Array }>): FileRef[] {
  const segs = safeSegments(relDir);
  const refs: FileRef[] = [];
  for (const f of files) {
    if (safeSegments(f.name).length !== 1) throw new ToolError("PATH_REFUSED", `"${f.name}" is not a plain file name`);
    const rel = [...segs, f.name].join("/");
    writeProjectFile(project, rel, f.bytes);
    refs.push({ path: rel, format: f.format, bytes: f.bytes.byteLength, sha256: sha256Hex(f.bytes) });
  }
  return refs;
}

function relLabel(project: ProjectDir, p: string): string {
  const rel = relative(project.dir, p).split(sep).join("/");
  return rel ? `${project.label}/${rel}` : project.label;
}
