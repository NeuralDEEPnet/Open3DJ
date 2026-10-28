import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@open3dj/schemas";
import { doctor } from "./index.ts";

test("doctor --bench measures kernel init, the bench part and scaling over 1..N workers", async () => {
  const lines: string[] = [];
  const d = await doctor({ bench: true, maxWorkers: 2, jobsPerWorker: 2, pool: { log: (l) => lines.push(l) } });
  assert.ok(validate("device-inventory", d.inventory).valid);
  const b = d.bench!;
  assert.ok(b.kernel_init_ms > 0, JSON.stringify(b));
  assert.ok(b.part_first_ms > 0 && b.part_ms > 0);
  // A 40 x 30 x 20 box less a 5 mm hole (1570.8 mm3) less a little for the 2 mm top fillets.
  assert.ok(b.part_volume_mm3 < 24000 - 1570.79 && b.part_volume_mm3 > 24000 - 1570.8 - 200, String(b.part_volume_mm3));
  assert.ok(b.peak_worker_memory_bytes > 0);
  assert.deepEqual(b.scaling.map((s) => [s.workers, s.jobs]), [[1, 2], [2, 4]]);
  assert.equal(b.scaling[0]!.speedup, 1);
  for (const s of b.scaling) assert.ok(s.jobs_per_s > 0 && s.wall_ms > 0);
});
