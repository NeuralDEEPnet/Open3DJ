// Human-readable output. The same results the MCP tools return, laid out for a terminal.
// --json prints the raw results instead.
import type { DocsOutput, ExportOutput, FileRef, GeometryReport, InspectOutput, RenderOutput, RunOutput, ScriptError, BBox } from "@open3dj/schemas";
import type { DoctorReport } from "@open3dj/compute";

const n = (x: number, digits = 3): string => String(Number(x.toFixed(digits)));
const size = (b: BBox): string => `${n(b.max[0] - b.min[0], 2)} x ${n(b.max[1] - b.min[1], 2)} x ${n(b.max[2] - b.min[2], 2)} mm`;

export function formatError(e: ScriptError, file?: string): string {
  const at = e.line !== undefined ? ` at ${file ? `${file}:` : "line "}${e.line}${e.column !== undefined ? `:${e.column}` : ""}` : "";
  const lines = [`error ${e.code}${at}: ${e.message}`];
  if (e.op) lines.push(`  op: ${e.op}`);
  if (e.elements?.length) lines.push(`  elements: ${e.elements.join(", ")}`);
  if (e.hint) lines.push(`  hint: ${e.hint}`);
  return `${lines.join("\n")}\n`;
}

export function formatReport(r: GeometryReport): string {
  const a = r.assembly;
  const lines = [`${r.status}  ${r.rev}  ${a.occurrences} occurrence${a.occurrences === 1 ? "" : "s"}, ${a.definitions} definition${a.definitions === 1 ? "" : "s"}${a.mass_g !== undefined ? `, ${n(a.mass_g, 2)} g` : ""}${a.bbox ? `, ${size(a.bbox)}` : ""}`];
  lines.push("parts:");
  const width = Math.max(4, ...r.parts.map((p) => p.def.length));
  for (const p of r.parts) {
    const occ = p.occurrences && p.occurrences > 1 ? ` x${p.occurrences}` : "";
    const solids = p.counts?.solids ?? 1;
    const faces = p.counts?.faces !== undefined ? `, ${p.counts.faces} faces` : "";
    lines.push(`  ${p.def.padEnd(width)}  ${p.valid ? "valid  " : "INVALID"}  ${n(p.volume_mm3, 2)} mm3  ${size(p.bbox)}  ${solids} solid${solids === 1 ? "" : "s"}${faces}${occ}`);
  }
  if (r.fits.length) {
    lines.push("fits:");
    for (const f of r.fits) {
      const v = f.volume_mm3 !== undefined ? `${n(f.volume_mm3)} mm3` : f.distance_mm !== undefined ? `${n(f.distance_mm)} mm` : "";
      lines.push(`  ${f.kind.padEnd(9)}  ${f.a} / ${f.b}  ${v} (${f.confidence})${f.n ? ` x${f.n}` : ""}`);
    }
  }
  for (const w of r.warnings ?? []) lines.push(`warning: ${w}`);
  for (const x of r.next ?? []) lines.push(`next: ${x}`);
  lines.push(`compute: ${r.compute.backend} on ${r.compute.device} (${r.compute.placement_reason})`);
  return `${lines.join("\n")}\n`;
}

export function formatRun(out: RunOutput, file?: string): string {
  if (out.error) return formatError(out.error, file);
  if (out.status === "queued") return `queued  job ${out.job_id}\n`;
  return out.report && out.status !== "error" ? formatReport({ ...out.report, status: out.status, rev: out.rev ?? "", compute: out.compute }) : `${out.status} ${out.rev ?? ""}\n`;
}

export function formatFiles(files: FileRef[] | undefined, base: string): string {
  return (files ?? []).map((f) => `  ${base}/${f.path}  ${f.format}  ${f.bytes} bytes  sha256 ${f.sha256.slice(0, 12)}`).join("\n");
}

