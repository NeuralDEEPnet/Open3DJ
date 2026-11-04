// Spike: evaluate an implicit field (sphere intersected with a gyroid lattice)
// on an N^3 grid with WebGPU (Dawn via the 'webgpu' npm package) and on the CPU,
// then compare results and timings. Usage:
//   node sdf-gpu-vs-cpu.mjs <path-to-node_modules/webgpu/index.js> [N]
import { createRequire } from 'node:module';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const N = isMainThread ? Number(process.argv[3] ?? 128) : workerData.N;
const CELL = 2.0 / (N - 1); // grid spans [-1,1]^3

function fieldCPU(x, y, z, f32) {
  // f32: round every intermediate to float32 to mimic the GPU type
  const r = f32 ? Math.fround : (v) => v;
  const s = 10.0;
  const sphere = r(r(Math.sqrt(r(r(x * x) + r(y * y)) + r(z * z))) - 0.9);
  const gx = r(x * s), gy = r(y * s), gz = r(z * s);
  const g = r(r(r(Math.sin(gx) * Math.cos(gy)) + r(Math.sin(gy) * Math.cos(gz))) + r(Math.sin(gz) * Math.cos(gx)));
  const lattice = r(r(Math.abs(g) / s) - 0.03);
  return r(Math.max(sphere, lattice));
}

function cpuSlab(z0, z1, f32) {
  const out = new Float32Array((z1 - z0) * N * N);
  let i = 0;
  for (let k = z0; k < z1; k++) for (let j = 0; j < N; j++) for (let ii = 0; ii < N; ii++) {
    out[i++] = fieldCPU(-1 + ii * CELL, -1 + j * CELL, -1 + k * CELL, f32);
  }
  return out;
}

if (!isMainThread) {
  const { z0, z1 } = workerData;
  const out = cpuSlab(z0, z1, true);
  parentPort.postMessage(out, [out.buffer]);
} else {
  const require = createRequire(import.meta.url);
  const { create, globals } = require(process.argv[2]);
  Object.assign(globalThis, globals);

  const shader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> outBuf: array<f32>;
const N: u32 = ${N}u;
const CELL: f32 = ${CELL.toFixed(10)};
fn field(p: vec3f) -> f32 {
  let s = 10.0;
  let sphere = length(p) - 0.9;
  let q = p * s;
  let g = sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
  let lattice = abs(g) / s - 0.03;
  return max(sphere, lattice);
}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N || id.z >= N) { return; }
  let p = vec3f(-1.0 + f32(id.x) * CELL, -1.0 + f32(id.y) * CELL, -1.0 + f32(id.z) * CELL);
  outBuf[(id.z * N + id.y) * N + id.x] = field(p);
}`;

  async function gpuRun() {
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { error: 'no adapter' };
    const info = adapter.info ?? {};
    const device = await adapter.requestDevice();
    const size = N * N * N * 4;
    const buf = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: shader });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const runOnce = async () => {
      const t0 = performance.now();
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(N / 4), Math.ceil(N / 4), Math.ceil(N / 4));
      pass.end();
      enc.copyBufferToBuffer(buf, 0, read, 0, size);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      return { ms: performance.now() - t0, out };
    };
    await runOnce(); // warm-up (pipeline compile)
    const a = await runOnce();
    const b = await runOnce();
    let identical = true;
    for (let i = 0; i < a.out.length; i++) if (a.out[i] !== b.out[i]) { identical = false; break; }
    device.destroy();
    return { info: { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallbackAdapter: info.isFallbackAdapter }, limits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize }, ms: Math.min(a.ms, b.ms), out: a.out, repeatIdentical: identical };
  }

  async function cpuPool(threads) {
    const t0 = performance.now();
    const slabs = [];
    const per = Math.ceil(N / threads);
    for (let t = 0; t < threads; t++) {
      const z0 = t * per, z1 = Math.min(N, z0 + per);
      if (z0 >= z1) continue;
      slabs.push(new Promise((res, rej) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { z0, z1, N } });
        w.once('message', (m) => { res({ z0, m }); w.terminate(); });
        w.once('error', rej);
      }));
    }
    const parts = await Promise.all(slabs);
    const out = new Float32Array(N * N * N);
    for (const { z0, m } of parts) out.set(m, z0 * N * N);
    return { ms: performance.now() - t0, out };
  }

  const t1 = performance.now();
  const cpu1 = cpuSlab(0, N, true);
  const cpu1ms = performance.now() - t1;
  const threads = os.availableParallelism();
  const cpuN = await cpuPool(threads);
  let poolSame = true;
  for (let i = 0; i < cpu1.length; i++) if (cpu1[i] !== cpuN.out[i]) { poolSame = false; break; }

  const g = await gpuRun();
  const res = { N, cells: N ** 3, cpu1ThreadMs: +cpu1ms.toFixed(1), cpuPoolThreads: threads, cpuPoolMs: +cpuN.ms.toFixed(1), cpuPoolBitIdenticalToSerial: poolSame };
  if (g.error) { res.gpu = g.error; }
  else {
    let maxAbs = 0, exact = 0, signFlips = 0;
    for (let i = 0; i < cpu1.length; i++) {
      const d = Math.abs(cpu1[i] - g.out[i]);
      if (d > maxAbs) maxAbs = d;
      if (d === 0) exact++;
      if ((cpu1[i] < 0) !== (g.out[i] < 0)) signFlips++;
    }
    Object.assign(res, { gpu: g.info, gpuLimits: g.limits, gpuMs: +g.ms.toFixed(1), gpuRepeatBitIdentical: g.repeatIdentical, gpuVsCpu: { maxAbsDiff: maxAbs, fractionBitIdentical: +(exact / cpu1.length).toFixed(4), insideOutsideFlips: signFlips } });
  }
  console.log(JSON.stringify(res, null, 1));
  process.exit(0);
}
