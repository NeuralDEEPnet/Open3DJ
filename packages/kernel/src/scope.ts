import type { KernelAdapter } from "./adapter.ts";

/**
 * Run fn and release every handle it created, even when it throws. Use it around each job
 * so memory stays flat across thousands of runs (the endurance spike measured 20,000
 * rebuilds with no heap growth this way). fn must return plain data, not handles.
 */
export async function withScope<T>(kernel: KernelAdapter, fn: () => T | Promise<T>): Promise<T> {
  const mark = kernel.checkpoint();
  try {
    return await fn();
  } finally {
    kernel.releaseSince(mark);
  }
}
