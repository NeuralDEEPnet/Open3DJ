// Child process for stdout.test.ts. It runs a STEP export, a 3MF export and a render through
// the pool with the default log (process.stderr) and reports on stderr. Its stdout must stay
// empty: that stream belongs to MCP stdio in the daemon.
import { BENCH_SCRIPT, createPool } from "./index.ts";

const pool = createPool({ size: 1 });
try {
  const exported = await pool.run({ kind: "export", script: BENCH_SCRIPT, rev: "r_leak", export: { formats: ["step", "3mf"] } });
  const rendered = await pool.run({ kind: "render", script: BENCH_SCRIPT, rev: "r_leak", render: { view: "multiview", format: "png" } });
  const summary = {
    export: exported.ok ? exported.artifacts!.map((a) => [a.name, a.bytes.length]) : exported.error,
    render: rendered.ok ? rendered.images!.map((i) => [i.name, i.bytes.length]) : rendered.error,
  };
  process.stderr.write(`RESULT ${JSON.stringify(summary)}\n`);
} finally {
  await pool.close();
}
