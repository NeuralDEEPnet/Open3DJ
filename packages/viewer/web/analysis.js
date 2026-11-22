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

/**
 * The zebra view's stripe image, used as a matcap: RGBA bytes of a size x size image whose
 * colour depends only on x, in `bands` black and white bands. Looked up by the view-space
 * normal, the stripes stand for parallel light bars reflected in the surface: they break at a
 * gap or a crease (G0), kink where a tangent edge has a curvature step (G1) and flow on across a
 * curvature-continuous join (G2). A preview on the display mesh; inspect continuity gives the
 * numbers of record.
 */
export function zebraImage(size = 256, bands = 12) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.floor(((x + 0.5) / size) * bands) % 2 === 0 ? 20 : 235;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** What the zebra view shows, for its legend. */
export const ZEBRA_NOTE = "Stripes break at a gap or crease (G0), kink where curvature steps (G1) and flow on across a smooth join (G2). A preview: inspect continuity gives the numbers.";

/**
 * The continuity overlay's legend: edge classes, then face kinds, each with its CSS colour token.
 * Its colours come from inspect fields=[continuity] (measured on the CPU kernel), not from the mesh.
 */
export const CONTINUITY_LEGEND = {
  edges: [
    ["gap", "gap: the faces do not meet", "--ct-gap"],
    ["G0", "G0: they meet at an angle", "--ov-bad"],
    ["G1", "G1: tangent, curvature steps", "--ov-neg"],
    ["G2", "G2: curvature continuous", "--ov-pos"],
  ],
  faces: [
    ["flat", "flat", "--ov-ok"],
    ["convex", "convex", "--ct-convex"],
    ["concave", "concave", "--ct-concave"],
    ["saddle", "saddle", "--ct-saddle"],
    ["mixed", "mixed", "--ct-mixed"],
    ["inflects", "inflects (an S-section)", "--ct-inflects"],
  ],
};
export const CONTINUITY_NOTE = "Measured on the CPU kernel (inspect continuity), not read off the mesh. An edge shows the worst class between its two faces; edges in the plain edge colour and sand-coloured faces were not measured or not listed.";

const EDGE_RANK = { gap: 0, G0: 1, G1: 2, G2: 3 };
/** face:<n> (1-based, the kernel's) to the viewer's 0-based face run. */
const faceRun = (address) => Number(address.slice(address.indexOf(":") + 1)) - 1;

/**
 * Index a continuity run (inspect fields=[continuity]) by definition, for colouring. pairs maps
 * "a,b" (0-based faces, a < b, as the viewer's edges carry them) to the worst class of the kernel
 * edges between those two faces; faces maps a 0-based face to its kind, or "inflects".
 */
export function continuityIndex(run) {
  const defs = new Map();
  for (const p of run?.parts ?? []) {
    const pairs = new Map();
    for (const e of p.edges) {
      const [a, b] = e.faces.map(faceRun).sort((x, y) => x - y);
      const key = `${a},${b}`;
      const was = pairs.get(key);
      if (was === undefined || EDGE_RANK[e.class] < EDGE_RANK[was]) pairs.set(key, e.class);
    }
    const faces = new Map();
    for (const f of p.faces) faces.set(faceRun(f.face), f.inflection ? "inflects" : f.kind);
    defs.set(p.def, { pairs, faces, facesComplete: p.faces_omitted === undefined });
  }
  return defs;
}

/** The class of a viewer edge between faces fa and fb (0-based; fb -1 on an open boundary), or undefined when the table has none. */
export function edgeClass(entry, fa, fb) {
  if (!entry || fa < 0 || fb < 0) return undefined;
  return entry.pairs.get(fa < fb ? `${fa},${fb}` : `${fb},${fa}`);
}

/** The kind of a face (0-based): as listed, else flat when the part's list is complete, else undefined. */
export function faceKind(entry, f) {
  if (!entry) return undefined;
  return entry.faces.get(f) ?? (entry.facesComplete ? "flat" : undefined);
}

/** Legend counts over a run: edges by the kernel's class counts, faces as drawn, and faces left off a capped list. */
export function continuityCounts(run) {
  const edges = { gap: 0, G0: 0, G1: 0, G2: 0 };
  const faces = { flat: 0, convex: 0, concave: 0, saddle: 0, mixed: 0, inflects: 0 };
  let unlisted = 0;
  for (const p of run?.parts ?? []) {
    for (const k of Object.keys(edges)) edges[k] += p.counts[k] ?? 0;
    faces.flat += p.face_counts.flat;
    for (const f of p.faces) faces[f.inflection ? "inflects" : f.kind]++;
    unlisted += p.faces_omitted ?? 0;
  }
  return { edges, faces, unlisted };
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
