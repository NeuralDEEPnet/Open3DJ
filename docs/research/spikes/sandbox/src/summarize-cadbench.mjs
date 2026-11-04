import { readFileSync, readdirSync } from "node:fs";
import { median, r3 } from "./lib/util.mjs";
const dir = process.argv[2]; const rows = {};
for (const f of readdirSync(dir).sort()) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  j.results.forEach((r, i) => { const k = `${j.variant} | ${r.case}`; (rows[k] ||= []).push({ ...r, kinit: j.kernel_init_ms, qinit: j.quickjs_init_ms }); });
}
const out = {};
for (const [k, rs] of Object.entries(rows)) {
  const m = (sel) => r3(median(rs.map(sel)));
  out[k] = { processes: rs.length, kernel_ops: rs[0].kernel_ops, identical_volume_all: rs.every(r => r.identical_volume),
    direct_ms: m(r => r.direct_ms.median), bridge_total_ms: m(r => r.bridge_total_ms.median), overhead_ms: m(r => r.overhead_ms_median), overhead_pct: m(r => r.overhead_pct_median),
    setup_ms: m(r => r.bridge_setup_ms.median), guest_marshal_ms: m(r => r.bridge_guest_and_marshalling_ms.median), teardown_ms: m(r => r.bridge_teardown_ms.median),
    kernel_in_bridge_ms: m(r => r.bridge_kernel_ms.median), bridge_no_freeze_ms: m(r => r.bridge_total_no_freeze_ms.median),
    first_direct_ms: m(r => r.first_run_ms.direct), first_bridge_ms: m(r => r.first_run_ms.bridge), kernel_init_ms: m(r => r.kinit), quickjs_init_ms: m(r => r.qinit) };
}
console.log(JSON.stringify(out, null, 1));
