// B-rep faces and edges from a definition's tessellation (pure functions, tested in Node).
//
// The export job writes the kernel's tessellation into the GLB unchanged: OCCT meshes each
// face on its own, in the kernel's face order (the order of subShapes(shape, "face"), whose
// 1-based position is the face:<n> element address), and never shares a vertex between two
// faces. So the triangles of face n form one run, and no other run touches its vertices.
// faceRanges() finds those runs; the viewer trusts them as addresses only when their count
// equals the kernel's face count in the report (packages/viewer/src/elements.test.ts checks the
// order against the kernel itself).
//
// Edges are the seams between those runs: a mesh edge that bounds face a and, at the same
// place, face b. They are drawn and picked, but the kernel numbers edges in an order the mesh
// does not carry, so an edge is named by the two faces it joins, never as edge:<n>.

/**
 * Split triangles into faces. index is the triangle index array, vertexCount the number of
 * vertices. Returns { starts, contiguous }: starts[f] is the first triangle of face f (0-based)
 * and starts[faces] the triangle count; contiguous is false when a face's triangles are not
 * one run (then the ranges are not the kernel's faces).
 */
export function faceRanges(index, vertexCount) {
  const tris = Math.floor(index.length / 3);
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t < tris; t++) {
    union(index[t * 3], index[t * 3 + 1]);
    union(index[t * 3], index[t * 3 + 2]);
  }
  const starts = [];
  const seen = new Set();
  let current = -1;
  let contiguous = true;
  for (let t = 0; t < tris; t++) {
    const root = find(index[t * 3]);
    if (root === current) continue;
    if (seen.has(root)) contiguous = false;
    seen.add(root);
    current = root;
    starts.push(t);
  }
  starts.push(tris);
  return { starts: Uint32Array.from(starts), contiguous };
}

/** The face (0-based) that holds triangle tri, by binary search in starts. -1 when out of range. */
export function faceOfTriangle(starts, tri) {
  const faces = starts.length - 1;
  if (tri < 0 || faces < 1 || tri >= starts[faces]) return -1;
  let lo = 0;
  let hi = faces - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= tri) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Element addresses for a definition: { faces, kernelFaces, addressed, reason }. addressed is
 * true only when the runs are contiguous and as many as the kernel's faces, so face index f
 * is the address face:<f + 1>.
 */
export function faceAddressing(ranges, kernelFaces) {
  const faces = ranges.starts.length - 1;
  if (!ranges.contiguous) return { faces, kernelFaces, addressed: false, reason: "the mesh faces are not in kernel order" };
  if (kernelFaces === undefined) return { faces, kernelFaces, addressed: false, reason: "the report has no face count for this definition" };
  if (faces !== kernelFaces) return { faces, kernelFaces, addressed: false, reason: `the mesh has ${faces} face patches and the kernel counts ${kernelFaces} faces` };
  return { faces, kernelFaces, addressed: true, reason: "" };
}

/**
 * Weld positions that lie within tolerance of each other (each vertex looks in its grid cell
 * and the 26 around it). Returns an Int32Array: vertex -> welded id.
 */
