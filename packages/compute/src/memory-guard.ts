// A hard cap on WebAssembly memory inside a worker thread. Kernel memory grows through
// WebAssembly.Memory.prototype.grow (Emscripten's resize calls it from JS), and it never
// shrinks, so a single job can take gigabytes before the wall-clock watchdog fires. The guard
// refuses growth past the limit, tells the pool at once (the pool terminates the worker and
// fails the job with JOB_MEMORY), and throws as a full memory would.

/**
 * Patch WebAssembly.Memory.prototype.grow in this thread so that no memory grows past
 * limitBytes. onLimit gets the size the refused growth asked for. Returns a function that
 * removes the patch.
 */
export function installMemoryGuard(limitBytes: number, onLimit: (requestedBytes: number) => void): () => void {
  const proto = WebAssembly.Memory.prototype;
  const original = proto.grow;
  proto.grow = function grow(this: WebAssembly.Memory, delta: number): number {
    const requested = this.buffer.byteLength + delta * 65536;
    if (requested > limitBytes) {
      onLimit(requested);
      throw new RangeError(`WebAssembly.Memory.grow(): ${requested} bytes is over the worker memory limit of ${limitBytes} bytes`);
    }
    return original.call(this, delta);
  };
  return () => {
    proto.grow = original;
  };
}
