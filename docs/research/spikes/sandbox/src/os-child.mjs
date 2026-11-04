// Child-process sandbox worker: loads kernel + QuickJS, runs the realistic script once,
// then probes what the PROCESS itself (not the guest) could do if the JS engine were escaped.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const t0 = performance.now();
const deps = process.argv[2];
const { loadQuickJS, loadKernel, runScript } = await import("./lib/bridge.mjs");
const qjs = await loadQuickJS(deps); const kernel = await loadKernel(deps);
const initMs = performance.now() - t0;
const code = readFileSync(new URL("./scripts/enclosure.js", import.meta.url), "utf8");
const r = runScript({ qjs: await qjs.fresh(128), kernel, code });
const probes = {};
const tryit = async (k, f) => { try { probes[k] = "ALLOWED: " + String(await f()).slice(0, 80); } catch (e) { probes[k] = `denied: ${e.code || e.name}: ${String(e.message).slice(0, 90)}`; } };
const fs = await import("node:fs"); const cp = await import("node:child_process"); const net = await import("node:net");
await tryit("fs_write_tmp", () => { fs.writeFileSync("./out/os-probe-write.txt", "x"); return "wrote"; });
await tryit("fs_read_etc_passwd", () => fs.readFileSync("/etc/passwd", "utf8").length + " bytes");
await tryit("fs_read_home_repo", () => fs.readdirSync("/home/user/Open3DJ").length + " entries");
await tryit("child_process_spawn", () => cp.spawnSync("/bin/true").status);
await tryit("tcp_connect_1.1.1.1:443", () => new Promise((res, rej) => { const s = net.connect({ host: "1.1.1.1", port: 443, timeout: 1500 }); s.on("connect", () => { s.destroy(); res("connected"); }); s.on("timeout", () => { s.destroy(); rej(Object.assign(new Error("timeout"), { code: "TIMEOUT" })); }); s.on("error", rej); }));
await tryit("env_vars_visible", () => Object.keys(process.env).length + " vars");
process.stdout.write(JSON.stringify({ init_ms: Math.round(initMs), run_ok: r.ok, run_ms: Math.round(r.timings.total_ms), volume: r.parts?.[0].volume, probes, total_ms: Math.round(performance.now() - t0) }) + "\n");
