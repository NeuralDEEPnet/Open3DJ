/** Thrown by package entry points that are declared but not built yet. */
export class NotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

/**
 * Build status of a package. Gates and tests read it: a "stub" package's behaviour tests are
 * skipped with a clear message, and the gates that need it (for example the stdout-leak gate
 * needs @open3dj/mcp) report SKIP instead of failing. Flip it to "ready" in the same change
 * that implements the package.
 */
export type PackageStatus = "stub" | "ready";
