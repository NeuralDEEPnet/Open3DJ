// View tools that need no kernel (pure functions, tested in Node): exploded-view offsets and
// the first analysis overlays. The overlays are previews computed on the mesh in the browser:
// they show where to look, and the CPU kernel decides the gates of record (the FDM overhang
// gate in S3, draft in S9; docs/COMPUTE.md "GPU screens, CPU decides").

const DEG = 180 / Math.PI;

/**
 * Exploded-view offsets: each occurrence moves away from the assembly centre along the line
 * from that centre to its own centre, by factor times that distance. A part at the centre
 * stays. centres maps path -> [x, y, z]. View only: nothing is written to the model.
 */
export function explodeOffsets(centres, centre, factor) {
  const out = new Map();
  for (const [path, c] of centres) {
    out.set(path, [(c[0] - centre[0]) * factor, (c[1] - centre[1]) * factor, (c[2] - centre[2]) * factor]);
  }
  return out;
}

/**
 * Overhang angle of a surface with unit normal n for a build direction (default +Z): how far
 * the surface leans past vertical towards facing down, in degrees. 0 for a vertical wall,
 * 90 for a face pointing straight down, negative for faces that look up.
 */
export function overhangAngle(n, build = [0, 0, 1]) {
  const down = -(n[0] * build[0] + n[1] * build[1] + n[2] * build[2]);
  return Math.asin(Math.min(1, Math.max(-1, down))) * DEG;
}

/**
 * Overhang class for 3D printing with the build direction +Z: "overhang" when the surface
 * leans more than limitDeg (default 45) past vertical and does not rest on the bed, "bed" for
 * a face that points down within 1 degree at the part's lowest level, else "ok".
 */
export function overhangClass(n, onBed, limitDeg = 45, build = [0, 0, 1]) {
  const a = overhangAngle(n, build);
  if (onBed && a >= 89) return "bed";
  return a > limitDeg ? "overhang" : "ok";
}

/**
 * Draft angle of a surface with unit normal n for a pull direction: the angle between the
 * surface and the pull direction, in degrees. Positive faces open towards the pull, negative
 * ones away from it, 0 is a wall parallel to the pull.
 */
export function draftAngle(n, pull) {
  const p = Math.hypot(pull[0], pull[1], pull[2]) || 1;
  const d = (n[0] * pull[0] + n[1] * pull[1] + n[2] * pull[2]) / p;
  return Math.asin(Math.min(1, Math.max(-1, d))) * DEG;
}

/** Draft class: "positive" or "negative" when the draft is at least minDeg either way, else "insufficient". */
export function draftClass(n, pull, minDeg = 1) {
  const a = draftAngle(n, pull);
  if (a >= minDeg) return "positive";
  if (a <= -minDeg) return "negative";
  return "insufficient";
}

/** Legend entries per overlay: class, label and CSS colour token. */
export const LEGENDS = {
  overhang: [
    ["ok", "printable without support", "--ov-ok"],
    ["overhang", "overhang past the limit", "--ov-bad"],
    ["bed", "on the bed", "--ov-bed"],
  ],
  draft: [
    ["positive", "draft towards the pull", "--ov-pos"],
    ["negative", "draft away from the pull", "--ov-neg"],
    ["insufficient", "below the minimum draft", "--ov-bad"],
  ],
};

/**
 * Classify a mesh for an overlay, in world orientation. positions, normals and index are the
 * definition's arrays; rot is the occurrence's column-major 4x4 matrix (only its rotation is
 * used); options { kind: "overhang" | "draft", limitDeg, pull, minDeg }. Returns
 * { vertexClass: Uint8Array (class index per vertex, into LEGENDS[kind]), area: number[] per
 * class (observed, mm²) }. A vertex rests on the bed when it lies within tol of the part's
 * lowest point along the build direction.
 */
export function classifyMesh(positions, normals, index, rot, options) {
  const kinds = LEGENDS[options.kind].map((e) => e[0]);
  const count = Math.floor(positions.length / 3);
  const turn = (v) => [rot[0] * v[0] + rot[4] * v[1] + rot[8] * v[2], rot[1] * v[0] + rot[5] * v[1] + rot[9] * v[2], rot[2] * v[0] + rot[6] * v[1] + rot[10] * v[2]];
  let low = Infinity;
  let high = -Infinity;
  const z = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    z[i] = turn([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]])[2];
    if (z[i] < low) low = z[i];
    if (z[i] > high) high = z[i];
  }
  const tol = Math.max(1e-4, (high - low) * 1e-6);
  const classOf = (n, onBed) => (options.kind === "overhang" ? overhangClass(n, onBed, options.limitDeg ?? 45) : draftClass(n, options.pull ?? [0, 0, 1], options.minDeg ?? 1));
  const vertexClass = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const n = turn([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
    vertexClass[i] = kinds.indexOf(classOf(n, z[i] - low <= tol));
  }
  const area = kinds.map(() => 0);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const u = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const v = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const s = Math.hypot(cr[0], cr[1], cr[2]);
    if (s === 0) continue;
    const n = turn([cr[0] / s, cr[1] / s, cr[2] / s]);
    const onBed = z[index[t]] - low <= tol && z[index[t + 1]] - low <= tol && z[index[t + 2]] - low <= tol;
    area[kinds.indexOf(classOf(n, onBed))] += s / 2;
  }
  return { vertexClass, area };
}

/** A key for the rotation part of a column-major 4x4 matrix, so equal turns share one overlay. */
export function rotationKey(m) {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]].map((x) => Math.round(x * 1e6)).join(",");
}
