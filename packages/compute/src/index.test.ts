import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "@open3dj/schemas";
import {
  ComputeError, DEFAULT_POOL_OPTIONS, GPU_NOTE, PACKAGE_STATUS, WORKER_ENTRY, createPool, deviceInventory, doctor,
  inventoryHash, place, poolSize,
} from "./index.ts";

test("exports the compute entry points and a worker entry that exists", () => {
  for (const f of [createPool, deviceInventory, place, doctor]) assert.equal(typeof f, "function");
  assert.ok(existsSync(fileURLToPath(WORKER_ENTRY)));
  assert.equal(DEFAULT_POOL_OPTIONS.recycleBytes, 1.5 * 1024 ** 3);
  assert.equal(PACKAGE_STATUS, "ready");
});

test("device inventory validates against the schema and names the engines", () => {
  const inv = deviceInventory();
  const r = validate("device-inventory", inv);
  assert.ok(r.valid, JSON.stringify(r.errors));
  assert.deepEqual(inv.gpus, []);
  assert.deepEqual(inv.backends, ["cpu.wasm"]);
  assert.ok(inv.cpu.cores >= 1 && inv.memory.total_bytes > 0);
  assert.equal(inv.runtime.node, process.versions.node);
  assert.equal(inv.runtime.occt_wasm, "5.8.1");
  assert.equal(inv.runtime.brepjs, "20.11.1");
  assert.equal(inv.runtime.quickjs, "0.32.0");
  assert.equal(inv.pool?.recycle_limit_bytes, DEFAULT_POOL_OPTIONS.recycleBytes);
});

test("pool size follows min(cores - 1, floor(freeRAM x 0.7 / recycle)), at least 1", () => {
  const GiB = 1024 ** 3;
  assert.equal(poolSize({}, { cores: 8, freeBytes: 32 * GiB }), 7);
  assert.equal(poolSize({}, { cores: 8, freeBytes: 4 * GiB }), 1); // 4 x 0.7 / 1.5 = 1.87
  assert.equal(poolSize({}, { cores: 16, freeBytes: 8 * GiB }), 3); // 5.6 / 1.5 = 3.7
  assert.equal(poolSize({}, { cores: 1, freeBytes: 64 * GiB }), 1);
  assert.equal(poolSize({}, { cores: 4, freeBytes: 0.5 * GiB }), 1);
  assert.equal(poolSize({ recycleBytes: GiB }, { cores: 16, freeBytes: 8 * GiB }), 5);
  assert.equal(poolSize({ size: 3 }, { cores: 1, freeBytes: 0 }), 3);
  assert.throws(() => poolSize({ size: 0 }), RangeError);
  const inv = deviceInventory({ pool: { size: 3 } });
  assert.deepEqual(inv.pool, { workers: 3, interactive_reserved: 1, recycle_limit_bytes: DEFAULT_POOL_OPTIONS.recycleBytes });
  assert.equal(deviceInventory({ pool: { size: 1 } }).pool?.interactive_reserved, 0);
});

test("auto and cpu place on cpu.wasm with a schema-valid compute block", () => {
  const inv = deviceInventory({ pool: { size: 3 } });
  for (const mode of ["auto", "cpu"] as const) {
    for (const kind of ["run", "render", "export"] as const) {
      const block = place(mode, kind, inv);
      const r = validate("compute", block);
      assert.ok(r.valid, JSON.stringify(r.errors));
      assert.equal(block.backend, "cpu.wasm");
      assert.equal(block.device, "cpu x3");
      assert.ok(block.placement_reason.startsWith(`${mode}:`));
    }
  }
});

test("gpu and cloud placement without a backend is a structured error", () => {
  const inv = deviceInventory();
  for (const mode of ["gpu", "cloud"] as const) {
    assert.throws(() => place(mode, "run", inv), (e: unknown) => {
      assert.ok(e instanceof ComputeError);
      assert.equal(e.code, "NO_BACKEND");
      assert.match(e.message, new RegExp(`compute "${mode}"`));
      assert.match(e.hint ?? "", /auto/);
      return true;
    });
  }
  assert.throws(() => place("auto", "mesh" as never, inv), RangeError);
});

test("the inventory hash ignores the timestamp and free RAM", () => {
  const a = deviceInventory();
  const b = { ...a, created: "2000-01-01T00:00:00.000Z", memory: { ...a.memory, free_bytes: 1 } };
  assert.match(inventoryHash(a), /^sha256:[0-9a-f]{64}$/);
  assert.equal(inventoryHash(a), inventoryHash(b));
  assert.notEqual(inventoryHash(a), inventoryHash({ ...a, cpu: { ...a.cpu, cores: a.cpu.cores + 1 } }));
});

test("doctor without bench gives the inventory, its hash and the GPU note", async () => {
  const d = await doctor({ pool: { size: 2 } });
  assert.ok(validate("device-inventory", d.inventory).valid);
  assert.equal(d.inventory_hash, inventoryHash(d.inventory));
  assert.deepEqual(d.notes, [GPU_NOTE]);
  assert.equal(d.bench, undefined);
});
