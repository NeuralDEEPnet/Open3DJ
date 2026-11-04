import { readFileSync, readdirSync } from "node:fs";
import { median, r3 } from "./lib/util.mjs";
const dir = process.argv[2];
const by = {};
for (const f of readdirSync(dir)) { const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); (by[j.variant] ||= []).push(j); }
const out = {};
for (const [v, js] of Object.entries(by)) {
  const m = (sel) => r3(median(js.map(sel)));
  out[v] = { runs: js.length, module_load_cold_ms: m(j => j.module_load_cold_ms), rt_ctx_create_dispose_ms: m(j => j.runtime_context_create_dispose_ms.median),
    full_setup_ms: m(j => j.full_sandbox_setup_ms.median), full_setup_no_freeze_ms: m(j => j.full_sandbox_setup_without_freeze_ms.median),
    host_noop_us: m(j => j.per_call_us.host_noop), host_3num_us: m(j => j.per_call_us.host_3_numbers), host_str_us: m(j => j.per_call_us.host_64char_string),
    guest_call_us: m(j => j.per_call_us.guest_to_guest), bridge_noop_us: m(j => j.bridge_per_call_us.noop), bridge_add3_us: m(j => j.bridge_per_call_us.add3),
    noop_10k_ms: m(j => j.raw_10k_ms.noop.median), node_direct_10k_ms: m(j => j.node_direct_10k_ms.median), wasm_max_mib: js[0].wasm_memory[0].maxMiB };
}
console.log(JSON.stringify(out, null, 1));
