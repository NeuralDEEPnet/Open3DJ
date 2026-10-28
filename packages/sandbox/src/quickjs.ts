// Loading QuickJS. The wasm is compiled once per thread; every run instantiates it again
// with its own WebAssembly.Memory capped at the run's memory limit. That cap is the only
// hard memory bound: setMemoryLimit() alone bounds single allocations only
// (quickjs-emscripten 0.32.0, upstream issue 271).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import type { QuickJSSyncVariant, QuickJSWASMModule } from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";

// The variant package types its default export loosely; it is the sync release variant.
const variant = releaseSync as unknown as QuickJSSyncVariant;

const PAGE = 64 * 1024;
/** Pages the instance starts with (16 MiB), as in the sandbox spike. */
const INITIAL_PAGES = 256;

let compiled: Promise<WebAssembly.Module> | undefined;

function compileOnce(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    const path = fileURLToPath(import.meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
    return WebAssembly.compile(await readFile(path));
  })();
  return compiled;
}

export interface FreshQuickJS {
  module: QuickJSWASMModule;
  memory: WebAssembly.Memory;
}

/** A new QuickJS instance whose whole heap cannot grow beyond memoryBytes. */
export async function freshQuickJS(memoryBytes: number): Promise<FreshQuickJS> {
  const wasmModule = await compileOnce();
  const maximum = Math.max(INITIAL_PAGES, Math.floor(memoryBytes / PAGE));
  const memory = new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum });
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule, wasmMemory: memory }));
  return { module, memory };
}

/** The smallest memory limit we accept: the instance starts at 16 MiB. */
export const MIN_MEMORY_BYTES = INITIAL_PAGES * PAGE;
