// DeviceInventory for S1: what node:os can tell us, plus engine versions. GPU discovery
// (systeminformation, the WebGPU probe, the sidecar) arrives in a later step, so gpus is
// always empty and backends is only cpu.wasm (COMPUTE.md section 3.1).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeviceInventory } from "@open3dj/schemas";
import type { InventoryOptions, PoolOptions } from "./types.ts";

export const DEFAULT_POOL_OPTIONS = Object.freeze({
  recycleBytes: 1.5 * 1024 ** 3,
  /** Hard cap on a worker's WebAssembly memory during a job: recycleBytes plus 512 MiB of headroom. */
  memoryLimitBytes: 2 * 1024 ** 3,
  /** V8 old-generation limit of a worker's JS heap. */
  maxOldGenerationSizeMb: 1024,
  maxJobsPerWorker: 200,
  jobTimeoutMs: 30_000,
});

/** Why gpus is empty. doctor() repeats it, because the inventory schema has no notes field. */
export const GPU_NOTE = "GPU discovery arrives in a later step (S7a); S1 runs every job on cpu.wasm.";

export interface MachineFacts {
  cores: number;
  freeBytes: number;
}

function machine(): MachineFacts {
  return { cores: os.availableParallelism(), freeBytes: os.freemem() };
}

/**
 * Worker count: min(cores - 1, floor(freeRAM x 0.7 / recycleBytes)), at least 1, so workers
 * that each grow to the recycle limit cannot over-commit RAM (COMPUTE.md section 4).
 */
export function poolSize(options: PoolOptions = {}, facts: MachineFacts = machine()): number {
  if (options.size !== undefined) {
    if (!Number.isInteger(options.size) || options.size < 1) throw new RangeError(`pool size must be an integer >= 1, got ${options.size}`);
    return options.size;
  }
  const recycle = options.recycleBytes ?? DEFAULT_POOL_OPTIONS.recycleBytes;
  const byRam = Math.floor((facts.freeBytes * 0.7) / recycle);
  return Math.max(1, Math.min(facts.cores - 1, byRam));
}

/** Workers reserved for the interactive lane: one, unless the pool has a single worker. */
export function interactiveReserved(size: number): number {
  return size > 1 ? 1 : 0;
}

// Read a dependency's version without relying on npm hoisting: walk up from the package that
// declares it and look for node_modules/<name>/package.json.
function versionFrom(fromPackage: string, name: string): string | undefined {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(fromPackage)));
    for (;;) {
      const candidate = join(dir, "node_modules", name, "package.json");
      if (existsSync(candidate)) return (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version;
      const up = dirname(dir);
      if (up === dir) return undefined;
      dir = up;
    }
  } catch {
    return undefined;
  }
}

let cachedRuntime: DeviceInventory["runtime"] | undefined;

/** Node and engine versions. Cached: they cannot change while the process runs. */
export function runtimeVersions(): DeviceInventory["runtime"] {
  if (cachedRuntime) return cachedRuntime;
  const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const runtime: DeviceInventory["runtime"] = { node: process.versions.node, open3dj: own.version };
  const occt = versionFrom("@open3dj/kernel", "occt-wasm");
  const brepjs = versionFrom("@open3dj/dsl", "brepjs");
  const quickjs = versionFrom("@open3dj/sandbox", "quickjs-emscripten-core");
  if (occt) runtime.occt_wasm = occt;
  if (brepjs) runtime.brepjs = brepjs;
  if (quickjs) runtime.quickjs = quickjs;
  cachedRuntime = runtime;
  return runtime;
}

/** What this machine can run (open3dj doctor, inspect fields=[devices]). Valid against device-inventory. */
export function deviceInventory(options: InventoryOptions = {}): DeviceInventory {
  const cpus = os.cpus();
  const model = cpus[0]?.model.trim();
  const workers = poolSize(options.pool ?? {});
  const inventory: DeviceInventory = {
    created: new Date().toISOString(),
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    runtime: { ...runtimeVersions() },
    cpu: { cores: os.availableParallelism(), arch: os.arch(), ...(model ? { model } : {}) },
    memory: { total_bytes: os.totalmem(), free_bytes: os.freemem() },
    gpus: [],
    backends: ["cpu.wasm"],
    pool: {
      workers,
      interactive_reserved: interactiveReserved(workers),
      recycle_limit_bytes: Math.round(options.pool?.recycleBytes ?? DEFAULT_POOL_OPTIONS.recycleBytes),
    },
  };
  return inventory;
}

/**
 * Hash for provenance lines and the Evidence Pack. It leaves out what changes between two
 * calls on the same machine (the timestamp and free RAM), so one machine keeps one hash.
 */
export function inventoryHash(inventory: DeviceInventory): string {
  const { created: _created, memory, ...stable } = inventory;
  return "sha256:" + createHash("sha256").update(canonical({ ...stable, memory: { total_bytes: memory.total_bytes } })).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