export function formatRender(out: RenderOutput, base: string, notes: string[] = []): string {
  if (out.error) return formatError(out.error);
  const lines = [`ok  ${out.rev}  ${out.view}${out.targets ? ` of ${out.targets.join(", ")}` : ""}`, formatFiles(out.files, base), ...notes.map((x) => `note: ${x}`)];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function formatExport(out: ExportOutput, base: string): string {
  if (out.error) return formatError(out.error);
  const lines = [`ok  ${out.rev}`, formatFiles(out.files, base), ...(out.warnings ?? []).map((w) => `warning: ${w}`)];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function formatInspect(out: InspectOutput): string {
  if (out.error) return formatError(out.error);
  const lines: string[] = [];
  if (out.rev) lines.push(`rev ${out.rev}`);
  if (out.tree) {
    lines.push("tree:");
    for (const t of out.tree) {
      const depth = t.path.split("/").length - 1;
      const at = t.transform ? `  at ${t.transform.t.map((x) => n(x, 2)).join(", ")}` : "";
      lines.push(`  ${"  ".repeat(depth)}${t.path.split("/").pop()}  (${t.kind} ${t.def})${at}`);
    }
  }
  if (out.measure) {
    lines.push("measure:");
    for (const p of out.measure) lines.push(`  ${p.def}  ${p.valid ? "valid" : "INVALID"}  ${n(p.volume_mm3, 2)} mm3  ${p.area_mm2 !== undefined ? n(p.area_mm2, 2) : "?"} mm2  ${size(p.bbox)}  centre of mass ${(p.center_of_mass ?? []).map((x) => n(x, 2)).join(", ")}${p.mass_g !== undefined ? `  ${n(p.mass_g, 2)} g` : ""}`);
  }
  if (out.fits) {
    lines.push(out.fits.length ? "fits:" : "fits: none");
    for (const f of out.fits) lines.push(`  ${f.kind.padEnd(9)}  ${f.a} / ${f.b}  ${f.volume_mm3 !== undefined ? `${n(f.volume_mm3)} mm3` : `${n(f.distance_mm ?? 0)} mm`} (${f.confidence})`);
  }
  if (out.refs) lines.push(out.refs.length ? `refs: ${out.refs.map((r) => `${r.name} ${r.state}`).join(", ")}` : "refs: none");
  if (out.devices) lines.push(formatDevices(out.devices));
  if (out.job) lines.push(`job ${out.job.job_id}: ${out.job.state}${out.job.rev ? ` (${out.job.rev})` : ""}${out.job.reason ? `: ${out.job.reason}` : ""}`);
  return `${lines.join("\n")}\n`;
}

function formatDevices(d: NonNullable<InspectOutput["devices"]>): string {
  const gib = (b: number) => `${n(b / 1024 ** 3, 1)} GiB`;
  const lines = [
    `os: ${d.os.platform} ${d.os.release ?? ""} ${d.os.arch}`.replace(/\s+/g, " ").trim(),
    `cpu: ${d.cpu.model ?? "unknown"}, ${d.cpu.cores} cores`,
    `memory: ${gib(d.memory.total_bytes)} total, ${gib(d.memory.free_bytes)} free`,
    `runtime: node ${d.runtime.node}${d.runtime.occt_wasm ? `, occt-wasm ${d.runtime.occt_wasm}` : ""}${d.runtime.brepjs ? `, brepjs ${d.runtime.brepjs}` : ""}${d.runtime.quickjs ? `, quickjs ${d.runtime.quickjs}` : ""}`,
    `backends: ${d.backends.join(", ")}`,
    `gpus: ${d.gpus.length ? d.gpus.map((g) => g.model ?? g.id).join(", ") : "none detected"}`,
  ];
  if (d.pool) lines.push(`pool: ${d.pool.workers} workers${d.pool.interactive_reserved ? `, ${d.pool.interactive_reserved} reserved for interactive jobs` : ""}`);
  return lines.join("\n");
}

export function formatDoctor(r: DoctorReport): string {
  const lines = [formatDevices(r.inventory), `inventory hash: ${r.inventory_hash}`, ...r.notes.map((x) => `note: ${x}`)];
  if (r.bench) {
    const b = r.bench;
    lines.push(
      "bench:",
      `  kernel init       ${n(b.kernel_init_ms, 1)} ms`,
      `  first part        ${n(b.part_first_ms, 1)} ms`,
      `  warm part (p50)   ${n(b.part_ms, 1)} ms  (${n(b.part_volume_mm3, 2)} mm3)`,
      `  peak worker mem   ${n(b.peak_worker_memory_bytes / 1024 ** 2, 1)} MiB`,
      "  scaling:",
      ...b.scaling.map((s) => `    ${s.workers} worker${s.workers === 1 ? " " : "s"}  ${s.jobs} jobs  ${n(s.wall_ms, 0)} ms  ${n(s.jobs_per_s, 2)} jobs/s  x${n(s.speedup, 2)}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatDocs(out: DocsOutput): string {
  if (out.hits.length === 0) return `no hits for "${out.query}"\n`;
  const lines = [`${out.hits.length} hits, page ${out.page} of ${out.pages}`];
  for (const h of out.hits) {
    lines.push("", `## ${h.title}  [${h.kind}]${h.ref ? `  ${h.ref}` : ""}`, h.text);
  }
  if (out.page < out.pages) lines.push("", `more: open3dj docs ${JSON.stringify(out.query)} --page ${out.page + 1}`);
  return `${lines.join("\n")}\n`;
}