export function weldVertices(positions, tolerance) {
  const count = Math.floor(positions.length / 3);
  const out = new Int32Array(count);
  const cells = new Map();
  const reps = [];
  const cell = (x) => Math.round(x / tolerance);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const cx = cell(x);
    const cy = cell(y);
    const cz = cell(z);
    let at = -1;
    for (let dx = -1; dx <= 1 && at < 0; dx++) {
      for (let dy = -1; dy <= 1 && at < 0; dy++) {
        for (let dz = -1; dz <= 1 && at < 0; dz++) {
          const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const r of list) {
            if (Math.abs(positions[r * 3] - x) <= tolerance && Math.abs(positions[r * 3 + 1] - y) <= tolerance && Math.abs(positions[r * 3 + 2] - z) <= tolerance) {
              at = out[r];
              break;
            }
          }
        }
      }
    }
    if (at < 0) {
      at = reps.length;
      reps.push(i);
      const key = `${cx},${cy},${cz}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
    out[i] = at;
  }
  return out;
}

/**
 * The B-rep edges of a definition, as seams between faces. Returns
 * { edges: [{ faces: [a, b], segments: Float32Array (x0 y0 z0 x1 y1 z1 per segment), length }],
 *   faceEdges: Array(faces) of edge indices }. b is -1 for a free (open) edge. A seam of a
 * periodic face (both sides on the same face, as on a cylinder) is left out, as CAD views do.
 * Edges are ordered by their two faces, then by where their first segment appears.
 */
export function faceEdges(positions, index, starts, tolerance = weldTolerance(positions)) {
  const faces = starts.length - 1;
  const welded = weldVertices(positions, tolerance);
  const vertexCount = Math.floor(positions.length / 3);
  // 1. Mesh edges used once inside their own face: the face's boundary (seams included).
  /** welded segment key -> [{ face, a, b }] */
  const boundary = new Map();
  for (let f = 0; f < faces; f++) {
    const uses = new Map();
    for (let t = starts[f]; t < starts[f + 1]; t++) {
      for (let k = 0; k < 3; k++) {
        const a = index[t * 3 + k];
        const b = index[t * 3 + ((k + 1) % 3)];
        const key = a < b ? a * vertexCount + b : b * vertexCount + a;
        const u = uses.get(key);
        if (u) u.n++;
        else uses.set(key, { n: 1, a, b });
      }
    }
    for (const u of uses.values()) {
      if (u.n !== 1) continue;
      const wa = welded[u.a];
      const wb = welded[u.b];
      if (wa === wb) continue;
      const key = wa < wb ? `${wa},${wb}` : `${wb},${wa}`;
      const list = boundary.get(key);
      const entry = { face: f, a: u.a, b: u.b, wa, wb };
      if (list) list.push(entry);
      else boundary.set(key, [entry]);
    }
  }
  // 2. Pair the sides of each segment by face: a seam of one face is skipped.
  /** "fa,fb" -> segments */
  const groups = new Map();
  for (const list of boundary.values()) {
    const distinct = [...new Set(list.map((e) => e.face))].sort((x, y) => x - y);
    if (distinct.length === 1 && list.length > 1) continue;
    const pairs = distinct.length === 1 ? [[distinct[0], -1]] : distinct.slice(1).map((f) => [distinct[0], f]);
    for (const [fa, fb] of pairs) {
      const key = `${fa},${fb}`;
      const g = groups.get(key);
      const seg = list[0];
      if (g) g.push(seg);
      else groups.set(key, [seg]);
    }
  }
  // 3. Split each face pair's segments into connected chains: each chain is one edge.
  const edges = [];
  const keys = [...groups.keys()].sort((x, y) => {
    const [a1, b1] = x.split(",").map(Number);
    const [a2, b2] = y.split(",").map(Number);
    return a1 - a2 || (b1 < 0 ? 1e9 : b1) - (b2 < 0 ? 1e9 : b2);
  });
  for (const key of keys) {
    const segs = groups.get(key);
    const [fa, fb] = key.split(",").map(Number);
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) {
        const next = parent.get(x);
        parent.set(x, r);
        x = next;
      }
      return r;
    };
    for (const s of segs) {
      if (!parent.has(s.wa)) parent.set(s.wa, s.wa);
      if (!parent.has(s.wb)) parent.set(s.wb, s.wb);
      const ra = find(s.wa);
      const rb = find(s.wb);
      if (ra !== rb) parent.set(rb, ra);
    }
    const chains = new Map();
    for (const s of segs) {
      const r = find(s.wa);
      const c = chains.get(r);
      if (c) c.push(s);
      else chains.set(r, [s]);
    }
    for (const chain of chains.values()) {
      const segments = new Float32Array(chain.length * 6);
      let length = 0;
      chain.forEach((s, i) => {
        for (let k = 0; k < 3; k++) {
          segments[i * 6 + k] = positions[s.a * 3 + k];
          segments[i * 6 + 3 + k] = positions[s.b * 3 + k];
        }
        length += Math.hypot(positions[s.b * 3] - positions[s.a * 3], positions[s.b * 3 + 1] - positions[s.a * 3 + 1], positions[s.b * 3 + 2] - positions[s.a * 3 + 2]);
      });
      edges.push({ faces: [fa, fb], segments, length });
    }
  }
  const byFace = Array.from({ length: faces }, () => []);
  edges.forEach((e, i) => {
    byFace[e.faces[0]]?.push(i);
    if (e.faces[1] >= 0) byFace[e.faces[1]]?.push(i);
  });
  return { edges, faceEdges: byFace };
}

/** A weld tolerance for a mesh: 1e-5 of its size, at least 1e-5 mm (the export weld). */
export function weldTolerance(positions) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] < min) min = positions[i];
    if (positions[i] > max) max = positions[i];
  }
  return Math.max(1e-5, (Number.isFinite(max - min) ? max - min : 0) * 1e-5);
}

/**
 * What a picked element is called. address is the element address an agent can use: the
 * occurrence path, then the element in the @elem: form (ASSEMBLIES.md section 2.2), for
 * example "screw#2@elem:face:7"; it is null when the viewer cannot name the element the way
 * the kernel does. text is always set, for the panel and the clipboard.
 */
export function elementName(path, element) {
  if (!element) return { address: path, text: path };
  if (element.kind === "face") {
    if (element.addressed) {
      const address = `${path}@elem:face:${element.face + 1}`;
      return { address, text: address };
    }
    return { address: null, text: `${path}: a face (no address: ${element.reason || "unknown"})` };
  }
  if (element.kind === "edge") {
    const [a, b] = element.faces;
    if (!element.addressed) return { address: null, text: `${path}: an edge (no address: ${element.reason || "unknown"})` };
    const where = b >= 0 ? `between face:${a + 1} and face:${b + 1}` : `on the open boundary of face:${a + 1}`;
    return { address: null, text: `${path}: the edge ${where}` };
  }
  return { address: path, text: path };
}

/**
 * How close (in pixels) the pointer must be to an edge of the face under it for a click to pick
 * the edge rather than the face: at most maxPx, and less on a face that is small on screen
 * (10% of its projected extent), so a click on a zoomed-out assembly keeps the face address.
 */
export function edgeSnapPx(faceExtentPx, maxPx = 4) {
  if (!(faceExtentPx > 0)) return 0;
  return Math.min(maxPx, 0.1 * faceExtentPx);
}
